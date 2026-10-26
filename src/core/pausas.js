/* Pausas da gravação: quando o OBS pausa, o relógio da sessão continua, mas o vídeo não.
   "Tempo da sessão" = tempo de verdade desde o começo; "tempo da gravação" = posição no vídeo.
   pausas: [[inicioMs, fimMs]] relativos ao começo da sessão. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Pausas = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function ordenar(pausas) {
    return (pausas || []).filter(function (p) { return p && p[1] > p[0]; }).slice().sort(function (a, b) { return a[0] - b[0]; });
  }

  /** Tempo da sessão → posição no vídeo (dentro de uma pausa, vale o começo dela). */
  function paraGravacao(ms, pausas) {
    var tirar = 0;
    ordenar(pausas).forEach(function (p) {
      if (ms > p[0]) tirar += Math.min(ms, p[1]) - p[0];
    });
    return ms - tirar;
  }

  /** Posição no vídeo → tempo da sessão. */
  function paraSessao(ms, pausas) {
    var somar = 0;
    var lista = ordenar(pausas);
    for (var i = 0; i < lista.length; i++) {
      var p = lista[i];
      if (ms + somar >= p[0]) somar += p[1] - p[0];
      else break;
    }
    return ms + somar;
  }

  return { paraGravacao: paraGravacao, paraSessao: paraSessao };
});
