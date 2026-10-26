'use strict';
// Carrega o main.js, o preload e o preload do StreamKit com um "Electron falso",
// para pegar erros de digitação, require quebrado e fluxos de janela/atalho/IPC
// sem precisar do Electron instalado.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { EventEmitter } = require('events');

function electronFalso(dir) {
  const r = { janelas: [], atalhos: {}, handlers: {}, ouvintes: {}, notificacoes: [], abertos: [], exposto: null, enviados: [], lixeira: [] };
  class WebContents extends EventEmitter {
    constructor(win) { super(); this.win = win; }
    send(canal, dado) { r.enviados.push([canal, dado]); }
    setWindowOpenHandler(fn) { this.abrir = fn; }
    setAudioMuted() {}
    getUserAgent() { return 'Mozilla/5.0 (Windows NT 10.0) Chrome/138.0 gravador-rpg/0.3.0 Electron/38.0.0 Safari/537.36'; }
    setUserAgent(u) { this.ua = u; }
  }
  class BrowserWindow extends EventEmitter {
    constructor(o) { super(); this.o = o; this.webContents = new WebContents(this); r.janelas.push(this); this.destruida = false; }
    loadFile(f, opc) { this.carregado = { f, opc }; setTimeout(() => this.emit('ready-to-show'), 1); return Promise.resolve(); }
    loadURL(u) { this.carregado = { u }; return Promise.resolve(); }
    show() { this.visivel = true; } focus() {} restore() {} isMinimized() { return false; }
    isDestroyed() { return this.destruida; } destroy() { this.destruida = true; this.emit('closed'); }
    setMenuBarVisibility() {}
    hide() { this.visivel = false; }
    get contentView() { const w = this; return { addChildView: v => { w.filhas = (w.filhas || []).concat([v]); }, removeChildView() {} }; }
  }
  const app = new EventEmitter();
  let pronto;
  app.whenReady = () => new Promise(res => { pronto = res; });
  app.requestSingleInstanceLock = () => true;
  app.getPath = () => dir;
  app.setAppUserModelId = () => {};
  app.quit = () => { r.saiu = true; };
  app.userAgentFallback = 'Mozilla/5.0 Chrome/138 gravador-rpg/0.3.1 Electron/38.0.0';
  r.ficarPronto = () => pronto();
  const ipcMain = {
    handle: (c, fn) => { r.handlers[c] = fn; },
    on: (c, fn) => { r.ouvintes[c] = fn; },
  };
  const electron = {
    app, BrowserWindow, ipcMain,
    globalShortcut: {
      register: (a, fn) => { if (a === 'F10') return false; if (a === 'Ctrl+Mal+X') throw new Error('x'); r.atalhos[a] = fn; return true; },
      unregisterAll: () => { r.atalhos = {}; },
    },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showErrorBox: (t, m) => { r.erroFatal = m; } },
    shell: { trashItem: async c => r.lixeira.push(c), openPath: async () => '', openExternal: u => r.abertos.push(u) },
    Notification: class { static isSupported() { return true; } constructor(o) { this.o = o; } show() { r.notificacoes.push(this.o); } },
    clipboard: { writeText: t => { r.copiado = t; } },
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: t => ({ itens: t, popup() { r.menuAberto = t; } }) },
    nativeImage: { createFromPath: p => ({ p }) },
    Tray: class extends EventEmitter { constructor(img) { super(); r.bandeja = this; this.img = img; } setToolTip(t) { this.dica = t; } setImage(i) { this.img = i; } setContextMenu(m) { this.menu = m; } },
    WebContentsView: class { constructor(o) { this.o = o; this.webContents = new WebContents(this); this.webContents.loadURL = u => { this.carregado = u; }; this.webContents.navigationHistory = { canGoBack: () => false, canGoForward: () => false }; r.vistas = (r.vistas || []).concat([this]); } setBounds(b) { this.limites = b; } setVisible(v) { this.visivel = v; } },
    session: { fromPartition: () => ({ setUserAgent() {}, webRequest: { onHeadersReceived() {} } }) },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: t => Buffer.from('X' + t), decryptString: b => b.toString().slice(1) },
    contextBridge: { exposeInMainWorld: (nome, api) => { r.exposto = { nome, api }; } },
    ipcRenderer: { invoke: async (...a) => { r.invocados = (r.invocados || []).concat([a]); return null; }, on: () => {}, send: (...a) => { r.enviadosRenderer = (r.enviadosRenderer || []).concat([a]); } },
  };
  return { electron, r };
}

