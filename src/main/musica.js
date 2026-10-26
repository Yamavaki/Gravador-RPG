'use strict';
// Música e bot do Discord, sem nada do Electron (testável):
//  - biblioteca de faixas do PC (musica.json);
//  - motor de áudio (página escondida, Trilha Viva adaptado) recebe comandos daqui;
//  - mixer junta o áudio do motor e do YouTube e o bot toca no canal de voz.
// O main.js liga isto às janelas (motor e YouTube) e ao IPC.

const path = require('path');
const { EventEmitter } = require('events');
const cfgMod = require('../core/config');
const streamkit = require('../core/streamkit');
const { MixerPCM } = require('../core/musica/mixer');
const { BotDiscord, idDoToken, linkConvite } = require('../core/musica/bot');
const { BibliotecaMusica } = require('../core/musica/biblioteca');
const { CofreToken } = require('../core/musica/cofre');

// comandos que a interface pode mandar direto para uma camada que está tocando
const COMANDOS_CAMADA = [
  'pararCamada', 'pararTudo', 'pausar', 'retomar', 'volume', 'irParaSecao', 'irParaSecaoPorNome', 'cancelarPendente',
  'mudarModo', 'definirCrossfade', 'irPara', 'repetirSecao', 'tocarDireto', 'reordenar', 'removerItem', 'modoFila',
  'aleatorio', 'tocarItem', 'pular',
];
const TEMPO_MOTOR = 10000;

class ControladorMusica extends EventEmitter {
  /**
   * @param {object} o
   *  ctl: Controlador (config, mesa, servidor, salvarConfig)
   *  pastaDados
   *  carregar: (testes) carrega discord.js/@discordjs/voice
   *  cifrar/decifrar: proteção do token (safeStorage do Electron)
   */
  constructor(o) {
    super();
    this.ctl = o.ctl;
    this.biblioteca = new BibliotecaMusica(path.join(o.pastaDados, 'musica.json'));
    this.cofre = new CofreToken(path.join(o.pastaDados, 'bot.json'), { cifrar: o.cifrar, decifrar: o.decifrar });
    this.mixer = new MixerPCM({ agora: o.agora });
    this.bot = new BotDiscord({ mixer: this.mixer, carregar: o.carregar });
    this.bot.on('estado', est => this._botMudou(est));
    this.mixer.on('atividade', () => this._mudou());
    this.motor = { pronto: false, estado: null, duracoes: {}, tocando: [], agora: 0, aviso: '' };
    this.abas = new Map();          // abas do navegador interno (cada uma é uma fonte de som)
    this.abaAtiva = '';
    this._pedidos = new Map();
    this._idPedido = 0;
    this._esperandoMotor = [];
    this.aplicarConfig();
  }

  get cfg() { return this.ctl.cfg.musica; }

  /** Volumes e "ouvir no PC" a partir da config (chamado ao salvar). */
  aplicarConfig() {
    const c = this.cfg;
    this.mixer.definirVolume(null, c.volume / 100);
    for (const a of this.abas.values()) { this._volumeAba(a); this.emit('ouvir-aba', a.id, this.ouvirAba(a.id)); }
    this.mixer.definirVolume('motor', 1);
    if (this.motor.pronto) {
      this._enviarMotor('volumeGeral', [c.volumeFaixas / 100]).catch(() => {});
      this._enviarMotor('ouvirNoPC', [c.ouvirNoPC]).catch(() => {});
    }
  }

  // ---------------------------------------------------------------- motor de áudio

  motorPronto() {
    this.motor.pronto = true;
    const c = this.cfg;
    this._enviarMotor('volumeGeral', [c.volumeFaixas / 100]).catch(() => {});
    this._enviarMotor('ouvirNoPC', [c.ouvirNoPC]).catch(() => {});
    const fila = this._esperandoMotor;
    this._esperandoMotor = [];
    fila.forEach(fn => fn());
    this._mudou();
  }

  /** O motor fechou ou travou: comandos esperam ele abrir de novo. */
  motorCaiu() {
    this.motor = { pronto: false, estado: null, duracoes: {}, tocando: [], agora: 0, aviso: '' };
    for (const [, p] of this._pedidos) p.rejeitar(new Error('O motor de áudio reiniciou. Tente de novo.'));
    this._pedidos.clear();
    this._mudou();
  }

