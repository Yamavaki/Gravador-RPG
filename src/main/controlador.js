'use strict';
// O "cérebro" do app, sem nada do Electron: junta OBS, StreamKit, overlay,
// linha do tempo e limpeza. O main.js só liga isso às janelas e atalhos.
// Assim dá para testar tudo isso sem abrir o app.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const cfgMod = require('../core/config');
const { vistaOverlay, casarPresencas } = require('../core/pessoas');
const streamkit = require('../core/streamkit');
const { Sessao, formatarTempo } = require('../core/sessao');
const { planejar, RegistroSegmentos, executar, mesmoArquivo, normalizarCaminho } = require('../core/limpeza');
const { ClienteOBS } = require('../core/obs');
const { ServidorOverlay } = require('../core/servidor-overlay');
const { Exportador } = require('../core/exportador');
const { Fila } = require('../core/fila');
const { Biblioteca } = require('./biblioteca');
const { Transcricao } = require('../core/transcricao');
const { Atualizador } = require('./atualizador');
const VERSAO_APP = require('../../package.json').version;
const { ControladorMusica } = require('./musica');

const EXT_IMAGEM = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif'];
const MAX_IMAGEM = 15 * 1024 * 1024;
const SEM_DADOS_MS = 8000; // StreamKit sem mandar nada há 8 s = desconectado

class Controlador extends EventEmitter {
  /**
   * @param {object} o
   *  pastaDados: onde ficam config, imagens, sessões
   *  removerArquivo(caminho, destino): Promise — Lixeira ou apagar
   *  notificar(titulo, texto)
   *  WebSocket: (testes) classe de WebSocket para o OBS
   *  agora: (testes) relógio
   */
  constructor(o) {
    super();
    this.o = o;
    this.agora = o.agora || (() => Date.now());
    this.pastaDados = o.pastaDados;
    this.pastaImagens = path.join(o.pastaDados, 'imagens');
    this.pastaSessoes = path.join(o.pastaDados, 'sessoes');
    fs.mkdirSync(this.pastaImagens, { recursive: true });
    fs.mkdirSync(this.pastaSessoes, { recursive: true });

    this.armazem = new cfgMod.ArmazemConfig(path.join(o.pastaDados, 'config.json'));
    this.cfg = this.armazem.carregar();
    this.registro = new RegistroSegmentos(path.join(o.pastaDados, 'segmentos.json'));
    this.arquivoMarcadores = path.join(o.pastaDados, 'marcadores.json');
    this.marcadoresAbs = this._lerMarcadores();

    this.obs = new ClienteOBS({ WebSocket: o.WebSocket, intervaloReconexao: o.intervaloReconexao });
    this.obsInfo = { conectado: false, erro: '', gravando: false, versao: '', arquivo: '' };
    this.sk = { presencas: [], ultimo: 0, texto: '', conectado: false };
    this.sessao = null;
    this.ultimaLimpeza = null;
    this.servidor = null;
    this.erroServidor = '';
    this._timers = [];
    this._agendado = null;

    // cortes e exportações
    this.exportador = new Exportador({ ffmpegConfigurado: () => this.cfg.cortes.ffmpeg });
    this.fila = new Fila();
    this.fila.on('mudou', () => this._mudou());
    this.fila.on('pronta', t => {
      if (this.o.notificar) this.o.notificar('Exportação pronta', t.titulo);
    });
    this.ffInfo = { ok: false, verificando: true };
    this.transcricao = o.transcricao || new Transcricao({ pasta: path.join(o.pastaDados, 'whisper') });
    this.atualizador = o.atualizador || new Atualizador({ versaoAtual: VERSAO_APP, pastaDados: o.pastaDados, pastaApp: path.join(__dirname, '..', '..') });
    this.atualizador.on('mudou', () => this._mudou());
    this.biblioteca = new Biblioteca({
      transcricao: this.transcricao,
      caminhoMusica: id => { const f = this.musica && this.musica.biblioteca.faixas.find(x => x.id === id); return f && fs.existsSync(f.caminho) ? f.caminho : null; },
      pastaTemp: o.pastaTemp,
      pastaSessoes: this.pastaSessoes,
      exportador: this.exportador,
      fila: this.fila,
      servidor: () => this.servidor,
      cfg: () => this.cfg,
      pastaCortesPadrao: o.pastaCortes || path.join(o.pastaDados, 'cortes'),
    });
    this._ultimoFoundry = new Map();

    // música e bot do Discord
    this.musica = new ControladorMusica({
      ctl: this, pastaDados: o.pastaDados, carregar: o.carregarDiscord, cifrar: o.cifrar, decifrar: o.decifrar, agora: o.agora,
    });
    this.musica.on('mudou', () => this._mudou());
  }

