'use strict';
// Sugestão de momentos: volume (FFmpeg) + falas simultâneas (StreamKit).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const M = require('../src/core/momentos');
const midia = require('../src/core/midia');
const { Controlador } = require('../src/main/controlador');
const { Sessao } = require('../src/core/sessao');
const { fabricaOBS } = require('./apoio');

test('momentos: falas simultâneas e volume viram sugestões, longe dos marcadores', () => {
  const vol = new Float32Array(300).fill(-35);
  for (let s = 100; s < 104; s++) vol[s] = -10;           // grito/risada aos 100 s
  const falas = [
    { chave: 'a', ini: 200000, fim: 206000 }, { chave: 'b', ini: 201000, fim: 205000 }, { chave: 'c', ini: 202000, fim: 204000 },
    { chave: 'a', ini: 10000, fim: 12000 },
  ];
  const r = M.sugerir({ duracaoMs: 300000, volume: vol, falas, marcadores: [], nomes: { a: 'Kael', b: 'Iris', c: 'Bram' } });
  assert.equal(r.length, 2);
  assert.ok(Math.abs(r[0].t - 100000) <= 3000, `pico de volume ${r[0].t}`);
  assert.match(r[0].motivos.join(), /Volume/);
  assert.ok(Math.abs(r[1].t - 203000) <= 3000, `agito ${r[1].t}`);
  assert.match(r[1].motivos.join(), /3 pessoas/);
  assert.deepEqual(r[1].quem.sort(), ['Bram', 'Iris', 'Kael']);
  const comMarcador = M.sugerir({ duracaoMs: 300000, volume: vol, falas, marcadores: [{ rel: 101000 }] });
  assert.equal(comMarcador.length, 1, 'onde já tem marcador, não sugere');
  const calmo = M.sugerir({ duracaoMs: 300000, volume: new Float32Array(300).fill(-30), falas: [] });
  assert.equal(calmo.length, 0, 'sessão calma: nada');
});

test('momentos: analisa o vídeo de verdade em segundo plano e guarda o resultado', async t => {
  const ff = await midia.detectar();
  if (!ff.ok) return t.skip('sem FFmpeg');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-mom-'));
  const c = new Controlador({ pastaDados: dir, WebSocket: fabricaOBS({ gravando: false }).WSFalso, portaOverlay: 0, intervaloReconexao: 60000, removerArquivo: async () => {}, notificar: () => {} });
  t.after(() => c.parar());
  await c.iniciar();
  const v = path.join(dir, 'rec.mp4');
  execFileSync(ff.bin, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=15',
    '-f', 'lavfi', '-i', 'anoisesrc=d=90:a=0.02:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=f=700:d=4:sample_rate=48000',
    '-filter_complex', '[2]adelay=60000|60000,volume=8[b];[1][b]amix=inputs=2:normalize=0[a]', '-map', '0:v', '-map', '[a]',
    '-t', '90', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', v]);
  const t0 = Date.now() - 100000;
  const s = new Sessao(c.pastaSessoes, { inicio: t0, mesa: { id: 'm', nome: 'Mesa' }, jogadores: [] });
  s.arquivoGravacao(v, t0);
  s.marcar('Início', 'atalho', t0 + 10000);
  s.encerrar(t0 + 90000);
  const id = path.basename(s.dir);
  assert.deepEqual(await c.biblioteca.momentos(id, 'cache'), { estado: 'nada' });
  let r = await c.biblioteca.momentos(id);
  assert.equal(r.estado, 'rodando');
  for (let i = 0; i < 100 && r.estado === 'rodando'; i++) { await new Promise(res => setTimeout(res, 100)); r = await c.biblioteca.momentos(id); }
  assert.equal(r.estado, 'pronto', JSON.stringify(r));
  assert.equal(r.sugestoes.length, 1);
  assert.ok(Math.abs(r.sugestoes[0].t - 60000) <= 3000, `pico aos 60 s: ${r.sugestoes[0].t}`);
  // guardado: abrir de novo não analisa outra vez
  const r2 = await c.biblioteca.momentos(id, 'cache');
  assert.equal(r2.estado, 'pronto');
  c.biblioteca.descartarMomento(id, r.sugestoes[0].t);
  assert.equal((await c.biblioteca.momentos(id, 'cache')).sugestoes.length, 0, 'descartada some');
  // criar corte de todos os marcadores
  const k = c.biblioteca.cortesDosMarcadores(id);
  assert.equal(k.criados, 1);
  assert.equal(c.biblioteca.cortesDosMarcadores(id).criados, 0, 'não repete');
});
