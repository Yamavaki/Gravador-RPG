'use strict';
// Cliente mínimo do obs-websocket 5 (vem junto com o OBS 28 ou mais novo).
// Ferramentas → Configurações do servidor WebSocket, no OBS.

const crypto = require('crypto');
const { EventEmitter } = require('events');

const OP = { HELLO: 0, IDENTIFY: 1, IDENTIFIED: 2, EVENT: 5, REQUEST: 6, RESPONSE: 7 };
const EVENTOS_SAIDAS = 1 << 6; // RecordStateChanged, RecordFileChanged, ReplayBufferSaved

function autenticacao(senha, salt, challenge) {
  const sha = s => crypto.createHash('sha256').update(s).digest('base64');
  return sha(sha(senha + salt) + challenge);
}

const CANCELADA = 'Conexão cancelada.';

const MENSAGENS_ERRO = {
  4009: 'Senha do OBS incorreta.',
  4008: 'O OBS pediu senha, mas nenhuma foi informada.',
  4010: 'Versão do OBS sem suporte. Atualize o OBS.',
};

class ClienteOBS extends EventEmitter {
  /** @param {object} o { WebSocket (opcional, para testes), tempoLimite } */
  constructor(o = {}) {
    super();
    this.WS = o.WebSocket || globalThis.WebSocket;
    this.tempoLimite = o.tempoLimite || 8000;
    this.ws = null;
    this.conectado = false;
    this.pendentes = new Map();
    this.seq = 0;
    this.querConectado = false;
    this.ultimoErro = '';
    this._reconectar = null;
    this.intervaloReconexao = o.intervaloReconexao || 5000;
  }

  /** Conecta e fica tentando de novo sozinho se cair (até desconectar()). */
  iniciar(opcoes) {
    this.opcoes = opcoes;
    this.querConectado = true;
    return this._conectar().catch(e => {
      // tentativa trocada por outra (ex.: senha nova): quem manda agora é a nova
      if (e.cancelada) throw e;
      this.ultimoErro = e.message;
      this._agendar();
      throw e;
    });
  }

  _agendar() {
    if (!this.querConectado || this._reconectar) return;
    this._reconectar = setTimeout(() => {
      this._reconectar = null;
      this._conectar().catch(e => { if (e.cancelada) return; this.ultimoErro = e.message; this._agendar(); });
    }, this.intervaloReconexao);
  }