  // ---------------------------------------------------------------- ciclo de vida

  async iniciar() {
    await this._iniciarServidor();
    this.verificarFFmpeg();
    this._ligarOBS();
    this._timers.push(setInterval(() => this._tique(), 2000));
    this._timers.push(setInterval(() => this.limpar().catch(() => {}), 5 * 60 * 1000));
    this.publicarOverlay();
    this._mudou();
    // procura versão nova um pouco depois de abrir e depois a cada 6 horas
    if (this.o.procurarAtualizacoes) {
      const procurar = () => { if (this.cfg.app.procurarAtualizacoes) this.atualizador.verificar().catch(() => {}); };
      this._timers.push(setTimeout(procurar, 15000));
      this._timers.push(setInterval(procurar, 6 * 3600 * 1000));
    }
  }

  async parar() {
    this.parado = true;
    for (const t of this.fila.lista()) if (t.estado === 'rodando' || t.estado === 'espera') this.fila.cancelar(t.id);
    this._timers.forEach(clearInterval);
    this._timers = [];
    clearTimeout(this._agendado);
    await this.musica.parar();
    if (this.sessao) this.sessao.encerrar(this.agora());
    this.obs.desconectar();
    if (this.servidor) await this.servidor.parar();
  }

  async _iniciarServidor() {
    if (this.servidor) await this.servidor.parar();
    const porta = this.o.portaOverlay != null ? this.o.portaOverlay : this.cfg.overlayPorta;
    this.servidor = new ServidorOverlay({ porta, pastaImagens: this.pastaImagens });
    this.servidor.aoFoundry = dados => this.eventoFoundry(dados);
    try {
      await this.servidor.iniciar();
      this.erroServidor = '';
      this.emit('servidor', this.servidor);
    } catch (e) {
      this.erroServidor = e.message;
      this.servidor = null;
    }
  }

  _tique() {
    const noOBS = this.servidor ? this.servidor.abertosNoOBS : 0;
    if (noOBS !== this._noOBS) { this._noOBS = noOBS; this._mudou(); }
    const vivo = this.agora() - this.sk.ultimo < SEM_DADOS_MS;
    if (vivo !== this.sk.conectado) {
      this.sk.conectado = vivo;
      this.publicarOverlay();
      this._mudou();
    }
    if (this.sessao) this.sessao.pulso(this.agora());
    this.musica.tique();
  }

  // ---------------------------------------------------------------- estado para a interface

  get mesa() { return cfgMod.mesaAtiva(this.cfg); }

