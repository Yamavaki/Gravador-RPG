'use strict';
// Sessões, cortes e exportação pelo controlador (como a interface usa), e o Foundry.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const { Controlador } = require('../src/main/controlador');
const { Sessao } = require('../src/core/sessao');
const midia = require('../src/core/midia');
const { fabricaOBS } = require('./apoio');

let ff;
const esperar = ms => new Promise(r => setTimeout(r, ms));

async function preparar(t) {
  ff = ff || await midia.detectar();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-bib-'));
  const c = new Controlador({
    pastaDados: dir, WebSocket: fabricaOBS({ gravando: false }).WSFalso, portaOverlay: 0, intervaloReconexao: 60000,
    removerArquivo: async () => {}, notificar: () => {},
  });
  t.after(() => c.parar());
  await c.iniciar();
  return { c, dir };
}

function sessaoFalsa(c, dir, comVideo) {
  const t0 = Date.now() - 60000;
  const s = new Sessao(c.pastaSessoes, { inicio: t0, mesa: { id: 'm', nome: 'Nauren' }, jogadores: [{ id: 'aaaaaa01', personagem: 'Kael' }] });
  if (comVideo) {
    const v = path.join(dir, 'rec.mp4');
    execFileSync(ff.bin, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30', '-f', 'lavfi', '-i', 'sine=f=440:sample_rate=48000',
      '-t', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', v]);
    s.arquivoGravacao(v, t0);
  }
  s.estado([{ chave: 'aaaaaa01', falando: true }], t0 + 2000);
  s.estado([{ chave: 'aaaaaa01', falando: false }], t0 + 5000);
  s.marcar('Crítico', 'atalho', t0 + 10000);
  s.encerrar(t0 + 20000);
  return path.basename(s.dir);
}

test('biblioteca: lista e abre sessões, com vídeo para a prévia', async t => {
  const { c, dir } = await preparar(t);
  if (!ff.ok) return t.skip('sem FFmpeg');
  const id = sessaoFalsa(c, dir, true);
  const lista = c.biblioteca.listar();
  assert.equal(lista.length, 1);
  assert.equal(lista[0].mesa, 'Nauren');
  assert.equal(lista[0].marcadores, 1);
  assert.equal(lista[0].arquivosExistem, 1);
  const s = await c.biblioteca.abrir(id);
  assert.equal(s.marcadores[0].rel, 10000);
  assert.deepEqual(s.falas, [{ chave: 'aaaaaa01', ini: 2000, fim: 5000 }]);
  assert.match(s.arquivos[0].url, /^http:\/\/127\.0\.0\.1:\d+\/midia\/[a-f0-9]+\.mp4$/);
  assert.equal(s.fonte.largura, 640);
  // o vídeo é servido com Range (o player precisa para pular)
  const r = await new Promise(res => http.get(s.arquivos[0].url, { headers: { Range: 'bytes=0-99' } }, res));
  assert.equal(r.statusCode, 206);
  assert.equal(r.headers['content-length'], '100');
  r.resume();
  const ruim = await new Promise(res => http.get(s.arquivos[0].url.replace(/midia\/[^/]+$/, 'midia/xyz.mp4'), res));
  assert.equal(ruim.statusCode, 404, 'só vídeos liberados pelo app');
  ruim.resume();
  assert.throws(() => c.biblioteca._dir('../../etc'), /inválida/);
});

test('biblioteca: criar, editar e excluir cortes, com valores corrigidos', async t => {
  const { c, dir } = await preparar(t);
  const id = sessaoFalsa(c, dir, false);
  const k = await c.biblioteca.criarCorte(id, { rel: 10000, nome: "Crítico" });
  assert.equal(k.ini, 0, 'não começa antes do início');
  assert.equal(k.fim, 20000, 'não passa do fim da sessão');
  const inteira = await c.biblioteca.criarCorte(id, { inteira: true });
  assert.equal(inteira.fim, 20000);
  const editado = c.biblioteca.salvarCorte(id, { ...k, ini: 5000, fim: 4000, nome: '  ', audio: { modo: 'mix', volumes: { 2: 500, 3: -4 } }, fonte: 'replay:C:/qualquer.mp4',
    vertical: { modo: 'camera', camera: [{ t: 0, x: 9, y: 0, w: 0.3 }] } });
  assert.equal(editado.id, k.id);
  assert.ok(editado.fim > editado.ini);
  assert.equal(editado.nome, 'Corte');
  assert.equal(editado.audio.volumes[2], 200);
  assert.equal(editado.audio.volumes[3], 0);
  assert.equal(editado.fonte, 'gravacao', 'replay que não é da sessão é recusado');
  assert.ok(editado.vertical.camera[0].x + editado.vertical.camera[0].w <= 1);
  c.biblioteca.excluirCorte(id, inteira.id);
  const s = await c.biblioteca.abrir(id);
  assert.deepEqual(s.cortes.map(x => x.id), [k.id]);
});

test('biblioteca: exportar pela fila e notificar no estado', async t => {
  const { c, dir } = await preparar(t);
  if (!ff.ok) return t.skip('sem FFmpeg');
  const id = sessaoFalsa(c, dir, true);
  const k = await c.biblioteca.criarCorte(id, { rel: 10000, nome: "Crítico" });
  await assert.rejects(c.biblioteca.exportar({ sessaoId: id, corteId: 'naoexiste', presets: ['youtube-1080'] }), /não encontrado/);
  await assert.rejects(c.biblioteca.exportar({ sessaoId: id, corteId: k.id, presets: [] }), /pelo menos um/);
  const r = await c.biblioteca.exportar({ sessaoId: id, corteId: k.id, presets: ['whatsapp', 'rapido'] });
  assert.equal(r.ids.length, 2);
  for (let i = 0; i < 200 && c.fila.lista().some(x => x.estado !== 'pronto' && x.estado !== 'erro'); i++) await esperar(100);
  const l = c.estadoPublico().fila;
  assert.deepEqual(l.map(x => x.estado), ['pronto', 'pronto'], JSON.stringify(l.map(x => x.erro)));
  assert.ok(l.every(x => x.saida.startsWith(path.join(dir, 'cortes'))));
  assert.match(path.basename(l[0].saida), /Nauren - Crítico - WhatsApp\.mp4$/);
});

test('foundry: chave certa marca, chave errada é recusada, repetido vira um só', async t => {
  const { c } = await preparar(t);
  const url = c.servidor.url.replace('/overlay', '/foundry');
  const enviar = corpo => new Promise((res, rej) => {
    const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://exemplo.forge-vtt.com' } }, r => {
      let b = ''; r.on('data', d => { b += d; }); r.on('end', () => res({ status: r.statusCode, corpo: JSON.parse(b), cabecalhos: r.headers }));
    });
    req.on('error', rej);
    req.end(JSON.stringify(corpo));
  });
  const chave = c.cfg.foundry.chave;
  assert.match(chave, /^[a-f0-9]{16}$/);
  assert.equal((await enviar({ chave: 'errada', tipo: 'ping' })).status, 401);
  const ping = await enviar({ chave, tipo: 'ping' });
  assert.equal(ping.corpo.ok, true);
  assert.equal(ping.cabecalhos['access-control-allow-origin'], 'https://exemplo.forge-vtt.com');
  const sem = await enviar({ chave, tipo: 'marcar', nome: 'Combate' });
  assert.equal(sem.corpo.ok, false, 'sem gravação não marca');
  await c.alternarGravacao();
  for (let i = 0; i < 50 && !c.sessao; i++) await esperar(20);
  const m = await enviar({ chave, tipo: 'marcar', nome: 'Combate: Emboscada' });
  assert.equal(m.corpo.ok, true);
  const rep = await enviar({ chave, tipo: 'marcar', nome: 'Combate: Emboscada' });
  assert.equal(rep.corpo.repetido, true);
  assert.equal(c.sessao.marcadores.length, 1);
  assert.equal(c.sessao.marcadores[0].origem, 'foundry');
  // pré-voo do navegador (Chrome pede para sites da internet falarem com o PC)
  const pre = await new Promise(res => http.request(url, { method: 'OPTIONS', headers: { Origin: 'https://x.com', 'Access-Control-Request-Private-Network': 'true' } }, res).end());
  assert.equal(pre.statusCode, 204);
  assert.equal(pre.headers['access-control-allow-private-network'], 'true');
  const cfg = JSON.parse(JSON.stringify(c.cfg));
  cfg.foundry.ativo = false;
  c.salvarConfig(cfg);
  assert.equal((await enviar({ chave, tipo: 'ping' })).status, 403);
});
