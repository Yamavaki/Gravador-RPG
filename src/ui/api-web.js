/* Só é usado quando a interface roda fora do Electron (testes no navegador).
   No app de verdade, o preload.js já criou window.api e este arquivo não faz nada.
   Qualquer window.api.<ação>(...) vira um POST /api/<ação> no servidor de teste. */
(function () {
  'use strict';
  if (window.api) return;
  var fontes = null;
  function eventos() {
    if (!fontes) fontes = new EventSource('/api/eventos');
    return fontes;
  }
  var especiais = {
    aoMudar: function (cb) { eventos().onmessage = function (ev) { cb(JSON.parse(ev.data)); }; },
    aoLinkStreamKit: function (cb) { eventos().addEventListener('link', function (ev) { cb(JSON.parse(ev.data)); }); },
    aoConfirmarSair: function () {},
    aoMusica: function (cb) { eventos().addEventListener('musica', function (ev) { cb(JSON.parse(ev.data)); }); },
  };
  window.api = new Proxy({}, {
    get: function (_alvo, nome) {
      if (especiais[nome]) return especiais[nome];
      if (typeof nome !== 'string' || nome === 'then') return undefined;
      return function () {
        var args = Array.prototype.slice.call(arguments);
        return fetch('/api/' + nome, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) })
          .then(function (r) { return r.json(); });
      };
    },
  });
})();