  estadoPublico() {
    const mesa = this.mesa;
    const { porJogador, desconhecidos } = casarPresencas(mesa, this.sk.presencas);
    const segs = this.registro.segmentos();
    const plano = this.simularLimpeza(segs);
    return {
      config: JSON.parse(JSON.stringify(this.cfg)), // cópia: quem recebe não mexe na config viva
      mesaId: mesa.id,
      versao: VERSAO_APP,
      atualizacao: this.atualizador.publico(),
      overlayUrl: this.servidor ? this.servidor.url : '',
      overlayNoOBS: this.servidor ? this.servidor.abertosNoOBS : 0,
      erroServidor: this.erroServidor,
      obs: { ...this.obsInfo },
      streamkit: {
        configurado: !!mesa.streamkit.url,
        conectado: this.sk.conectado,
        texto: this.sk.texto,
        presentes: this.sk.presencas.length,
        jogadores: Object.fromEntries([...porJogador].map(([id, p]) => [id, { falando: p.falando, nome: p.nome }])),
        desconhecidos,
      },
      sessao: this.sessao ? {
        inicio: this.sessao.inicio,
        pasta: this.sessao.dir,
        marcadores: this.sessao.marcadores.slice(-20).reverse().map(m => ({ t: m.t, nome: m.nome, origem: m.origem, tempo: formatarTempo(m.rel) })),
      } : null,
      disco: {
        pedacos: segs.length,
        horas: plano.totalHoras,
        gb: plano.totalGB,
        protegidos: plano.protegidos.length,
        aApagar: plano.apagar.length,
        acimaDoLimite: plano.acimaDoLimite,
        ultimaLimpeza: this.ultimaLimpeza,
      },
      fila: this.fila.lista(),
      ffmpeg: this.ffInfo,
      pastaCortes: this.biblioteca.pastaSaida(),
      musica: this.musica.publico(),
    };
  }

  /** Procura o FFmpeg (e a placa NVIDIA). Roda no início e quando muda o caminho. */
  async verificarFFmpeg() {
    this.ffInfo = { ok: false, verificando: true };
    this._mudou();
    try {
      const r = await this.exportador.ffmpeg(true);
      this.ffInfo = r.ok ? { ok: true, versao: r.versao, nvenc: r.nvenc, bin: r.bin } : { ok: false, erro: r.erro };
    } catch (e) {
      this.ffInfo = { ok: false, erro: e.message };
    }
    this._mudou();
    return this.ffInfo;
  }

  _mudou() {
    if (this._agendado || this.parado) return;
    this._agendado = setTimeout(() => {
      this._agendado = null;
      this.emit('estado', this.estadoPublico());
    }, 80);
  }

  // ---------------------------------------------------------------- configuração

  salvarConfig(novo) {
    const antes = this.cfg;
    this.cfg = this.armazem.salvar(novo);
    const ma = cfgMod.mesaAtiva(antes), md = this.mesa;
    if (JSON.stringify(antes.atalhos) !== JSON.stringify(this.cfg.atalhos)) this.emit('atalhos', this.cfg.atalhos);
    if (ma.streamkit.url !== md.streamkit.url || ma.id !== md.id) {
      this.sk = { presencas: [], ultimo: 0, texto: '', conectado: false };
      this.emit('streamkit-url', this.urlStreamKit());
    }
    if (JSON.stringify(antes.obs) !== JSON.stringify(this.cfg.obs)) this._ligarOBS();
    if (JSON.stringify(antes.musica) !== JSON.stringify(this.cfg.musica)) this.musica.aplicarConfig();
    if (ma.streamkit.url !== md.streamkit.url || ma.id !== md.id || ma.musica.canal !== md.musica.canal) this.musica.mesaMudou();
    if (antes.cortes.ffmpeg !== this.cfg.cortes.ffmpeg) this.verificarFFmpeg();
    if (antes.overlayPorta !== this.cfg.overlayPorta) {
      this._iniciarServidor().then(() => { this.publicarOverlay(); this._mudou(); });
    }
    this._limparImagensOrfas();
    this.publicarOverlay();
    this._mudou();
    return this.cfg;
  }

  /** Troca o canal de voz da mesa ativa (lista salva em Conexões). Funciona no meio da gravação. */
  trocarCanal(canalId) {
    const cfg = JSON.parse(JSON.stringify(this.cfg));
    const mesa = cfgMod.mesaAtiva(cfg);
    const canal = mesa.streamkit.canais.find(c => c.id === canalId);
    if (!canal) throw new Error('Canal não encontrado.');
    mesa.streamkit.ativo = canal.id;
    mesa.streamkit.url = canal.url;
    return this.salvarConfig(cfg);
  }

