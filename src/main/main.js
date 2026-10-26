'use strict';
// Processo principal do Electron: janelas, atalhos globais, StreamKit escondido.
// A lógica fica no controlador.js; aqui só ligamos às peças do Electron.

const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, ipcMain, globalShortcut, dialog, shell, Notification, clipboard, Menu, safeStorage, session,
  Tray, nativeImage, WebContentsView,
} = require('electron');
const { Controlador } = require('./controlador');
const { criarAcoes, executarAcao } = require('./acoes');
const { Navegador } = require('./navegador');

const PARTICAO_SK = 'persist:streamkit';
const SITE_STREAMKIT = 'https://streamkit.discord.com/overlay';
const UI = path.join(__dirname, '..', 'ui');
const EXTERNOS_PERMITIDOS = ['obsproject.com', 'streamkit.discord.com', 'discord.com', 'support.discord.com', 'nodejs.org', 'github.com'];

let janela = null;
let janelaSK = null;       // StreamKit escondido (leitura)
let janelaSiteSK = null;   // site do StreamKit visível (autorizar e pegar o link)
let janelaNome = null;     // "marcar com nome"
let ctl = null;
let statusAtalhos = {};
let reabrirSK = null;
let janelaMotor = null;    // motor de áudio do bot (escondido)
let nav = null;            // navegador interno (abas de YouTube e outros sites, som para o bot)
let bandeja = null;        // ícone perto do relógio
let sairDeVez = false;     // "Sair" da bandeja: fecha tudo (o X só esconde)
let avisouBandeja = false;
const ICONES = path.join(__dirname);
let reabrirMotor = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // abrir de novo (ABRIR.bat, atalho) com o app na bandeja: mostra a janela
  app.on('second-instance', () => mostrarJanela());
  app.whenReady().then(iniciar).catch(e => {
    dialog.showErrorBox('Gravador RPG', 'O app não conseguiu abrir:\n\n' + (e && e.stack || e));
    app.quit();
  });
}

