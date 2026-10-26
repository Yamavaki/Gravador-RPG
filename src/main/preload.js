'use strict';
// Ponte segura entre a interface e o app: só estas funções ficam disponíveis.
const { contextBridge, ipcRenderer } = require('electron');

const ACOES = [
  'estado', 'salvarConfig', 'escolherImagem', 'marcar', 'marcarComNome', 'gravar', 'replay',
  'nomearMarcador', 'fecharMarcador', 'abrirStreamKit', 'recarregarStreamKit', 'mostrarStreamKit',
  'trocarCanal', 'adicionarCanal', 'adicionarDetectado', 'ignorarDetectado', 'simularLimpeza', 'limpar', 'abrirPasta', 'abrirExterno', 'copiar',
  'sessoes', 'sessao', 'criarCorte', 'momentos', 'descartarMomento', 'cortesDosMarcadores', 'procurarAtualizacao', 'atualizarAgora', 'legendar', 'estadoTranscricao', 'salvarCorte', 'excluirCorte', 'exportar', 'compilado', 'cancelarExportacao',
  'limparFila', 'mostrarArquivo', 'abrirPastaCortes', 'verificarFFmpeg', 'escolherPastaCortes', 'escolherFFmpeg',
  'musicaFaixas', 'musicaAdicionarArquivos', 'musicaAdicionarPasta', 'musicaAtualizarFaixa', 'musicaRemoverFaixas',
  'musicaSecoes', 'musicaUrl', 'musicaTocar', 'musicaTocarFila', 'musicaAdicionarNaFila', 'musicaComando',
  'botToken', 'botLigar', 'botDesligar', 'botEntrar', 'botSair', 'botDiagnostico', 'navAbrir', 'navArea', 'navNova', 'navFechar', 'navAtivar', 'navIr', 'navAcao', 'navVolume', 'navFavoritos',
];

const api = {};
for (const nome of ACOES) api[nome] = (...args) => ipcRenderer.invoke('acao', nome, args);
api.aoMudar = cb => ipcRenderer.on('estado', (_e, est) => cb(est));
api.aoLinkStreamKit = cb => ipcRenderer.on('streamkit-link', (_e, link) => cb(link));
api.aoConfirmarSair = cb => ipcRenderer.on('confirmar-ao-sair', () => cb());

contextBridge.exposeInMainWorld('api', api);