  /** Link que veio do site do StreamKit: vira um canal novo (ou ativa o que já existe). */
  adicionarCanal(url, nome) {
    const r = streamkit.validarUrl(url);
    if (!r.ok) throw new Error(r.erro || 'Link do StreamKit inválido.');
    const cfg = JSON.parse(JSON.stringify(this.cfg));
    const mesa = cfgMod.mesaAtiva(cfg);
    const chave = u => { const v = streamkit.validarUrl(u); return v.ok ? v.servidor + '/' + v.canal : u; };
    let canal = mesa.streamkit.canais.find(c => chave(c.url) === r.servidor + '/' + r.canal);
    let novo = false;
    if (!canal) {
      canal = { id: cfgMod.novoId(), nome: String(nome || '').trim() || 'Canal ' + (mesa.streamkit.canais.length + 1), url: String(url).trim() };
      mesa.streamkit.canais.push(canal);
      novo = true;
    }
    mesa.streamkit.ativo = canal.id;
    mesa.streamkit.url = canal.url;
    return { config: this.salvarConfig(cfg), canalId: canal.id, novo };
  }

  /** Link do StreamKit da mesa ativa, já conferido (ou '' se não houver). */
  urlStreamKit() {
    const r = streamkit.validarUrl(this.mesa.streamkit.url);
    return r.ok ? r.url : '';
  }

  /** Copia a imagem escolhida para a pasta do app (o arquivo original pode sumir). */
  importarImagem(origem, jogadorId) {
    const ext = path.extname(origem).toLowerCase();
    if (!EXT_IMAGEM.includes(ext)) throw new Error('Formato não suportado. Use PNG, JPG, WEBP, GIF ou AVIF.');
    const st = fs.statSync(origem);
    if (st.size > MAX_IMAGEM) throw new Error('Imagem grande demais (máximo 15 MB).');
    const seguro = String(jogadorId).replace(/[^a-z0-9]/gi, '').slice(0, 32) || 'img';
    const nome = `${seguro}-${this.agora()}${ext}`;
    fs.copyFileSync(origem, path.join(this.pastaImagens, nome));
    return nome;
  }

  _limparImagensOrfas() {
    // imagens em uso: retratos, camadas da identidade visual, imagens finais e fundos do vertical
    const usadas = new Set(this.cfg.mesas.flatMap(m => [
      ...m.jogadores.map(j => j.imagem),
      ...((m.identidade && m.identidade.camadas) || []).map(c => c.imagem),
      m.final && m.final.h.imagem, m.final && m.final.v.imagem,
      m.vertical && m.vertical.fundo && m.vertical.fundo.imagem,
    ]).filter(Boolean));
    let arquivos = [];
    try { arquivos = fs.readdirSync(this.pastaImagens); } catch { return; }
    for (const f of arquivos) {
      if (usadas.has(f)) continue;
      const c = path.join(this.pastaImagens, f);
      try {
        // só apaga as que ficaram órfãs há mais de 1 minuto (evita apagar uma recém-importada não salva)
        if (this.agora() - fs.statSync(c).mtimeMs > 60000) fs.unlinkSync(c);
      } catch { /* em uso */ }
    }
  }

  // ---------------------------------------------------------------- StreamKit

