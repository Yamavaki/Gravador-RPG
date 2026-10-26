'use strict';
const { autenticacao, OP } = require('../src/core/obs');

// ------------------------------------------------------------- OBS falso
// Imita o protocolo do obs-websocket 5 para testar o cliente sem o OBS.
function fabricaOBS({ senha = '', recusar = new Set(), naoResponde = false, fecharCom = null, gravando = true, arquivo = 'D:/Gravacoes/sessao.mp4', pasta = 'D:/Gravacoes', caminhoNoInicio = true } = {}) {
  const salt = 'sal123', challenge = 'desafio456';
  const pedidos = [];
  let ultimo = null;
  const obs = { gravando };
  // StartRecord / StopRecord mudam o estado e mandam o evento, como o OBS de verdade
  const efeitos = {
    StartRecord(ws) {
      obs.gravando = true;
      // o OBS de verdade manda outputPath = null no início (só manda no fim)
      setTimeout(() => ws.evento('RecordStateChanged', { outputActive: true, outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED', outputPath: caminhoNoInicio ? arquivo : null }), 2);
    },
    StopRecord(ws) {
      obs.gravando = false;
      setTimeout(() => ws.evento('RecordStateChanged', { outputActive: false, outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED', outputPath: arquivo }), 2);
    },
  };
  class WSFalso {
    constructor(url, proto) {
      this.url = url; this.proto = proto; ultimo = this;
      setTimeout(() => {
        if (fecharCom) return this.onclose && this.onclose({ code: fecharCom });
        if (naoResponde) return;
        const d = { obsWebSocketVersion: '5.5.0', rpcVersion: 1 };
        if (senha) d.authentication = { salt, challenge };
        this._recebe({ op: OP.HELLO, d });
      }, 1);
    }
    _recebe(msg) { this.onmessage && this.onmessage({ data: JSON.stringify(msg) }); }
    send(txt) {
      const m = JSON.parse(txt);
      if (m.op === OP.IDENTIFY) {
        if (senha && m.d.authentication !== autenticacao(senha, salt, challenge)) {
          return setTimeout(() => this.onclose && this.onclose({ code: 4009 }), 1);
        }
        this.eventos = m.d.eventSubscriptions;
        setTimeout(() => this._recebe({ op: OP.IDENTIFIED, d: { negotiatedRpcVersion: 1 } }), 1);
      } else if (m.op === OP.REQUEST) {
        pedidos.push(m.d);
        const ok = !recusar.has(m.d.requestType);
        const respostas = {
          GetRecordStatus: { outputActive: obs.gravando, outputDuration: obs.gravando ? 600000 : 0, outputTimecode: '00:10:00.000' },
          GetRecordDirectory: { recordDirectory: pasta },
          GetVersion: { obsVersion: '31.0.0', obsWebSocketVersion: '5.5.0' },
        };
        const resp = { op: OP.RESPONSE, d: { requestType: m.d.requestType, requestId: m.d.requestId,
          requestStatus: ok ? { result: true, code: 100 } : { result: false, code: 204, comment: 'sem suporte' },
          responseData: respostas[m.d.requestType] } };
        setTimeout(() => {
          this._recebe(resp);
          if (ok && efeitos[m.d.requestType]) efeitos[m.d.requestType](this);
        }, 1);
      }
    }
    close() { setTimeout(() => this.onclose && this.onclose({ code: 1000 }), 1); }
    evento(tipo, dados) { this._recebe({ op: OP.EVENT, d: { eventType: tipo, eventData: dados } }); }
  }
  return { WSFalso, pedidos, socket: () => ultimo, obs };
}

module.exports = { fabricaOBS };

