'use strict';
// Linha do tempo de uma gravação: quem falou e quando, e os marcadores.
// Grava em JSONL (uma linha por evento) para não perder nada se o PC desligar
// no meio da sessão. É esse arquivo que a fase de cortes usa para redesenhar
// os retratos no vídeo vertical.

const fs = require('fs');
const path = require('path');

const JUNTAR_MS = 400;   // pausas menores que isso contam como a mesma fala
const MINIMO_MS = 150;   // falas menores que isso são ruído

function carimbo(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function formatarTempo(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = n => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

class Sessao {
  /**
   * @param {string} pasta onde guardar (uma subpasta por sessão é criada)
   * @param {object} info { inicio (ms), mesa: {id,nome}, jogadores: [{id, discordId, personagem, jogador}] }
   */
  constructor(pasta, info) {
    this.inicio = info.inicio || Date.now();
    this.dir = path.join(pasta, carimbo(new Date(this.inicio)));
    let n = 1;
    while (fs.existsSync(this.dir)) this.dir = path.join(pasta, carimbo(new Date(this.inicio)) + '-' + ++n);
    fs.mkdirSync(this.dir, { recursive: true });
    this.arquivo = path.join(this.dir, 'linha-do-tempo.jsonl');
    this.falando = new Map(); // chave -> ms em que começou
    this.marcadores = [];
    this.arquivos = [];
    this.encerrada = false;
    this._escrever({ tipo: 'inicio', t: this.inicio, mesa: info.mesa || null, jogadores: info.jogadores || [] });
  }

  _escrever(ev) {
    fs.appendFileSync(this.arquivo, JSON.stringify(ev) + '\n', 'utf8');
  }

  /** Recebe o estado atual (lista de {chave, falando}) e grava só as mudanças. */
  estado(lista, agora = Date.now()) {
    if (this.encerrada) return;
    const falandoAgora = new Set(lista.filter(p => p.falando && p.chave).map(p => p.chave));
    for (const chave of falandoAgora) {
      if (!this.falando.has(chave)) {
        this.falando.set(chave, agora);
        this._escrever({ tipo: 'fala-ini', t: agora, chave });
      }
    }
    for (const chave of [...this.falando.keys()]) {
      if (!falandoAgora.has(chave)) {
        this.falando.delete(chave);
        this._escrever({ tipo: 'fala-fim', t: agora, chave });
      }
    }
  }

  marcar(nome = '', origem = 'atalho', agora = Date.now()) {
    if (this.encerrada) return null;
    const m = { tipo: 'marcador', t: agora, rel: agora - this.inicio, nome: String(nome || '').slice(0, 120), origem };
    this.marcadores.push(m);
    this._escrever(m);
    return { ...m, tempo: formatarTempo(m.rel) };
  }

  /** Ex.: arquivo novo do OBS quando ele divide a gravação em pedaços. */
  arquivoGravacao(caminho, agora = Date.now()) {
    if (this.encerrada || !caminho) return;
    this.arquivos.push({ caminho, t: agora });
    this._escrever({ tipo: 'arquivo', t: agora, caminho });
  }

  /** Quanto tempo de vídeo esta sessão deveria ter agora (sem as pausas). */
  duracaoGravada(agora = Date.now()) {
    return agora - this.inicio - (this.pausadoTotal || 0) - (this.pausadaDesde ? agora - this.pausadaDesde : 0);
  }

  /** Gravação pausada / retomada no OBS. */
  pausa(agora = Date.now()) {
    if (this.encerrada || this.pausadaDesde) return;
    this.pausadaDesde = agora;
    this._escrever({ tipo: 'pausa', t: agora });
  }

  retoma(agora = Date.now()) {
    if (this.encerrada || !this.pausadaDesde) return;
    this.pausadoTotal = (this.pausadoTotal || 0) + (agora - this.pausadaDesde);
    this.pausadaDesde = null;
    this._escrever({ tipo: 'retoma', t: agora });
  }

  /** Replay salvo pelo OBS (arquivo separado com os últimos minutos). */
  replay(caminho, agora = Date.now()) {
    if (this.encerrada || !caminho) return;
    this._escrever({ tipo: 'replay', t: agora, caminho });
  }

  /** Batida periódica: se o PC cair, a leitura sabe até quando a sessão foi. */
  pulso(agora = Date.now()) {
    if (!this.encerrada) this._escrever({ tipo: 'pulso', t: agora });
  }

  renomearMarcador(t, nome) {
    const m = this.marcadores.find(x => x.t === t);
    if (!m) return false;
    m.nome = String(nome || '').slice(0, 120);
    this._escrever({ tipo: 'marcador-nome', t: m.t, nome: m.nome });
    return true;
  }

  encerrar(agora = Date.now()) {
    if (this.encerrada) return;
    this.retoma(agora);
    this.estado([], agora);
    this._escrever({ tipo: 'fim', t: agora });
    this.encerrada = true;
  }
}

/** Lê uma sessão gravada e devolve as falas já limpas e juntadas. */
function lerSessao(arquivo) {
  const linhas = fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean);
  let inicio = null, fim = null, mesa = null, jogadores = [];
  const abertas = new Map();
  const brutas = [];
  const marcadores = [];
  const arquivos = [];
  const replays = [];
  const pausas = [];
  let pausaAberta = null;
  let ultimoVisto = 0;
  for (const linha of linhas) {
    let ev;
    try { ev = JSON.parse(linha); } catch { continue; } // última linha cortada por queda de energia
    if (Number.isFinite(ev.t)) ultimoVisto = Math.max(ultimoVisto, ev.t);
    switch (ev.tipo) {
      case 'inicio': inicio = ev.t; mesa = ev.mesa; jogadores = ev.jogadores || []; break;
      case 'fala-ini': abertas.set(ev.chave, ev.t); break;
      case 'fala-fim':
        if (abertas.has(ev.chave)) { brutas.push({ chave: ev.chave, ini: abertas.get(ev.chave), fim: ev.t }); abertas.delete(ev.chave); }
        break;
      case 'marcador': marcadores.push({ t: ev.t, rel: ev.rel, nome: ev.nome, origem: ev.origem }); break;
      case 'marcador-nome': { const m = marcadores.find(x => x.t === ev.t); if (m) m.nome = ev.nome; break; }
      case 'arquivo': arquivos.push({ caminho: ev.caminho, t: ev.t }); break;
      case 'replay': replays.push({ caminho: ev.caminho, t: ev.t }); break;
      case 'pausa': pausaAberta = ev.t; break;
      case 'retoma': if (pausaAberta != null) { pausas.push([pausaAberta, ev.t]); pausaAberta = null; } break;
      case 'fim': fim = ev.t; break;
    }
  }
  const ultimo = fim || ultimoVisto;
  if (pausaAberta != null) pausas.push([pausaAberta, ultimo]);
  for (const [chave, ini] of abertas) brutas.push({ chave, ini, fim: ultimo });
  // pausas relativas ao começo da sessão (como os cortes)
  const pausasRel = pausas.map(([a, b]) => [a - inicio, b - inicio]);
  return { inicio, fim: ultimo, mesa, jogadores, falas: juntarFalas(brutas), marcadores, arquivos, replays, pausas: pausasRel };
}

function juntarFalas(brutas, juntar = JUNTAR_MS, minimo = MINIMO_MS) {
  const porChave = new Map();
  for (const f of brutas) {
    if (!porChave.has(f.chave)) porChave.set(f.chave, []);
    porChave.get(f.chave).push({ ...f });
  }
  const saida = [];
  for (const lista of porChave.values()) {
    lista.sort((a, b) => a.ini - b.ini);
    const juntas = [];
    for (const f of lista) {
      const ult = juntas[juntas.length - 1];
      if (ult && f.ini - ult.fim <= juntar) ult.fim = Math.max(ult.fim, f.fim);
      else juntas.push(f);
    }
    saida.push(...juntas.filter(f => f.fim - f.ini >= minimo));
  }
  return saida.sort((a, b) => a.ini - b.ini);
}

module.exports = { Sessao, lerSessao, juntarFalas, formatarTempo, carimbo };