  /** Dados brutos vindos da janela escondida do StreamKit. */
  receberStreamKit(brutos, texto = '') {
    const antes = this.sk.presencas.length;
    this.sk.presencas = streamkit.interpretar(brutos);
    this.sk.ultimo = this.agora();
    this.sk.texto = String(texto || '').slice(0, 300);
    this.sk.conectado = true;
    if (this.sessao) {
      // na linha do tempo, quem está na mesa é guardado pelo id do jogador (vale mesmo se a
      // pessoa trocar de nome ou de foto no Discord); quem não está, pelo ID ou nome do Discord
      const { porJogador, desconhecidos } = casarPresencas(this.mesa, this.sk.presencas);
      const lista = [...porJogador].map(([id, p]) => ({ chave: id, falando: p.falando }))
        .concat(desconhecidos.map(p => ({ chave: p.discordId || 'nome:' + p.nome.toLowerCase(), falando: p.falando })));
      this.sessao.estado(lista, this.agora());
    }
    if (antes === 0 && this.sk.presencas.length > 0 && this.cfg.gravacao.gravarAoEntrar && this.obsInfo.conectado && !this.obsInfo.gravando) {
      this.obs.iniciarGravacao().catch(() => {});
    }
    this.publicarOverlay();
    this._mudou();
  }

  /** A janela do StreamKit está viva mas sem ninguém (canal vazio, sem autorização...). */
  vivoStreamKit(texto = '') {
    this.sk.ultimo = this.agora();
    this.sk.texto = String(texto || '').slice(0, 300);
    if (!this.sk.conectado) { this.sk.conectado = true; this._mudou(); }
  }

  publicarOverlay() {
    if (!this.servidor) return;
    this.servidor.publicar(vistaOverlay(this.mesa, this.sk.presencas, { conectado: this.sk.conectado }));
  }

  /** Adiciona à mesa alguém que o StreamKit viu e ainda não está cadastrado. */
  adicionarDetectado(discordId, nome) {
    const cfg = JSON.parse(JSON.stringify(this.cfg));
    const mesa = cfgMod.mesaAtiva(cfg);
    mesa.jogadores.push(cfgMod.padraoJogador({ discordId: discordId || '', discordNome: nome || '', jogador: nome || '' }));
    return this.salvarConfig(cfg);
  }

  ignorarDetectado(discordId) {
    if (!discordId) return this.cfg;
    const cfg = JSON.parse(JSON.stringify(this.cfg));
    cfgMod.mesaAtiva(cfg).ignorados.push(discordId);
    return this.salvarConfig(cfg);
  }

  // ---------------------------------------------------------------- OBS

  _ligarOBS() {
    this.obs.removeAllListeners();
    this.obs.desconectar();
    this.obs.on('conectado', () => this._aoConectarOBS());
    this.obs.on('desconectado', () => {
      this.obsInfo.conectado = false;
      this._mudou();
    });
    this.obs.on('RecordStateChanged', d => this._estadoGravacao(d));
    this.obs.on('ReplayBufferSaved', d => {
      if (this.sessao && d.savedReplayPath) { this.sessao.replay(d.savedReplayPath, this.agora()); this._mudou(); }
    });
    this.obs.on('RecordFileChanged', d => {
      if (d.newOutputPath) {
        this._novoArquivo(d.newOutputPath, this.agora());
        this.limpar().catch(() => {});
        this._mudou();
      }
    });
    this.obs.iniciar(this.cfg.obs).catch(e => {
      if (e.cancelada) return;
      this.obsInfo.erro = e.message;
      this._mudou();
    });
  }

  async _aoConectarOBS() {
    this.obsInfo.conectado = true;
    this.obsInfo.erro = '';
    try {
      const v = await this.obs.versao();
      this.obsInfo.versao = v.obsVersion || '';
      const st = await this.obs.estadoGravacao();
      const agora = this.agora();
      if (this.sessao && !st.outputActive) {
        // a gravação parou enquanto a conexão estava caída
        this.sessao.encerrar(agora);
        this.sessao = null;
        this.obsInfo.arquivo = '';
        this._arquivoAtual = null;
      } else if (this.sessao && st.outputActive && Math.abs(this.sessao.duracaoGravada(agora) - (st.outputDuration || 0)) > 60000) {
        // o OBS parou e começou outra gravação enquanto a conexão estava caída: sessão nova
        this.sessao.encerrar(agora);
        this.sessao = null;
        this._arquivoAtual = null;
      }
      if (st.outputActive && !this.sessao) {
        // o OBS já estava gravando quando o app abriu
        const inicio = this.agora() - (st.outputDuration || 0);
        this._abrirSessao(inicio);
        this._acharPrimeiroArquivo(this.sessao, inicio);
      }
      this.obsInfo.gravando = !!st.outputActive;
    } catch (e) {
      this.obsInfo.erro = e.message;
    }
    this._mudou();
  }

