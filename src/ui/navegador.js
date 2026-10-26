/* Navegador dentro do app: abas (cada uma tocando o próprio som para o bot), barra de
   endereço (link, site ou busca no YouTube), favoritos e volume/mudo por aba.
   As páginas de verdade são desenhadas pelo app por cima de #area-nav. */
(function () {
  'use strict';
  var A = window.App;
  var $ = A.$, esc = A.esc;

  var observador = null;
  var assinatura = { abas: null, fav: null };

  function M() { var E = A.E(); return (E && E.musica) || { abas: [], abaAtiva: '' }; }
  function abas() { return M().abas || []; }
  function ativa() {
    var m = M();
    return abas().filter(function (a) { return a.id === m.abaAtiva; })[0] || null;
  }
  function favoritos() { return A.cfg().navegador.favoritos || []; }
  function dominio(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
  function resultado(r) { if (r && r.erro) A.aviso(r.erro, 'erro'); return r; }

  function mandarArea() {
    var el = $('#area-nav');
    if (!el) return;
    var r = el.getBoundingClientRect();
    window.api.navArea({ x: r.left, y: r.top, largura: r.width, altura: r.height });
  }

  A.TELAS.navegador = {
    html: function () {
      return '<div class="tela-nav">' +
        '<div class="abas-nav" role="tablist" aria-label="Abas" id="abas-nav"></div>' +
        '<div class="barra-nav">' +
        '<button class="icone-nav" data-acao="navVoltar" id="nav-voltar" title="Voltar" aria-label="Voltar">‹</button>' +
        '<button class="icone-nav" data-acao="navAvancar" id="nav-avancar" title="Avançar" aria-label="Avançar">›</button>' +
        '<button class="icone-nav" data-acao="navRecarregar" title="Recarregar" aria-label="Recarregar">⟳</button>' +
        '<form id="form-endereco" class="endereco"><input type="text" id="endereco" autocomplete="off" spellcheck="false" ' +
        'placeholder="Cole o link da música ou digite para procurar no YouTube" aria-label="Endereço ou busca"></form>' +
        '<button class="icone-nav estrela" data-acao="navFavoritar" id="nav-estrela" title="Favoritar esta página" aria-label="Favoritar">☆</button>' +
        '<div class="vol-nav" id="vol-nav"></div>' +
        '</div>' +
        '<div class="favoritos-nav" id="favoritos-nav"></div>' +
        '<div id="area-nav"><div class="vazio-nav">Abrindo…</div></div>' +
        '</div>';
    },
    depois: function () {
      document.body.classList.add('com-navegador');
      assinatura = { abas: null, fav: null };
      window.api.navAbrir().then(function () { mandarArea(); A.TELAS.navegador.vivo(); });
      if (window.ResizeObserver) {
        observador = new ResizeObserver(mandarArea);
        observador.observe($('#area-nav'));
      }
      window.addEventListener('resize', mandarArea);
      $('#form-endereco').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var inp = $('#endereco');
        var a = ativa();
        var p = a ? window.api.navIr(a.id, inp.value) : window.api.navNova(inp.value);
        p.then(resultado);
        inp.blur();
      });
      $('#endereco').addEventListener('focus', function (ev) { ev.target.select(); });
      A.TELAS.navegador.vivo();
    },
    sair: function () {
      document.body.classList.remove('com-navegador');
      if (observador) { observador.disconnect(); observador = null; }
      window.removeEventListener('resize', mandarArea);
      window.api.navArea(null);
    },
    vivo: function () {
      var lista = abas(), m = M(), a = ativa();
      var sig = JSON.stringify([m.abaAtiva, lista.map(function (x) { return [x.id, x.titulo, x.icone, x.tocando, x.mudo, x.ouvir, x.carregando]; })]);
      var caixa = $('#abas-nav');
      if (caixa && sig !== assinatura.abas) {
        assinatura.abas = sig;
        caixa.innerHTML = lista.map(abaHtml).join('') +
          '<button class="aba-nova" data-acao="navNova" title="Nova aba" aria-label="Nova aba">+</button>';
      }
      var inp = $('#endereco');
      if (inp && document.activeElement !== inp) inp.value = a ? a.url : '';
      var v = $('#nav-voltar'), f = $('#nav-avancar');
      if (v) v.disabled = !(a && a.voltar);
      if (f) f.disabled = !(a && a.avancar);
      var est = $('#nav-estrela');
      if (est) {
        var fav = a && favoritos().some(function (x) { return x.url === a.url; });
        est.textContent = fav ? '★' : '☆';
        est.classList.toggle('on', !!fav);
        est.disabled = !a;
        est.title = fav ? 'Tirar dos favoritos' : 'Favoritar esta página';
      }
      var vol = $('#vol-nav');
      var vsig = a ? [a.id, a.mudo, a.ouvir, a.volume].join('|') : '';
      if (vol && vol.getAttribute('data-sig') !== vsig && !(document.activeElement && document.activeElement.type === 'range' && vol.contains(document.activeElement))) {
        vol.setAttribute('data-sig', vsig);
        vol.innerHTML = a ? '<button class="chave-nav' + (a.ouvir ? ' on' : '') + '" data-acao="navOuvir" data-id="' + esc(a.id) + '" aria-pressed="' + !!a.ouvir + '" title="Tocar esta aba também aqui no PC (para você conferir a música)">🎧 Ouvir aqui</button>' +
          '<button class="chave-nav' + (a.mudo ? ' mudo' : ' on') + '" data-acao="navMudo" data-id="' + esc(a.id) + '" aria-pressed="' + !a.mudo + '" title="' + (a.mudo ? 'Só você está ouvindo. Clique para a galera do Discord ouvir' : 'A galera do Discord está ouvindo. Clique para tirar do Discord') + '">' + (a.mudo ? '🔇 Fora do Discord' : '📢 No Discord') + '</button>' +
          '<input type="range" min="0" max="1" step="0.01" value="' + a.volume + '" data-nav-volume="' + esc(a.id) + '" aria-label="Volume desta aba no Discord" title="Volume desta aba no Discord"' + (a.mudo ? ' disabled' : '') + '>' : '';
      }
      var fsig = JSON.stringify(favoritos());
      var fc = $('#favoritos-nav');
      if (fc && fsig !== assinatura.fav) {
        assinatura.fav = fsig;
        fc.innerHTML = favoritos().map(function (x, i) {
          return '<span class="fav"><button class="fav-abrir" data-acao="navAbrirFav" data-i="' + i + '" title="' + esc(x.url) + '">' +
            '<span class="fav-letra" aria-hidden="true">' + esc((x.nome || '?')[0].toUpperCase()) + '</span>' + esc(x.nome) + '</button>' +
            '<button class="fav-tirar" data-acao="navTirarFav" data-i="' + i + '" aria-label="Tirar ' + esc(x.nome) + ' dos favoritos" title="Tirar dos favoritos">×</button></span>';
        }).join('') + (favoritos().length ? '' : '<span class="ajuda">Favorite uma página com a ☆ para ela aparecer aqui.</span>');
      }
      var area = $('#area-nav');
      if (area) area.innerHTML = lista.length ? '' : '<div class="vazio-nav">Nenhuma aba aberta. Clique em <strong>+</strong> ou cole um link na barra acima.</div>';
    },
  };

  function abaHtml(a) {
    var m = M();
    var icone = a.icone ? '<img class="aba-icone" alt="" src="' + esc(a.icone) + '">' :
      '<span class="aba-icone letra" aria-hidden="true">' + esc((dominio(a.url) || '?')[0].toUpperCase()) + '</span>';
    return '<div class="aba-nav' + (a.id === m.abaAtiva ? ' ativa' : '') + (a.tocando ? ' tocando' : '') + '" role="tab" aria-selected="' + (a.id === m.abaAtiva) + '" ' +
      'data-acao="navAtivar" data-id="' + esc(a.id) + '" title="' + esc(a.titulo || a.url) + '">' +
      (a.carregando ? '<span class="aba-icone girando" aria-hidden="true"></span>' : icone) +
      '<span class="aba-titulo">' + esc(a.titulo || dominio(a.url) || 'Nova aba') + '</span>' +
      (a.ouvir ? '<span class="aba-fone" title="Tocando aqui no PC">🎧</span>' : '') +
      (a.tocando || a.mudo ? '<button class="aba-som' + (a.mudo ? ' mudo' : '') + '" data-acao="navMudo" data-id="' + esc(a.id) + '" title="' + (a.mudo ? 'Fora do Discord: clique para a galera ouvir' : 'No Discord: clique para tirar') + '" aria-label="Discord">' + (a.mudo ? '🔇' : '🔊') + '</button>' : '') +
      '<button class="aba-fechar" data-acao="navFechar" data-id="' + esc(a.id) + '" title="Fechar aba" aria-label="Fechar aba">×</button></div>';
  }

  function salvarFavoritos(lista) {
    return window.api.navFavoritos(lista).then(function (r) {
      if (r && r.erro) return A.aviso(r.erro, 'erro');
      A.cfg().navegador.favoritos = r;
      A.TELAS.navegador.vivo();
    });
  }

  var ACOES = {
    navNova: function () {
      return window.api.navNova('').then(function (r) { resultado(r); setTimeout(function () { var i = $('#endereco'); if (i) i.focus(); }, 50); });
    },
    navAtivar: function (el) { return window.api.navAtivar(el.getAttribute('data-id')).then(resultado); },
    navFechar: function (el) { return window.api.navFechar(el.getAttribute('data-id')).then(resultado); },
    navVoltar: function () { var a = ativa(); return a && window.api.navAcao(a.id, 'voltar'); },
    navAvancar: function () { var a = ativa(); return a && window.api.navAcao(a.id, 'avancar'); },
    navRecarregar: function () { var a = ativa(); return a && window.api.navAcao(a.id, 'recarregar'); },
    navMudo: function (el) {
      var id = el.getAttribute('data-id');
      var a = abas().filter(function (x) { return x.id === id; })[0];
      return a && window.api.navVolume(id, null, !a.mudo).then(resultado);
    },
    navOuvir: function (el) {
      var id = el.getAttribute('data-id');
      var a = abas().filter(function (x) { return x.id === id; })[0];
      return a && window.api.navVolume(id, null, null, !a.ouvir).then(resultado);
    },
    navFavoritar: function () {
      var a = ativa();
      if (!a) return;
      var lista = favoritos().slice();
      var i = lista.map(function (x) { return x.url; }).indexOf(a.url);
      if (i >= 0) lista.splice(i, 1);
      else lista.push({ nome: (a.titulo || dominio(a.url)).replace(/\s*-\s*YouTube( Music)?$/, '').slice(0, 40), url: a.url });
      return salvarFavoritos(lista);
    },
    navAbrirFav: function (el) {
      var f = favoritos()[Number(el.getAttribute('data-i'))];
      if (!f) return;
      var a = ativa();
      return (a ? window.api.navIr(a.id, f.url) : window.api.navNova(f.url)).then(resultado);
    },
    navTirarFav: function (el) {
      var lista = favoritos().slice();
      lista.splice(Number(el.getAttribute('data-i')), 1);
      return salvarFavoritos(lista);
    },
  };
  Object.keys(ACOES).forEach(function (k) { A.ACOES[k] = ACOES[k]; });

  // volume de uma aba (aqui ou na tela de Música)
  document.addEventListener('change', function (ev) {
    var id = ev.target.getAttribute && ev.target.getAttribute('data-nav-volume');
    if (id) window.api.navVolume(id, Number(ev.target.value), null).then(resultado);
  });
  // botão do meio na aba fecha (como no Chrome)
  document.addEventListener('auxclick', function (ev) {
    var t = ev.button === 1 && ev.target.closest && ev.target.closest('.aba-nav');
    if (t) { ev.preventDefault(); window.api.navFechar(t.getAttribute('data-id')).then(resultado); }
  });
  // Ctrl+T nova aba, Ctrl+W fecha, Ctrl+L vai para o endereço (quando a tela do navegador está aberta)
  document.addEventListener('keydown', function (ev) {
    if (!document.body.classList.contains('com-navegador') || !ev.ctrlKey) return;
    var k = ev.key.toLowerCase();
    if (k === 't') { ev.preventDefault(); ACOES.navNova(); }
    else if (k === 'w') { var a = ativa(); if (a) { ev.preventDefault(); window.api.navFechar(a.id); } }
    else if (k === 'l') { var i = $('#endereco'); if (i) { ev.preventDefault(); i.focus(); } }
  });
})();
