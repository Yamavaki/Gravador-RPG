/* Câmera do vídeo vertical: uma caixa 9:16 que anda e dá zoom sobre o vídeo original.
   Funciona no app (Node) e na interface (navegador): a prévia e a exportação usam
   exatamente a mesma conta, então o que você vê é o que sai. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Camera = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ASPECTO = 9 / 16;          // largura / altura da saída vertical
  var RAPIDO_S = 0.6;            // transição "rápida": anda só no último 0,6 s
  var TRANSICOES = ['suave', 'rapido', 'corte'];
  var ZOOM_MAX = 6;              // caixa no mínimo 1/6 da maior possível

  /** Largura máxima da caixa (fração da largura da fonte) para caber inteira na altura. */
  function larguraMaxima(W, H) {
    return Math.min(1, (H * ASPECTO) / W);
  }

  function limitar(k, W, H) {
    var wMax = larguraMaxima(W, H);
    var w = Math.min(wMax, Math.max(wMax / ZOOM_MAX, Number(k.w) || wMax));
    var h = (w * W) / ASPECTO / H; // fração da altura
    var x = Math.min(1 - w, Math.max(0, Number(k.x) || 0));
    var y = Math.min(1 - h, Math.max(0, Number(k.y) || 0));
    return { x: x, y: y, w: w, h: h };
  }

  /** Arruma a lista de pontos: ordena, tira repetidos, corrige valores fora do lugar. */
  function normalizar(pontos, W, H) {
    var lista = (Array.isArray(pontos) ? pontos : []).filter(function (p) { return p && isFinite(p.t); })
      .map(function (p) {
        var c = limitar(p, W, H);
        return { t: Math.max(0, Math.round(Number(p.t))), x: c.x, y: c.y, w: c.w, trans: TRANSICOES.indexOf(p.trans) >= 0 ? p.trans : 'suave', nome: p.nome || '' };
      })
      .sort(function (a, b) { return a.t - b.t; });
    var saida = [];
    lista.forEach(function (p) {
      if (saida.length && saida[saida.length - 1].t === p.t) saida[saida.length - 1] = p;
      else saida.push(p);
    });
    if (!saida.length) {
      var w = larguraMaxima(W, H);
      saida.push({ t: 0, x: (1 - w) / 2, y: 0, w: w, trans: 'suave', nome: '' });
    }
    return saida;
  }

  function suavizar(u) { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); }

  /** Caixa (frações da fonte) no tempo t (ms desde o começo do corte). */
  function caixaEm(pontos, t, W, H) {
    var p = normalizar(pontos, W, H);
    if (t <= p[0].t || p.length === 1) return limitar(p[0], W, H);
    for (var i = 0; i < p.length - 1; i++) {
      var a = p[i], b = p[i + 1];
      if (t >= b.t) continue;
      var u = 0;
      if (a.trans === 'suave') u = suavizar((t - a.t) / (b.t - a.t));
      else if (a.trans === 'rapido') {
        var ini = Math.max(a.t, b.t - RAPIDO_S * 1000);
        u = t < ini ? 0 : suavizar((t - ini) / (b.t - ini));
      }
      return limitar({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, w: a.w + (b.w - a.w) * u }, W, H);
    }
    return limitar(p[p.length - 1], W, H);
  }

  // --------------------------------------------------------------- FFmpeg
  function num(v) { return (Math.round(v * 1000) / 1000).toString(); }

  /** Expressão do FFmpeg para um valor que muda entre os pontos (T = tempo em segundos). */
  function expressaoValor(pontos, valores, T) {
    var n = pontos.length;
    var expr = num(valores[n - 1]);
    for (var i = n - 2; i >= 0; i--) {
      var a = valores[i], b = valores[i + 1];
      var t0 = pontos[i].t / 1000, t1 = pontos[i + 1].t / 1000;
      var seg;
      if (pontos[i].trans === 'corte' || a === b) seg = num(a);
      else {
        var ini = pontos[i].trans === 'rapido' ? Math.max(t0, t1 - RAPIDO_S) : t0;
        var u = 'clip((' + T + '-' + num(ini) + ')/' + num(Math.max(0.001, t1 - ini)) + ',0,1)';
        var e = '(' + u + '*' + u + '*(3-2*' + u + '))';
        seg = num(a) + '+(' + num(b - a) + ')*' + e;
      }
      expr = 'if(lt(' + T + ',' + num(t1) + '),' + seg + ',' + expr + ')';
    }
    return expr;
  }

  /**
   * Os 4 cantos da caixa como expressões do filtro "perspective" do FFmpeg
   * (sense=source). fps: quadros por segundo do vídeo que entra no filtro.
   */
  function expressoesPerspective(pontos, W, H, fps) {
    var p = normalizar(pontos, W, H);
    var c = p.map(function (k) { return limitar(k, W, H); });
    var T = '(in/' + num(fps) + ')';
    var esq = c.map(function (k) { return k.x * W; });
    var dir = c.map(function (k) { return (k.x + k.w) * W; });
    var topo = c.map(function (k) { return k.y * H; });
    var baixo = c.map(function (k) { return (k.y + k.h) * H; });
    var E = expressaoValor(p, esq, T), D = expressaoValor(p, dir, T);
    var C = expressaoValor(p, topo, T), B = expressaoValor(p, baixo, T);
    return { x0: E, y0: C, x1: D, y1: C, x2: E, y2: B, x3: D, y3: B };
  }

  return {
    ASPECTO: ASPECTO, TRANSICOES: TRANSICOES, RAPIDO_S: RAPIDO_S,
    larguraMaxima: larguraMaxima, limitar: limitar, normalizar: normalizar, caixaEm: caixaEm,
    expressaoValor: expressaoValor, expressoesPerspective: expressoesPerspective, suavizar: suavizar,
  };
});
