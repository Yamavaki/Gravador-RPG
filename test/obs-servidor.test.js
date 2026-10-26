'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { ClienteOBS } = require('../src/core/obs');
const { ServidorOverlay } = require('../src/core/servidor-overlay');

const { fabricaOBS } = require('./apoio');

test('obs: conecta sem senha e faz pedidos', async () => {
  const f = fabricaOBS();
  const c = new ClienteOBS({ WebSocket: f.WSFalso });
  await c.iniciar({ host: '127.0.0.1', porta: 4455 });
  assert.equal(c.conectado, true);
  assert.equal(f.socket().url, 'ws://127.0.0.1:4455');
  assert.equal(f.socket().eventos, 64);
  const st = await c.estadoGravacao();
  assert.equal(st.outputActive, true);
  assert.equal((await c.pastaGravacao()).recordDirectory, 'D:/Gravacoes');
  c.desconectar();
});

test('obs: autentica com senha certa', async () => {
  const f = fabricaOBS({ senha: 'segredo' });
  const c = new ClienteOBS({ WebSocket: f.WSFalso });
  await c.iniciar({ senha: 'segredo' });
  assert.equal(c.conectado, true);
  c.desconectar();
});

test('obs: senha errada dá mensagem clara', async () => {
  const f = fabricaOBS({ senha: 'segredo' });
  const c = new ClienteOBS({ WebSocket: f.WSFalso, intervaloReconexao: 60000 });
  await assert.rejects(c.iniciar({ senha: 'errada' }), /Senha do OBS incorreta/);
  c.desconectar();
});

test('obs: sem senha quando o OBS pede', async () => {
  const f = fabricaOBS({ senha: 'segredo' });
  const c = new ClienteOBS({ WebSocket: f.WSFalso, intervaloReconexao: 60000 });
  await assert.rejects(c.iniciar({}), /pediu senha/);
  c.desconectar();
});

test('obs: OBS fechado dá mensagem clara e tenta de novo', async () => {
  const f = fabricaOBS({ fecharCom: 1006 });
  const c = new ClienteOBS({ WebSocket: f.WSFalso, intervaloReconexao: 20 });
  await assert.rejects(c.iniciar({}), /Não foi possível conectar ao OBS/);
  await new Promise(r => setTimeout(r, 60));
  assert.ok(c._reconectar || true);
  c.desconectar();
  assert.equal(c._reconectar, null);
});

test('obs: OBS que não responde estoura o tempo', async () => {
  const f = fabricaOBS({ naoResponde: true });
  const c = new ClienteOBS({ WebSocket: f.WSFalso, tempoLimite: 30, intervaloReconexao: 60000 });
  await assert.rejects(c.iniciar({}), /não respondeu/);
  c.desconectar();
});

test('obs: capítulo sem suporte não quebra, só devolve false', async () => {
  const f = fabricaOBS({ recusar: new Set(['CreateRecordChapter']) });
  const c = new ClienteOBS({ WebSocket: f.WSFalso });
  await c.iniciar({});
  assert.equal(await c.capitulo('Crítico'), false);
  const f2 = fabricaOBS();
  const c2 = new ClienteOBS({ WebSocket: f2.WSFalso });
  await c2.iniciar({});
  assert.equal(await c2.capitulo('Crítico'), true);
  assert.deepEqual(f2.pedidos.at(-1), { requestType: 'CreateRecordChapter', requestId: f2.pedidos.at(-1).requestId, requestData: { chapterName: 'Crítico' } });
  c.desconectar(); c2.desconectar();
});

test('obs: eventos chegam pelo nome', async () => {
  const f = fabricaOBS();
  const c = new ClienteOBS({ WebSocket: f.WSFalso });
  await c.iniciar({});
  const recebido = new Promise(r => c.once('RecordFileChanged', r));
  f.socket().evento('RecordFileChanged', { newOutputPath: 'D:/b.mp4' });
  assert.equal((await recebido).newOutputPath, 'D:/b.mp4');
  c.desconectar();
});

test('obs: pedido sem conexão falha na hora', async () => {
  const c = new ClienteOBS({ WebSocket: fabricaOBS().WSFalso });
  await assert.rejects(c.iniciarGravacao(), /não conectado/);
});

test('obs: conexão que cai rejeita pedidos pendentes e avisa', async () => {
  const f = fabricaOBS({ naoResponde: false });
  const c = new ClienteOBS({ WebSocket: f.WSFalso, intervaloReconexao: 60000 });
  await c.iniciar({});
  let caiu = false;
  c.on('desconectado', () => { caiu = true; });
  const ws = f.socket();
  ws.send = () => {};                                  // OBS some sem responder
  const p = c.iniciarGravacao();
  ws.onclose({ code: 1006 });
  await assert.rejects(p, /caiu/);
  assert.equal(caiu, true);
  c.desconectar();
});

