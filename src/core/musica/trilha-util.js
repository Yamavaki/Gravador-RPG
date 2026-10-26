/* Tempos das faixas com seções (vindo do Trilha Viva). Usado pelo motor de áudio,
   pela interface (barra de progresso) e pelos testes no Node. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.TrilhaUtil = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Arquivos maiores que isso (em segundos) tocam em streaming, sem seções. */
  var LIMITE_BUFFER = 600;
  var CORES_SECAO = ['#6f9be0', '#d9b44a', '#b48ce6', '#e0866a', '#5fb3a8', '#e6a3c8', '#9bc46a', '#c9a27a'];

  /**
   * Posição dentro do arquivo de um segmento, `e` segundos depois do seu início.
   * Todo segmento toca do `offset` até `loopFim` e depois repete entre `loopIni` e `loopFim`.
   */
  function posDoSeg(seg, e, dur) {
    e = Math.max(0, e || 0);
    var L = seg.loopFim > 0 ? seg.loopFim : dur;
    var a = seg.loopIni || 0;
    var p = (seg.offset || 0) + e;
    if (!(L > 0) || p < L) return { pos: p, volta: 1 };
    var len = L - a;
    if (len <= 0.02) return { pos: L, volta: 1 };
    var k = Math.floor((p - L) / len);
    return { pos: a + (p - L) - k * len, volta: k + 2 };
  }

  /** Horário (ms) em que termina a volta atual do segmento. */
  function fimDaVolta(seg, t, dur, margem) {
    if (margem == null) margem = 0.3;
    var t0 = Math.max(t, seg.inicio);
    var pos = posDoSeg(seg, (t0 - seg.inicio) / 1000, dur).pos;
    var L = seg.loopFim > 0 ? seg.loopFim : dur;
    var a = seg.loopIni || 0;
    var resto = L - pos;
    if (resto < margem) resto += Math.max(L - a, 0.05);
    return t0 + resto * 1000;
  }

  function secoesOrd(item) {
    return ((item && item.secoes) || []).slice().sort(function (a, b) { return a.inicio - b.inicio; });
  }
  function temSecoes(item) { return ((item && item.secoes && item.secoes.length) || 0) > 1; }

  function embaralhar(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function fmtTempo(seg) {
    seg = Math.max(0, Math.floor((Number(seg) || 0) + 1e-6));
    var h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
    var d = function (n) { return (n < 10 ? '0' : '') + n; };
    return h ? h + ':' + d(m) + ':' + d(s) : m + ':' + d(s);
  }

  /** "1:23", "1:23.5", "83" → segundos (NaN se inválido). */
  function parseTempo(txt) {
    if (typeof txt === 'number') return txt;
    var s = String(txt == null ? '' : txt).trim().replace(',', '.');
    if (!s) return NaN;
    var partes = s.split(':');
    if (partes.length > 3 || partes.some(function (p) { return p.trim() === '' || isNaN(Number(p)); })) return NaN;
    return partes.reduce(function (acc, p) { return acc * 60 + Number(p); }, 0);
  }

  function nomeDoArquivo(caminho) {
    var base = String(caminho).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    try { base = decodeURIComponent(base); } catch (e) { /* nome com % solto */ }
    base = base.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  return {
    LIMITE_BUFFER: LIMITE_BUFFER, CORES_SECAO: CORES_SECAO, posDoSeg: posDoSeg, fimDaVolta: fimDaVolta,
    secoesOrd: secoesOrd, temSecoes: temSecoes, embaralhar: embaralhar, fmtTempo: fmtTempo, parseTempo: parseTempo,
    nomeDoArquivo: nomeDoArquivo,
  };
});