  _estadoGravacao(d) {
    if (d.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED') {
      this.obsInfo.gravando = true;
      const inicio = this.agora();
      this._abrirSessao(inicio);
      // liga o Replay Buffer junto, se ele estiver habilitado no OBS (se não estiver, não faz nada)
      this.obs.pedir('StartReplayBuffer').catch(() => {});
      if (d.outputPath) this._novoArquivo(d.outputPath, inicio);
      // o OBS só informa o nome do arquivo no fim da gravação ou quando divide em pedaços;
      // para saber o primeiro pedaço já, o app procura na pasta de gravação
      else this._acharPrimeiroArquivo(this.sessao, inicio);
    } else if (d.outputState === 'OBS_WEBSOCKET_OUTPUT_PAUSED') {
      if (this.sessao) this.sessao.pausa(this.agora());
      this.obsInfo.pausado = true;
    } else if (d.outputState === 'OBS_WEBSOCKET_OUTPUT_RESUMED') {
      if (this.sessao) this.sessao.retoma(this.agora());
      this.obsInfo.pausado = false;
    } else if (d.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPED') {
      this.obsInfo.pausado = false;
      this.obsInfo.gravando = false;
      if (d.outputPath) {
        const s = this.sessao;
        if (s && !s.arquivos.some(a => mesmoArquivo(a.caminho, d.outputPath))) {
          // gravação sem divisão e sem o arquivo achado: ele começou junto com a sessão
          if (!s.arquivos.length) s.arquivoGravacao(d.outputPath, s.inicio);
        }
        const conhecido = this._arquivoAtual && mesmoArquivo(this._arquivoAtual.caminho, d.outputPath);
        this.registro.adicionar(d.outputPath, conhecido ? this._arquivoAtual.inicio : s ? s.inicio : this.agora());
      }
      this.obsInfo.arquivo = '';
      this._arquivoAtual = null;
      if (this.sessao) { this.sessao.encerrar(this.agora()); this.sessao = null; }
      this.limpar().catch(() => {});
    }
    this._mudou();
  }

  _novoArquivo(caminho, inicio) {
    caminho = normalizarCaminho(caminho);
    this.registro.adicionar(caminho, inicio);
    this.obsInfo.arquivo = caminho;
    this._arquivoAtual = { caminho, inicio };
    if (this.sessao && !this.sessao.arquivos.some(a => mesmoArquivo(a.caminho, caminho))) this.sessao.arquivoGravacao(caminho, inicio);
  }

  /** Procura na pasta do OBS o arquivo que começou junto com esta gravação. */
  async _acharPrimeiroArquivo(sessao, inicio, tentativa = 0) {
    if (this.sessao !== sessao || sessao.arquivos.length) return;
    try {
      const { recordDirectory } = await this.obs.pastaGravacao();
      const VIDEO = /\.(mp4|mkv|mov|flv|ts|m4v|fragmented\.mp4)$/i;
      const candidatos = fs.readdirSync(recordDirectory).filter(n => VIDEO.test(n)).map(n => {
        const c = path.join(recordDirectory, n);
        const st = fs.statSync(c);
        return { c, nasceu: st.birthtimeMs || st.ctimeMs, mudou: st.mtimeMs };
      }).filter(x => x.nasceu >= inicio - 15000 && x.mudou >= inicio - 5000 && !this.registro.tem(x.c)
        // nunca um corte exportado pelo próprio app (se a pasta dos cortes for a mesma do OBS)
        && !this.fila.lista().some(t => mesmoArquivo(t.saida, x.c)) && !mesmoArquivo(path.dirname(x.c), this.biblioteca.pastaSaida()))
        .sort((a, b) => a.nasceu - b.nasceu);
      if (candidatos.length && this.sessao === sessao && !sessao.arquivos.length) {
        this._novoArquivo(candidatos[0].c, inicio);
        this._mudou();
        return;
      }
    } catch { /* OBS sem resposta ou pasta inacessível: tenta de novo */ }
    if (tentativa < 4) setTimeout(() => this._acharPrimeiroArquivo(sessao, inicio, tentativa + 1), 1500 * (tentativa + 1));
  }