  _conectar() {
    const { host = '127.0.0.1', porta = 4455, senha = '' } = this.opcoes || {};
    if (!this.WS) return Promise.reject(new Error('Este Electron não tem WebSocket. Atualize o app.'));
    this._fecharSocket();
    return new Promise((resolve, reject) => {
      let resolvido = false;
      const falhar = msg => {
        if (resolvido) return;
        resolvido = true;
        clearTimeout(limite);
        reject(Object.assign(new Error(msg), { cancelada: msg === CANCELADA }));
      };
      let ws = null;
      const limite = setTimeout(() => {
        falhar('O OBS não respondeu. Ele está aberto e com o servidor WebSocket ligado?');
        // fecha só ESTA tentativa (outra conexão já pode ter começado depois dela)
        if (ws && this.ws === ws) this._fecharSocket();
        else if (ws) { try { ws.onclose = null; ws.onmessage = null; ws.close(); } catch { /* */ } }
        this._agendar();
      }, this.tempoLimite);
      // se esta tentativa for abandonada (desconectar, nova senha), a promessa termina já
      this._abandonar = () => falhar(CANCELADA);

      try {
        ws = new this.WS(`ws://${host}:${porta}`, 'obswebsocket.json');
      } catch (e) {
        return falhar('Endereço do OBS inválido.');
      }
      this.ws = ws;

      ws.onmessage = ev => {
        let msg;
        try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
        const d = msg.d || {};
        if (msg.op === OP.HELLO) {
          const ident = { rpcVersion: 1, eventSubscriptions: EVENTOS_SAIDAS };
          if (d.authentication) {
            if (!senha) { falhar(MENSAGENS_ERRO[4008]); this._fecharSocket(); return; }
            ident.authentication = autenticacao(senha, d.authentication.salt, d.authentication.challenge);
          }
          ws.send(JSON.stringify({ op: OP.IDENTIFY, d: ident }));
        } else if (msg.op === OP.IDENTIFIED) {
          this._abandonar = null;
          this.conectado = true;
          this.ultimoErro = '';
          resolvido = true;
          clearTimeout(limite);
          this.emit('conectado');
          resolve();
        } else if (msg.op === OP.RESPONSE) {
          const p = this.pendentes.get(d.requestId);
          if (!p) return;
          this.pendentes.delete(d.requestId);
          clearTimeout(p.limite);
          const st = d.requestStatus || {};
          if (st.result) p.resolve(d.responseData || {});
          else {
            const e = new Error(st.comment || `O OBS recusou o pedido (código ${st.code}).`);
            e.codigo = st.code;
            p.reject(e);
          }
        } else if (msg.op === OP.EVENT) {
          this.emit('evento', d.eventType, d.eventData || {});
          this.emit(d.eventType, d.eventData || {});
        }
      };
      ws.onclose = ev => {
        const eraConectado = this.conectado;
        this.conectado = false;
        for (const p of this.pendentes.values()) { clearTimeout(p.limite); p.reject(new Error('Conexão com o OBS caiu.')); }
        this.pendentes.clear();
        const msg = MENSAGENS_ERRO[ev && ev.code] || 'Não foi possível conectar ao OBS. Ele está aberto e com o servidor WebSocket ligado?';
        if (!resolvido) falhar(msg);
        else if (ev && MENSAGENS_ERRO[ev.code]) this.ultimoErro = msg;
        if (eraConectado) this.emit('desconectado');
        if (this.ws === ws) this.ws = null;
        this._agendar();
      };
      ws.onerror = () => { /* o onclose trata */ };
    });
  }

  _fecharSocket() {
    if (this._abandonar) { const a = this._abandonar; this._abandonar = null; a(); }
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.onclose = null; ws.onmessage = null; ws.close(); } catch { /* já fechado */ }
      if (this.conectado) { this.conectado = false; this.emit('desconectado'); }
    }
  }

  desconectar() {
    this.querConectado = false;
    clearTimeout(this._reconectar);
    this._reconectar = null;
    this._fecharSocket();
  }

  pedir(tipo, dados) {
    if (!this.conectado || !this.ws) return Promise.reject(new Error('OBS não conectado.'));
    const id = String(++this.seq);
    return new Promise((resolve, reject) => {
      const limite = setTimeout(() => {
        this.pendentes.delete(id);
        reject(new Error('O OBS demorou para responder.'));
      }, this.tempoLimite);
      this.pendentes.set(id, { resolve, reject, limite });
      this.ws.send(JSON.stringify({ op: OP.REQUEST, d: { requestType: tipo, requestId: id, requestData: dados } }));
    });
  }

  versao() { return this.pedir('GetVersion'); }
  estadoGravacao() { return this.pedir('GetRecordStatus'); }
  iniciarGravacao() { return this.pedir('StartRecord'); }
  pararGravacao() { return this.pedir('StopRecord'); }
  pastaGravacao() { return this.pedir('GetRecordDirectory'); }
  salvarReplay() { return this.pedir('SaveReplayBuffer'); }
  estadoReplay() { return this.pedir('GetReplayBufferStatus'); }

  /** Marcador de capítulo no arquivo (OBS 30.2+, formato MP4 Híbrido). */
  async capitulo(nome) {
    try {
      await this.pedir('CreateRecordChapter', nome ? { chapterName: nome } : undefined);
      return true;
    } catch (e) {
      // sem suporte (OBS antigo ou formato que não é MP4 Híbrido): o marcador
      // continua salvo na linha do tempo do app, só não vai dentro do arquivo
      return false;
    }
  }
}

module.exports = { ClienteOBS, autenticacao, OP };