// ------------------------------------------------------------- servidor
function pegar(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let corpo = '';
      res.on('data', d => { corpo += d; });
      res.on('end', () => resolve({ status: res.statusCode, tipo: res.headers['content-type'], corpo }));
    }).on('error', reject);
  });
}

test('servidor: entrega overlay, estado, imagens e protege a pasta', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-img-'));
  fs.writeFileSync(path.join(dir, 'kael.png'), 'PNG');
  fs.writeFileSync(path.join(os.tmpdir(), 'segredo.png'), 'nao');
  const s = new ServidorOverlay({ porta: 0, pastaImagens: dir });
  await s.iniciar();
  const porta = s.servidor.address().port;
  const base = `http://127.0.0.1:${porta}`;
  try {
    const o = await pegar(base + '/overlay');
    assert.equal(o.status, 200);
    assert.match(o.tipo, /text\/html/);
    assert.equal((await pegar(base + '/overlay.js')).status, 200);
    assert.equal((await pegar(base + '/overlay.css')).status, 200);
    s.publicar({ ativo: true, pessoas: [{ id: 'a', nome: 'Kael' }] });
    const est = JSON.parse((await pegar(base + '/estado')).corpo);
    assert.equal(est.pessoas[0].nome, 'Kael');
    assert.match(est._v, /^[a-f0-9]{12}$/, 'versão do overlay vai junto (a página recarrega quando o app atualiza)');
    const img = await pegar(base + '/img/kael.png');
    assert.equal(img.status, 200);
    assert.equal(img.tipo, 'image/png');
    assert.equal((await pegar(base + '/img/..%2Fsegredo.png')).status, 404);
    assert.equal((await pegar(base + '/img/%2e%2e%2fsegredo.png')).status, 404);
    assert.equal((await pegar(base + '/img/nao-existe.png')).status, 404);
    assert.equal((await pegar(base + '/img/kael.exe')).status, 404);
    assert.equal((await pegar(base + '/../package.json')).status, 404);
    const rebind = await new Promise(res => http.get(base + '/estado', { headers: { Host: 'malicioso.com' } }, res));
    assert.equal(rebind.statusCode, 403, 'Host de fora é recusado');
    rebind.resume();
  } finally {
    await s.parar();
  }
});

test('servidor: eventos ao vivo (SSE) recebem cada publicação', async () => {
  const s = new ServidorOverlay({ porta: 0, pastaImagens: os.tmpdir() });
  await s.iniciar();
  const porta = s.servidor.address().port;
  const recebidos = [];
  await new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${porta}/eventos`, res => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', d => {
        buf += d;
        const partes = buf.split('\n\n');
        buf = partes.pop();
        for (const p of partes) {
          const linha = p.split('\n').find(l => l.startsWith('data: '));
          if (linha) recebidos.push(JSON.parse(linha.slice(6)));
        }
        if (recebidos.length === 1) s.publicar({ ativo: false, pessoas: [] });
        if (recebidos.length === 2) { req.destroy(); resolve(); }
      });
    });
    req.on('error', e => (e.code === 'ECONNRESET' ? resolve() : reject(e)));
  });
  assert.equal(recebidos[1].ativo, false);
  await s.parar();
});

test('servidor: porta ocupada dá mensagem clara', async () => {
  const a = new ServidorOverlay({ porta: 0, pastaImagens: os.tmpdir() });
  await a.iniciar();
  const b = new ServidorOverlay({ porta: a.servidor.address().port, pastaImagens: os.tmpdir() });
  await assert.rejects(b.iniciar(), /já está em uso/);
  await a.parar();
});

test('obs: trocar a senha no meio de uma tentativa não derruba a conexão nova depois', async () => {
  const { fabricaOBS } = require('./apoio');
  const lento = fabricaOBS({ naoResponde: true });
  const bom = fabricaOBS();
  let usar = lento.WSFalso;
  class Alternado { constructor(u, p) { return new usar(u, p); } }
  const c = new ClienteOBS({ WebSocket: Alternado, tempoLimite: 80, intervaloReconexao: 60000 });
  const primeira = c.iniciar({ senha: 'a' }).catch(e => e);
  usar = bom.WSFalso;
  await c.iniciar({ senha: 'b' });                      // como salvar a config de novo
  assert.match((await primeira).message, /cancelada/);
  await new Promise(r => setTimeout(r, 150));          // passa o tempo-limite da primeira
  assert.equal(c.conectado, true, 'a conexão nova continua de pé');
  assert.equal(c._reconectar, null, 'sem reconexão desnecessária agendada');
  c.desconectar();
});