  _abrirSessao(inicio) {
    if (this.sessao) this.sessao.encerrar(this.agora());
    const mesa = this.mesa;
    this.sessao = new Sessao(this.pastaSessoes, {
      inicio,
      mesa: { id: mesa.id, nome: mesa.nome },
      jogadores: mesa.jogadores.map(j => ({ id: j.id, discordId: j.discordId, discordNome: j.discordNome, personagem: j.personagem, jogador: j.jogador, imagem: j.imagem })),
    });
  }

  // ---------------------------------------------------------------- ações (atalhos e botões)

  /**
   * Cria um marcador agora.
   * capitulo:false = só na linha do tempo (o "marcar com nome" cria o capítulo
   * do OBS depois que o nome é digitado, mas o tempo vale o do aperto da tecla).
   */
  async marcar(nome = '', origem = 'atalho', { capitulo = true, avisar = true } = {}) {
    if (!this.sessao) {
      return { ok: false, mensagem: this.obsInfo.conectado ? 'Não está gravando: o marcador não foi criado.' : 'OBS não conectado: o marcador não foi criado.' };
    }
    const m = this.sessao.marcar(nome, origem, this.agora());
    this.marcadoresAbs.push({ t: m.t, nome: m.nome });
    this._salvarMarcadores();
    const noArquivo = capitulo && this.obsInfo.conectado ? await this.obs.capitulo(nome || `Marcador ${m.tempo}`) : false;
    if (avisar && this.cfg.avisos.marcador && this.o.notificar) this.o.notificar('Marcado ' + m.tempo, nome || 'Marcador');
    this._mudou();
    return { ok: true, t: m.t, tempo: m.tempo, noArquivo, mensagem: `Marcado ${m.tempo}` };
  }

  /** Dá nome a um marcador (e, se pedido, cria o capítulo no arquivo do OBS). */
  async renomearMarcador(t, nome, { capitulo = false } = {}) {
    nome = String(nome || '').trim().slice(0, 120);
    if (!this.sessao || !this.sessao.renomearMarcador(t, nome)) return false;
    const m = this.marcadoresAbs.find(x => x.t === t);
    if (m) { m.nome = nome; this._salvarMarcadores(); }
    if (capitulo && this.obsInfo.conectado) await this.obs.capitulo(nome || 'Marcador');
    if (capitulo && this.cfg.avisos.marcador && this.o.notificar) {
      const sm = this.sessao.marcadores.find(x => x.t === t);
      this.o.notificar('Marcado ' + formatarTempo(sm ? sm.rel : 0), nome || 'Marcador');
    }
    this._mudou();
    return true;
  }

  async alternarGravacao() {
    if (!this.obsInfo.conectado) return { ok: false, mensagem: 'OBS não conectado.' };
    try {
      if (this.obsInfo.gravando) await this.obs.pararGravacao();
      else await this.obs.iniciarGravacao();
      return { ok: true };
    } catch (e) {
      return { ok: false, mensagem: e.message };
    }
  }

