/* Caixinha do "marcar com nome": o marcador já foi criado no aperto da tecla;
   aqui só se dá o nome. Enter salva, Esc deixa sem nome, clicar fora salva o que tiver. */
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var t = q.get('t');
  var feito = false;
  document.getElementById('tempo').textContent = q.get('tempo') || '';
  var campo = document.getElementById('nome');

  function terminar(nome) {
    if (feito) return;
    feito = true;
    window.api.nomearMarcador(t, nome, true).then(function () { window.api.fecharMarcador(); });
  }
  document.getElementById('f').addEventListener('submit', function (ev) {
    ev.preventDefault();
    terminar(campo.value);
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') terminar('');
  });
  window.api.aoConfirmarSair(function () { terminar(campo.value); });
  setTimeout(function () { campo.focus(); }, 50);
})();
