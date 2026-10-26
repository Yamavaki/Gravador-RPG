'use strict';
// discord.js e @discordjs/voice de mentira, com a mesma "forma" das APIs usadas pelo bot.
const { EventEmitter } = require('events');

const SERVIDOR = '187691838138400768';
const CANAL = '298765432109876543';
const CANAL2 = '111111111111111111';
const BOT_ID = '999999999999999999';
// token com o formato real: ID em base64 . carimbo . assinatura
const TOKEN = Buffer.from(BOT_ID).toString('base64').replace(/=+$/, '') + '.GaBcDe.assinatura-falsa_123';

function discordFalso(opc = {}) {
  const reg = { logins: [], joins: [], rejoins: 0, players: [], recursos: [], destruidos: 0, conexoes: [], eu: { voice: { channelId: null } } };
  const S = { Ready: 'ready', Signalling: 'signalling', Connecting: 'connecting', Disconnected: 'disconnected', Destroyed: 'destroyed' };
  const PermissionFlagsBits = { Connect: 1n << 20n, Speak: 1n << 21n };

  function canal(id, name, type, pos) {
    return {
      id, name, type, rawPosition: pos, joinable: true, bitrate: 96000,
      permissionsFor: () => ({ has: p => !(opc.semFalar && p === PermissionFlagsBits.Speak) }),
    };
  }
  class Client extends EventEmitter {
    constructor(o) { super(); this.o = o; this.guilds = { cache: new Map() }; }
    async login(t) {
      reg.logins.push(t);
      if (opc.tokenRuim) { const e = new Error('An invalid token was provided.'); e.code = 'TokenInvalid'; throw e; }
      this.user = { id: BOT_ID, username: 'Bardo' };
      const chans = new Map([
        [CANAL2, canal(CANAL2, 'Sala 2', 2, 2)],
        ['555555555555555555', canal('555555555555555555', 'geral', 0, 0)],
        [CANAL, canal(CANAL, 'Mesa de RPG', 2, 1)],
      ]);
      this.guilds.cache.set(SERVIDOR, { id: SERVIDOR, name: 'Taverna', voiceAdapterCreator: () => ({}), members: { me: reg.eu }, channels: { cache: chans } });
      setTimeout(() => this.emit('clientReady'), 5);
      return t;
    }
    destroy() { reg.destruidos++; }
  }
  const djs = {
    Client, PermissionFlagsBits,
    GatewayIntentBits: { Guilds: 1, GuildVoiceStates: 128 },
    Events: { ClientReady: 'clientReady' },
    ChannelType: { GuildText: 0, GuildVoice: 2 },
  };

  class Conexao extends EventEmitter {
    constructor(cfg) {
      super();
      this.joinConfig = { ...cfg };
      this.state = { status: S.Signalling };
      if (!opc.naoConecta) setTimeout(() => { reg.eu.voice.channelId = cfg.channelId; this._estado(S.Ready); }, 10);
    }
    _estado(st) { const a = this.state; this.state = { status: st }; this.emit('stateChange', a, this.state); }
    // como no de verdade: com a conexão pronta, trocar de canal não muda o estado
    rejoin(cfg) { reg.rejoins++; this.joinConfig.channelId = cfg.channelId; if (!opc.naoTroca) setTimeout(() => { reg.eu.voice.channelId = cfg.channelId; }, 30); return true; }
    subscribe(p) { this.player = p; return {}; }
    destroy() { reg.eu.voice.channelId = null; this._estado(S.Destroyed); }
  }
  // como no de verdade: play() passa por "buffering"; pause() só vale tocando, unpause() só pausado
  class Player extends EventEmitter {
    constructor(o) { super(); this.o = o; this.pausado = false; this.state = { status: 'idle' }; }
    _estado(st) { const a = this.state; this.state = { status: st }; this.emit('stateChange', a, this.state); }
    play(r) { this.recurso = r; this.pausado = false; this._estado('buffering'); setTimeout(() => { if (this.recurso === r && !this.parado) this._estado('playing'); }, 5); }
    pause() { if (this.state.status !== 'playing') return false; this.pausado = true; this._estado('paused'); return true; }
    unpause() { if (this.state.status !== 'paused') return false; this.pausado = false; this._estado('playing'); return true; }
    stop() { this.parado = true; this._estado('idle'); }
  }
  const voz = {
    VoiceConnectionStatus: S,
    AudioPlayerStatus: { Idle: 'idle', Buffering: 'buffering', Playing: 'playing', Paused: 'paused' },
    NoSubscriberBehavior: { Play: 'play' },
    StreamType: { Raw: 'raw' },
    joinVoiceChannel(cfg) { const c = new Conexao(cfg); reg.joins.push(cfg); reg.conexoes.push(c); return c; },
    entersState(con, st, t) {
      return new Promise((res, rej) => {
        if (con.state.status === st) return res(con);
        const h = (a, b) => { if (b.status === st) { con.off('stateChange', h); clearTimeout(tm); res(con); } };
        con.on('stateChange', h);
        const tm = setTimeout(() => { con.off('stateChange', h); rej(new Error('tempo')); }, Math.min(t, opc.tempo || 200));
      });
    },
    createAudioPlayer(o) { const p = new Player(o); reg.players.push(p); return p; },
    createAudioResource(stream, o) {
      const r = { stream, o, encoder: { setBitrate(b) { r.bitrate = b; }, setFEC(v) { r.fec = v; } } };
      reg.recursos.push(r);
      return r;
    },
    generateDependencyReport: () => 'opusscript: 0.0.8\n@snazzah/davey: 0.1.6',
  };
  const carregar = nome => {
    if (opc.semBibliotecas) { const e = new Error(`Cannot find module '${nome}'`); e.code = 'MODULE_NOT_FOUND'; throw e; }
    if (nome === 'discord.js') return djs;
    if (nome === '@discordjs/voice') return voz;
    throw new Error('módulo inesperado ' + nome);
  };
  return { carregar, reg, djs, voz, S };
}

module.exports = { discordFalso, SERVIDOR, CANAL, CANAL2, BOT_ID, TOKEN };
