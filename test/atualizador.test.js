'use strict';
// Atualização automática pelo GitHub: achar a versão nova, baixar, conferir e o script que aplica.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('../src/main/atualizador');

const resposta = (status, corpo, tipo = 'json') => ({
  ok: status >= 200 && status < 300, status,
  json: async () => corpo, text: async () => corpo,
  headers: { get: k => (k.toLowerCase() === 'content-length' && typeof corpo === 'string' ? String(Buffer.byteLength(corpo)) : null) },
  body: typeof corpo === 'string' ? (async function* () { yield Buffer.from(corpo); })() : null,
});

test('atualização: compara versões e acha a maior tag', () => {
  assert.equal(A.comparar('0.5.1', '0.5.0'), 1);
  assert.equal(A.comparar('v0.10.0', '0.9.9'), 1);
  assert.equal(A.comparar('0.5.0', 'v0.5.0'), 0);
  assert.equal(A.comparar('0.4.9', '0.5.0'), -1);
  assert.equal(A.maiorTag([{ name: 'v0.5.0' }, { name: 'teste' }, { name: 'v0.10.2' }, { name: 'v0.9.0' }]), 'v0.10.2');
  assert.equal(A.maiorTag([{ name: 'xyz' }]), null);
  const md = '# Novidades\n\n## 0.6.0\n- música\n\n## 0.5.1\n- atualização\n\n## 0.5.0\n- identidade';
  assert.equal(A.novidadesDesde(md, '0.5.0'), '## 0.6.0\n- música\n\n## 0.5.1\n- atualização');
});

test('atualização: avisa quando há versão nova e mostra as novidades', async () => {
  const pedidos = [];
  const at = new A.Atualizador({
    versaoAtual: '0.5.0', pastaDados: fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-at-')), pastaApp: '/app',
    fetch: async url => {
      pedidos.push(url);
      if (url.endsWith('/package.json')) return resposta(200, JSON.stringify({ name: 'gravador-rpg', version: '0.5.1' }));
      if (url.endsWith('NOVIDADES.md')) return resposta(200, '## 0.5.1\n- atualiza sozinho\n## 0.5.0\n- velho');
      return resposta(404, null);
    },
  });
  const r = await at.verificar();
  assert.equal(r.disponivel, '0.5.1');
  assert.equal(r.notas, '## 0.5.1\n- atualiza sozinho');
  assert.equal(pedidos[0], 'https://raw.githubusercontent.com/Yamavaki/Gravador-RPG/estavel/package.json');
  const semNada = new A.Atualizador({ versaoAtual: '0.5.1', pastaDados: os.tmpdir(), pastaApp: '/app', fetch: async () => resposta(200, JSON.stringify({ version: '0.5.1' })) });
  assert.equal((await semNada.verificar()).disponivel, null);
  const offline = new A.Atualizador({ versaoAtual: '0.5.0', pastaDados: os.tmpdir(), pastaApp: '/app', fetch: async () => { throw new Error('sem internet'); } });
  const e = await offline.verificar();
  assert.match(e.erro, /sem internet/);
  assert.equal(e.disponivel, null);
});

function atualizadorCom(versaoZip, nome = 'gravador-rpg') {
  const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-at-'));
  return new A.Atualizador({
    versaoAtual: '0.5.0', pastaDados: dados, pastaApp: 'C:\\Jogos\\gravador-rpg', plataforma: 'win32',
    fetch: async url => {
      if (url === 'https://codeload.github.com/Yamavaki/Gravador-RPG/zip/refs/heads/estavel') return resposta(200, 'ZIP');
      if (url.endsWith('/package.json')) return resposta(200, JSON.stringify({ version: '0.5.1' }));
      return resposta(404, null);
    },
    extrair: async (zip, destino) => {
      assert.equal(fs.readFileSync(zip, 'utf8'), 'ZIP');
      const raiz = path.join(destino, 'Gravador-RPG-estavel');
      fs.mkdirSync(path.join(raiz, 'src', 'main'), { recursive: true });
      fs.writeFileSync(path.join(raiz, 'package.json'), JSON.stringify({ name: nome, version: versaoZip }));
      fs.writeFileSync(path.join(raiz, 'src', 'main', 'main.js'), '');
      fs.writeFileSync(path.join(raiz, 'ABRIR.bat'), '');
    },
  });
}

test('atualização: baixa a versão da tag, confere e monta o script que aplica', async () => {
  const at = atualizadorCom('0.5.1');
  const pasta = await at.preparar();
  assert.equal(path.basename(pasta), 'Gravador-RPG-estavel');
  assert.equal(at.publico().pronta, true);
  const cmd = fs.readFileSync(at.scriptAplicar(pasta, 4321), 'utf8');
  assert.match(cmd, /PID eq 4321/);
  assert.match(cmd, /robocopy ".*Gravador-RPG-estavel" "C:\\Jogos\\gravador-rpg" \/E \/XD node_modules dist \.git/);
  assert.match(cmd, /call ABRIR\.bat/);
  assert.ok(cmd.includes('\r\n'), 'linhas do Windows');
});

test('atualização: recusa arquivo de outra versão ou de outro programa', async () => {
  await assert.rejects(atualizadorCom('0.4.0').preparar(), /não é uma versão mais nova/);
  await assert.rejects(atualizadorCom('0.5.1', 'outra-coisa').preparar(), /não é do Gravador RPG/);
});
