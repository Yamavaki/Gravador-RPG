'use strict';
// Mistura o áudio que chega das fontes (motor das faixas do PC e janela do YouTube)
// num único fluxo PCM: 48 kHz, estéreo, 16 bits (o "Raw" que o @discordjs/voice aceita).
//
// Cada fonte manda pedaços no ritmo do relógio da placa de som; o Discord consome no
// ritmo dele (20 ms por pacote). Os dois relógios nunca batem perfeitamente, então cada
// fonte tem um "colchão" (buffer) e o mixer corrige a diferença aos pouquinhos,
// tirando ou repetindo uma amostra a cada tanto (inaudível), em vez de dar pulos.

const { Readable } = require('stream');
const { EventEmitter } = require('events');

const TAXA = 48000;
const CANAIS = 2;
const BYTES_QUADRO = CANAIS * 2;                 // um instante estéreo de 16 bits
const QUADROS_PACOTE = TAXA / 50;                // 20 ms = 960 instantes
const BYTES_PACOTE = QUADROS_PACOTE * BYTES_QUADRO;
const ms = n => Math.round(TAXA * n / 1000);     // milissegundos → instantes

class Fonte {
  constructor(nome, o = {}) {
    this.nome = nome;
    this.volume = o.volume == null ? 1 : o.volume;
    this.alvo = o.alvo || ms(250);          // colchão desejado (absorve os trancos do PC)
    this.maximo = o.maximo || ms(2000);     // acima disso joga o mais velho fora
    this.media = null;                       // nível do colchão suavizado (~1 s)
    this.pedacos = [];                       // Int16Array intercalados
    this.quadros = 0;                        // instantes guardados
    this.enchendo = true;                    // espera o colchão antes de tocar
    this.ultimoSom = 0;                      // quando chegou algo que não é silêncio
    this.descartados = 0;
    this.ajustes = 0;
  }

  /** Guarda um pedaço. Devolve true se ele tem som de verdade (não é silêncio). */
  empurrar(int16, agora) {
    if (int16.length % CANAIS) int16 = int16.subarray(0, int16.length - (int16.length % CANAIS));
    if (!int16.length) return false;
    this.pedacos.push(int16);
    this.quadros += int16.length / CANAIS;
    let som = false;
    for (let i = 0; i < int16.length; i += 7) {
      if (int16[i] > 24 || int16[i] < -24) { this.ultimoSom = agora; som = true; break; }
    }
    // fonte atrasada demais: joga o áudio mais velho fora (melhor que tocar atrasado)
    while (this.quadros > this.maximo) {
      if (this.pedacos.length > 1) {
        const p = this.pedacos.shift();
        this.quadros -= p.length / CANAIS;
        this.descartados += p.length / CANAIS;
      } else {
        // um pedaço enorme sozinho: corta o começo dele
        const tirar = this.quadros - this.alvo;
        this.pedacos[0] = this.pedacos[0].subarray(tirar * CANAIS);
        this.quadros -= tirar;
        this.descartados += tirar;
      }
    }
    if (this.enchendo && this.quadros >= this.alvo) this.enchendo = false;
    return som;
  }

  /** Tira `n` instantes (Int16Array intercalado), ou null se não houver o bastante. */
  _tirar(n) {
    if (this.quadros < n) return null;
    const out = new Int16Array(n * CANAIS);
    let feito = 0;
    while (feito < n * CANAIS) {
      const p = this.pedacos[0];
      const falta = n * CANAIS - feito;
      if (p.length <= falta) {
        out.set(p, feito);
        feito += p.length;
        this.pedacos.shift();
      } else {
        out.set(p.subarray(0, falta), feito);
        this.pedacos[0] = p.subarray(falta);
        feito += falta;
      }
    }
    this.quadros -= n;
    return out;
  }

  /**
   * Um pacote de 20 ms, já corrigindo a diferença de relógio. null = sem som agora.
   * A correção olha o nível MÉDIO do colchão (não o de agora, que pula com os trancos)
   * e, quando ele se afasta do alvo, estica ou encolhe o pacote em 2 amostras (0,2%)
   * com interpolação linear: imperceptível, sem estalos.
   */
  ler() {
    if (this.enchendo) return null;
    const n = QUADROS_PACOTE;
    // muito atrasada (ficou sem leitor um tempo): pula direto para perto do alvo
    if (this.quadros > this.alvo * 4) {
      const tirar = this.quadros - this.alvo;
      this._tirar(tirar);
      this.descartados += tirar;
      this.media = this.quadros;
    }
    this.media = this.media == null ? this.quadros : this.media * 0.98 + this.quadros * 0.02;
    let pedir = n;
    if (this.media > this.alvo * 1.6) pedir = n + 2;          // adiantada: gasta um pouco mais
    else if (this.media < this.alvo * 0.6) pedir = n - 2;     // atrasada: gasta um pouco menos
    const bruto = this._tirar(pedir);
    if (!bruto) { this.enchendo = true; this.media = null; this.buracos = (this.buracos || 0) + 1; return null; }
    if (pedir === n) return bruto;
    this.ajustes++;
    const out = new Int16Array(n * CANAIS);
    const passo = (pedir - 1) / (n - 1);
    for (let i = 0; i < n; i++) {
      const pos = i * passo;
      const j = Math.floor(pos), f = pos - j, k = Math.min(j + 1, pedir - 1);
      out[i * 2] = Math.round(bruto[j * 2] * (1 - f) + bruto[k * 2] * f);
      out[i * 2 + 1] = Math.round(bruto[j * 2 + 1] * (1 - f) + bruto[k * 2 + 1] * f);
    }
    return out;
  }