  async salvarReplay() {
    if (!this.obsInfo.conectado) return { ok: false, mensagem: 'OBS não conectado.' };
    try {
      await this.obs.salvarReplay();
      if (this.sessao) await this.marcar('Replay salvo', 'replay');
      return { ok: true, mensagem: 'Replay salvo' };
    } catch (e) {
      return { ok: false, mensagem: 'Replay Buffer desligado no OBS. Ligue em Configurações → Saída → Buffer de replay e clique em "Iniciar buffer de replay".' };
    }
  }

  // ---------------------------------------------------------------- Foundry

  /** Pedido do módulo do Foundry: { chave, tipo: 'ping'|'marcar', nome }. */
  async eventoFoundry(d) {
    const f = this.cfg.foundry;
    if (!f.ativo) return { ok: false, status: 403, mensagem: 'Integração com o Foundry desligada no app.' };
    if (!d || d.chave !== f.chave) return { ok: false, status: 401, mensagem: 'Chave errada. Copie a chave do app (Conexões → Foundry).' };
    if (d.tipo === 'ping') return { ok: true, mesa: this.mesa.nome, gravando: !!this.sessao };
    if (d.tipo === 'marcar') {
      const nome = String(d.nome || '').slice(0, 120);
      // o mesmo evento repetido em menos de 3 s vira um só (ex.: vários clientes mandando)
      const agora = this.agora();
      const ult = this._ultimoFoundry.get(nome) || 0;
      if (agora - ult < 3000) return { ok: true, repetido: true };
      this._ultimoFoundry.set(nome, agora);
      const r = await this.marcar(nome, 'foundry', { avisar: false });
      return r.ok ? { ok: true, tempo: r.tempo } : { ok: false, mensagem: r.mensagem };
    }
    return { ok: false, status: 400, mensagem: 'Pedido desconhecido.' };
  }

  // ---------------------------------------------------------------- limpeza

  simularLimpeza(segmentos) {
    const k = this.cfg.cortes;
    return planejar({
      segmentos: segmentos || this.registro.segmentos(),
      marcadores: this.marcadoresAbs.map(m => m.t),
      // o corte criado de um marcador vai de "antes" a "depois"; folga de 1 min para ajustes
      antesMs: (k.antes + 60) * 1000, depoisMs: (k.depois + 60) * 1000,
      protecoes: this._protecoesCortes(),
      intocaveis: this.fila.arquivosEmUso(),
      limiteHoras: this.cfg.gravacao.limiteHoras, limiteGB: this.cfg.gravacao.limiteGB,
      agora: this.agora(), gravando: this.obsInfo.arquivo,
    });
  }

  /** Trechos com corte salvo (guardado por 10 s: o estado é recalculado várias vezes por segundo). */
  _protecoesCortes() {
    const agora = Date.now();
    if (this._cacheProtecoes && agora - this._cacheProtecoes.t < 10000) return this._cacheProtecoes.lista;
    let lista = [];
    try { lista = this.biblioteca.protecoes(); } catch { /* sem sessões */ }
    this._cacheProtecoes = { t: agora, lista };
    return lista;
  }

  async limpar() {
    const plano = this.simularLimpeza();
    if (!plano.apagar.length) return { feitos: [], falhas: [] };
    const destino = this.cfg.gravacao.destino;
    const r = await executar(plano, this.registro, c => this.o.removerArquivo(c, destino));
    this.ultimaLimpeza = { t: this.agora(), feitos: r.feitos.length, falhas: r.falhas.length };
    this._mudou();
    return r;
  }

  _lerMarcadores() {
    try {
      const d = JSON.parse(fs.readFileSync(this.arquivoMarcadores, 'utf8'));
      return Array.isArray(d) ? d.filter(m => Number.isFinite(m.t)) : [];
    } catch { return []; }
  }

  _salvarMarcadores() {
    // guarda só os últimos 2000 (bem mais que 10 h de sessões)
    this.marcadoresAbs = this.marcadoresAbs.slice(-2000);
    const tmp = this.arquivoMarcadores + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.marcadoresAbs));
    fs.renameSync(tmp, this.arquivoMarcadores);
  }
}

module.exports = { Controlador };
