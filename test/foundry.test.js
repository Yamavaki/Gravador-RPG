'use strict';
// Partes do módulo do Foundry que não dependem do Foundry: críticos e envio ao app.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { Controlador } = require('../src/main/controlador');
const { fabricaOBS } = require('./apoio');

const modulo = () => import(pathToFileURL(path.join(__dirname, '..', 'modulo-foundry', 'gravador-rpg-marcadores', 'scripts', 'main.mjs')));

test('module.json é válido para o Foundry', () => {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'modulo-foundry', 'gravador-rpg-marcadores', 'module.json'), 'utf8'));
  assert.equal(m.id, 'gravador-rpg-marcadores');
  assert.deepEqual(m.esmodules, ['scripts/main.mjs']);
  assert.ok(m.compatibility.verified >= '14');
});

test('críticos: d20 natural, vantagem e desvantagem', async () => {
  const { criticoDaMensagem, resultadosD20 } = await modulo();
  const d20 = (...res) => ({ dice: [{ faces: 20, results: res }] });
  assert.equal(criticoDaMensagem({ rolls: [d20({ result: 20 })] }, 'Kael'), 'Crítico: Kael');
  assert.equal(criticoDaMensagem({ rolls: [d20({ result: 1 })] }), 'Falha crítica');
  assert.equal(criticoDaMensagem({ rolls: [d20({ result: 13 })] }), null);
  // vantagem: o 20 descartado não conta
  assert.equal(criticoDaMensagem({ rolls: [d20({ result: 20, discarded: true, active: false }, { result: 7 })] }), null);
  assert.equal(criticoDaMensagem({ rolls: [{ dice: [{ faces: 6, results: [{ result: 6 }] }] }] }), null, 'd6 não conta');
  assert.deepEqual(resultadosD20({ terms: [{ faces: 20, results: [{ result: 4 }] }, { operator: '+' }] }), [4]);
  assert.equal(criticoDaMensagem({}), null);
});

test('envio: chega no app de verdade e marca na sessão', async t => {
  const { enviar } = await modulo();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-fvtt-'));
  const c = new Controlador({ pastaDados: dir, WebSocket: fabricaOBS({ gravando: true }).WSFalso, portaOverlay: 0, intervaloReconexao: 60000, removerArquivo: async () => {}, notificar: () => {} });
  t.after(() => c.parar());
  await c.iniciar();
  for (let i = 0; i < 100 && !c.sessao; i++) await new Promise(r => setTimeout(r, 20));
  const porta = c.servidor.portaReal;
  const ping = await enviar({ porta, chave: c.cfg.foundry.chave, tipo: 'ping' });
  assert.equal(ping.ok, true);
  assert.equal(ping.gravando, true);
  const r = await enviar({ porta, chave: c.cfg.foundry.chave, tipo: 'marcar', nome: 'Crítico: Kael' });
  assert.equal(r.ok, true);
  assert.equal(c.sessao.marcadores.at(-1).nome, 'Crítico: Kael');
  const errada = await enviar({ porta, chave: '0000000000000000', tipo: 'ping' });
  assert.equal(errada.ok, false);
  assert.match(errada.mensagem, /Chave errada/);
  const fechado = await enviar({ porta: 1, chave: 'x', tipo: 'ping' });
  assert.match(fechado.mensagem, /não encontrado/);
});

test('módulo dentro de um Foundry simulado: registra, testa a conexão e manda os eventos', async () => {
  const ganchos = {}, umaVez = {}, ajustes = {}, valores = { chave: 'abc', porta: 47800, combate: true, rodada: true, critico: true, cena: true };
  const enviados = [], avisos = [];
  global.Hooks = { on: (n, f) => { (ganchos[n] = ganchos[n] || []).push(f); }, once: (n, f) => { umaVez[n] = f; } };
  global.game = {
    settings: { register: (m, k, d) => { ajustes[k] = d; }, get: (m, k) => valores[k] },
    keybindings: { register: (m, k, d) => { ajustes['tecla-' + k] = d; } },
    user: { isGM: true, id: 'u1' },
    users: { activeGM: { id: 'u1' } },
  };
  global.ui = { notifications: { info: m => avisos.push(m), warn: m => avisos.push('!' + m) } };
  const fetchOriginal = global.fetch;
  global.fetch = async (url, o) => { enviados.push(JSON.parse(o.body)); return { json: async () => ({ ok: true, mesa: 'Nauren', gravando: true }) }; };
  try {
    await import(pathToFileURL(path.join(__dirname, '..', 'modulo-foundry', 'gravador-rpg-marcadores', 'scripts', 'main.mjs')) + '?simulado');
    umaVez.init();
    assert.ok(ajustes.chave && ajustes.porta && ajustes['tecla-marcar'], 'configurações e tecla registradas');
    assert.equal(ajustes.chave.scope, 'client', 'chave fica só no PC do mestre');
    await umaVez.ready();
    await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(enviados[0], { chave: 'abc', tipo: 'ping', nome: '' });
    assert.match(avisos[0], /conectado/);
    const disparar = (n, ...a) => ganchos[n].forEach(f => f(...a));
    disparar('combatStart', { combatants: { contents: [{ name: 'Goblin', actor: { hasPlayerOwner: false } }, { name: 'Kael', actor: { hasPlayerOwner: true } }, { name: 'Goblin', actor: { hasPlayerOwner: false } }] } });
    disparar('updateCombat', {}, { round: 2 });
    disparar('updateCombat', {}, { turn: 3 });
    disparar('createChatMessage', { speaker: { alias: 'Kael' }, rolls: [{ dice: [{ faces: 20, results: [{ result: 20 }] }] }] });
    disparar('createChatMessage', { rolls: [{ dice: [{ faces: 20, results: [{ result: 11 }] }] }] });
    disparar('updateScene', { name: 'Taverna' }, { active: true });
    disparar('updateScene', { name: 'Outra' }, { name: 'x' });
    disparar('deleteCombat', { started: true });
    await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(enviados.slice(1).map(e => e.nome), ['Combate: Goblin', 'Rodada 2', 'Crítico: Kael', 'Cena: Taverna', 'Fim do combate']);
    // outro mestre conectado: este não manda (evita marcador duplicado)
    global.game.users.activeGM = { id: 'u2' };
    disparar('updateScene', { name: 'Masmorra' }, { active: true });
    await new Promise(r => setTimeout(r, 10));
    assert.equal(enviados.at(-1).nome, 'Fim do combate');
    assert.equal(typeof globalThis.GravadorRPG.marcar, 'function');
  } finally {
    global.fetch = fetchOriginal;
    delete global.Hooks; delete global.game; delete global.ui; delete globalThis.GravadorRPG;
  }
});