async function iniciar() {
  Menu.setApplicationMenu(null);
  app.setAppUserModelId('Gravador RPG');

  ctl = new Controlador({
    procurarAtualizacoes: true,
    pastaDados: app.getPath('userData'),
    pastaCortes: path.join(app.getPath('videos'), 'Gravador RPG'),
    removerArquivo: (caminho, destino) => (destino === 'apagar' ? fs.promises.unlink(caminho) : shell.trashItem(caminho)),
    notificar: (titulo, texto) => {
      if (Notification.isSupported()) new Notification({ title: titulo, body: texto, silent: true }).show();
    },
    // token do bot protegido pelo Windows (DPAPI) quando disponível
    cifrar: safeStorage && safeStorage.isEncryptionAvailable() ? t => safeStorage.encryptString(t) : null,
    decifrar: safeStorage && safeStorage.isEncryptionAvailable() ? b => safeStorage.decryptString(b) : null,
  });
  ctl.on('estado', enviarEstado);
  ctl.on('atalhos', registrarAtalhos);
  ctl.on('streamkit-url', abrirStreamKitOculto);
  ctl.on('servidor', () => { if (janelaMotor && !janelaMotor.isDestroyed()) abrirMotor(); });
  ctl.musica.on('abrir-motor', () => { if (!janelaMotor || janelaMotor.isDestroyed()) abrirMotor(); });
  ctl.musica.on('motor', pedido => {
    if (janelaMotor && !janelaMotor.isDestroyed()) janelaMotor.webContents.send('motor:comando', pedido);
  });
  nav = new Navegador({
    electron: { WebContentsView, session, shell, app, Menu, clipboard },
    avisar: t => avisar(t),
    janela: () => janela,
    musica: ctl.musica,
    salvarAbas: urls => {
      if (JSON.stringify(urls) === JSON.stringify(ctl.cfg.navegador.abas)) return;
      const cfg = JSON.parse(JSON.stringify(ctl.cfg));
      cfg.navegador.abas = urls;
      ctl.salvarConfig(cfg);
    },
  });
  ctl.musica.on('ouvir-aba', (id, ligado) => nav.ouvirAba(id, ligado));

  registrarIpc();
  criarJanela();
  criarBandeja();
  await ctl.iniciar();
  registrarAtalhos(ctl.cfg.atalhos);
  abrirStreamKitOculto(ctl.urlStreamKit());
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
// antes de sair: tira o bot do canal e fecha a sessão (no máximo 3 s de espera)
let saindo = false;
app.on('before-quit', ev => {
  if (!ctl || saindo) return;
  saindo = true;
  ev.preventDefault();
  Promise.race([ctl.parar(), new Promise(r => setTimeout(r, 3000))]).catch(() => {}).then(() => app.quit());
});

// ---------------------------------------------------------------- janelas

function seguranca(win) {
  // links externos abrem no navegador, nunca dentro do app
  win.webContents.setWindowOpenHandler(({ url }) => { abrirExterno(url); return { action: 'deny' }; });
  // a janela do app nunca sai das próprias páginas (nem por arrastar um arquivo .html para ela)
  win.webContents.on('will-navigate', (ev, url) => {
    ev.preventDefault();
    if (/^https:/.test(url)) abrirExterno(url);
  });
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1240, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: '#101217',
    title: 'Gravador RPG',
    icon: path.join(ICONES, 'icone.png'),
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  seguranca(janela);
  janela.once('ready-to-show', () => janela.show());
  // o X esconde na bandeja (gravação, retratos e música continuam); "Sair" na bandeja fecha tudo
  janela.on('close', ev => {
    if (sairDeVez || !ctl) return;
    if (ctl.cfg.app.fecharParaBandeja && bandeja) {
      ev.preventDefault();
      janela.hide();
      if (!avisouBandeja) {
        avisouBandeja = true;
        avisar('O Gravador RPG continua rodando aqui na bandeja (perto do relógio). Para sair de vez: botão direito no ícone → Sair.');
      }
      return;
    }
    if (!confirmarSaida()) ev.preventDefault();
    else sairDeVez = true;
  });
  janela.loadFile(path.join(UI, 'index.html'));
  janela.on('resize', () => { if (nav) nav.posicionar(); });
  janela.on('closed', () => { janela = null; if (nav) nav.fecharTudo(); app.quit(); });
}

/** Sair com o OBS gravando perde os marcadores dali para frente: pergunta antes. */
function confirmarSaida() {
  if (!ctl || !ctl.obsInfo.gravando) return true;
  mostrarJanela();
  const r = dialog.showMessageBoxSync(janela, {
    type: 'warning', buttons: ['Continuar aberto', 'Sair mesmo assim'], defaultId: 0, cancelId: 0,
    title: 'Gravador RPG', message: 'O OBS ainda está gravando.',
    detail: 'Com o app fechado, os marcadores e quem está falando deixam de ser registrados (o OBS continua gravando). Sair mesmo assim?',
  });
  return r === 1;
}

function sair() {
  if (!confirmarSaida()) return;
  sairDeVez = true;
  app.quit();
}

function mostrarJanela() {
  if (!janela) { if (ctl) criarJanela(); return; }
  if (janela.isMinimized()) janela.restore();
  janela.show();
  janela.focus();
}

function criarBandeja() {
  try {
    bandeja = new Tray(nativeImage.createFromPath(path.join(ICONES, 'icone-bandeja.png')));
  } catch { bandeja = null; return; }
  bandeja.setToolTip('Gravador RPG');
  bandeja.on('click', mostrarJanela);
  bandeja.on('double-click', mostrarJanela);
  atualizarBandeja();
}

let bandejaAntes = '';
function atualizarBandeja() {
  if (!bandeja || !ctl) return;
  const grav = !!ctl.obsInfo.gravando;
  const bot = ctl.musica.bot.estado;
  const linhaBot = bot.etapa === 'online' ? (bot.voz === 'no-canal' ? 'Bot de música no canal' : 'Bot de música ligado') : '';
  const chave = [grav, linhaBot].join('|');
  if (chave === bandejaAntes) return;
  bandejaAntes = chave;
  bandeja.setImage(nativeImage.createFromPath(path.join(ICONES, grav ? 'icone-gravando.png' : 'icone-bandeja.png')));
  bandeja.setToolTip('Gravador RPG' + (grav ? ' — gravando' : '') + (linhaBot ? ' — ' + linhaBot.toLowerCase() : ''));
  const itens = [
    { label: 'Abrir o Gravador RPG', click: mostrarJanela },
    { label: grav ? '● Gravando' : 'Parado', enabled: false },
  ];
  if (linhaBot) itens.push({ label: linhaBot, enabled: false });
  itens.push({ type: 'separator' }, { label: 'Sair (fecha tudo)', click: sair });
  bandeja.setContextMenu(Menu.buildFromTemplate(itens));
}

function enviarEstado(estado) {
  if (janela && !janela.isDestroyed()) janela.webContents.send('estado', { ...estado, atalhos: statusAtalhos });
  atualizarBandeja();
}

/** Janela escondida com o widget de voz: é ela que lê quem está falando. */
function abrirStreamKitOculto(url) {
  clearTimeout(reabrirSK);
  if (janelaSK && !janelaSK.isDestroyed()) janelaSK.destroy();
  janelaSK = null;
  if (!url) return;
  janelaSK = new BrowserWindow({
    show: false, width: 420, height: 900,
    webPreferences: {
      partition: PARTICAO_SK,
      preload: path.join(__dirname, 'streamkit-preload.js'),
      contextIsolation: true, sandbox: false, backgroundThrottling: false,
    },
  });
  janelaSK.webContents.setAudioMuted(true);
  janelaSK.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const tentarDeNovo = () => {
    clearTimeout(reabrirSK);
    reabrirSK = setTimeout(() => abrirStreamKitOculto(ctl.urlStreamKit()), 10000);
  };
  janelaSK.webContents.on('did-fail-load', (ev, codigo, desc, url, principal) => { if (principal) tentarDeNovo(); });
  janelaSK.webContents.on('render-process-gone', tentarDeNovo);
  janelaSK.loadURL(url).catch(tentarDeNovo);
}

/** Site do StreamKit, visível, para autorizar uma vez e pegar o link do canal. */
function abrirSiteStreamKit() {
  if (janelaSiteSK && !janelaSiteSK.isDestroyed()) { janelaSiteSK.focus(); return; }
  janelaSiteSK = new BrowserWindow({
    width: 1100, height: 820, title: 'StreamKit do Discord', parent: janela || undefined,
    backgroundColor: '#1e2124',
    webPreferences: {
      partition: PARTICAO_SK,
      preload: path.join(__dirname, 'streamkit-preload.js'),
      contextIsolation: true, sandbox: false,
    },
  });
  janelaSiteSK.setMenuBarVisibility(false);
  janelaSiteSK.webContents.setWindowOpenHandler(({ url }) => { abrirExterno(url); return { action: 'deny' }; });
  janelaSiteSK.loadURL(SITE_STREAMKIT);
  janelaSiteSK.on('closed', () => {
    janelaSiteSK = null;
    // a autorização pode ter acabado de acontecer: recarrega a leitura
    abrirStreamKitOculto(ctl.urlStreamKit());
  });
}

/** Motor de áudio do bot: página escondida que toca as faixas e manda o som para o mixer. */
function abrirMotor() {
  clearTimeout(reabrirMotor);
  if (janelaMotor && !janelaMotor.isDestroyed()) { janelaMotor.destroy(); ctl.musica.motorCaiu(); }
  janelaMotor = null;
  if (!ctl.servidor) return;
  const win = new BrowserWindow({
    show: false, width: 400, height: 300,
    webPreferences: {
      preload: path.join(__dirname, 'motor-preload.js'),
      contextIsolation: true, sandbox: true, backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  janelaMotor = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', ev => ev.preventDefault());
  const caiu = () => {
    if (janelaMotor !== win) return;
    ctl.musica.motorCaiu();
    janelaMotor = null;
    try { win.destroy(); } catch { /* já fechada */ }
    reabrirMotor = setTimeout(abrirMotor, 2000);
  };
  win.webContents.on('render-process-gone', caiu);
  win.webContents.on('did-fail-load', (ev, codigo, desc, url, principal) => { if (principal) caiu(); });
  win.loadURL(ctl.servidor.urlMotor).catch(caiu);
}

/** Pequena janela para digitar o nome do marcador. O tempo é o do aperto da tecla. */
async function marcarComNome() {
  const r = await ctl.marcar('', 'atalho-nome', { capitulo: false, avisar: false });
  if (!r.ok) { avisar(r.mensagem); return; }
  if (janelaNome && !janelaNome.isDestroyed()) janelaNome.destroy();
  janelaNome = new BrowserWindow({
    width: 460, height: 150, frame: false, resizable: false, alwaysOnTop: true, skipTaskbar: true,
    backgroundColor: '#1A1D24', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  janelaNome.loadFile(path.join(UI, 'marcador.html'), { query: { t: String(r.t), tempo: r.tempo } });
  janelaNome.once('ready-to-show', () => { janelaNome.show(); janelaNome.focus(); });
  janelaNome.on('blur', () => { if (janelaNome && !janelaNome.isDestroyed()) janelaNome.webContents.send('confirmar-ao-sair'); });
}

function avisar(texto) {
  if (Notification.isSupported()) new Notification({ title: 'Gravador RPG', body: texto, silent: true }).show();
}

function abrirExterno(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && EXTERNOS_PERMITIDOS.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) {
      shell.openExternal(u.toString());
    }
  } catch { /* link inválido */ }
}

// ---------------------------------------------------------------- atalhos

function registrarAtalhos(atalhos) {
  globalShortcut.unregisterAll();
  const acoes = {
    marcar: () => ctl.marcar('', 'atalho').then(r => { if (!r.ok) avisar(r.mensagem); }),
    marcarNome: () => marcarComNome(),
    replay: () => ctl.salvarReplay().then(r => { if (!r.ok) avisar(r.mensagem); }),
    gravar: () => ctl.alternarGravacao().then(r => { if (!r.ok) avisar(r.mensagem); }),
  };
  statusAtalhos = {};
  for (const [nome, fn] of Object.entries(acoes)) {
    const tecla = atalhos[nome];
    if (!tecla) { statusAtalhos[nome] = 'vazio'; continue; }
    try {
      statusAtalhos[nome] = globalShortcut.register(tecla, () => { fn().catch(() => {}); }) ? 'ok' : 'ocupado';
    } catch {
      statusAtalhos[nome] = 'invalido';
    }
  }
  enviarEstado(ctl.estadoPublico());
}

// ---------------------------------------------------------------- IPC

function doStreamKit(ev) {
  return janelaSK && !janelaSK.isDestroyed() && ev.sender === janelaSK.webContents;
}

function registrarIpc() {
  ipcMain.on('streamkit:dados', (ev, dados, texto) => { if (doStreamKit(ev)) ctl.receberStreamKit(dados, texto); });
  ipcMain.on('streamkit:vivo', (ev, texto) => { if (doStreamKit(ev)) ctl.vivoStreamKit(texto); });
  // motor de áudio e abas do navegador: só aceitam mensagens das próprias janelas
  const doMotor = ev => janelaMotor && !janelaMotor.isDestroyed() && ev.sender === janelaMotor.webContents;
  const daAba = ev => (nav ? nav.abaDe(ev.sender) : '');
  ipcMain.on('motor:pronto', ev => { if (doMotor(ev)) ctl.musica.motorPronto(); });
  ipcMain.on('motor:estado', (ev, e) => { if (doMotor(ev)) ctl.musica.motorEstado(e); });
  ipcMain.on('motor:aviso', (ev, t) => { if (doMotor(ev)) { ctl.musica.motorAviso(t); avisar(String(t)); } });
  ipcMain.on('motor:resposta', (ev, id, r) => { if (doMotor(ev)) ctl.musica.responderMotor(id, r); });
  ipcMain.on('motor:pcm', (ev, buf) => { if (doMotor(ev)) ctl.musica.pcm('motor', buf); });
  ipcMain.on('aba:pcm', (ev, buf) => { const id = daAba(ev); if (id) ctl.musica.pcm('aba:' + id, buf); });
  ipcMain.on('aba:estado', (ev, e) => { const id = daAba(ev); if (id && e) ctl.musica.abaMudou(id, { tocando: !!e.tocando }); });

  ipcMain.on('streamkit:link', (ev, link) => {
    if (janelaSiteSK && ev.sender === janelaSiteSK.webContents && janela) janela.webContents.send('streamkit-link', link);
  });

  const acoes = criarAcoes({
    ctl,
    statusAtalhos: () => statusAtalhos,
    escolherArquivoImagem: async () => {
      const r = await dialog.showOpenDialog(janela, {
        title: 'Escolha a imagem do retrato',
        properties: ['openFile'],
        filters: [{ name: 'Imagens', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] }],
      });
      return r.canceled ? null : r.filePaths[0] || null;
    },
    marcarComNome,
    fecharMarcador: () => { if (janelaNome && !janelaNome.isDestroyed()) janelaNome.destroy(); },
    abrirSiteStreamKit,
    recarregarStreamKit: () => abrirStreamKitOculto(ctl.urlStreamKit()),
    mostrarStreamKit: () => { if (janelaSK && !janelaSK.isDestroyed()) janelaSK.show(); },
    abrirCaminho: (caminho, criar) => {
      if (criar) fs.mkdirSync(caminho, { recursive: true });
      return shell.openPath(caminho);
    },
    mostrarNaPasta: caminho => { shell.showItemInFolder(caminho); return true; },
    escolherPasta: async () => {
      const r = await dialog.showOpenDialog(janela, { title: 'Pasta dos cortes', properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : r.filePaths[0] || null;
    },
    escolherExecutavel: async () => {
      const r = await dialog.showOpenDialog(janela, { title: 'Onde está o ffmpeg.exe?', properties: ['openFile'], filters: [{ name: 'FFmpeg', extensions: ['exe'] }] });
      return r.canceled ? null : r.filePaths[0] || null;
    },
    abrirExterno,
    copiar: texto => { clipboard.writeText(texto); return true; },
    navegador: () => nav,
    escolherAudios: async () => {
      const r = await dialog.showOpenDialog(janela, {
        title: 'Escolha as músicas', properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Áudio', extensions: ['mp3', 'ogg', 'oga', 'opus', 'wav', 'flac', 'm4a', 'aac', 'webm'] }],
      });
      return r.canceled ? [] : r.filePaths;
    },
    aplicarAtualizacao: async () => {
      if (ctl.obsInfo.gravando) throw new Error('O OBS está gravando. Termine a gravação e atualize depois.');
      if (app.isPackaged) {
        abrirExterno(ctl.atualizador.publico().pagina + '/tags');
        throw new Error('Esta cópia do app é a versão empacotada (.exe): baixe a versão nova na página que abriu.');
      }
      const pasta = await ctl.atualizador.preparar();
      ctl.atualizador.aplicar(pasta, process.pid);
      // fecha de vez (sem perguntar) para o atualizador copiar os arquivos e abrir o app de novo
      sairDeVez = true;
      try { app.releaseSingleInstanceLock(); } catch { /* */ }
      setTimeout(() => app.quit(), 300);
      return { ok: true, mensagem: 'Atualizando… o app fecha e abre de novo sozinho.' };
    },
    escolherPastaAudio: async () => {
      const r = await dialog.showOpenDialog(janela, { title: 'Pasta com músicas (as subpastas viram grupos)', properties: ['openDirectory'] });
      return r.canceled ? null : r.filePaths[0] || null;
    },
  });
  // só as páginas do próprio app podem pedir ações
  // (comparação tolerante a letras acentuadas codificadas e maiúsculas no Windows)
  const comparar = u => { try { u = decodeURIComponent(u); } catch { /* */ } return process.platform === 'win32' ? u.toLowerCase() : u; };
  const PAGINAS = ['index.html', 'marcador.html'].map(n => comparar(require('url').pathToFileURL(path.join(UI, n)).href));
  ipcMain.handle('acao', (ev, nome, args) => {
    const origem = comparar(((ev.senderFrame && ev.senderFrame.url) || '').split(/[?#]/)[0]);
    if (!PAGINAS.includes(origem)) return { erro: 'Pedido recusado.' };
    return executarAcao(acoes, nome, args);
  });
}