  motorEstado(e) {
    if (!e || typeof e !== 'object') return;
    this.motor.estado = e.estado || null;
    this.motor.duracoes = e.duracoes || {};
    this.motor.tocando = Array.isArray(e.tocando) ? e.tocando : [];
    this.motor.agora = Number(e.agora) || Date.now();
    this.motor.audio = e.audio || '';
    this._mudou();
  }

  motorAviso(texto) {
    this.motor.aviso = String(texto || '').slice(0, 300);
    this.emit('aviso', this.motor.aviso);
    this._mudou();
  }

  responderMotor(id, r) {
    const p = this._pedidos.get(id);
    if (!p) return;
    this._pedidos.delete(id);
    clearTimeout(p.t);
    if (r && r.erro) p.rejeitar(new Error(r.erro)); else p.resolver(r || { ok: true });
  }

  /** PCM que chegou do motor ou da janela do YouTube. */
  pcm(fonte, dados) {
    if (fonte !== 'motor' && !(fonte.startsWith('aba:') && this.abas.has(fonte.slice(4)))) return;
    this.mixer.empurrar(fonte, dados);
  }

  _enviarMotor(cmd, args = []) {
    const enviar = () => new Promise((resolver, rejeitar) => {
      const id = ++this._idPedido;
      const t = setTimeout(() => {
        this._pedidos.delete(id);
        rejeitar(new Error('O motor de áudio não respondeu.'));
      }, TEMPO_MOTOR);
      this._pedidos.set(id, { resolver, rejeitar, t });
      this.emit('motor', { id, cmd, args });
    });
    if (this.motor.pronto) return enviar();
    // primeira música: pede para abrir o motor e espera ele ficar pronto
    this.emit('abrir-motor');
    return new Promise((resolver, rejeitar) => {
      const t = setTimeout(() => {
        this._esperandoMotor = this._esperandoMotor.filter(f => f !== seguir);
        rejeitar(new Error('O motor de áudio não abriu. Feche e abra o app.'));
      }, TEMPO_MOTOR);
      const seguir = () => { clearTimeout(t); enviar().then(resolver, rejeitar); };
      this._esperandoMotor.push(seguir);
    });
  }

  /** Faixa da biblioteca → item que o motor entende (o arquivo vira um endereço local). */
  _item(f) {
    const srv = this.ctl.servidor;
    if (!srv) throw new Error('O servidor local do app não está rodando (veja a porta em Gravação).');
    return { uuid: f.id, src: srv.urlMidia(f.caminho), nome: f.nome, grupo: f.grupo, tipo: f.tipo, repetir: f.repetir, secoes: f.secoes };
  }

  _faixa(id) {
    const f = this.biblioteca.faixa(id);
    if (!f) throw new Error('Faixa não encontrada na biblioteca.');
    return f;
  }

  async tocar(id) {
    await this._enviarMotor('tocarSom', [this._item(this._faixa(id))]);
    return { ok: true };
  }

  async tocarFila(ids, aleatorio = false) {
    const fs = (Array.isArray(ids) ? ids : []).map(id => this.biblioteca.faixa(id)).filter(Boolean);
    if (!fs.length) throw new Error('Marque as faixas da fila primeiro.');
    await this._enviarMotor('tocarFila', [fs.map(f => this._item(f)), 'fila', !!aleatorio]);
    return { ok: true };
  }

  async adicionarNaFila(camadaId, ids) {
    const fs = (Array.isArray(ids) ? ids : []).map(id => this.biblioteca.faixa(id)).filter(Boolean);
    if (!fs.length) return { ok: true };
    await this._enviarMotor('adicionarSons', [String(camadaId), fs.map(f => this._item(f))]);
    return { ok: true };
  }

  async comando(cmd, args) {
    if (!COMANDOS_CAMADA.includes(cmd)) throw new Error('Comando de música desconhecido: ' + cmd);
    await this._enviarMotor(cmd, Array.isArray(args) ? args.slice(0, 4) : []);
    return { ok: true };
  }

  // ---------------------------------------------------------------- biblioteca

  listar() { return this.biblioteca.listar(); }

  adicionarArquivos(caminhos) {
    const novos = this.biblioteca.adicionar(caminhos || []);
    return { novos: novos.length, faixas: this.listar() };
  }

