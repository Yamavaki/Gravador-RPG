'use strict';
// Bot do Discord que toca a mistura do mixer num canal de voz.
// Usa discord.js + @discordjs/voice, carregados só quando a pessoa liga o bot:
// se as bibliotecas não estiverem instaladas, o resto do app funciona igual.

const { EventEmitter } = require('events');

const PERMISSOES = 3146752; // Ver canal (1<<10) + Conectar (1<<20) + Falar (1<<21)

/** ID do bot a partir do token (a primeira parte do token é o ID em base64). */
function idDoToken(token) {
  const p = String(token || '').trim().split('.')[0];
  if (!p) return '';
  try {
    const id = Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return /^\d{15,22}$/.test(id) ? id : '';
  } catch { return ''; }
}

function linkConvite(id) {
  return id ? `https://discord.com/oauth2/authorize?client_id=${id}&scope=bot&permissions=${PERMISSOES}` : '';
}

/** Texto que a pessoa entende para os erros mais comuns. */
function explicarErro(e) {
  const cod = e && (e.code || '');
  const msg = String((e && e.message) || e || '');
  if (cod === 'TokenInvalid' || /invalid token|TokenInvalid|401/i.test(msg)) return 'Token inválido. Copie de novo em Discord Developer Portal → seu app → Bot → Reset Token.';
  if (cod === 'DisallowedIntents' || /disallowed intents/i.test(msg)) return 'O Discord recusou as permissões do bot. Este bot não precisa de "Privileged Intents": confira o token.';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|getaddrinfo|network/i.test(msg)) return 'Sem conexão com o Discord. Confira a internet.';
  if (/Cannot find module|MODULE_NOT_FOUND/.test(msg)) return 'Bibliotecas do bot não instaladas. Rode o INSTALAR.bat de novo (com internet).';
  if (/opus/i.test(msg)) return 'Falta o codificador de áudio (opusscript). Rode o INSTALAR.bat de novo.';
  if (/dave|davey/i.test(msg)) return 'Falta a biblioteca de criptografia de voz do Discord (@snazzah/davey). Rode o INSTALAR.bat de novo.';
  return msg || 'Erro desconhecido.';
}

function destruir(cliente) {
  try { Promise.resolve(cliente.destroy()).catch(() => {}); } catch { /* já destruído */ }
}

class BotDiscord extends EventEmitter {
  /**
   * @param {object} o
   *  mixer: MixerPCM (de onde sai o áudio)
   *  carregar: (nome) => módulo  (testes trocam por falsos)
   */
  constructor(o) {
    super();
    this.mixer = o.mixer;
    this.carregar = o.carregar || (nome => require(nome));
    this.cliente = null;
    this.conexao = null;
    this.player = null;
    this.estado = { etapa: 'desligado', erro: '', usuario: null, voz: 'fora', canal: null, servidores: [] };
    this._alvo = null;          // canal em que queremos estar { servidor, canal }
    this._geracao = 0;          // invalida tentativas antigas (ligar/desligar rápido)
    this.mixer.on('atividade', ativo => this._atividade(ativo));
  }

  /** Confere se dá para carregar as bibliotecas (sem conectar). */
  bibliotecas() {
    try {
      const djs = this.carregar('discord.js');
      const voz = this.carregar('@discordjs/voice');
      let relatorio = '';
      try { relatorio = voz.generateDependencyReport ? voz.generateDependencyReport() : ''; } catch { /* sem relatório */ }
      return { ok: true, djs, voz, relatorio };
    } catch (e) {
      return { ok: false, erro: explicarErro(e) };
    }
  }

  _mudar(campos) {
    Object.assign(this.estado, campos);
    this.emit('estado', this.publico());
  }

  publico() {
    return JSON.parse(JSON.stringify(this.estado));
  }

  /** Liga o bot (login). Não entra em canal nenhum ainda. */
  async conectar(token) {
    token = String(token || '').trim();
    if (!token) throw new Error('Cole o token do bot primeiro.');
    await this.desconectar();
    const geracao = ++this._geracao;
    const libs = this.bibliotecas();
    if (!libs.ok) { this._mudar({ etapa: 'erro', erro: libs.erro }); throw new Error(libs.erro); }
    const { djs } = libs;
    this.libs = libs;
    this._mudar({ etapa: 'conectando', erro: '' });
    const cliente = new djs.Client({ intents: [djs.GatewayIntentBits.Guilds, djs.GatewayIntentBits.GuildVoiceStates] });
    this.cliente = cliente;
    let tPronto;
    const pronto = new Promise((resolve, reject) => {
      cliente.once((djs.Events && djs.Events.ClientReady) || 'ready', () => { clearTimeout(tPronto); resolve(); });
      tPronto = setTimeout(() => reject(new Error('O Discord não respondeu em 30 s. Confira a internet.')), 30000);
    });
    pronto.catch(() => {});
    cliente.on('error', e => this._mudar({ erro: explicarErro(e) }));
    const atualizar = () => { if (this.cliente === cliente) this._mudar({ servidores: this._listarServidores() }); };
    for (const ev of ['guildCreate', 'guildDelete', 'channelCreate', 'channelDelete', 'channelUpdate']) cliente.on(ev, atualizar);
    try {
      await cliente.login(token);
      await pronto;
    } catch (e) {
      if (geracao === this._geracao) {
        this.cliente = null;
        destruir(cliente);
        this._mudar({ etapa: 'erro', erro: explicarErro(e) });
      }
      throw new Error(explicarErro(e));
    }
    if (geracao !== this._geracao) { destruir(cliente); throw new Error('Cancelado.'); }
    const u = cliente.user;
    this._mudar({ etapa: 'online', erro: '', usuario: { id: u.id, nome: u.username || u.tag || 'bot' }, servidores: this._listarServidores() });
    return this.publico();
  }

