'use strict';
// Sessões gravadas e os cortes de cada uma: listar, criar, editar, exportar.

const fs = require('fs');
const path = require('path');

const { lerSessao } = require('../core/sessao');
const Pausas = require('../core/pausas');
const C = require('../core/cortes');
const { novoIdCorte } = require('../core/exportador');
const Momentos = require('../core/momentos');
const { atribuirFalantes } = require('../core/transcricao');
const Identidade = require('../core/identidade');
const Anotacoes = require('../core/anotacoes');

const ID_SESSAO = /^[\w-]{1,80}$/;
const MAX_CORTES = 300;

function dataCurta(ms) {
  const d = new Date(ms);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** Legendas de um corte: ligadas ou não, e os trechos de texto (tempos em ms da SESSÃO). */
function normalizarLegendasCorte(l) {
  l = l && typeof l === 'object' ? l : {};
  const segs = (Array.isArray(l.segmentos) ? l.segmentos : []).slice(0, 3000)
    .filter(x => x && Number.isFinite(Number(x.ini)) && Number.isFinite(Number(x.fim)) && Number(x.fim) > Number(x.ini))
    .map(x => ({
      id: typeof x.id === 'string' && /^[\w-]{1,24}$/.test(x.id) ? x.id : Math.random().toString(36).slice(2, 10),
      ini: Math.max(0, Math.round(Number(x.ini))), fim: Math.round(Number(x.fim)),
      texto: String(x.texto || '').replace(/\s+/g, ' ').trim().slice(0, 500),
      chave: typeof x.chave === 'string' ? x.chave.slice(0, 80) : '',
    }))
    .sort((a, b) => a.ini - b.ini);
  return { ativo: !!l.ativo, segmentos: segs };
}

class Biblioteca {
  /**
   * @param {object} o
   *  pastaSessoes, exportador, fila, servidor: () => ServidorOverlay|null,
   *  cfg: () => config, pastaCortesPadrao: string
   */
  constructor(o) {
    this.o = o;
    this.cache = new Map(); // id -> { mtime, dados }
    this.analises = new Map(); // id -> { progresso, erro }
    this.transcricoes = new Map(); // "sessao:corte" -> { etapa, progresso, fim, erro }
  }

  _dir(id) {
    if (!ID_SESSAO.test(String(id || ''))) throw new Error('Sessão inválida.');
    const dir = path.join(this.o.pastaSessoes, id);
    if (!fs.existsSync(path.join(dir, 'linha-do-tempo.jsonl'))) throw new Error('Sessão não encontrada.');
    return dir;
  }

  _ler(id) {
    const arq = path.join(this._dir(id), 'linha-do-tempo.jsonl');
    const mtime = fs.statSync(arq).mtimeMs;
    const c = this.cache.get(id);
    if (c && c.mtime === mtime) return c.dados;
    const dados = lerSessao(arq);
    this.cache.set(id, { mtime, dados });
    return dados;
  }

  _cortes(id) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(this._dir(id), 'cortes.json'), 'utf8'));
      return Array.isArray(d) ? d : [];
    } catch { return []; }
  }

  _salvarCortes(id, lista) {
    const arq = path.join(this._dir(id), 'cortes.json');
    fs.writeFileSync(arq + '.tmp', JSON.stringify(lista, null, 2));
    fs.renameSync(arq + '.tmp', arq);
  }

  /** Resumo de todas as sessões, mais novas primeiro. */
  listar() {
    let pastas = [];
    try { pastas = fs.readdirSync(this.o.pastaSessoes).filter(p => ID_SESSAO.test(p)); } catch { return []; }
    const lista = [];
    for (const id of pastas) {
      try {
        const s = this._ler(id);
        if (!s.inicio) continue;
        const existem = s.arquivos.filter(a => fs.existsSync(a.caminho)).length;
        lista.push({
          id, inicio: s.inicio, duracao: Math.max(0, (s.fim || s.inicio) - s.inicio),
          mesa: s.mesa ? s.mesa.nome : '', marcadores: s.marcadores.length, replays: s.replays.length,
          cortes: this._cortes(id).length, arquivos: s.arquivos.length, arquivosExistem: existem,
        });
      } catch { /* pasta estragada: ignora */ }
    }
    return lista.sort((a, b) => b.inicio - a.inicio).slice(0, 200);
  }

  /** Trechos (ms absolutos) com corte salvo: a limpeza não tira o vídeo deles. */
  protecoes() {
    let pastas = [];
    try { pastas = fs.readdirSync(this.o.pastaSessoes).filter(p => ID_SESSAO.test(p)); } catch { return []; }
    const lista = [];
    for (const id of pastas) {
      let cortes;
      try { cortes = this._cortes(id); } catch { continue; }
      if (!cortes.length) continue;
      const s = this._ler(id);
      for (const c of cortes) lista.push([s.inicio + c.ini - 60000, s.inicio + c.fim + 60000]);
    }
    return lista;
  }

  /** Tudo de uma sessão para as telas de corte. */
  async abrir(id) {
    const s = this._ler(id);
    const srv = this.o.servidor();
    const url = c => (srv && fs.existsSync(c) ? srv.urlMidia(c) : '');
    let linha = [];
    let erroFFmpeg = '';
    try {
      linha = await this.o.exportador.linha(s);
    } catch (e) {
      // sem FFmpeg: ainda dá para ver, usando os horários dos eventos
      erroFFmpeg = e.message;
      const R = ms => Pausas.paraGravacao(ms, s.pausas) / 1000;
      linha = s.arquivos.map((a, i) => {
        const prox = s.arquivos[i + 1];
        const ini = R(a.t - s.inicio);
        return { caminho: a.caminho, inicio: ini, duracao: R((prox ? prox.t : s.fim) - s.inicio) - ini, existe: fs.existsSync(a.caminho) };
      });
    }
    const info = linha.find(a => a.info) || {};
    const replays = [];
    for (const r of s.replays) {
      const existe = fs.existsSync(r.caminho);
      let duracao = 0;
      if (existe) { try { const i = await this.o.exportador.infoArquivo(r.caminho); duracao = i.duracao || 0; } catch { /* sem FFmpeg */ } }
      replays.push({ caminho: r.caminho, t: r.t, rel: r.t - s.inicio, existe, url: url(r.caminho), duracao });
    }
    return {
      id, inicio: s.inicio, fim: s.fim, duracao: Math.max(0, s.fim - s.inicio),
      mesa: s.mesa, jogadores: s.jogadores,
      marcadores: s.marcadores.map(m => ({ ...m, rel: m.t - s.inicio })),
      // as posições dos vídeos (arquivos[].inicio) estão em tempo da gravação; com pausas, a interface converte
      pausas: s.pausas || [],
      replays,
      arquivos: linha.map(a => ({ caminho: a.caminho, inicio: a.inicio, duracao: a.duracao, existe: a.existe !== false, url: a.existe === false ? '' : url(a.caminho) })),
      fonte: info.info ? { largura: info.info.largura, altura: info.info.altura, fps: info.info.fps, audios: info.info.audios } : null,
      falas: s.falas.map(f => ({ chave: f.chave, ini: f.ini - s.inicio, fim: f.fim - s.inicio })),
      cortes: this._cortes(id),
      erroFFmpeg,
    };
  }

  /** Arruma um corte vindo da interface antes de salvar. */
  _normalizarCorte(s, c, existente = {}) {
    const dur = Math.max(1000, s.fim - s.inicio);
    let ini = Math.max(0, Math.round(Number(c.ini)) || 0);
    let fim = Math.round(Number(c.fim)) || ini + 15000;
    fim = Math.min(Math.max(fim, ini + 300), dur + 60000);
    if (ini >= fim) ini = Math.max(0, fim - 300);
    let fonte = 'gravacao';
    if (typeof c.fonte === 'string' && c.fonte.startsWith('replay:') && s.replays.some(r => 'replay:' + r.caminho === c.fonte)) fonte = c.fonte;
    const a = c.audio && typeof c.audio === 'object' ? c.audio : {};
    const volumes = {};
    for (let k = 1; k <= 8; k++) {
      const v = Number((a.volumes || {})[k]);
      volumes[k] = Number.isFinite(v) ? Math.max(0, Math.min(200, Math.round(v))) : 100;
    }
    const v = c.vertical && typeof c.vertical === 'object' ? c.vertical : {};
    const num = (x, a, b, p) => (Number.isFinite(Number(x)) ? Math.max(a, Math.min(b, Number(x))) : p);
    const pontoCamera = p => {
      const w = num(p.w, 0.01, 1, 0.3);
      const o = { t: Math.max(0, Math.round(Number(p.t))), x: num(p.x, 0, 1 - w, 0), y: num(p.y, 0, 1, 0), w, trans: ['suave', 'rapido', 'corte'].includes(p.trans) ? p.trans : 'suave' };
      if (p.dur != null && Number.isFinite(Number(p.dur))) o.dur = Math.round(num(p.dur, 100, 10000, 600));
      return o;
    };
    // a câmera só é validada aqui (frações de 0 a 1); quem ajusta à proporção do vídeo é a
    // tela (que conhece o vídeo) e a exportação (que lê o vídeo de verdade)
    const camera = (Array.isArray(v.camera) ? v.camera : []).slice(0, 200)
      .filter(p => p && Number.isFinite(Number(p.t)) && Number(p.t) <= fim - ini + 1000)
      .map(pontoCamera)
      .sort((a, b) => a.t - b.t);
    // câmera do horizontal (zoom em partes da tela, para tutoriais)
    const hz = c.horizontal && typeof c.horizontal === 'object' ? c.horizontal : {};
    const cameraH = (Array.isArray(hz.camera) ? hz.camera : []).slice(0, 200)
      .filter(p => p && Number.isFinite(Number(p.t)) && Number(p.t) <= fim - ini + 1000)
      .map(pontoCamera)
      .sort((a, b) => a.t - b.t);
    return {
      id: existente.id || (typeof c.id === 'string' && /^[a-f0-9]{6,20}$/.test(c.id) ? c.id : novoIdCorte()),
      nome: String(c.nome || '').trim().slice(0, 100) || 'Corte',
      ini, fim, fonte,
      audio: { modo: a.modo === 'mix' ? 'mix' : 'faixa1', volumes },
      vertical: {
        modo: v.modo === 'inteira' ? 'inteira' : 'camera',
        camera,
      },
      horizontal: { camera: cameraH },
      anotacoes: Anotacoes.normalizarLista(c.anotacoes),
      retratosHorizontal: !!c.retratosHorizontal,
      legendas: normalizarLegendasCorte(c.legendas),
      // identidade visual: camadas da mesa escondidas neste corte; imagem final sim/não; música rápida
      identidade: { ocultas: (Array.isArray(c.identidade && c.identidade.ocultas) ? c.identidade.ocultas : []).filter(x => typeof x === 'string' && /^[\w-]{1,24}$/.test(x)).slice(0, 24) },
      final: typeof c.final === 'boolean' ? c.final : true,
      musica: Identidade.normalizarMusica(c.musica),
      criado: existente.criado || Date.now(),
      atualizado: Date.now(),
    };
  }

  salvarCorte(id, corte) {
    const s = this._ler(id);
    const lista = this._cortes(id);
    const i = lista.findIndex(x => x.id === corte.id);
    if (i < 0 && lista.length >= MAX_CORTES) throw new Error('Esta sessão já tem cortes demais.');
    const novo = this._normalizarCorte(s, corte, i >= 0 ? lista[i] : {});
    if (i >= 0) lista[i] = novo; else lista.push(novo);
    this._salvarCortes(id, lista);
    return novo;
  }

  excluirCorte(id, corteId) {
    const lista = this._cortes(id).filter(c => c.id !== corteId);
    this._salvarCortes(id, lista);
    return true;
  }

  /** Corte novo em volta de um marcador (ou da sessão inteira, se tMarcador for null). */
  async criarCorte(id, { rel = null, nome = '', fonte = 'gravacao', inteira = false } = {}) {
    const s = this._ler(id);
    const cfg = this.o.cfg().cortes;
    let ini, fim;
    if (inteira) { ini = 0; fim = s.fim - s.inicio; }
    else if (fonte.startsWith('replay:')) {
      const r = s.replays.find(x => 'replay:' + x.caminho === fonte);
      fim = r ? r.t - s.inicio : (rel || 0);
      // o replay tem a duração configurada no OBS (normalmente 20 s a 2 min)
      let dur = 30;
      try { const i = await this.o.exportador.infoArquivo(fonte.slice(7)); if (i.duracao) dur = i.duracao; } catch { /* sem FFmpeg */ }
      ini = Math.max(0, fim - dur * 1000);
    } else {
      ini = Math.max(0, rel - cfg.antes * 1000);
      fim = Math.min(s.fim - s.inicio, rel + cfg.depois * 1000);
    }
    return this.salvarCorte(id, { nome: nome || (inteira ? 'Sessão inteira' : 'Corte'), ini, fim, fonte });
  }

  // ---------------------------------------------------------------- sugestão de momentos

  _lerMomentos(id) {
    try { return JSON.parse(fs.readFileSync(path.join(this._dir(id), 'momentos.json'), 'utf8')); } catch { return null; }
  }

  /**
   * Sugestões de momentos da sessão. A análise do áudio roda em segundo plano:
   * enquanto isso devolve { estado: 'rodando', progresso }; depois { estado: 'pronto', sugestoes }.
   */
  async momentos(id, modo = '') {
    const forcar = modo === true || modo === 'refazer';
    const s = this._ler(id);
    const a = this.analises.get(id);
    if (a && !a.fim) return { estado: 'rodando', progresso: a.progresso };
    const linha = await this.o.exportador.linha(s);
    const chave = linha.map(x => `${x.caminho}:${Math.round(x.duracao)}:${x.existe !== false}`).join('|') + `|${s.falas.length}|${s.marcadores.length}`;
    const cache = this._lerMomentos(id);
    if (a && a.fim && a.erro) { this.analises.delete(id); return { estado: 'erro', erro: a.erro }; }
    if (cache && cache.chave === chave && !forcar) {
      const fora = new Set(cache.descartados || []);
      return { estado: 'pronto', sugestoes: cache.sugestoes.filter(x => !fora.has(x.t)) };
    }
    if (modo === 'cache') return { estado: 'nada' };
    if (!linha.some(x => x.existe !== false)) return { estado: 'erro', erro: 'O vídeo desta sessão já foi apagado.' };
    const job = { progresso: 0, fim: false };
    this.analises.set(id, job);
    this._analisar(id, s, linha, chave, cache).then(() => { job.fim = true; this.analises.delete(id); })
      .catch(e => { job.fim = true; job.erro = e.message; });
    return { estado: 'rodando', progresso: 0 };
  }

  async _analisar(id, s, linha, chave, cacheAntigo) {
    const job = this.analises.get(id);
    const ff = await this.o.exportador.ffmpeg();
    if (!ff.ok) throw new Error(ff.erro);
    const durSessao = Math.max(1000, s.fim - s.inicio);
    const volume = new Float32Array(Math.ceil(durSessao / 1000) + 1).fill(NaN);
    const existentes = linha.filter(x => x.existe !== false && x.duracao > 0);
    const total = existentes.reduce((t, x) => t + x.duracao, 0) || 1;
    let feito = 0;
    for (const arq of existentes) {
      const v = await Momentos.volumePorSegundo(ff.bin, arq.caminho, 0, seg => { job.progresso = Math.min(0.99, (feito + seg) / total); });
      for (let k = 0; k < v.length; k++) {
        if (!Number.isFinite(v[k])) continue;
        // segundo do arquivo → tempo da gravação → tempo da sessão (descontando pausas do OBS)
        const ms = Pausas.paraSessao((arq.inicio + k) * 1000, s.pausas);
        const i = Math.floor(ms / 1000);
        if (i >= 0 && i < volume.length && !(volume[i] >= v[k])) volume[i] = v[k];
      }
      feito += arq.duracao;
      job.progresso = Math.min(0.99, feito / total);
    }
    const nomes = {};
    for (const j of s.jogadores || []) nomes[j.id] = j.personagem || j.jogador || '';
    const sugestoes = Momentos.sugerir({
      duracaoMs: durSessao, volume,
      falas: s.falas.map(f => ({ chave: f.chave, ini: f.ini - s.inicio, fim: f.fim - s.inicio })),
      marcadores: s.marcadores.map(m => ({ rel: m.t - s.inicio })),
      nomes,
    });
    const arq = path.join(this._dir(id), 'momentos.json');
    fs.writeFileSync(arq + '.tmp', JSON.stringify({ versao: 1, chave, sugestoes, descartados: (cacheAntigo && cacheAntigo.descartados) || [] }));
    fs.renameSync(arq + '.tmp', arq);
  }

  descartarMomento(id, t) {
    const c = this._lerMomentos(id);
    if (!c) return false;
    c.descartados = [...new Set([...(c.descartados || []), Math.round(Number(t))])];
    fs.writeFileSync(path.join(this._dir(id), 'momentos.json'), JSON.stringify(c));
    return true;
  }

  /** Um corte para cada marcador que ainda não tem corte em volta. */
  cortesDosMarcadores(id) {
    const s = this._ler(id);
    const cfg = this.o.cfg().cortes;
    const lista = this._cortes(id);
    let criados = 0;
    for (const m of s.marcadores) {
      const rel = m.t - s.inicio;
      if (lista.some(c => c.ini <= rel && c.fim >= rel)) continue;
      if (lista.length >= MAX_CORTES) break;
      const ini = Math.max(0, rel - cfg.antes * 1000);
      const fim = Math.min(s.fim - s.inicio, rel + cfg.depois * 1000);
      lista.push(this._normalizarCorte(s, { nome: m.nome || 'Corte', ini, fim, fonte: 'gravacao' }));
      criados++;
    }
    if (criados) this._salvarCortes(id, lista);
    return { criados, cortes: lista };
  }

  // ---------------------------------------------------------------- legendas (transcrição)

  /**
   * Gera as legendas de um corte (transcrição no PC). Roda em segundo plano:
   * devolve { estado: 'rodando', etapa, progresso } até terminar; depois { estado: 'pronto', corte }.
   * modo: '' = começa se não estiver rodando; 'ver' = só consulta.
   */
  legendar(id, corteId, modo = '') {
    const chave = id + ':' + corteId;
    const job = this.transcricoes.get(chave);
    if (job && !job.fim) return { estado: 'rodando', etapa: job.etapa, progresso: job.progresso, mb: job.mb, totalMb: job.totalMb };
    if (job && job.fim) {
      this.transcricoes.delete(chave);
      if (job.erro) return { estado: 'erro', erro: job.erro };
      return { estado: 'pronto', corte: this._cortes(id).find(c => c.id === corteId) || null, avisos: job.avisos || [] };
    }
    if (modo === 'ver') return { estado: 'nada' };
    if (!this.o.transcricao) throw new Error('Transcrição indisponível.');
    const corte = this._cortes(id).find(c => c.id === corteId);
    if (!corte) throw new Error('Corte não encontrado. Salve o corte antes.');
    if (corte.fim - corte.ini > 20 * 60000) throw new Error('Para legendar, o corte precisa ter no máximo 20 minutos.');
    const novo = { etapa: 'preparando', progresso: 0, fim: false };
    this.transcricoes.set(chave, novo);
    this._legendar(id, corte, novo).then(() => { novo.fim = true; }).catch(e => { novo.fim = true; novo.erro = e.message; });
    return { estado: 'rodando', etapa: novo.etapa, progresso: 0 };
  }

  async _legendar(id, corte, job) {
    const cfgT = (this.o.cfg().transcricao) || {};
    const tr = this.o.transcricao;
    const s = this._ler(id);
    const est = tr.estado();
    if (!est.programa || !est.modelos[cfgT.modelo || 'preciso']) {
      job.etapa = 'baixando';
      await tr.preparar(cfgT.modelo || 'preciso', p => { job.progresso = p.fracao; job.mb = p.mb; job.totalMb = p.totalMb; job.etapa = p.etapa === 'programa' ? 'baixando-programa' : 'baixando'; });
    }
    job.etapa = 'extraindo'; job.progresso = 0;
    const tmp = fs.mkdtempSync(path.join(this.o.pastaTemp || require('os').tmpdir(), 'legendas-'));
    try {
      const wav = path.join(tmp, 'audio.wav');
      const { inicio } = await this.o.exportador.extrairAudio(path.join(this._dir(id), 'linha-do-tempo.jsonl'), corte, wav);
      job.etapa = 'transcrevendo'; job.progresso = 0;
      const nomes = (s.jogadores || []).map(j => j.personagem).filter(Boolean);
      const segs = await tr.transcrever(wav, {
        modelo: cfgT.modelo || 'preciso', idioma: cfgT.idioma || 'pt',
        dica: nomes.length ? nomes.join(', ') + '.' : '',
        aoProgresso: f => { job.progresso = f; },
      });
      // o tempo do áudio conta do começo do corte (em tempo da sessão); pausas no meio são raras em cortes
      const naSessao = segs.map(x => ({ ini: inicio + x.ini, fim: inicio + x.fim, texto: x.texto }))
        .filter(x => x.fim > corte.ini - 500 && x.ini < corte.fim + 500);
      const falas = s.falas.map(f => ({ chave: f.chave, ini: f.ini - s.inicio, fim: f.fim - s.inicio }));
      const comQuem = atribuirFalantes(naSessao, falas);
      if (!comQuem.length) job.avisos = ['Ninguém falando foi encontrado neste trecho.'];
      const lista = this._cortes(id);
      const i = lista.findIndex(c => c.id === corte.id);
      if (i < 0) throw new Error('O corte foi apagado durante a transcrição.');
      lista[i] = this._normalizarCorte(s, { ...lista[i], legendas: { ativo: true, segmentos: comQuem } }, lista[i]);
      this._salvarCortes(id, lista);
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
    }
  }

  pastaSaida() {
    return this.o.cfg().cortes.pasta || this.o.pastaCortesPadrao;
  }

  _nomeBase(s, corte) {
    return `${dataCurta(s.inicio)} ${s.mesa ? s.mesa.nome : ''} - ${corte.nome}`;
  }

  /**
   * Põe um corte na fila, um item por formato escolhido.
   * pedido: { sessaoId, corteId, presets, retratos, layout, retratosHorizontal }
   */
  async exportar(pedido) {
    const s = this._ler(pedido.sessaoId);
    const corte = this._cortes(pedido.sessaoId).find(c => c.id === pedido.corteId);
    if (!corte) throw new Error('Corte não encontrado. Salve o corte antes de exportar.');
    const presets = (pedido.presets || []).filter(p => C.PRESETS[p]);
    if (!presets.length) throw new Error('Escolha pelo menos um formato.');
    const ids = [];
    const avisos = [];
    for (const preset of presets) {
      const prep = await this.o.exportador.preparar({
        sessaoArquivo: path.join(this._dir(pedido.sessaoId), 'linha-do-tempo.jsonl'),
        corte: { ...corte, retratosHorizontal: undefined },
        preset,
        retratos: pedido.retratos || [],
        layout: pedido.layout || { layout: 'nenhum' },
        retratosHorizontal: pedido.retratosHorizontal ?? corte.retratosHorizontal,
        legendasAss: corte.legendas && corte.legendas.ativo && pedido.legendas ? pedido.legendas[preset] || null : null,
        camadas: (pedido.camadas && pedido.camadas[preset]) || [],
        fundo: (pedido.fundo && pedido.fundo[preset]) || null,
        final: corte.final !== false && pedido.final ? pedido.final[preset] || null : null,
        musica: this._musica(corte),
        anotacoes: (pedido.anotacoes && pedido.anotacoes[preset]) || [],
        gif: this.o.cfg().cortes.gif,
        pastaSaida: this.pastaSaida(),
        nomeBase: this._nomeBase(s, corte),
      });
      ids.push(this.o.fila.adicionar(prep));
    }
    return { ok: true, ids, avisos, mensagem: presets.length === 1 ? 'Na fila de exportação.' : `${presets.length} arquivos na fila.` };
  }

  /** Arquivo da música rápida de um corte (a faixa vem da biblioteca de músicas do bot). */
  _musica(corte) {
    const m = corte.musica;
    if (!m || !m.faixa || !this.o.caminhoMusica) return null;
    const arquivo = this.o.caminhoMusica(m.faixa);
    if (!arquivo) throw new Error('A música deste corte saiu da biblioteca de músicas. Escolha outra ou tire a música.');
    return { ...m, arquivo };
  }

  /** Compilado: itens = [{ sessaoId, corteId }] na ordem do vídeo final. */
  async compilado({ itens, preset, retratos, layout, retratosHorizontal, nome, camadas, fundo, final }) {
    const pedidos = [];
    for (const it of itens || []) {
      const corte = this._cortes(it.sessaoId).find(c => c.id === it.corteId);
      if (!corte) continue;
      pedidos.push({
        sessaoArquivo: path.join(this._dir(it.sessaoId), 'linha-do-tempo.jsonl'),
        corte, retratos: retratos || [], layout: layout || { layout: 'nenhum' }, retratosHorizontal: !!retratosHorizontal,
        camadas: camadas || [], fundo: fundo || null,
        anotacoes: Array.isArray(it.anotacoes) ? it.anotacoes : [],
      });
    }
    // a imagem final entra só uma vez, no fim do compilado
    if (pedidos.length && final) pedidos[pedidos.length - 1].final = final;
    const prep = await this.o.exportador.prepararCompilado(pedidos, { preset, pastaSaida: this.pastaSaida(), nomeBase: nome || 'Melhores momentos' });
    return { ok: true, ids: [this.o.fila.adicionar(prep)], mensagem: 'Compilado na fila de exportação.' };
  }
}

module.exports = { Biblioteca, dataCurta };