  adicionarPasta(pasta) {
    const novos = this.biblioteca.adicionarPasta(pasta);
    return { novos: novos.length, faixas: this.listar() };
  }

  atualizarFaixa(id, campos) {
    const antes = this._faixa(id);
    const f = this.biblioteca.atualizar(id, campos || {});
    if (antes.tipo !== f.tipo && this.motor.pronto) this._enviarMotor('atualizarTipo', [f.id, f.tipo]).catch(() => {});
    return f;
  }

  salvarSecoes(id, secoes, duracao) {
    const f = this.biblioteca.definirSecoes(id, secoes, duracao);
    // se a faixa estiver tocando, vale na hora (sem cortar)
    if (this.motor.pronto) this._enviarMotor('atualizarSecoes', [f.id, f.secoes]).catch(() => {});
    return f;
  }

  removerFaixas(ids) {
    this.biblioteca.remover(ids);
    return this.listar();
  }

  /** Endereço local de uma faixa (prévia no editor de seções). */
  urlFaixa(id) {
    return this._item(this._faixa(id)).src;
  }

  // ---------------------------------------------------------------- bot

  salvarToken(token) {
    token = String(token || '').trim();
    if (token && !idDoToken(token)) throw new Error('Isso não parece um token de bot. Copie em Developer Portal → Bot → Reset Token.');
    this.cofre.salvar(token);
    this._mudou();
    return this.publico();
  }

  async ligarBot() {
    const token = this.cofre.ler();
    if (!token) throw new Error('Cole o token do bot e salve primeiro.');
    await this.bot.conectar(token);
    if (this.cfg.entrarAoConectar) {
      const alvo = this.canalAlvo();
      if (alvo) await this.bot.entrar(alvo.servidor, alvo.canal).catch(() => {});
    }
    return this.publico();
  }

  async desligarBot() {
    await this.bot.desconectar();
    return this.publico();
  }

  /** Canal onde o bot deve tocar: o escolhido na mesa ou o mesmo canal do StreamKit. */
  canalAlvo(mesa = this.ctl.mesa) {
    if (mesa.musica && mesa.musica.canal) {
      const [servidor, canal] = mesa.musica.canal.split('/');
      return { servidor, canal, origem: 'mesa' };
    }
    const r = streamkit.validarUrl(mesa.streamkit.url);
    return r.ok ? { servidor: r.servidor, canal: r.canal, origem: 'streamkit' } : null;
  }

  async entrar(servidor, canal) {
    if (!servidor || !canal) {
      const alvo = this.canalAlvo();
      if (!alvo) throw new Error('Escolha o canal de voz do bot (ou configure o canal do StreamKit da mesa).');
      ({ servidor, canal } = alvo);
    }
    await this.bot.entrar(String(servidor), String(canal));
    return this.publico();
  }

  sair() {
    this.bot.sair();
    return this.publico();
  }

  /** A mesa ou o canal do StreamKit mudou: o bot acompanha, se estiver num canal. */
  mesaMudou() {
    if (this.bot.estado.etapa !== 'online' || this.bot.estado.voz === 'fora') return;
    const alvo = this.canalAlvo();
    const atual = this.bot.estado.canal;
    if (!alvo || (atual && atual.servidor === alvo.servidor && atual.canal === alvo.canal)) return;
    this.bot.entrar(alvo.servidor, alvo.canal).catch(() => {});
  }

  _botMudou(est) {
    // o bot aparece no StreamKit como qualquer pessoa: fica ignorado em todas as mesas
    if (est.etapa === 'online' && est.usuario && est.usuario.id) {
      const id = est.usuario.id;
      const cfg = this.ctl.cfg;
      if (cfg.musica.botId !== id || cfg.mesas.some(m => !m.ignorados.includes(id))) {
        const nova = JSON.parse(JSON.stringify(cfg));
        nova.musica.botId = id;
        // vai no começo da lista (a lista tem limite e guarda os primeiros)
        for (const m of nova.mesas) m.ignorados = [id, ...m.ignorados.filter(x => x !== id)];
        try { this.ctl.salvarConfig(nova); } catch { /* tenta de novo na próxima */ }
      }
    }
    this._mudou();
  }

  // ---------------------------------------------------------------- YouTube

