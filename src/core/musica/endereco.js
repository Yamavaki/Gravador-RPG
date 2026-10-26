'use strict';
// Barra de endereço do navegador interno: link, site ou busca no YouTube.

const BUSCA = 'https://www.youtube.com/results?search_query=';
const INICIO = 'https://www.youtube.com/';

const FAVORITOS_PADRAO = [
  { nome: 'YouTube', url: 'https://www.youtube.com/' },
  { nome: 'YouTube Music', url: 'https://music.youtube.com/' },
  { nome: 'Tabletop Audio', url: 'https://tabletopaudio.com/' },
  { nome: 'SoundCloud', url: 'https://soundcloud.com/' },
];

/** "youtu.be/xyz" → https://youtu.be/xyz; "música de taverna" → busca no YouTube. */
function paraEndereco(texto) {
  const t = String(texto || '').trim();
  if (!t) return INICIO;
  if (/^https?:\/\//i.test(t)) {
    try { return new URL(t).toString(); } catch { /* cai na busca */ }
  }
  // parece um endereço: tem ponto, nenhum espaço e uma terminação de domínio
  if (!/\s/.test(t) && /^[^\s/]+\.[a-z]{2,}(?::\d+)?(\/.*)?$/i.test(t)) {
    try { return new URL('https://' + t).toString(); } catch { /* busca */ }
  }
  return BUSCA + encodeURIComponent(t);
}

/** Só páginas da internet (nada de file:, javascript:, chrome: etc.). */
function enderecoPermitido(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch { return false; }
}

module.exports = { paraEndereco, enderecoPermitido, FAVORITOS_PADRAO, INICIO };
