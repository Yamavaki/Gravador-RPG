'use strict';
// Ponte do motor de áudio (janela escondida) com o app: só estas funções.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ponte', {
  aoComando: cb => ipcRenderer.on('motor:comando', (_e, pedido) => cb(pedido)),
  responder: (id, r) => ipcRenderer.send('motor:resposta', id, r),
  estado: e => ipcRenderer.send('motor:estado', e),
  aviso: t => ipcRenderer.send('motor:aviso', String(t)),
  pronto: () => ipcRenderer.send('motor:pronto'),
  pcm: buf => ipcRenderer.send('motor:pcm', buf),
});
