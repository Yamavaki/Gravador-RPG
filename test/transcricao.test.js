'use strict';
// Transcrição (whisper.cpp): download, execução, leitura do resultado e legendas no corte.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const T = require('../src/core/transcricao');
const midia = require('../src/core/midia');
const { Controlador } = require('../src/main/controlador');
const { Sessao } = require('../src/core/sessao');
const { fabricaOBS } = require('./apoio');

const esperar = ms => new Promise(r => setTimeout(r, ms));

const { instalarWhisperFalso: instalarFalso } = require('./whisper-falso');

function respostaFalsa(conteudo) {
  const buf = Buffer.from(conteudo);
  return {
    ok: true, status: 200,
    headers: { get: k => (k.toLowerCase() === 'content-length' ? String(buf.length) : null) },
    body: (async function* () { for (let i = 0; i < buf.length; i += 4) yield buf.subarray(i, i + 4); })(),
  };
}

test('transcrição: lê o JSON do whisper, tira ruído e acha quem fala', () => {
  const segs = T.lerJsonWhisper({ transcription: [
    { offsets: { from: 0, to: 900 }, text: ' (risos)' },
    { timestamps: { from: '00:01:02,345', to: '00:01:03,000' }, text: ' Oi  ' },
    { offsets: { from: 5, to: 5 }, text: 'zero' },
  ] });
  assert.deepEqual(segs, [{ ini: 62345, fim: 63000, texto: 'Oi' }]);
  const q = T.atribuirFalantes([{ ini: 0, fim: 1000 }, { ini: 5000, fim: 6000 }],
    [{ chave: 'a', ini: 0, fim: 300 }, { chave: 'b', ini: 200, fim: 1200 }]);
  assert.equal(q[0].chave, 'b');
  assert.equal(q[1].chave, '');
});

test('transcrição: baixa programa e modelo uma vez só, com progresso', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-whisper-'));
  const pedidos = [];
  const progresso = [];
  const tr = new T.Transcricao({
    pasta,
    fetch: async url => { pedidos.push(url); return respostaFalsa('x'.repeat(40)); },
    extrair: async (zip, destino) => {
      assert.ok(fs.existsSync(zip));
      instalarFalso(pasta);
      assert.equal(destino, path.join(pasta, 'programa'));
    },
  });
  assert.deepEqual(tr.estado().modelos, { preciso: false, rapido: false });
  await tr.preparar('rapido', p => progresso.push(p.etapa));
  assert.equal(pedidos[0], T.URL_PROGRAMA);
  assert.equal(pedidos[1], T.URL_MODELOS + T.MODELOS.rapido.arquivo);
  const est = tr.estado();
  assert.equal(est.programa, true);
  assert.equal(est.modelos.rapido, true);
  assert.equal(fs.readFileSync(path.join(pasta, 'modelos', T.MODELOS.rapido.arquivo), 'utf8'), 'x'.repeat(40));
  await tr.preparar('rapido');
  assert.equal(pedidos.length, 2, 'não baixa de novo');
});

test('transcrição: download que falha não deixa arquivo pela metade', async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-whisper-'));
  instalarFalso(pasta);
  const tr = new T.Transcricao({ pasta, fetch: async () => ({ ok: false, status: 404, headers: { get: () => null } }) });
  await assert.rejects(tr.preparar('rapido'), /modelo de transcrição.*404/);
  assert.deepEqual(fs.readdirSync(path.join(pasta, 'modelos')).filter(f => f.includes('small')), []);
});

test('transcrição: roda o whisper com idioma, nomes e lê o resultado', { skip: process.platform === 'win32' }, async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-whisper-'));
  instalarFalso(pasta);
  const argsArq = path.join(pasta, 'args.json');
  process.env.HOME_ARGS = argsArq;
  const tr = new T.Transcricao({ pasta });
  const wav = path.join(pasta, 'audio.wav');
  fs.writeFileSync(wav, '');
  const prog = [];
  const segs = await tr.transcrever(wav, { idioma: 'pt', dica: 'Kael, Iris.', aoProgresso: f => prog.push(f) });
  delete process.env.HOME_ARGS;
  assert.deepEqual(segs, [{ ini: 1000, fim: 4000, texto: 'Rolei vinte natural!' }, { ini: 5000, fim: 7500, texto: 'O dragão caiu.' }]);
  assert.deepEqual(prog, [0.5, 1]);
  const args = JSON.parse(fs.readFileSync(argsArq, 'utf8'));
  assert.equal(args[args.indexOf('-l') + 1], 'pt');
  assert.equal(args[args.indexOf('--prompt') + 1], 'Kael, Iris.');
  assert.ok(args.includes('-oj'));
});

test('legendas: gerar no corte transcreve o trecho e marca quem fala', { skip: process.platform === 'win32' }, async t => {
  const ff = await midia.detectar();
  if (!ff.ok) return t.skip('sem FFmpeg');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-leg-'));
  const pastaW = path.join(dir, 'whisper');
  instalarFalso(pastaW);
  const c = new Controlador({
    pastaDados: dir, WebSocket: fabricaOBS({ gravando: false }).WSFalso, portaOverlay: 0, intervaloReconexao: 60000,
    removerArquivo: async () => {}, notificar: () => {},
  });
  t.after(() => c.parar());
  await c.iniciar();
  const t0 = Date.now() - 60000;
  const s = new Sessao(c.pastaSessoes, { inicio: t0, mesa: { id: 'm', nome: 'Nauren' }, jogadores: [{ id: 'aaaaaa01', personagem: 'Kael' }, { id: 'bbbbbb02', personagem: 'Iris' }] });
  const v = path.join(dir, 'rec.mp4');
  execFileSync(ff.bin, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30', '-f', 'lavfi', '-i', 'sine=f=440:sample_rate=48000',
    '-t', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', v]);
  s.arquivoGravacao(v, t0);
  s.estado([{ chave: 'aaaaaa01', falando: true }], t0 + 3000);       // corte começa em 2 s: "Rolei..." = 3 a 6 s
  s.estado([{ chave: 'aaaaaa01', falando: false }], t0 + 6000);
  s.estado([{ chave: 'bbbbbb02', falando: true }], t0 + 7000);
  s.estado([{ chave: 'bbbbbb02', falando: false }], t0 + 9500);
  s.encerrar(t0 + 20000);
  const id = path.basename(s.dir);
  const corte = c.biblioteca.salvarCorte(id, { nome: 'Crítico', ini: 2000, fim: 12000 });
  assert.equal(c.biblioteca.legendar(id, corte.id, 'ver').estado, 'nada');
  let r = c.biblioteca.legendar(id, corte.id);
  assert.equal(r.estado, 'rodando');
  for (let i = 0; i < 200 && r.estado === 'rodando'; i++) { await esperar(50); r = c.biblioteca.legendar(id, corte.id, 'ver'); }
  assert.equal(r.estado, 'pronto', r.erro);
  const leg = r.corte.legendas;
  assert.equal(leg.ativo, true);
  assert.equal(leg.segmentos.length, 2);
  assert.ok(Math.abs(leg.segmentos[0].ini - 3000) < 80, `início ${leg.segmentos[0].ini}`);
  assert.equal(leg.segmentos[0].texto, 'Rolei vinte natural!');
  assert.equal(leg.segmentos[0].chave, 'aaaaaa01');
  assert.equal(leg.segmentos[1].chave, 'bbbbbb02');
  // salvo de verdade
  const aberta = await c.biblioteca.abrir(id);
  assert.equal(aberta.cortes[0].legendas.segmentos.length, 2);
});