  limpar() {
    this.pedacos = [];
    this.quadros = 0;
    this.enchendo = true;
    this.media = null;
  }
}

class MixerPCM extends EventEmitter {
  constructor(o = {}) {
    super();
    this.agora = o.agora || (() => Date.now());
    this.fontes = new Map();
    this.volume = 1;                 // volume geral do bot
    this.saida = null;
    this.ativo = false;               // tem som de verdade saindo?
    this.silencioParaPausa = o.silencioParaPausa || 3000;
    this._ultimoSom = 0;
    this._ultimaLeitura = 0;
  }

  fonte(nome, o) {
    let f = this.fontes.get(nome);
    if (!f) { f = new Fonte(nome, o); this.fontes.set(nome, f); }
    return f;
  }

  definirVolume(nome, v) {
    v = Math.max(0, Math.min(2, Number(v) || 0));
    if (nome) this.fonte(nome).volume = v;
    else this.volume = v;
  }

  /** PCM que chegou de uma fonte (Buffer, Uint8Array ou Int16Array, s16le intercalado). */
  empurrar(nome, dados) {
    let int16;
    if (dados instanceof Int16Array) int16 = dados;
    else {
      const b = Buffer.isBuffer(dados) ? dados : Buffer.from(dados.buffer || dados, dados.byteOffset || 0, dados.byteLength);
      const util = b.length - (b.length % BYTES_QUADRO);
      if (!util) return;
      // copia para um bloco alinhado (o Buffer pode vir com deslocamento ímpar)
      const copia = new Int16Array(util / 2);
      Buffer.from(copia.buffer).set(b.subarray(0, util));
      int16 = copia;
    }
    const agora = this.agora();
    const f = this.fonte(nome);
    if (f.empurrar(int16, agora)) this._marcarSom(agora);
    // ninguém lendo (bot fora do canal ou calado): não deixa áudio velho acumular
    if (agora - this._ultimaLeitura > 200) this._aparar(f);
  }

  _marcarSom(agora) {
    this._ultimoSom = agora;
    if (!this.ativo) { this.ativo = true; this.emit('atividade', true); }
  }

  /** Chamado de tempos em tempos: avisa quando ficou em silêncio (para o bot "calar"). */
  verificarSilencio() {
    if (this.ativo && this.agora() - this._ultimoSom > this.silencioParaPausa) {
      this.ativo = false;
      this.emit('atividade', false);
    }
    return this.ativo;
  }

  /** Mistura um pacote de 20 ms de todas as fontes (Buffer de 3840 bytes). */
  pacote() {
    this._ultimaLeitura = this.agora();
    const soma = new Int32Array(QUADROS_PACOTE * CANAIS);
    for (const f of this.fontes.values()) {
      const p = f.ler();
      if (!p || f.volume === 0) continue;
      const g = f.volume;
      for (let i = 0; i < soma.length; i++) soma[i] += p[i] * g;
    }
    const out = Buffer.allocUnsafe(BYTES_PACOTE);
    const g = this.volume;
    for (let i = 0; i < soma.length; i++) {
      let v = soma[i] * g;
      if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
      out.writeInt16LE(v | 0, i * 2);
    }
    return out;
  }

  /** Deixa cada colchão só com o necessário (o resto é áudio velho acumulado). */
  aparar() {
    for (const f of this.fontes.values()) this._aparar(f);
  }

  _aparar(f) {
    while (f.quadros > f.alvo && f.pedacos.length > 1 && f.quadros - f.pedacos[0].length / CANAIS >= f.alvo / 2) {
      const p = f.pedacos.shift();
      f.quadros -= p.length / CANAIS;
    }
  }

  /** Esvazia os colchões. */
  limpar() {
    for (const f of this.fontes.values()) f.limpar();
  }

  /**
   * Fluxo para o Discord. Cada chamada cria um novo (o anterior termina).
   * Entrega no ritmo do relógio: no máximo ~200 ms adiantado. Se quem lê ficou parado
   * (bot calado), não tenta "recuperar" o tempo perdido despejando áudio de uma vez.
   */
  criarSaida() {
    if (this.saida) this.saida.push(null);
    const mixer = this;
    const PACOTE_MS = 20, FOLGA_MS = 200;
    let inicio = 0, enviados = 0, espera = null;
    const s = new Readable({
      highWaterMark: BYTES_PACOTE * 3,
      read() {
        if (mixer.saida !== s) { this.push(null); return; }
        if (espera) return;
        const agora = Date.now();
        if (!inicio) inicio = agora;
        let adiantado = enviados * PACOTE_MS - (agora - inicio);
        if (adiantado < -FOLGA_MS) { inicio = agora - enviados * PACOTE_MS; adiantado = 0; }
        if (adiantado > FOLGA_MS) {
          espera = setTimeout(() => {
            espera = null;
            if (mixer.saida !== s) { s.push(null); return; }
            enviados++;
            s.push(mixer.pacote());
          }, adiantado - FOLGA_MS);
          return;
        }
        enviados++;
        this.push(mixer.pacote());
      },
      destroy(err, cb) { clearTimeout(espera); cb(err); },
    });
    this.saida = s;
    return s;
  }

  diagnostico() {
    return [...this.fontes.values()].map(f => ({
      nome: f.nome, colchaoMs: Math.round(f.quadros / TAXA * 1000), descartadosMs: Math.round(f.descartados / TAXA * 1000), ajustes: f.ajustes, buracos: f.buracos || 0, volume: f.volume,
    }));
  }
}

module.exports = { MixerPCM, Fonte, TAXA, CANAIS, QUADROS_PACOTE, BYTES_PACOTE };
