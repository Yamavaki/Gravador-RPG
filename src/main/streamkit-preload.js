'use strict';
// Roda dentro das páginas do StreamKit (janela escondida e site visível).
//  - No widget de voz: observa a página e manda quem está no canal e quem fala.
//  - No site de configuração: procura o link do widget de voz para preencher o app sozinho.
const { ipcRenderer } = require('electron');
const { coletarStreamKit } = require('../core/streamkit');

const ehWidget = /^\/overlay\/voice\//.test(location.pathname);

function textoDaPagina() {
  return ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

if (ehWidget) {
  let ultimo = '';
  let agendado = null;
  const enviar = () => {
    agendado = null;
    let dados;
    try { dados = coletarStreamKit(document); } catch { dados = []; }
    const txt = JSON.stringify(dados);
    if (txt === ultimo) return;
    ultimo = txt;
    ipcRenderer.send('streamkit:dados', dados, dados.length ? '' : textoDaPagina());
  };
  const agendar = () => { if (!agendado) agendado = setTimeout(enviar, 40); };

  window.addEventListener('DOMContentLoaded', () => {
    new MutationObserver(agendar).observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'src'], characterData: true,
    });
    agendar();
  });
  // sinal de vida a cada 2 s, mesmo sem mudanças (o app sabe que a leitura está de pé)
  setInterval(() => {
    let n = 0;
    try { n = coletarStreamKit(document).length; } catch { /* página carregando */ }
    if (n) ipcRenderer.send('streamkit:dados', JSON.parse(ultimo || '[]'), '');
    else ipcRenderer.send('streamkit:vivo', textoDaPagina());
  }, 2000);
} else {
  // site de configuração: o link aparece num campo de texto depois de escolher servidor e canal
  let enviado = '';
  setInterval(() => {
    const achados = [];
    document.querySelectorAll('input, textarea').forEach(el => achados.push(el.value || ''));
    achados.push(textoDaPagina());
    for (const t of achados) {
      const m = String(t).match(/https:\/\/streamkit\.discord\.com\/overlay\/voice\/\d{15,22}\/\d{15,22}[^\s"'<>]*/);
      if (m && m[0] !== enviado) {
        enviado = m[0];
        ipcRenderer.send('streamkit:link', m[0]);
        break;
      }
    }
  }, 1000);
}