function comElectron(electron, fn) {
  const original = Module._load;
  Module._load = function (pedido, ...resto) {
    if (pedido === 'electron') return electron;
    return original.call(this, pedido, ...resto);
  };
  try { return fn(); } finally { Module._load = original; }
}

const raiz = path.join(__dirname, '..', 'src', 'main');
const limpar = () => { for (const k of Object.keys(require.cache)) if (k.startsWith(path.join(__dirname, '..', 'src'))) delete require.cache[k]; };

test('main.js: abre a janela, registra atalhos e responde à interface', async () => {
  limpar();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-el-'));
  // porta 0: deixa o sistema escolher (o padrão 47800 pode estar ocupado na máquina de teste)
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ overlayPorta: 47800 + Math.floor(Math.random() * 1000) }));
  const { electron, r } = electronFalso(dir);
  comElectron(electron, () => require(path.join(raiz, 'main.js')));
  r.ficarPronto();
  await new Promise(res => setTimeout(res, 150));
  assert.equal(r.erroFatal, undefined, 'abriu sem erro');
  const principal = r.janelas[0];
  assert.match(principal.carregado.f, /index\.html$/);
  assert.equal(principal.o.webPreferences.contextIsolation, true);
  assert.equal(principal.o.webPreferences.sandbox, true);
  assert.deepEqual(Object.keys(r.atalhos).sort(), ['Ctrl+F9', 'F9', 'Shift+F9']);

  const pagina = require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'ui', 'index.html')).href;
  const acao = (nome, ...args) => r.handlers.acao({ senderFrame: { url: pagina + '#sessao' } }, nome, args);
  assert.deepEqual(await r.handlers.acao({ senderFrame: { url: 'file:///C:/Users/x/Downloads/malicioso.html' } }, 'estado', []), { erro: 'Pedido recusado.' });
  const est = await acao('estado');
  assert.equal(est.atalhos.replay, 'ocupado', 'F10 ocupado aparece na interface');
  assert.equal(est.atalhos.marcar, 'ok');
  assert.match(est.overlayUrl, /\/overlay$/);
  assert.deepEqual(await acao('naoExiste'), { erro: 'Ação desconhecida: naoExiste' });
  assert.deepEqual(await acao('escolherImagem', 'abc'), { cancelado: true });
  assert.equal((await acao('marcar')).ok, false, 'sem OBS não marca');
  await acao('copiar', 'http://x');
  assert.equal(r.copiado, 'http://x');
  await acao('abrirExterno', 'https://obsproject.com/download');
  await acao('abrirExterno', 'https://site-malicioso.com');
  assert.deepEqual(r.abertos, ['https://obsproject.com/download'], 'só abre sites permitidos');

  // atalho dispara ação (sem OBS: avisa)
  await r.atalhos.F9();
  await new Promise(res => setTimeout(res, 20));
  assert.ok(r.notificacoes.some(n => /OBS não conectado/.test(n.body)));

  // trocar atalho pela interface re-registra
  const cfg = est.config;
  cfg.atalhos.marcar = 'F7';
  await acao('salvarConfig', cfg);
  assert.ok(r.atalhos.F7 && !r.atalhos.F9);

  // link do StreamKit cria a janela escondida com a partição própria
  cfg.mesas[0].streamkit.url = 'https://streamkit.discord.com/overlay/voice/187691838138400768/298765432109876543';
  await acao('salvarConfig', cfg);
  const sk = r.janelas.find(j => j.carregado && j.carregado.u && j.carregado.u.includes('/overlay/voice/'));
  assert.ok(sk, 'janela do StreamKit aberta');
  assert.equal(sk.o.show, false);
  assert.equal(sk.o.webPreferences.partition, 'persist:streamkit');
  assert.match(sk.carregado.u, /icon=true/);
  // dados só valem vindos da janela do StreamKit
  r.ouvintes['streamkit:dados']({ sender: principal.webContents }, [{ src: 'https://cdn.discordapp.com/avatars/111111111111111111/a.png', nome: 'falso', falando: true }]);
  assert.equal((await acao('estado')).streamkit.presentes, 0, 'ignora dados de outra janela');
  r.ouvintes['streamkit:dados']({ sender: sk.webContents }, [{ src: 'https://cdn.discordapp.com/avatars/187691838138400768/a.png', nome: 'Ana', falando: true }]);
  assert.equal((await acao('estado')).streamkit.presentes, 1);

  // abrir o site do StreamKit e receber o link
  await acao('abrirStreamKit');
  const site = r.janelas.find(j => j.carregado && j.carregado.u === 'https://streamkit.discord.com/overlay');
  assert.ok(site);
  r.ouvintes['streamkit:link']({ sender: site.webContents }, 'https://streamkit.discord.com/overlay/voice/1/2');
  assert.ok(r.enviados.some(([c]) => c === 'streamkit-link'));

  // música: o primeiro comando abre o motor escondido; só ele pode falar pelos canais do motor
  const tocando = acao('musicaComando', 'pararTudo', []);
  await new Promise(res => setTimeout(res, 20));
  const mot = r.janelas.find(j => j.carregado && j.carregado.u && j.carregado.u.endsWith('/motor/'));
  assert.ok(mot, 'janela do motor aberta');
  assert.equal(mot.o.show, false);
  assert.equal(mot.o.webPreferences.sandbox, true);
  assert.equal(mot.o.webPreferences.autoplayPolicy, 'no-user-gesture-required');
  r.ouvintes['motor:pronto']({ sender: principal.webContents });
  assert.equal((await acao('estado')).musica.motor.pronto, false, 'outra janela não finge ser o motor');
  r.ouvintes['motor:pronto']({ sender: mot.webContents });
  await new Promise(res => setTimeout(res, 10));
  const pedido = r.enviados.filter(([c]) => c === 'motor:comando').map(([, p]) => p).find(p => p.cmd === 'pararTudo');
  assert.ok(pedido, 'comando chegou ao motor');
  r.ouvintes['motor:resposta']({ sender: mot.webContents }, pedido.id, { ok: true });
  assert.deepEqual(await tocando, { ok: true });
  r.ouvintes['motor:pcm']({ sender: mot.webContents }, new Int16Array(4096).fill(5000));
  assert.equal((await acao('estado')).musica.somSaindo, true, 'áudio do motor chega ao mixer');
  // navegador com abas dentro da janela do app
  await acao('navAbrir');
  const v1 = r.vistas && r.vistas[0];
  assert.ok(v1, 'primeira aba criada');
  assert.equal(v1.carregado, 'https://www.youtube.com/');
  assert.equal(v1.o.webPreferences.partition, 'persist:youtube', 'mesma sessão: o login do YouTube continua');
  assert.match(v1.o.webPreferences.preload, /navegador-preload\.js$/);
  assert.ok(principal.filhas.includes(v1), 'dentro da janela principal');
  await acao('navArea', { x: 230, y: 120, largura: 900, altura: 600 });
  assert.deepEqual(v1.limites, { x: 230, y: 120, width: 900, height: 600 });
  assert.equal(v1.visivel, true);
  const id2 = await acao('navNova', 'youtu.be/abc');
  const v2 = r.vistas[1];
  assert.equal(v2.carregado, 'https://youtu.be/abc');
  assert.equal(v2.visivel, true, 'aba nova aparece');
  assert.equal(v1.visivel, false, 'a outra fica escondida (mas continua tocando)');
  await acao('navIr', id2, 'música de taverna');
  assert.match(v2.carregado, /search_query=m%C3%BAsica%20de%20taverna/);
  // som e estado: cada aba é uma fonte; quem não é aba não entra
  r.ouvintes['aba:pcm']({ sender: v1.webContents }, new Int16Array(30000).fill(3000));
  r.ouvintes['aba:pcm']({ sender: mot.webContents }, new Int16Array(30000).fill(3000));
  assert.equal((await acao('estado')).musica.abas.length, 2);
  r.ouvintes['aba:estado']({ sender: v2.webContents }, { tocando: true });
  assert.equal((await acao('estado')).musica.abas[1].tocando, true);
  await acao('navVolume', id2, 0.3, true);
  assert.equal((await acao('estado')).musica.abas[1].mudo, true);
  await acao('navArea', null);
  assert.equal(v2.visivel, false, 'trocar de tela esconde (o som continua)');
  // botão direito num vídeo: abrir em nova aba (inclusive só para mim, em prévia)
  v2.webContents.navigationHistory = { canGoBack: () => true, canGoForward: () => false, goBack() {} };
  v2.webContents.emit('context-menu', {}, { linkURL: 'https://www.youtube.com/watch?v=dragao', editFlags: {}, selectionText: '' });
  const rotulos = r.menuAberto.map(i => i.label).filter(Boolean);
  assert.ok(rotulos.includes('Abrir link em nova aba'), rotulos.join(' | '));
  r.menuAberto.find(i => /prévia/.test(i.label || '')).click();
  const v3 = r.vistas[r.vistas.length - 1];
  assert.equal(v3.carregado, 'https://www.youtube.com/watch?v=dragao');
  let est3 = (await acao('estado')).musica;
  const a3 = est3.abas[est3.abas.length - 1];
  assert.ok(a3.mudo && a3.ouvir, 'aba aberta em prévia: fora do Discord, tocando no PC');
  assert.equal(est3.abaAtiva, a3.id);
  // Ctrl+clique / botão do meio: abre em segundo plano (a aba atual continua na frente)
  v3.webContents.abrir({ url: 'https://www.youtube.com/watch?v=taverna', disposition: 'background-tab' });
  est3 = (await acao('estado')).musica;
  assert.equal(est3.abas.length, 4);
  assert.equal(est3.abaAtiva, a3.id, 'segundo plano não troca de aba');
  // texto selecionado: procurar no YouTube
  v3.webContents.emit('context-menu', {}, { linkURL: '', editFlags: {}, selectionText: 'música de chefe' });
  assert.ok(r.menuAberto.some(i => /Procurar "música de chefe"/.test(i.label || '')));
  for (const a of est3.abas.slice(2)) await acao('navFechar', a.id);
  await acao('navFechar', id2);
  assert.equal((await acao('estado')).musica.abas.length, 1);
  await assert.rejects(Promise.resolve(acao('navAtivar', 'zz')).then(x => { if (x && x.erro) throw new Error(x.erro); }), /não encontrada/);
  // X da janela: esconde na bandeja; "Sair" da bandeja fecha tudo
  assert.ok(r.bandeja, 'ícone na bandeja');
  let cancelado = false;
  principal.emit('close', { preventDefault() { cancelado = true; } });
  assert.equal(cancelado, true, 'o X não fecha');
  assert.equal(principal.visivel, false, 'só esconde');
  assert.ok(r.notificacoes.some(n => /bandeja/.test(n.body)), 'avisa onde o app ficou');
  const itens = r.bandeja.menu.itens;
  assert.ok(itens.some(i => /Sair/.test(i.label || '')));
  r.ouvintes['streamkit:link'] && null;
  await new Promise(res => setTimeout(res, 120));
  // token guardado cifrado pelo "Windows"
  const { TOKEN } = require('./discord-falso');
  await acao('botToken', TOKEN);
  const salvo = fs.readFileSync(path.join(dir, 'bot.json'), 'utf8');
  assert.ok(!salvo.includes(TOKEN) && JSON.parse(salvo).cifrado === true);
  assert.equal((await acao('estado')).musica.temToken, true);

  app_sair(electron);
  await new Promise(res => setTimeout(res, 50));
});

