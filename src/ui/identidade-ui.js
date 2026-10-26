/* Identidade visual na interface:
   - tela "Identidade visual": camadas (imagens e textos) ao vivo e/ou nos cortes, com transformação
     livre na prévia, e a imagem final padrão dos cortes (uma para horizontal, outra para vertical);
   - nos editores de corte: desenhar as camadas e a imagem final na prévia, esconder camadas e tirar
     a imagem final de um corte, e a música rápida (volume por pontos no tempo, fades);
   - na exportação: monta os PNGs (camadas, imagem final, fundo do vertical) do tamanho de cada formato. */
(function () {
  'use strict';
  var A = window.App, I = window.Identidade;
  var $ = A.$, $$ = A.$$, esc = A.esc;
  var ed = function () { return A.Cortes && A.Cortes.ed(); };

  // ================================================================ imagens (com CORS: o canvas não fica "sujo")
  var imgs = {};
  var redesenhar = [];
  function carregar(nome) {
    var url = A.urlImagem(nome);
    if (!url) return Promise.resolve(null);
    if (imgs[url]) return imgs[url].promessa;
    var reg = { img: null };
    reg.promessa = new Promise(function (res) {
      var im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = function () { reg.img = im; res(im); redesenhar.forEach(function (f) { try { f(); } catch (e) { /* */ } }); };
      im.onerror = function () { delete imgs[url]; res(null); };
      im.src = url;
    });
    imgs[url] = reg;
    return reg.promessa;
  }
  /** Imagem já carregada (ou null, e começa a carregar). */
  function imagem(nome) {
    if (!nome) return null;
    var url = A.urlImagem(nome);
    if (!url) return null;
    if (!imgs[url]) carregar(nome);
    return imgs[url] ? imgs[url].img : null;
  }

  function mesa() { return A.mesa(); }
  function camadas() { return mesa().identidade.camadas; }
  function camada(id) { return camadas().filter(function (c) { return c.id === id; })[0] || null; }
  var medidor = null;
  function ctxMedir() { return medidor || (medidor = document.createElement('canvas').getContext('2d')); }

  /**
   * Camadas que entram num corte: no vertical, as marcadas "nos cortes"; no horizontal, também
   * só as que não estão ao vivo (as ao vivo já foram gravadas pelo OBS), a não ser que o corte
   * diga que a gravação foi feita sem o overlay (retratosHorizontal).
   */
  function camadasDoCorte(corte, qual) {
    var ocultas = (corte && corte.identidade && corte.identidade.ocultas) || [];
    return camadas().filter(function (c) {
      if (!c.cortes || ocultas.indexOf(c.id) >= 0) return false;
      if (qual === 'h' && c.aoVivo && !(corte && corte.retratosHorizontal)) return false;
      return c.tipo === 'texto' ? !!c.texto.trim() : !!c.imagem;
    });
  }
  function finalDoCorte(corte, qual) {
    var f = mesa().final[qual];
    if (!f || !f.ativo || (corte && corte.final === false)) return null;
    return f;
  }
  /** Quanto a imagem final aumenta o vídeo (ms). */
  function extraFinal(f, durMs) {
    if (!f) return 0;
    var fade = Math.min(f.fade, durMs / 1000);
    return Math.max(0, f.duracao - fade) * 1000;
  }

  // ================================================================ desenho e mouse nas prévias
  var sel = '';                  // camada escolhida (vale para a tela e para os editores)
  var arrasto = null;
  var areas = {};                // id do canvas -> { qual, W, H, itens: [{ id, r }] }

  function desenharCamadas(ctx, W, H, qual, lista, idCanvas, editavel) {
    var itens = [];
    lista.forEach(function (c) {
      var img = c.tipo === 'imagem' ? imagem(c.imagem) : null;
      var cc = arrasto && arrasto.id === c.id ? Object.assign({}, c, (function () { var o = {}; o[qual] = arrasto.pos; return o; })()) : c;
      if (c.tipo === 'imagem' && !img) {
        // ainda carregando: guarda o lugar
        var r0 = I.retangulo(ctx, cc, W, H, qual, null);
        itens.push({ id: c.id, r: r0 });
        return;
      }
      var r = I.desenharCamada(ctx, cc, W, H, qual, img);
      itens.push({ id: c.id, r: r });
    });
    if (idCanvas) areas[idCanvas] = { qual: qual, W: W, H: H, itens: itens };
    if (!editavel) return;
    ctx.save();
    itens.forEach(function (it) {
      var escolhida = it.id === sel;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = escolhida ? 'rgba(143,180,240,.95)' : 'rgba(143,180,240,.35)';
      ctx.strokeRect(it.r.x, it.r.y, it.r.largura, it.r.altura);
      ctx.setLineDash([]);
      if (escolhida) {
        ctx.fillStyle = '#8FB4F0';
        ctx.strokeStyle = '#0B0C0F';
        ctx.beginPath();
        ctx.arc(it.r.x + it.r.largura, it.r.y + it.r.altura, 7, 0, Math.PI * 2);
        ctx.fill(); ctx.stroke();
      }
    });
    if (arrasto && arrasto.guiaX) { ctx.strokeStyle = 'rgba(143,180,240,.8)'; ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke(); }
    if (arrasto && arrasto.guiaY) { ctx.strokeStyle = 'rgba(143,180,240,.8)'; ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke(); }
    ctx.restore();
  }

  /** Nos editores: camadas do corte (antes dos retratos e da legenda). */
  function desenharEditor(ctx, W, H, qual, idCanvas) {
    var e = ed();
    if (!e) return;
    desenharCamadas(ctx, W, H, qual, camadasDoCorte(e.corte, qual), idCanvas, true);
  }
  /** Nos editores: a imagem final entrando com fade no fim do corte (por cima de tudo). */
  function desenharFinalEditor(ctx, W, H, qual) {
    var e = ed();
    if (!e) return;
    var f = finalDoCorte(e.corte, qual);
    if (!f) return;
    var T = e.T * 1000, fim = e.corte.fim, dur = fim - e.corte.ini;
    var fade = Math.min(f.fade, dur / 1000) * 1000;
    var a = fade > 0 ? (T - (fim - fade)) / fade : (T >= fim ? 1 : 0);
    if (a <= 0) return;
    var img = f.imagem ? imagem(f.imagem) : null;
    ctx.save();
    ctx.globalAlpha = Math.min(1, a);
    I.desenharFinal(ctx, f, W, H, img);
    ctx.restore();
  }

  function pontoNo(cv, ev) {
    var r = cv.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * cv.width / r.width, y: (ev.clientY - r.top) * cv.height / r.height };
  }
  function acertar(area, p) {
    for (var i = area.itens.length - 1; i >= 0; i--) {
      var it = area.itens[i], r = it.r;
      if (it.id === sel && Math.hypot(p.x - (r.x + r.largura), p.y - (r.y + r.altura)) <= 11) return { id: it.id, modo: 'tamanho', r: r };
    }
    for (var k = area.itens.length - 1; k >= 0; k--) {
      var r2 = area.itens[k].r;
      if (p.x >= r2.x && p.x <= r2.x + r2.largura && p.y >= r2.y && p.y <= r2.y + r2.altura) return { id: area.itens[k].id, modo: 'mover', r: r2 };
    }
    return null;
  }

  // fase de captura: as camadas vêm antes dos retratos (a legenda, registrada antes, vem primeiro)
  document.addEventListener('pointerdown', function (ev) {
    var cv = ev.target;
    var area = cv && cv.id && areas[cv.id];
    if (!area || cv.tagName !== 'CANVAS') return;
    var p0 = pontoNo(cv, ev);
    var h = acertar(area, p0);
    if (!h) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    var c = camada(h.id);
    if (!c) return;
    var mudouSel = sel !== h.id;
    sel = h.id;
    if (mudouSel) aoEscolher();
    var e = ed();
    if (e && e.player && !e.player.video.paused) e.player.video.pause();
    var q = area.qual, ini = { x: c[q].x, y: c[q].y, w: c[q].w };
    arrasto = { id: c.id, modo: h.modo, pos: { x: ini.x, y: ini.y, w: ini.w } };
    cv.setPointerCapture(ev.pointerId);
    var mover = function (e2) {
      var p = pontoNo(cv, e2), dx = p.x - p0.x, dy = p.y - p0.y;
      if (h.modo === 'mover') {
        var nx = ini.x + dx / area.W, ny = ini.y + dy / area.H;
        arrasto.guiaX = Math.abs(nx - 0.5) < 0.012;
        arrasto.guiaY = Math.abs(ny - 0.5) < 0.012;
        arrasto.pos.x = arrasto.guiaX ? 0.5 : nx;
        arrasto.pos.y = arrasto.guiaY ? 0.5 : ny;
      } else {
        var f = 1 + dx / Math.max(10, h.r.largura) + dy / Math.max(10, h.r.altura);
        arrasto.pos.w = Math.max(0.02, Math.min(1.5, ini.w * Math.max(0.05, f)));
      }
      pedirDesenho();
    };
    var soltar = function () {
      cv.removeEventListener('pointermove', mover);
      cv.removeEventListener('pointerup', soltar);
      cv.removeEventListener('pointercancel', soltar);
      var a = arrasto;
      arrasto = null;
      var c2 = camada(a.id);
      if (c2) { c2[q] = I.normalizarPos(a.pos, q); A.salvar(true); }
      pedirDesenho();
    };
    cv.addEventListener('pointermove', mover);
    cv.addEventListener('pointerup', soltar);
    cv.addEventListener('pointercancel', soltar);
  }, true);
  document.addEventListener('pointermove', function (ev) {
    var cv = ev.target;
    var area = cv && cv.id && areas[cv.id];
    if (!area || arrasto || cv.tagName !== 'CANVAS') return;
    var h = acertar(area, pontoNo(cv, ev));
    if (h) { cv.style.cursor = h.modo === 'tamanho' ? 'nwse-resize' : 'move'; ev.stopImmediatePropagation(); }
    else if (cv.id === 'previa-identidade') cv.style.cursor = '';
  }, true);

  var desenhoPedido = false;
  function pedirDesenho() {
    if (desenhoPedido) return;
    desenhoPedido = true;
    requestAnimationFrame(function () { desenhoPedido = false; desenharTela(); });
  }

  // ================================================================ exportação
  function canvas(W, H) { var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(W)); c.height = Math.max(1, Math.round(H)); return c; }

  /** PNG de uma camada recortado no retângulo dela (posição em px no quadro W×H). */
  function pngCamada(c, W, H, qual) {
    var p = c.tipo === 'imagem' ? carregar(c.imagem) : Promise.resolve(null);
    return p.then(function (img) {
      if (c.tipo === 'imagem' && !img) return null;
      var r = I.retangulo(ctxMedir(), c, W, H, qual, img);
      var x = Math.floor(r.x), y = Math.floor(r.y);
      var cv = canvas(Math.ceil(r.x + r.largura) - x + 1, Math.ceil(r.y + r.altura) - y + 1);
      var ctx = cv.getContext('2d');
      ctx.translate(-x, -y);
      I.desenharCamada(ctx, c, W, H, qual, img);
      return { png: cv.toDataURL('image/png'), x: x, y: y };
    });
  }
  function pngFinal(f, W, H) {
    return (f.imagem ? carregar(f.imagem) : Promise.resolve(null)).then(function (img) {
      var cv = canvas(W, H);
      I.desenharFinal(cv.getContext('2d'), f, W, H, img);
      return { png: cv.toDataURL('image/png'), duracao: f.duracao, fade: f.fade };
    });
  }
  function pngFundo(fu, W, H) {
    if (fu.tipo === 'desfoque' || (fu.tipo === 'imagem' && !fu.imagem)) return Promise.resolve({ y: fu.y, escala: fu.escala });
    return (fu.tipo === 'imagem' ? carregar(fu.imagem) : Promise.resolve(null)).then(function (img) {
      var cv = canvas(W, H);
      I.desenharFundoImagem(cv.getContext('2d'), fu, W, H, img);
      return { png: cv.toDataURL('image/png'), y: fu.y, escala: fu.escala };
    });
  }

  /**
   * O que a exportação de um formato precisa: { camadas, final, fundo }.
   * preset: { tipo: 'h'|'v'|'c', largura, altura }. corte pode ser null (compilado: sem esconder nada).
   */
  function visualPara(corte, preset) {
    if (!preset || preset.tipo === 'c' || !preset.largura) return Promise.resolve({ camadas: [], final: null, fundo: null });
    var qual = preset.tipo === 'v' ? 'v' : 'h', W = preset.largura, H = preset.altura;
    var lista = camadasDoCorte(corte || { identidade: { ocultas: [] } }, qual);
    var f = finalDoCorte(corte, qual);
    var vert = mesa().vertical;
    return Promise.all([
      Promise.all(lista.map(function (c) { return pngCamada(c, W, H, qual); })),
      f ? pngFinal(f, W, H) : Promise.resolve(null),
      qual === 'v' ? pngFundo(vert.fundo, W, H) : Promise.resolve(null),
    ]).then(function (r) { return { camadas: r[0].filter(Boolean), final: r[1], fundo: r[2] }; });
  }

  // ================================================================ tela "Identidade visual"
  var qualTela = 'h';
  var PREV = { h: { w: 640, h: 360 }, v: { w: 270, h: 480 } };
  var NOMES_AJUSTE = { caber: 'Caber inteira (sobra a cor de fundo)', cobrir: 'Cobrir a tela (corta as bordas)' };

  function linhaCamada(c) {
    return '<div class="id-camada' + (c.id === sel ? ' escolhida' : '') + '" data-camada="' + esc(c.id) + '">' +
      '<button class="id-nome" data-acao="idEscolher" title="Editar esta camada"><span class="id-tipo">' + (c.tipo === 'texto' ? 'T' : '🖼') + '</span>' + esc(c.nome) + '</button>' +
      '<label class="opcao" title="Aparece no overlay do OBS (e então já sai na gravação)"><input type="checkbox" data-idc="aoVivo"' + A.marcado(c.aoVivo) + '>Ao vivo</label>' +
      '<label class="opcao" title="Desenhada nos cortes exportados"><input type="checkbox" data-idc="cortes"' + A.marcado(c.cortes) + '>Nos cortes</label>' +
      '<span class="id-botoes"><button class="pequeno icone" data-acao="idMover" data-dir="-1" aria-label="Para trás" title="Para trás">↓</button>' +
      '<button class="pequeno icone" data-acao="idMover" data-dir="1" aria-label="Para a frente" title="Para a frente">↑</button>' +
      '<button class="pequeno icone" data-acao="idApagar" aria-label="Apagar camada" title="Apagar">✕</button></span></div>';
  }
  function opcoes(lista, valor) {
    return lista.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(valor) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function faixa(campo, rotulo, valor, min, max, suf, step) {
    return '<label class="campo"><span class="rotulo">' + rotulo + ': <span data-eco-idc="' + campo + '">' + valor + '</span>' + suf + '</span>' +
      '<input type="range" min="' + min + '" max="' + max + '" step="' + (step || 1) + '" value="' + valor + '" data-idc="' + campo + '" data-num></label>';
  }
  function editorCamada() {
    var c = camada(sel);
    if (!c) return '<p class="ajuda">Escolha uma camada na lista (ou clique nela na prévia) para editar. Ainda não tem nenhuma? Use <strong>+ Imagem</strong> (logo, selo, moldura) ou <strong>+ Texto</strong> (canal, @ do Discord).</p>';
    return '<div class="coluna id-editor" data-camada="' + esc(c.id) + '" style="gap:10px">' +
      '<label class="campo"><span class="rotulo">Nome da camada</span><input type="text" data-idc="nome" value="' + esc(c.nome) + '" maxlength="40"></label>' +
      (c.tipo === 'imagem' ?
        '<div class="linha"><button class="pequeno" data-acao="idImagem">' + (c.imagem ? 'Trocar imagem' : 'Escolher imagem') + '</button>' +
        '<span class="ajuda">PNG com fundo transparente fica melhor.</span></div>' :
        '<label class="campo"><span class="rotulo">Texto</span><input type="text" data-idc="texto" value="' + esc(c.texto) + '" maxlength="200"></label>' +
        '<div class="leg-linha"><label class="campo" style="flex:1"><span class="rotulo">Fonte</span><select data-idc="fonte">' + opcoes(I.FONTES.map(function (f) { return [f, f]; }), c.fonte) + '</select></label>' +
        '<label class="opcao"><input type="checkbox" data-idc="negrito"' + A.marcado(c.negrito) + '>Negrito</label></div>' +
        '<div class="leg-linha"><label class="leg-cor"><input type="color" data-idc="corTexto" value="' + esc(c.corTexto) + '"><span>Texto</span></label>' +
        '<label class="leg-cor"><input type="color" data-idc="corContorno" value="' + esc(c.corContorno) + '"><span>Contorno</span></label></div>' +
        faixa('contorno', 'Contorno', c.contorno, 0, 30, ' px') + faixa('sombra', 'Sombra', c.sombra, 0, 30, ' px')) +
      faixa('opacidade', 'Opacidade', c.opacidade, 0, 100, '%') +
      '<div class="linha"><button class="pequeno" data-acao="idCentralizar">Centralizar</button><button class="pequeno" data-acao="idPosPadrao">Posição padrão</button>' +
      '<span class="ajuda">A posição no horizontal e no vertical é separada.</span></div></div>';
  }
  function blocoFinal(qual) {
    var f = mesa().final[qual];
    var p = 'm.final.' + qual + '.';
    return '<div class="id-final" data-final="' + qual + '"><div class="titulo"><h3>' + (qual === 'h' ? 'Vídeos horizontais' : 'Vídeos verticais') + '</h3>' +
      '<label class="opcao"><input type="checkbox" data-campo="' + p + 'ativo"' + A.marcado(f.ativo) + ' data-id-final>Usar em todos os cortes</label></div>' +
      '<canvas class="id-final-previa ' + qual + '" id="final-previa-' + qual + '" width="' + (qual === 'h' ? 320 : 135) + '" height="' + (qual === 'h' ? 180 : 240) + '" aria-label="Prévia da imagem final"></canvas>' +
      '<div class="coluna" style="gap:8px;flex:1;min-width:200px">' +
      '<div class="linha"><button class="pequeno" data-acao="idFinalImagem" data-qual="' + qual + '">' + (f.imagem ? 'Trocar imagem' : 'Escolher imagem') + '</button>' +
      (f.imagem ? '<button class="pequeno" data-acao="idFinalTirar" data-qual="' + qual + '">Tirar</button>' : '') + '</div>' +
      '<label class="campo"><span class="rotulo">Na tela por: <span data-eco="f-' + qual + '-dur">' + f.duracao + '</span> s</span><input type="range" min="0.5" max="15" step="0.5" value="' + f.duracao + '" data-campo="' + p + 'duracao" data-num data-eco-alvo="f-' + qual + '-dur" data-id-final></label>' +
      '<label class="campo"><span class="rotulo">Fade de entrada: <span data-eco="f-' + qual + '-fade">' + f.fade + '</span> s</span><input type="range" min="0" max="5" step="0.1" value="' + f.fade + '" data-campo="' + p + 'fade" data-num data-eco-alvo="f-' + qual + '-fade" data-id-final></label>' +
      '<div class="leg-linha"><select data-campo="' + p + 'ajuste" data-id-final>' + opcoes([['caber', NOMES_AJUSTE.caber], ['cobrir', NOMES_AJUSTE.cobrir]], f.ajuste) + '</select>' +
      '<label class="leg-cor"><input type="color" data-campo="' + p + 'cor" value="' + esc(f.cor) + '" data-id-final><span>Fundo</span></label></div>' +
      '</div></div>';
  }

  A.TELAS.identidade = {
    menu: 'identidade',
    html: function () {
      return '<header class="cabecalho"><div><h1>Identidade visual</h1>' +
        '<p>Logo, textos e a imagem final dos cortes. Cada camada pode aparecer ao vivo (no overlay do OBS), nos cortes, ou nos dois.</p></div></header>' +
        '<div class="grade" style="grid-template-columns:minmax(0,1.4fr) minmax(320px,1fr)">' +
        '<section class="painel"><div class="titulo"><h2>Prévia</h2><div class="segmentos" role="radiogroup" aria-label="Formato da prévia">' +
        '<label class="segmento"><input type="radio" name="id-qual" value="h"' + A.marcado(qualTela === 'h') + '><span>Horizontal</span></label>' +
        '<label class="segmento"><input type="radio" name="id-qual" value="v"' + A.marcado(qualTela === 'v') + '><span>Vertical</span></label></div></div>' +
        '<div class="id-palco"><canvas id="previa-identidade" class="previa-identidade ' + qualTela + '" aria-label="Prévia: arraste uma camada para mover, puxe a bolinha para o tamanho"></canvas></div>' +
        '<p class="ajuda">Arraste uma camada para mover (ela gruda no centro) e puxe a bolinha azul para o tamanho. ' +
        (qualTela === 'h' ? 'Horizontal = overlay do OBS e cortes de YouTube/WhatsApp.' : 'Vertical = cortes de TikTok/Reels/Shorts (só as camadas marcadas “Nos cortes”).') + '</p>' +
        '<p class="ajuda">Nos cortes horizontais, as camadas “Ao vivo” não são desenhadas de novo: elas já foram gravadas pelo OBS.</p></section>' +
        '<div class="coluna" style="gap:16px">' +
        '<section class="painel"><div class="titulo"><h2>Camadas</h2><div class="linha"><button class="pequeno" data-acao="idNovaImagem">+ Imagem</button>' +
        '<button class="pequeno" data-acao="idNovoTexto">+ Texto</button></div></div>' +
        '<div id="id-lista" class="coluna" style="gap:6px"></div><div class="separador"></div><div id="id-editor"></div></section>' +
        '<section class="painel"><h2>Imagem final dos cortes</h2>' +
        '<p class="ajuda">Uma imagem no fim de cada corte (divulgar o Discord, o canal, créditos). Ela entra com fade por cima do fim do vídeo e fica na tela; o som do corte some junto. ' +
        'Em cada corte dá para tirar.</p>' + blocoFinal('h') + blocoFinal('v') + '</section>' +
        '</div></div>';
    },
    depois: function () { desenharListaTela(); desenharTela(); },
  };

  function desenharListaTela() {
    var l = $('#id-lista');
    if (!l) return;
    var cs = camadas();
    l.innerHTML = cs.length ? cs.slice().reverse().map(linhaCamada).join('') : '<p class="ajuda">Nenhuma camada ainda.</p>';
    var e = $('#id-editor');
    if (e && !e.contains(document.activeElement)) e.innerHTML = editorCamada();
  }
  function aoEscolher() {
    desenharListaTela();
    var e = $('#id-editor');
    if (e) e.innerHTML = editorCamada();
    if (ed()) desenharPainelVisual();
  }

  function fundoExemplo(ctx, W, H) {
    var g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#2B3140'); g.addColorStop(1, '#151820');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.lineWidth = 1;
    var passo = W / 12;
    for (var x = passo; x < W; x += passo) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (var y = passo; y < H; y += passo) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.font = Math.round(W / 22) + 'px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('seu vídeo', W / 2, H / 2);
  }

  function desenharTela() {
    var cv = $('#previa-identidade');
    if (cv) {
      var r = cv.getBoundingClientRect();
      var dpr = window.devicePixelRatio || 1;
      var base = PREV[qualTela];
      var w = Math.round((r.width || base.w) * dpr), h = Math.round(w * base.h / base.w);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      var ctx = cv.getContext('2d');
      fundoExemplo(ctx, w, h);
      var lista = camadas().filter(function (c) { return qualTela === 'h' ? (c.aoVivo || c.cortes) : c.cortes; });
      desenharCamadas(ctx, w, h, qualTela, lista, 'previa-identidade', true);
    }
    ['h', 'v'].forEach(function (q) {
      var c2 = $('#final-previa-' + q);
      if (!c2) return;
      var f = mesa().final[q];
      var img = f.imagem ? imagem(f.imagem) : null;
      I.desenharFinal(c2.getContext('2d'), f, c2.width, c2.height, img);
      if (!f.imagem) {
        var x = c2.getContext('2d');
        x.fillStyle = 'rgba(255,255,255,.35)'; x.font = '12px "Segoe UI", sans-serif'; x.textAlign = 'center';
        x.fillText('sem imagem', c2.width / 2, c2.height / 2);
      }
    });
  }
  redesenhar.push(function () { if ($('#previa-identidade')) desenharTela(); });
  window.addEventListener('resize', function () { if ($('#previa-identidade')) desenharTela(); });

  function camadaDoEl(el) {
    var b = el.closest && el.closest('[data-camada]');
    return b ? camada(b.getAttribute('data-camada')) : null;
  }

  Object.assign(A.ACOES, {
    idNovaImagem: function () {
      if (camadas().length >= I.MAX_CAMADAS) { A.aviso('No máximo ' + I.MAX_CAMADAS + ' camadas.', 'erro'); return; }
      return window.api.escolherImagem('identidade').then(function (r) {
        if (!r || r.cancelado) return;
        if (r.erro) return A.aviso(r.erro, 'erro');
        var c = I.normalizarCamada({ tipo: 'imagem', imagem: r.nome, nome: 'Imagem ' + (camadas().length + 1) });
        camadas().push(c);
        sel = c.id;
        A.salvar(true);
        desenharListaTela(); desenharTela();
      });
    },
    idNovoTexto: function () {
      if (camadas().length >= I.MAX_CAMADAS) { A.aviso('No máximo ' + I.MAX_CAMADAS + ' camadas.', 'erro'); return; }
      var c = I.normalizarCamada({ tipo: 'texto', nome: 'Texto ' + (camadas().length + 1), h: { x: 0.5, y: 0.93, w: 0.3 }, v: { x: 0.5, y: 0.06, w: 0.7 } });
      camadas().push(c);
      sel = c.id;
      A.salvar(true);
      desenharListaTela(); desenharTela();
      var t = $('#id-editor [data-idc="texto"]');
      if (t) { t.focus(); t.select(); }
    },
    idEscolher: function (el) { var c = camadaDoEl(el); if (c) { sel = c.id; aoEscolher(); desenharTela(); } },
    idApagar: function (el) {
      var c = camadaDoEl(el);
      if (!c || !confirm('Apagar a camada “' + c.nome + '”?')) return;
      mesa().identidade.camadas = camadas().filter(function (x) { return x !== c; });
      if (sel === c.id) sel = '';
      A.salvar(true);
      desenharListaTela(); desenharTela();
    },
    idMover: function (el) {
      var c = camadaDoEl(el);
      if (!c) return;
      var l = camadas(), i = l.indexOf(c), j = i + Number(el.getAttribute('data-dir'));
      if (j < 0 || j >= l.length) return;
      l.splice(i, 1); l.splice(j, 0, c);
      A.salvar(true);
      desenharListaTela(); desenharTela();
    },
    idImagem: function (el) {
      var c = camadaDoEl(el);
      if (!c) return;
      return window.api.escolherImagem('identidade').then(function (r) {
        if (!r || r.cancelado) return;
        if (r.erro) return A.aviso(r.erro, 'erro');
        c.imagem = r.nome;
        A.salvar(true);
        aoEscolher(); desenharTela();
      });
    },
    idCentralizar: function (el) {
      var c = camadaDoEl(el);
      if (!c) return;
      c[qualTela].x = 0.5;
      A.salvar(true); desenharTela();
    },
    idPosPadrao: function (el) {
      var c = camadaDoEl(el);
      if (!c) return;
      c[qualTela] = I.normalizarPos(null, qualTela);
      A.salvar(true); desenharTela();
    },
    idFinalImagem: function (el) {
      var q = el.getAttribute('data-qual');
      return window.api.escolherImagem('final').then(function (r) {
        if (!r || r.cancelado) return;
        if (r.erro) return A.aviso(r.erro, 'erro');
        var f = mesa().final[q];
        f.imagem = r.nome;
        f.ativo = true;
        A.salvar(true);
        A.desenhar();
      });
    },
    idFinalTirar: function (el) {
      var f = mesa().final[el.getAttribute('data-qual')];
      f.imagem = '';
      A.salvar(true);
      A.desenhar();
    },
  });

  function aoEditarCamada(ev) {
    var el = ev.target;
    var campo = el.getAttribute && el.getAttribute('data-idc');
    if (!campo) return;
    var c = camadaDoEl(el);
    if (!c) return;
    var v = el.type === 'checkbox' ? el.checked : el.hasAttribute('data-num') ? Number(el.value) : el.value;
    if (campo === 'nome' || campo === 'texto') v = String(v).slice(0, campo === 'nome' ? 40 : 200);
    c[campo] = v;
    var eco = $('[data-eco-idc="' + campo + '"]');
    if (eco) eco.textContent = el.value;
    A.salvar(el.type === 'checkbox' || el.tagName === 'SELECT');
    if (campo === 'nome' && ev.type === 'change') desenharListaTela();
    if (campo === 'aoVivo' || campo === 'cortes') desenharListaTela();
    desenharTela();
  }
  document.addEventListener('input', aoEditarCamada);
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.name === 'id-qual') { qualTela = el.value; A.desenhar(); return; }
    if (el.getAttribute && el.getAttribute('data-idc')) aoEditarCamada(ev);
    if (el.hasAttribute && el.hasAttribute('data-id-final')) setTimeout(desenharTela, 30);
  });
  document.addEventListener('input', function (ev) {
    if (ev.target.hasAttribute && ev.target.hasAttribute('data-id-final')) setTimeout(desenharTela, 30);
  });

  // ================================================================ painel do corte: visual + música
  var musicas = null;        // faixas da biblioteca do bot (cache)
  function carregarMusicas(forcar) {
    if (musicas && !forcar) return Promise.resolve(musicas);
    return window.api.musicaFaixas().then(function (l) { musicas = Array.isArray(l) ? l : (l && l.faixas) || []; return musicas; });
  }

  function painel() {
    return '<section class="painel" id="painel-visual"><h2>Visual e música</h2><div id="visual-corpo"></div>' +
      '<div class="separador"></div>' +
      '<div class="titulo"><h3>Música rápida</h3><label class="opcao"><input type="checkbox" id="musica-ouvir" checked>Ouvir na prévia</label></div>' +
      '<div id="musica-corpo"><p class="ajuda">Carregando as músicas…</p></div>' +
      '<audio id="musica-previa" preload="auto"></audio></section>';
  }

  function desenharPainelVisual() {
    var alvo = $('#visual-corpo'), e = ed();
    if (!alvo || !e) return;
    var c = e.corte;
    var ocultas = (c.identidade && c.identidade.ocultas) || [];
    var nosCortes = camadas().filter(function (x) { return x.cortes; });
    var fh = mesa().final.h, fv = mesa().final.v;
    var algumFinal = fh.ativo || fv.ativo;
    alvo.innerHTML =
      (nosCortes.length ? '<div class="coluna" style="gap:4px">' + nosCortes.map(function (x) {
        var aoVivoH = x.aoVivo && !c.retratosHorizontal;
        return '<label class="opcao"><input type="checkbox" data-corte-camada="' + esc(x.id) + '"' + A.marcado(ocultas.indexOf(x.id) < 0) + '><span>' + esc(x.nome) +
          (aoVivoH ? '<small>Ao vivo: nos horizontais já está na gravação; aqui vale para o vertical</small>' : '') + '</span></label>';
      }).join('') + '</div>' : '<p class="ajuda">Sem camadas para os cortes. Crie logo e textos em <a href="#identidade">Identidade visual</a>.</p>') +
      (algumFinal ? '<label class="opcao"><input type="checkbox" id="corte-final"' + A.marcado(c.final !== false) + '><span>Imagem final neste corte<small>' +
        [fh.ativo ? 'horizontal ' + fh.duracao + ' s' : '', fv.ativo ? 'vertical ' + fv.duracao + ' s' : ''].filter(Boolean).join(' · ') + '</small></span></label>' :
        '<p class="ajuda">Imagem final: configure uma em <a href="#identidade">Identidade visual</a>.</p>');
  }

  // ---------------------------------------------------------------- música rápida
  function mus() { var e = ed(); return e && e.corte.musica; }
  function totalMs() {
    var e = ed();
    if (!e) return 1;
    var dur = e.corte.fim - e.corte.ini;
    var qual = A.TELAS.vertical.desenharCaixa ? 'v' : 'h';
    return dur + extraFinal(finalDoCorte(e.corte, qual), dur);
  }

  function desenharMusica() {
    var alvo = $('#musica-corpo'), e = ed();
    if (!alvo || !e) return;
    var m = mus();
    carregarMusicas().then(function (lista) {
      if (!$('#musica-corpo') || !ed()) return;
      var grupos = {};
      lista.forEach(function (f) { var g = f.grupo || 'Sem grupo'; (grupos[g] = grupos[g] || []).push(f); });
      var ops = '<option value="">Sem música</option>' + Object.keys(grupos).sort().map(function (g) {
        return '<optgroup label="' + esc(g) + '">' + grupos[g].map(function (f) {
          return '<option value="' + esc(f.id) + '"' + (f.id === m.faixa ? ' selected' : '') + (f.existe === false ? ' disabled' : '') + '>' + esc(f.nome) + (f.existe === false ? ' (arquivo sumiu)' : '') + '</option>';
        }).join('') + '</optgroup>';
      }).join('');
      var faltando = m.faixa && !lista.some(function (f) { return f.id === m.faixa; });
      alvo.innerHTML =
        '<div class="leg-linha"><select id="musica-faixa" style="flex:1" aria-label="Música">' + ops + (faltando ? '<option value="' + esc(m.faixa) + '" selected>(saiu da biblioteca)</option>' : '') + '</select>' +
        '<button class="pequeno" data-acao="musicaCorteAdicionar" title="Adicionar arquivos de música à biblioteca">+ Arquivos…</button></div>' +
        (m.faixa ?
          '<label class="campo"><span class="rotulo">Começar a música em</span><input type="text" class="mono" id="musica-inicio" value="' + fmtS(m.inicio) + '" style="max-width:120px"></label>' +
          faixaMus('volume', 'Volume geral', m.volume, 0, 200, 1, '%') +
          '<div class="leg-linha">' + faixaMus('fadeIn', 'Fade de entrada', m.fadeIn, 0, 10, 0.5, ' s') + faixaMus('fadeOut', 'Fade de saída', m.fadeOut, 0, 10, 0.5, ' s') + '</div>' +
          '<div class="campo"><span class="rotulo">Volume no tempo (pontos)</span>' +
          '<canvas id="musica-curva" class="musica-curva" height="96" aria-label="Volume da música no tempo: clique para criar um ponto, arraste para mudar, clique duas vezes para apagar"></canvas>' +
          '<span class="ajuda">Clique para criar um ponto · arraste para mudar · clique duas vezes para apagar. Ex.: abaixe a música quando alguém fala.</span></div>' +
          '<div class="linha"><button class="pequeno" data-acao="musicaPontoAqui">+ Ponto no tempo atual</button>' +
          '<button class="pequeno" data-acao="musicaLimparPontos"' + (m.pontos.length ? '' : ' disabled') + '>Tirar os pontos</button></div>' :
          '<p class="ajuda">Escolha uma música da biblioteca do bot (aba Música) ou adicione arquivos. Ela toca por baixo do corte, com volume, fades e pontos de volume no tempo.</p>');
      desenharCurva();
      prepararAudio();
    });
  }
  function fmtS(s) { return A.Cortes.fmt(s); }
  function faixaMus(campo, rotulo, valor, min, max, step, suf) {
    return '<label class="campo" style="flex:1"><span class="rotulo">' + rotulo + ': <span data-eco-mus="' + campo + '">' + valor + '</span>' + suf + '</span>' +
      '<input type="range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + valor + '" data-mus="' + campo + '"></label>';
  }

  var curva = { pontoArrastado: -1 };
  function geoCurva(cv) { return { W: cv.width, H: cv.height, pad: 6 }; }
  function xDe(t, g) { return g.pad + (g.W - 2 * g.pad) * Math.max(0, Math.min(1, t / totalMs())); }
  function yDe(v, g) { return g.pad + (g.H - 2 * g.pad) * (1 - v / 200); }
  function desenharCurva() {
    var cv = $('#musica-curva'), e = ed(), m = mus();
    if (!cv || !e || !m) return;
    var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    var w = Math.max(100, Math.round(r.width * dpr)), h = Math.round(96 * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    var g = geoCurva(cv), ctx = cv.getContext('2d');
    var total = totalMs(), dur = e.corte.fim - e.corte.ini;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#13161B';
    ctx.fillRect(0, 0, w, h);
    // final
    if (total > dur) {
      ctx.fillStyle = 'rgba(143,180,240,.12)';
      ctx.fillRect(xDe(dur, g), 0, w - xDe(dur, g), h);
      ctx.fillStyle = 'rgba(143,180,240,.6)';
      ctx.font = Math.round(10 * dpr) + 'px "Segoe UI", sans-serif';
      ctx.fillText('final', xDe(dur, g) + 4 * dpr, 12 * dpr);
    }
    // 100%
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath(); ctx.moveTo(g.pad, yDe(100, g)); ctx.lineTo(w - g.pad, yDe(100, g)); ctx.stroke();
    ctx.setLineDash([]);
    // volume final (com volume geral e fades), em escala: 100% do eixo = volume 100%
    ctx.strokeStyle = '#F0B44C';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    for (var i = 0; i <= 200; i++) {
      var t = total * i / 200;
      var gn = I.ganhoEm(m, t, total) * 100;
      var x = xDe(t, g), y = yDe(Math.min(200, gn), g);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
    // pontos (no eixo da curva × volume geral)
    m.pontos.forEach(function (p, k) {
      var x = xDe(p.t, g), y = yDe(Math.min(200, p.v * m.volume / 100), g);
      ctx.fillStyle = k === curva.pontoArrastado ? '#FFFFFF' : '#F0B44C';
      ctx.strokeStyle = '#1A1405';
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
    // cabeça
    var rel = e.T * 1000 - e.corte.ini;
    if (rel >= 0 && rel <= total) {
      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.moveTo(xDe(rel, g), 0); ctx.lineTo(xDe(rel, g), h); ctx.stroke();
    }
  }
  function pontoPerto(cv, p) {
    var g = geoCurva(cv), m = mus(), dpr = window.devicePixelRatio || 1;
    for (var k = m.pontos.length - 1; k >= 0; k--) {
      var q = m.pontos[k];
      if (Math.hypot(p.x - xDe(q.t, g), p.y - yDe(Math.min(200, q.v * m.volume / 100), g)) <= 9 * dpr) return k;
    }
    return -1;
  }
  function valoresNo(cv, p) {
    var g = geoCurva(cv), m = mus();
    var t = Math.round(Math.max(0, Math.min(1, (p.x - g.pad) / (g.W - 2 * g.pad))) * totalMs());
    var noEixo = Math.max(0, Math.min(200, (1 - (p.y - g.pad) / (g.H - 2 * g.pad)) * 200));
    var v = m.volume > 0 ? Math.round(Math.min(200, noEixo * 100 / m.volume)) : 100;
    return { t: t, v: v };
  }
  document.addEventListener('pointerdown', function (ev) {
    var cv = ev.target;
    if (!cv || cv.id !== 'musica-curva' || !mus()) return;
    ev.preventDefault();
    var p = pontoNo(cv, ev), m = mus();
    var k = pontoPerto(cv, p);
    if (k < 0) {
      var nv = valoresNo(cv, p);
      m.pontos.push(nv);
      m.pontos.sort(function (a, b) { return a.t - b.t; });
      k = m.pontos.indexOf(nv);
    }
    curva.pontoArrastado = k;
    var alvoP = m.pontos[k];
    cv.setPointerCapture(ev.pointerId);
    var mover = function (e2) {
      var nv2 = valoresNo(cv, pontoNo(cv, e2));
      alvoP.t = nv2.t; alvoP.v = nv2.v;
      desenharCurva();
    };
    var soltar = function () {
      cv.removeEventListener('pointermove', mover);
      cv.removeEventListener('pointerup', soltar);
      m.pontos.sort(function (a, b) { return a.t - b.t; });
      curva.pontoArrastado = -1;
      desenharCurva();
      A.Cortes.salvarCorte();
      var b = $('[data-acao="musicaLimparPontos"]');
      if (b) b.disabled = !m.pontos.length;
    };
    cv.addEventListener('pointermove', mover);
    cv.addEventListener('pointerup', soltar);
  });
  document.addEventListener('dblclick', function (ev) {
    var cv = ev.target;
    if (!cv || cv.id !== 'musica-curva' || !mus()) return;
    var k = pontoPerto(cv, pontoNo(cv, ev));
    if (k < 0) return;
    mus().pontos.splice(k, 1);
    desenharCurva();
    A.Cortes.salvarCorte();
  });

  Object.assign(A.ACOES, {
    musicaCorteAdicionar: function () {
      return window.api.musicaAdicionarArquivos().then(function (r) {
        if (!r || r.cancelado) return;
        if (r.erro) return A.aviso(r.erro, 'erro');
        var antes = (musicas || []).map(function (f) { return f.id; });
        return carregarMusicas(true).then(function (lista) {
          var nova = lista.filter(function (f) { return antes.indexOf(f.id) < 0; })[0];
          if (nova && mus()) { mus().faixa = nova.id; A.Cortes.salvarCorte(); }
          desenharMusica();
        });
      });
    },
    musicaPontoAqui: function () {
      var e = ed(), m = mus();
      if (!e || !m) return;
      var t = Math.round(Math.max(0, e.T * 1000 - e.corte.ini));
      m.pontos.push({ t: t, v: Math.round(I.curvaEm(m.pontos, t) * 100) });
      m.pontos.sort(function (a, b) { return a.t - b.t; });
      desenharCurva();
      A.Cortes.salvarCorte();
      var b = $('[data-acao="musicaLimparPontos"]');
      if (b) b.disabled = false;
    },
    musicaLimparPontos: function () {
      var m = mus();
      if (!m) return;
      m.pontos = [];
      desenharMusica();
      A.Cortes.salvarCorte();
    },
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target, e = ed();
    if (!e) return;
    if (el.hasAttribute && el.hasAttribute('data-corte-camada')) {
      var id = el.getAttribute('data-corte-camada');
      var oc = e.corte.identidade.ocultas.filter(function (x) { return x !== id; });
      if (!el.checked) oc.push(id);
      e.corte.identidade.ocultas = oc;
      A.Cortes.salvarCorte();
    } else if (el.id === 'corte-final') {
      e.corte.final = el.checked;
      A.Cortes.salvarCorte();
      desenharCurva();
    } else if (el.id === 'musica-faixa') {
      mus().faixa = el.value;
      A.Cortes.salvarCorte();
      desenharMusica();
    } else if (el.id === 'musica-inicio') {
      var t = A.Cortes.lerTempo(el.value);
      if (t == null) { A.aviso('Use o formato minutos:segundos, por exemplo 1:05', 'erro'); el.value = fmtS(mus().inicio); return; }
      mus().inicio = Math.max(0, Math.round(t * 10) / 10);
      el.value = fmtS(mus().inicio);
      A.Cortes.salvarCorte();
      sincronizar(true);
    }
  });
  document.addEventListener('input', function (ev) {
    var el = ev.target, campo = el.getAttribute && el.getAttribute('data-mus');
    if (!campo || !mus()) return;
    mus()[campo] = Number(el.value);
    var eco = $('[data-eco-mus="' + campo + '"]');
    if (eco) eco.textContent = el.value;
    desenharCurva();
    A.Cortes.salvarCorte();
  });

  // ---------------------------------------------------------------- prévia da música junto com o vídeo
  function prepararAudio() {
    var a = $('#musica-previa'), m = mus();
    if (!a || !m) return;
    if (!m.faixa) { a.pause(); a.removeAttribute('src'); a.removeAttribute('data-faixa'); return; }
    if (a.getAttribute('data-faixa') === m.faixa) return;
    a.setAttribute('data-faixa', m.faixa);
    window.api.musicaUrl(m.faixa).then(function (url) {
      if (typeof url !== 'string' || !url) return;
      a.src = url;
      a.loop = true;
      sincronizar(true);
    });
  }
  function sincronizar(forcar) {
    var a = $('#musica-previa'), e = ed(), m = mus();
    if (!a || !e || !m || !m.faixa || !a.src) return;
    var v = e.player && e.player.video;
    var rel = e.T * 1000 - e.corte.ini;
    var total = totalMs();
    var ouvir = $('#musica-ouvir');
    var tocar = v && !v.paused && rel >= 0 && rel < e.corte.fim - e.corte.ini && (!ouvir || ouvir.checked);
    if (!tocar) { if (!a.paused) a.pause(); return; }
    var dur = a.duration || 0;
    var alvo = m.inicio + rel / 1000;
    if (dur > 0) alvo = alvo % dur;
    if (forcar || Math.abs(a.currentTime - alvo) > 0.3) { try { a.currentTime = alvo; } catch (err) { /* ainda carregando */ } }
    a.volume = Math.max(0, Math.min(1, I.ganhoEm(m, rel, total)));
    if (a.paused) a.play().catch(function () {});
  }
  function tique() {
    sincronizar(false);
    desenharCurva();
  }

  function montar() {
    desenharPainelVisual();
    desenharMusica();
    var e = ed();
    var v = e && e.player && e.player.video;
    if (v) {
      v.addEventListener('pause', function () { sincronizar(false); });
      v.addEventListener('play', function () { sincronizar(true); });
      v.addEventListener('seeked', function () { sincronizar(true); });
    }
  }
  function sair() {
    var a = $('#musica-previa');
    if (a) { try { a.pause(); } catch (e) { /* */ } }
    for (var k in areas) if (k !== 'previa-identidade') delete areas[k];
  }
  document.addEventListener('change', function (ev) { if (ev.target.id === 'musica-ouvir') sincronizar(true); });

  A.IdentidadeUI = {
    imagem: imagem, carregar: carregar, camadasDoCorte: camadasDoCorte, finalDoCorte: finalDoCorte, extraFinal: extraFinal,
    desenharEditor: desenharEditor, desenharFinalEditor: desenharFinalEditor, visualPara: visualPara,
    painel: painel, montar: montar, sair: sair, tique: tique, desenharPainelVisual: desenharPainelVisual,
    escolhida: function () { return sel; },
  };
})();