  _listarServidores() {
    const djs = this.libs && this.libs.djs;
    if (!this.cliente || !djs) return [];
    const VOZ = [djs.ChannelType.GuildVoice];
    return [...this.cliente.guilds.cache.values()].map(g => ({
      id: g.id,
      nome: g.name,
      canais: [...g.channels.cache.values()]
        .filter(c => VOZ.includes(c.type))
        .sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0))
        .map(c => ({ id: c.id, nome: c.name })),
    })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }

  /** Entra (ou muda) para um canal de voz. */
  async entrar(servidorId, canalId) {
    if (this.estado.etapa !== 'online' || !this.cliente) throw new Error('Ligue o bot primeiro.');
    const { djs, voz } = this.libs;
    const guild = this.cliente.guilds.cache.get(servidorId);
    if (!guild) throw new Error('O bot não está nesse servidor. Use "Convidar o bot" e escolha o servidor da mesa.');
    const canal = guild.channels.cache.get(canalId);
    if (!canal) throw new Error('Canal de voz não encontrado nesse servidor.');
    const eu = guild.members && guild.members.me;
    const perm = eu && canal.permissionsFor ? canal.permissionsFor(eu) : null;
    if (perm && djs.PermissionFlagsBits && (!perm.has(djs.PermissionFlagsBits.Connect) || !perm.has(djs.PermissionFlagsBits.Speak))) {
      throw new Error(`O bot não tem permissão de Conectar e Falar em "${canal.name}". Ajuste as permissões do canal no Discord.`);
    }
    if (canal.joinable === false) throw new Error(`Não dá para entrar em "${canal.name}" (canal cheio ou sem permissão).`);

    this._alvo = { servidor: servidorId, canal: canalId };
    // qualidade do áudio: a taxa que o canal aceita (64 kbps padrão; servidores com impulso, mais)
    this._bitrate = Math.max(64000, Math.min(128000, Number(canal.bitrate) || 96000));
    if (this._recurso) this._ajustarCodificador(this._recurso);
    const geracao = this._geracao;
    if (this.conexao && this.conexao.joinConfig && this.conexao.joinConfig.guildId === servidorId) {
      // mesmo servidor: só troca de canal
      this.conexao.rejoin({ channelId: canalId, selfDeaf: true, selfMute: false });
    } else {
      this._sairDoCanal();
      this.conexao = voz.joinVoiceChannel({ channelId: canalId, guildId: servidorId, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true, selfMute: false });
      this._ligarConexao(this.conexao);
    }
    const canalAnterior = this.estado.canal;
    this._mudar({ voz: 'entrando', canal: { servidor: servidorId, canal: canalId, nome: canal.name, nomeServidor: guild.name }, erro: '' });
    try {
      await voz.entersState(this.conexao, voz.VoiceConnectionStatus.Ready, 20000);
      // trocando de canal com a conexão já pronta, o estado não muda: confere no Discord onde o bot está
      await this._esperarCanal(guild, canalId, 10000);
    } catch (e) {
      if (e && e.trocaFalhou && geracao === this._geracao) {
        const m = `Não consegui mudar para "${canal.name}". O bot tem permissão de Ver, Conectar e Falar nesse canal?`;
        this._mudar({ voz: canalAnterior ? 'no-canal' : 'fora', canal: canalAnterior, erro: m });
        throw new Error(m);
      }
      if (geracao === this._geracao && this._alvo && this._alvo.canal === canalId) {
        this._sairDoCanal();
        const m = 'Não consegui entrar no canal de voz em 20 s. O bot tem permissão de Conectar e Falar?';
        this._mudar({ voz: 'fora', canal: null, erro: m });
        throw new Error(m);
      }
      throw new Error('Cancelado.');
    }
    this._garantirPlayer();
    this._mudar({ voz: 'no-canal' });
    return this.publico();
  }

  /** Espera o Discord confirmar que o bot está no canal (quando dá para saber). */
  _esperarCanal(guild, canalId, limite) {
    const eu = guild.members && guild.members.me;
    if (!eu || !eu.voice || !('channelId' in eu.voice)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ini = Date.now();
      const olhar = () => {
        const atual = guild.members.me && guild.members.me.voice && guild.members.me.voice.channelId;
        if (atual === canalId) return resolve();
        if (Date.now() - ini > limite) { const e = new Error('troca'); e.trocaFalhou = true; return reject(e); }
        setTimeout(olhar, 200);
      };
      olhar();
    });
  }

  _ligarConexao(con) {
    const { voz } = this.libs;
    const S = voz.VoiceConnectionStatus;
    con.on('stateChange', (antes, depois) => {
      if (con !== this.conexao) return;
      if (depois.status === S.Disconnected) {
        // caiu ou alguém tirou o bot do canal: espera um pouco para ver se é só uma troca de canal
        this._mudar({ voz: 'reconectando' });
        Promise.race([
          voz.entersState(con, S.Signalling, 5000),
          voz.entersState(con, S.Connecting, 5000),
        ]).catch(() => {
          if (con !== this.conexao) return;
          this._sairDoCanal();
          this._mudar({ voz: 'fora', canal: null, erro: 'O bot saiu do canal de voz (foi desconectado ou removido).' });
        });
      } else if (depois.status === S.Ready && this.estado.voz !== 'no-canal' && this.estado.voz !== 'entrando') {
        this._mudar({ voz: 'no-canal', erro: '' });
      } else if (depois.status === S.Destroyed && con === this.conexao) {
        this.conexao = null;
        this._mudar({ voz: 'fora', canal: null });
      }
    });
    con.on('error', e => this._mudar({ erro: explicarErro(e) }));
  }

  _garantirPlayer() {
    const { voz } = this.libs;
    if (!this.player) {
      this.player = voz.createAudioPlayer({ behaviors: { noSubscriber: voz.NoSubscriberBehavior.Play, maxMissedFrames: 250 } });
      this.player.on('error', e => {
        this._mudar({ erro: 'Falha no áudio do bot: ' + explicarErro(e) });
        setTimeout(() => this._tocar(), 1000);
      });
      // o fluxo nunca acaba sozinho; se acabar (erro), recomeça
      this.player.on('stateChange', (antes, depois) => {
        if (depois.status === voz.AudioPlayerStatus.Idle && this.conexao) setTimeout(() => this._tocar(), 200);
        // pause() só vale com o player tocando: cala assim que ele começa, se não houver som
        if (depois.status === voz.AudioPlayerStatus.Playing && !this.mixer.ativo) this.player.pause(true);
      });
      this._tocar();
    }
    if (this.conexao) this.conexao.subscribe(this.player);
  }

  _tocar() {
    if (!this.player || !this.libs) return;
    const { voz } = this.libs;
    try {
      this.mixer.aparar();            // começa sem áudio acumulado (sem atraso)
      const recurso = voz.createAudioResource(this.mixer.criarSaida(), { inputType: voz.StreamType.Raw });
      this._recurso = recurso;
      this._ajustarCodificador(recurso);
      this.player.play(recurso);
    } catch (e) {
      this._mudar({ erro: 'Falha no áudio do bot: ' + explicarErro(e) });
    }
  }

  /** Opus na taxa do canal e com correção de pacotes perdidos (menos chiado em internet instável). */
  _ajustarCodificador(recurso) {
    const enc = recurso && recurso.encoder;
    if (!enc) return;
    try { if (enc.setBitrate) enc.setBitrate(this._bitrate || 96000); } catch { /* codificador sem esse ajuste */ }
    try { if (enc.setFEC) enc.setFEC(true); } catch { /* */ }
  }

  _atividade(ativo) {
    if (!this.player) return;
    if (ativo) {
      this.mixer.aparar();          // descarta o silêncio acumulado: o som novo sai na hora
      this.player.unpause();
    } else {
      this.player.pause(true);
    }
  }

  /** Fora do canal o player não fica codificando à toa. */
  _pararPlayer() {
    const p = this.player;
    this.player = null;
    if (p) { try { p.removeAllListeners(); p.stop(true); } catch { /* */ } }
    if (this.mixer.saida) { this.mixer.saida.push(null); this.mixer.saida = null; }
  }

  _sairDoCanal() {
    const con = this.conexao;
    this.conexao = null;
    if (con) { try { con.destroy(); } catch { /* já destruída */ } }
  }

  /** Sai do canal de voz (o bot continua ligado). */
  sair() {
    this._alvo = null;
    this._geracao++;
    this._sairDoCanal();
    this._pararPlayer();
    this._mudar({ voz: 'fora', canal: null });
  }

  /** Desliga o bot (sai do canal e do Discord). */
  async desconectar() {
    this._geracao++;
    this._alvo = null;
    this._sairDoCanal();
    this._pararPlayer();
    const c = this.cliente;
    this.cliente = null;
    if (c) destruir(c);
    this._mudar({ etapa: 'desligado', usuario: null, voz: 'fora', canal: null, servidores: [], erro: '' });
  }
}

module.exports = { BotDiscord, idDoToken, linkConvite, explicarErro, PERMISSOES };