function app_sair(electron) {
  electron.app.emit('before-quit', { preventDefault() {} });
  electron.app.emit('will-quit');
}

test('preload.js: expõe só a api, sem Node', () => {
  limpar();
  const { electron, r } = electronFalso(os.tmpdir());
  comElectron(electron, () => require(path.join(raiz, 'preload.js')));
  assert.equal(r.exposto.nome, 'api');
  const nomes = Object.keys(r.exposto.api).sort();
  for (const n of ['estado', 'salvarConfig', 'marcar', 'aoMudar', 'nomearMarcador', 'escolherImagem']) assert.ok(nomes.includes(n), n);
  assert.ok(!nomes.includes('require'));
});

test('a interface só chama ações que existem no app', () => {
  const { criarAcoes } = require('../src/main/acoes');
  const existentes = Object.keys(criarAcoes({ ctl: {} }));
  const app = ['app.js', 'marcador.js', 'cortes.js', 'musica.js']
    .map(n => fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', n), 'utf8')).join('\n');
  const usadas = [...new Set([...app.matchAll(/window\.api\.(\w+)\(/g)].map(m => m[1]))]
    .filter(n => !['aoMudar', 'aoLinkStreamKit', 'aoConfirmarSair'].includes(n));
  assert.ok(usadas.includes('musicaTocar') && usadas.includes('exportar'), 'leu todas as telas');
  for (const n of usadas) assert.ok(existentes.includes(n), `interface usa "${n}", que o app não tem`);
  const preload = fs.readFileSync(path.join(raiz, 'preload.js'), 'utf8');
  for (const n of existentes) assert.ok(preload.includes(`'${n}'`), `preload não expõe "${n}"`);
});

test('streamkit-preload.js: no widget manda sinais; no site acha o link', async () => {
  const LINK = 'https://streamkit.discord.com/overlay/voice/187691838138400768/298765432109876543?icon=true';
  async function rodar(pathname, documento) {
    limpar();
    const { electron, r } = electronFalso(os.tmpdir());
    const antes = { location: global.location, document: global.document, window: global.window, MutationObserver: global.MutationObserver };
    global.location = { pathname };
    global.document = documento;
    global.window = { addEventListener: (ev, fn) => { if (ev === 'DOMContentLoaded') fn(); } };
    global.MutationObserver = class { constructor(fn) { this.fn = fn; } observe() {} };
    const timers = [];
    const setIntervalOriginal = global.setInterval;
    global.setInterval = (fn, ms) => { const t = setIntervalOriginal(fn, ms); timers.push(t); return t; };
    try {
      comElectron(electron, () => require(path.join(raiz, 'streamkit-preload.js')));
      await new Promise(res => setTimeout(res, 2200));
    } finally {
      timers.forEach(clearInterval);
      global.setInterval = setIntervalOriginal;
      Object.assign(global, antes);
    }
    return r.enviadosRenderer || [];
  }
  const vazio = { documentElement: {}, body: { innerText: 'Discord não está aberto' }, querySelectorAll: () => [] };
  const w = await rodar('/overlay/voice/1/2', vazio);
  assert.ok(w.some(([c, d]) => c === 'streamkit:dados' && Array.isArray(d)), 'manda a lista (vazia) ao carregar');
  assert.ok(w.some(([c, t]) => c === 'streamkit:vivo' && /não está aberto/.test(t)), 'sinal de vida com o texto da página');

  const site = { documentElement: {}, body: { innerText: '' }, querySelectorAll: s => (s === 'input, textarea' ? [{ value: LINK }] : []) };
  const s = await rodar('/overlay', site);
  assert.deepEqual(s.filter(([c]) => c === 'streamkit:link'), [['streamkit:link', LINK]], 'achou o link uma vez');
});