  // ---------------------------------------------------------------- navegador (abas)

  /** O main.js abriu uma aba nova (cada aba toca o próprio som, com volume próprio). */
  abaAberta(id, url, opc = {}) {
    // "prévia": a aba nova começa tocando só aqui no app (mudo no Discord) até você liberar
    const previa = opc.previa != null ? !!opc.previa : this.cfg.abasNovas === 'previa';
    const a = { id, url: String(url || ''), titulo: 'Nova aba', icone: '', tocando: false, carregando: true, voltar: false, avancar: false, volume: 1, mudo: previa, ouvir: previa };
    this.abas.set(id, a);
    if (opc.ativar !== false || !this.abaAtiva) this.abaAtiva = id;
    this._volumeAba(a);
    this._mudou();
    return a;
  }

  /** Título, endereço, ícone, "tocando", navegação... vindos da aba. */
  abaMudou(id, campos) {
    const a = this.abas.get(id);
    if (!a || !campos || typeof campos !== 'object') return;
    let mudou = false;
    for (const k of ['url', 'titulo', 'icone', 'tocando', 'carregando', 'voltar', 'avancar']) {
      if (!(k in campos)) continue;
      const v = typeof a[k] === 'boolean' ? !!campos[k] : String(campos[k] || '').slice(0, k === 'url' || k === 'icone' ? 2000 : 200);
      if (a[k] !== v) { a[k] = v; mudou = true; }
    }
    if (mudou) this._mudou();
  }

  abaFechou(id) {
    if (!this.abas.delete(id)) return;
    const f = this.mixer.fontes.get('aba:' + id);
    if (f) { f.limpar(); this.mixer.fontes.delete('aba:' + id); }
    if (this.abaAtiva === id) this.abaAtiva = [...this.abas.keys()].pop() || '';
    this._mudou();
  }

  ativarAba(id) {
    if (!this.abas.has(id)) throw new Error('Aba não encontrada.');
    this.abaAtiva = id;
    this._mudou();
  }

  /** volume e mudo valem para o Discord; "ouvir" toca a aba também aqui no PC (prévia). */
  volumeAba(id, volume, mudo, ouvir) {
    const a = this.abas.get(id);
    if (!a) throw new Error('Aba não encontrada.');
    if (volume != null) a.volume = Math.max(0, Math.min(1, Number(volume) || 0));
    if (mudo != null) a.mudo = !!mudo;
    if (ouvir != null && a.ouvir !== !!ouvir) { a.ouvir = !!ouvir; this.emit('ouvir-aba', id, this.ouvirAba(id)); }
    this._volumeAba(a);
    this._mudou();
    return a;
  }

  _volumeAba(a) {
    this.mixer.definirVolume('aba:' + a.id, a.mudo ? 0 : a.volume * this.cfg.volumeYoutube / 100);
  }

  /** A aba toca nas caixas de som deste PC? (prévia da aba, ou "ouvir aqui" geral ligado) */
  ouvirAba(id) {
    const a = this.abas.get(id);
    return !!(a && (a.ouvir || this.cfg.ouvirNoPC));
  }

  /** Lista das abas na ordem em que foram abertas. */
  listaAbas() { return [...this.abas.values()].map(a => ({ ...a })); }

  // ---------------------------------------------------------------- estado

  /** Chamado a cada 2 s pelo controlador. */
  tique() { this.mixer.verificarSilencio(); }

  publico() {
    const token = this.cofre.ler();
    const id = idDoToken(token) || this.cfg.botId;
    return {
      bot: this.bot.publico(),
      temToken: !!token,
      convite: linkConvite(id),
      alvo: this.canalAlvo(),
      motor: { pronto: this.motor.pronto, estado: this.motor.estado, duracoes: this.motor.duracoes, tocando: this.motor.tocando, agora: this.motor.agora, aviso: this.motor.aviso },
      abas: this.listaAbas(),
      abaAtiva: this.abaAtiva,
      somSaindo: this.mixer.ativo,
    };
  }

  _mudou() { this.emit('mudou'); }

  async parar() {
    for (const [, p] of this._pedidos) clearTimeout(p.t);
    this._pedidos.clear();
    await this.bot.desconectar().catch(() => {});
  }
}

module.exports = { ControladorMusica, COMANDOS_CAMADA };
