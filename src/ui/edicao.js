/* Câmera e anotações para tutoriais.
   - Horizontal: zoom em partes da tela com pontos no tempo (desliza devagar, desliza em X s ou
     corte seco) e "voltar para a tela inteira"; editado com o mouse numa visão da gravação inteira.
   - Anotações (seta, linha, retângulo, círculo, marca-texto, destaque, texto) com início, fim e
     entrada com fade ou corte seco. Presas à gravação original: valem no horizontal e no vertical
     e acompanham o zoom das duas câmeras. */
(function () {
  'use strict';
  var A = window.App, Cam = window.Camera, N = window.Anotacoes;
  var $ = A.$, $$ = A.$$, esc = A.esc;
  var ed = function () { return A.Cortes && A.Cortes.ed(); };
  var ASP = 16 / 9;

  var st = {
    qual: '',          // 'h' ou 'v' (qual editor está aberto)
    editando: false,   // horizontal: visão da gravação inteira para editar
    ferramenta: '',    // tipo de anotação sendo desenhada
    sel: '',           // anotação escolhida
    arrasto: null,
    caixaArrasto: null,
    raf: 0,
  };

  // ================================================================ dados do corte
  function corte() { var e = ed(); return e && e.corte; }
  function garantir(c) {
    if (!c.horizontal || typeof c.horizontal !== 'object') c.horizontal = { camera: [] };
    if (!Array.isArray(c.horizontal.camera)) c.horizontal.camera = [];
    if (!Array.isArray(c.anotacoes)) c.anotacoes = [];
  }
  function anotacoes() { var c = corte(); return c ? c.anotacoes : []; }
  function anotacao(id) { return anotacoes().filter(function (a) { return a.id === id; })[0] || null; }
  function dim() {
    var e = ed(), f = (e && e.s.fonte) || {}, v = e && e.player && e.player.video;
    return { W: (v && v.videoWidth) || f.largura || 1920, H: (v && v.videoHeight) || f.altura || 1080 };
  }
  function relMs() { var e = ed(); return e ? Math.round(e.T * 1000 - e.corte.ini) : 0; }
  function durMs() { var e = ed(); return e ? e.corte.fim - e.corte.ini : 1; }
  function salvar() { A.Cortes.salvarCorte(); }
  function fmt(ms) { return A.Cortes.fmt(Math.max(0, ms) / 1000); }

  // ---------------------------------------------------------------- câmera do horizontal
  function pontosH() { return corte().horizontal.camera; }
  function temZoomH() {
    var c = corte();
    if (!c || !c.horizontal || !c.horizontal.camera.length) return false;
    var d = dim(), cheia = Cam.inteira(d.W, d.H, ASP);
    return c.horizontal.camera.some(function (p) { return Math.abs(p.w - cheia.w) > 0.002 || Math.abs(p.x - cheia.x) > 0.002 || Math.abs(p.y - cheia.y) > 0.002; });
  }
  function caixaH(t) {
    var d = dim();
    if (st.caixaArrasto) return st.caixaArrasto;
    if (!pontosH().length) return Cam.limitar(Cam.inteira(d.W, d.H, ASP), d.W, d.H, ASP);
    return Cam.caixaEm(pontosH(), t == null ? relMs() : t, d.W, d.H, ASP);
  }
  function pontoPertoH(t) {
    var l = pontosH();
    for (var i = 0; i < l.length; i++) if (Math.abs(l[i].t - t) <= 120) return i;
    return -1;
  }
  function gravarPontoH(b) {
    var d = dim();
    var lim = Cam.limitar(b, d.W, d.H, ASP);
    var t = Math.max(0, Math.min(durMs(), relMs()));
    var l = pontosH();
    // o primeiro ponto em outro tempo: guarda a tela inteira no começo, para o zoom "entrar"
    if (!l.length && t > 0) l.push(Object.assign({ t: 0, trans: 'rapido', dur: 500 }, Cam.inteira(d.W, d.H, ASP)));
    var i = pontoPertoH(t);
    if (i >= 0) { l[i].x = lim.x; l[i].y = lim.y; l[i].w = lim.w; }
    else {
      var ant = l.filter(function (p) { return p.t < t; }).pop();
      l.push({ t: t, x: lim.x, y: lim.y, w: lim.w, trans: ant ? ant.trans : 'rapido', dur: ant && ant.dur ? ant.dur : 500 });
    }
    corte().horizontal.camera = Cam.normalizar(l, d.W, d.H, ASP);
    desenharTrilha();
    salvar();
  }

  // ================================================================ desenho
  /** Desenha as anotações do instante t num contexto cujas coordenadas são as da gravação (W×H). */
  function desenharAnotacoes(ctx, W, H, t, editavel) {
    anotacoes().forEach(function (a) {
      var al = N.alfaEm(a, t);
      var escolhida = editavel && a.id === st.sel;
      if (al <= 0 && !escolhida) return;
      N.desenhar(ctx, a, W, H, al > 0 ? al : 0.35);
    });
    if (!editavel) return;
    var a = anotacao(st.sel);
    if (!a) return;
    // alças da escolhida
    ctx.save();
    var raio = Math.max(5, H / 120);
    var pontas = a.tipo === 'texto' ? [[a.x1, a.y1]] : [[a.x1, a.y1], [a.x2, a.y2]];
    pontas.forEach(function (p) {
      ctx.fillStyle = '#8FB4F0';
      ctx.strokeStyle = '#0B0C0F';
      ctx.lineWidth = Math.max(1.5, H / 540);
      ctx.beginPath(); ctx.arc(p[0] * W, p[1] * H, raio, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
    ctx.restore();
  }

  /** Transforma o contexto para desenhar em coordenadas da gravação dentro de um retângulo da fonte. */
  function comFonte(ctx, origem, destino, d, desenho) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(destino.x, destino.y, destino.w, destino.h);
    ctx.clip();
    var ex = destino.w / (origem.w * d.W), ey = destino.h / (origem.h * d.H);
    ctx.translate(destino.x - origem.x * d.W * ex, destino.y - origem.y * d.H * ey);
    ctx.scale(ex, ey);
    desenho();
    ctx.restore();
  }

  // ---------------------------------------------------------------- horizontal: resultado e edição
  function ajustar(cv) {
    var r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    var w = Math.max(16, Math.round(r.width * dpr)), h = Math.max(9, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  }
  /** Onde a gravação inteira aparece dentro de um quadro (caber, centralizada). */
  function quadroFonte(W, H, d) {
    var e = Math.min(W / d.W, H / d.H);
    return { x: (W - d.W * e) / 2, y: (H - d.H * e) / 2, w: d.W * e, h: d.H * e, e: e };
  }

  function desenharH() {
    var e = ed();
    var res = $('#resultado-h'), edi = $('#edicao-h');
    if (!e || !res) return;
    var v = e.player && e.player.video;
    var d = dim(), t = relMs();
    // resultado (o que sai no vídeo): só desenha quando há zoom ou anotação; senão o <video> aparece
    ajustar(res);
    var ctx = res.getContext('2d');
    ctx.clearRect(0, 0, res.width, res.height);
    var precisa = !st.editando && (temZoomH() || anotacoes().length);
    if (precisa && v && v.readyState >= 2) {
      var b = caixaH(t);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, res.width, res.height);
      var dest = { x: 0, y: 0, w: res.width, h: res.height };
      if (!temZoomH()) {
        // sem zoom: igual à exportação (caber no 16:9 com bordas pretas)
        var q = quadroFonte(res.width, res.height, d);
        b = { x: 0, y: 0, w: 1, h: 1 };
        dest = { x: q.x, y: q.y, w: q.w, h: q.h };
      }
      ctx.drawImage(v, b.x * d.W, b.y * d.H, b.w * d.W, b.h * d.H, dest.x, dest.y, dest.w, dest.h);
      comFonte(ctx, b, dest, d, function () { desenharAnotacoes(ctx, d.W, d.H, t, false); });
    }
    // edição: a gravação inteira, a caixa da câmera e as anotações com alças
    if (!edi) return;
    edi.hidden = !st.editando;
    if (!st.editando) return;
    ajustar(edi);
    var c2 = edi.getContext('2d');
    c2.fillStyle = '#0B0C0F';
    c2.fillRect(0, 0, edi.width, edi.height);
    var qf = quadroFonte(edi.width, edi.height, d);
    if (v && v.readyState >= 2) c2.drawImage(v, qf.x, qf.y, qf.w, qf.h);
    comFonte(c2, { x: 0, y: 0, w: 1, h: 1 }, qf, d, function () { desenharAnotacoes(c2, d.W, d.H, t, true); });
    // caixa da câmera
    var cb = caixaH(t);
    var bx = qf.x + cb.x * qf.w, by = qf.y + cb.y * qf.h, bw = cb.w * qf.w, bh = cb.h * qf.h;
    c2.save();
    c2.fillStyle = 'rgba(0,0,0,0.45)';
    c2.beginPath();
    c2.rect(qf.x, qf.y, qf.w, qf.h);
    c2.rect(bx, by, bw, bh);
    c2.fill('evenodd');
    c2.setLineDash([6, 4]);
    c2.strokeStyle = pontoPertoH(t) >= 0 ? '#F0B44C' : 'rgba(240,180,76,.7)';
    c2.lineWidth = 2;
    c2.strokeRect(bx, by, bw, bh);
    c2.setLineDash([]);
    c2.fillStyle = '#F0B44C';
    c2.strokeStyle = '#1A1405';
    c2.beginPath(); c2.arc(bx + bw, by + bh, 8, 0, Math.PI * 2); c2.fill(); c2.stroke();
    c2.restore();
    st.geoH = { qf: qf, caixa: { x: bx, y: by, w: bw, h: bh } };
  }

  // ---------------------------------------------------------------- vertical: camada por cima da gravação
  function desenharV() {
    var cv = $('#edicao-v');
    if (!cv || !ed()) return;
    ajustar(cv);
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    var d = dim();
    comFonte(ctx, { x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: cv.width, h: cv.height }, d, function () { desenharAnotacoes(ctx, d.W, d.H, relMs(), true); });
    cv.style.pointerEvents = st.ferramenta || st.sel ? 'auto' : 'none';
    cv.classList.toggle('desenhando', !!st.ferramenta);
  }
  /** Prévia do vertical: anotações por cima do vídeo já enquadrado (origem = parte da gravação). */
  function desenharNaPrevia(ctx, origem, destino) {
    if (!anotacoes().length) return;
    var d = dim();
    comFonte(ctx, origem, destino, d, function () { desenharAnotacoes(ctx, d.W, d.H, relMs(), false); });
  }

  function laco() {
    if (!ed()) { st.raf = 0; return; }
    if (st.qual === 'h') desenharH(); else desenharV();
    st.raf = requestAnimationFrame(laco);
  }

  // ================================================================ mouse
  /** Ponto do mouse em frações da gravação (h: na visão de edição; v: na camada da gravação). */
  function fracao(cv, ev) {
    var r = cv.getBoundingClientRect(), dpr = cv.width / r.width;
    var px = (ev.clientX - r.left) * dpr, py = (ev.clientY - r.top) * dpr;
    if (cv.id === 'edicao-h') {
      var qf = st.geoH.qf;
      return { x: (px - qf.x) / qf.w, y: (py - qf.y) / qf.h, px: px, py: py };
    }
    return { x: px / cv.width, y: py / cv.height, px: px, py: py };
  }
  function acertarAnot(f) {
    var d = dim(), t = relMs();
    var lista = anotacoes().slice().reverse();
    // a escolhida primeiro (as alças dela vêm antes)
    var s = anotacao(st.sel);
    if (s) lista = [s].concat(lista.filter(function (a) { return a !== s; }));
    var raio = Math.max(12, d.H / 60);
    for (var i = 0; i < lista.length; i++) {
      var a = lista[i];
      if (a !== s && N.alfaEm(a, t) <= 0) continue;
      var onde = N.acertar(medidor(), a, d.W, d.H, f.x * d.W, f.y * d.H, raio);
      if (onde) return { a: a, onde: onde };
    }
    return null;
  }
  var _med = null;
  function medidor() { return _med || (_med = document.createElement('canvas').getContext('2d')); }

  function novaAnotacao(tipo, f) {
    var t = Math.max(0, Math.min(durMs() - 200, relMs()));
    var a = N.normalizar({
      tipo: tipo, ini: t, fim: Math.min(durMs(), t + 3000),
      x1: f.x, y1: f.y, x2: f.x, y2: f.y,
    });
    var base = anotacoes().filter(function (x) { return x.tipo === tipo; }).pop();
    if (base) { a.cor = base.cor; a.espessura = base.espessura; a.entrada = base.entrada; a.fade = base.fade; }
    corte().anotacoes.push(a);
    return a;
  }

  document.addEventListener('pointerdown', function (ev) {
    var cv = ev.target;
    if (!cv || (cv.id !== 'edicao-h' && cv.id !== 'edicao-v') || !ed()) return;
    if (cv.id === 'edicao-h' && !st.geoH) return;
    ev.preventDefault();
    var e = ed();
    if (e.player && !e.player.video.paused) e.player.video.pause();
    var f0 = fracao(cv, ev);
    cv.setPointerCapture(ev.pointerId);
    var mover, soltar;
    var fim = function () {
      cv.removeEventListener('pointermove', mover);
      cv.removeEventListener('pointerup', soltar);
      cv.removeEventListener('pointercancel', soltar);
    };
    if (st.ferramenta) {
      // desenhar uma anotação nova
      var a = novaAnotacao(st.ferramenta, f0);
      st.sel = a.id;
      var tipo = st.ferramenta;
      mover = function (e2) { var f = fracao(cv, e2); a.x2 = f.x; a.y2 = f.y; };
      soltar = function () {
        fim();
        // clique sem arrastar: tamanho padrão
        if (tipo !== 'texto' && Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 0.01) {
          if (tipo === 'seta' || tipo === 'linha') { a.x1 = Math.max(0, a.x2 - 0.12); a.y1 = Math.max(0, a.y2 - 0.12); }
          else { a.x1 -= 0.08; a.y1 -= 0.06; a.x2 += 0.08; a.y2 += 0.06; }
        }
        Object.assign(a, N.normalizar(a));
        st.ferramenta = '';
        salvar();
        desenharPainel();
        if (tipo === 'texto') { var inp = $('[data-anot="' + a.id + '"] [data-an="texto"]'); if (inp) { inp.focus(); inp.select(); } }
      };
      cv.addEventListener('pointermove', mover);
      cv.addEventListener('pointerup', soltar);
      cv.addEventListener('pointercancel', soltar);
      return;
    }
    var h = acertarAnot(f0);
    if (h) {
      var an = h.a, ini = { x1: an.x1, y1: an.y1, x2: an.x2, y2: an.y2 };
      var mudou = st.sel !== an.id;
      st.sel = an.id;
      if (mudou) desenharPainel();
      mover = function (e2) {
        var f = fracao(cv, e2), dx = f.x - f0.x, dy = f.y - f0.y;
        if (h.onde === 'p1') { an.x1 = ini.x1 + dx; an.y1 = ini.y1 + dy; }
        else if (h.onde === 'p2') { an.x2 = ini.x2 + dx; an.y2 = ini.y2 + dy; }
        else { an.x1 = ini.x1 + dx; an.y1 = ini.y1 + dy; an.x2 = ini.x2 + dx; an.y2 = ini.y2 + dy; }
      };
      soltar = function () { fim(); Object.assign(an, N.normalizar(an)); salvar(); };
      cv.addEventListener('pointermove', mover);
      cv.addEventListener('pointerup', soltar);
      cv.addEventListener('pointercancel', soltar);
      return;
    }
    if (st.sel) { st.sel = ''; desenharPainel(); }
    if (cv.id !== 'edicao-h') return;
    // caixa da câmera (horizontal): arrastar move; bolinha do canto dá zoom
    var g = st.geoH.caixa;
    var naBolinha = Math.hypot(f0.px - (g.x + g.w), f0.py - (g.y + g.h)) <= 14;
    var dentro = f0.px >= g.x && f0.px <= g.x + g.w && f0.py >= g.y && f0.py <= g.y + g.h;
    if (!naBolinha && !dentro) return;
    var d = dim(), b0 = caixaH();
    mover = function (e2) {
      var f = fracao(cv, e2), dx = f.x - f0.x, dy = f.y - f0.y;
      st.caixaArrasto = naBolinha ? Cam.limitar({ x: b0.x, y: b0.y, w: b0.w + dx }, d.W, d.H, ASP) : Cam.limitar({ x: b0.x + dx, y: b0.y + dy, w: b0.w }, d.W, d.H, ASP);
    };
    soltar = function () {
      fim();
      var b = st.caixaArrasto;
      st.caixaArrasto = null;
      if (b) gravarPontoH(b);
    };
    cv.addEventListener('pointermove', mover);
    cv.addEventListener('pointerup', soltar);
    cv.addEventListener('pointercancel', soltar);
  });
  document.addEventListener('pointermove', function (ev) {
    var cv = ev.target;
    if (!cv || (cv.id !== 'edicao-h' && cv.id !== 'edicao-v') || !ed() || ev.buttons) return;
    if (cv.id === 'edicao-h' && !st.geoH) return;
    if (st.ferramenta) { cv.style.cursor = 'crosshair'; return; }
    var f = fracao(cv, ev), h = acertarAnot(f);
    if (h) { cv.style.cursor = h.onde === 'corpo' ? 'move' : 'grab'; return; }
    if (cv.id === 'edicao-h') {
      var g = st.geoH.caixa;
      cv.style.cursor = Math.hypot(f.px - (g.x + g.w), f.py - (g.y + g.h)) <= 14 ? 'nwse-resize' : (f.px >= g.x && f.px <= g.x + g.w && f.py >= g.y && f.py <= g.y + g.h) ? 'move' : '';
    } else cv.style.cursor = '';
  });
  // rodinha na visão de edição do horizontal: zoom da câmera em volta do mouse
  document.addEventListener('wheel', function (ev) {
    var cv = ev.target;
    if (!cv || cv.id !== 'edicao-h' || !ed() || !st.geoH) return;
    ev.preventDefault();
    var d = dim(), b = st.caixaArrasto || caixaH(), f = fracao(cv, ev);
    var fator = ev.deltaY > 0 ? 1.08 : 1 / 1.08;
    var w = b.w * fator, h = (w * d.W) / ASP / d.H;
    var cx = Math.max(0, Math.min(1, f.x)), cy = Math.max(0, Math.min(1, f.y));
    // mantém o ponto embaixo do mouse no lugar
    var nx = cx - (cx - b.x) * (w / b.w), ny = cy - (cy - b.y) * (h / b.h);
    st.caixaArrasto = Cam.limitar({ x: nx, y: ny, w: w }, d.W, d.H, ASP);
    clearTimeout(st.tRoda);
    st.tRoda = setTimeout(function () { var bb = st.caixaArrasto; st.caixaArrasto = null; if (bb) gravarPontoH(bb); }, 300);
  }, { passive: false });
  document.addEventListener('keydown', function (ev) {
    if (!ed() || !st.sel) return;
    var alvo = ev.target;
    if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT')) return;
    if (ev.key === 'Delete') { ev.preventDefault(); apagar(st.sel); }
    if (ev.key === 'Escape') { st.sel = ''; st.ferramenta = ''; desenharPainel(); }
  });

  // ================================================================ painel
  var ICONES = { seta: '↗', linha: '╱', retangulo: '▭', circulo: '◯', marcador: '▬', destaque: '◐', texto: 'T' };
  function opcoes(lista, valor) {
    return lista.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(valor) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function painel(qual) {
    return '<section class="painel" id="painel-edicao"><div class="titulo"><h2>Câmera e anotações</h2>' +
      (qual === 'h' ? '<button class="pequeno" data-acao="edEditar" id="botao-editar-h" aria-pressed="false">✏️ Editar no vídeo</button>' : '') + '</div>' +
      (qual === 'h' ?
        '<h3>Câmera (zoom)</h3>' +
        '<div id="trilha-camera-h" class="trilha-pontos" data-trilha-h aria-label="Pontos da câmera do horizontal"></div>' +
        '<div class="linha" id="acoes-camera-h"></div>' +
        '<p class="ajuda">Em <strong>Editar no vídeo</strong>: arraste a caixa amarela, puxe a bolinha ou use a rodinha para dar zoom. Mexer cria um ponto no tempo atual.</p>' :
        '<p class="ajuda">A câmera do vertical fica no quadro da gravação, à esquerda. As anotações valem para o horizontal e para o vertical.</p>') +
      '<h3>Anotações</h3>' +
      '<div class="ferramentas-anot" role="toolbar" aria-label="Desenhar anotação">' +
      N.TIPOS.map(function (t) {
        return '<button class="pequeno ferramenta" data-acao="edFerramenta" data-tipo="' + t + '" aria-pressed="false" title="' + esc(N.NOMES[t]) + ': clique e arraste no vídeo"><span aria-hidden="true">' + ICONES[t] + '</span> ' + esc(N.NOMES[t]) + '</button>';
      }).join('') + '</div>' +
      '<div id="lista-anot" class="coluna" style="gap:6px"></div>' +
      '</section>';
  }

  function linhaAnot(a) {
    var escolhida = a.id === st.sel;
    var corpo = '<div class="anot' + (escolhida ? ' escolhida' : '') + '" data-anot="' + esc(a.id) + '">' +
      '<div class="anot-topo"><button class="pequeno anot-nome" data-acao="edEscolher"><span aria-hidden="true">' + ICONES[a.tipo] + '</span> ' + esc(N.NOMES[a.tipo]) +
      (a.tipo === 'texto' && a.texto ? ': ' + esc(a.texto.slice(0, 24)) : '') + '</button>' +
      '<span class="ajuda mono">' + fmt(a.ini) + ' → ' + fmt(a.fim) + '</span>' +
      '<button class="pequeno icone" data-acao="edApagar" aria-label="Apagar anotação" title="Apagar (Delete)">✕</button></div>';
    if (!escolhida) return corpo + '</div>';
    return corpo +
      '<div class="leg-linha">' +
      '<label class="campo"><span class="rotulo">Aparece em</span><div class="linha" style="flex-wrap:nowrap"><input type="text" class="mono leg-tempo" data-an="ini" value="' + fmt(a.ini) + '"><button class="pequeno" data-acao="edAqui" data-campo-t="ini" title="Usar o ponto atual do vídeo">Aqui</button></div></label>' +
      '<label class="campo"><span class="rotulo">Some em</span><div class="linha" style="flex-wrap:nowrap"><input type="text" class="mono leg-tempo" data-an="fim" value="' + fmt(a.fim) + '"><button class="pequeno" data-acao="edAqui" data-campo-t="fim" title="Usar o ponto atual do vídeo">Aqui</button></div></label></div>' +
      '<div class="leg-linha"><label class="campo"><span class="rotulo">Entra e sai</span><select data-an="entrada">' + opcoes([['fade', 'Com fade'], ['corte', 'Corte seco']], a.entrada) + '</select></label>' +
      (a.entrada === 'fade' ? '<label class="campo"><span class="rotulo">Fade</span><select data-an="fade" data-num>' + opcoes([[150, '0,15 s'], [300, '0,3 s'], [500, '0,5 s'], [800, '0,8 s'], [1200, '1,2 s']], a.fade) + '</select></label>' : '') +
      '<label class="leg-cor"><input type="color" data-an="cor" value="' + esc(a.cor) + '"><span>Cor</span></label></div>' +
      (a.tipo === 'texto' ?
        '<label class="campo"><span class="rotulo">Texto</span><input type="text" data-an="texto" value="' + esc(a.texto) + '" maxlength="200"></label>' +
        '<label class="campo"><span class="rotulo">Tamanho: <span data-eco-an="tamanho">' + a.tamanho + '</span> px</span><input type="range" min="16" max="200" value="' + a.tamanho + '" data-an="tamanho" data-num></label>' :
        a.tipo === 'destaque' ?
          '<label class="campo"><span class="rotulo">Escurecer o resto: <span data-eco-an="opacidade">' + a.opacidade + '</span>%</span><input type="range" min="10" max="95" value="' + a.opacidade + '" data-an="opacidade" data-num></label>' :
          a.tipo === 'marcador' ? '' :
            '<label class="campo"><span class="rotulo">Espessura: <span data-eco-an="espessura">' + a.espessura + '</span> px</span><input type="range" min="1" max="40" value="' + a.espessura + '" data-an="espessura" data-num></label>') +
      '<div class="linha"><button class="pequeno" data-acao="edVer">▶ Ver</button><button class="pequeno" data-acao="edDuplicar">Duplicar</button></div>' +
      '</div>';
  }

  function desenharPainel() {
    var l = $('#lista-anot');
    if (!l || !corte()) return;
    if (!l.contains(document.activeElement) || document.activeElement.type === 'range') {
      var lista = anotacoes();
      l.innerHTML = lista.length ? lista.map(linhaAnot).join('') :
        '<p class="ajuda">Escolha uma ferramenta e arraste no vídeo' + (st.qual === 'h' ? ' (o modo Editar liga sozinho)' : ' (no quadro da gravação, à esquerda)') + '. A anotação começa no ponto atual e dura 3 s; depois ajuste.</p>';
    }
    $$('[data-acao="edFerramenta"]').forEach(function (b) {
      var sim = b.getAttribute('data-tipo') === st.ferramenta;
      b.setAttribute('aria-pressed', String(sim));
      b.classList.toggle('principal', sim);
    });
    $$('[data-acao="edEditar"]').forEach(function (be) {
      be.setAttribute('aria-pressed', String(st.editando));
      be.classList.toggle('principal', st.editando);
      be.textContent = st.editando ? '✓ Ver o resultado' : '✏️ Câmera e anotações';
    });
    desenharTrilha();
  }

  // ---------------------------------------------------------------- trilha da câmera (horizontal)
  function desenharTrilha() {
    var el = $('#trilha-camera-h');
    if (!el || !corte()) return;
    var dur = durMs(), atual = pontoPertoH(relMs());
    el.innerHTML = pontosH().map(function (p, i) {
      return '<button class="ponto-camera' + (i === atual ? ' atual' : '') + '" data-ir-ponto-h="' + i + '" style="left:' + Math.min(100, p.t / dur * 100) + '%" aria-label="Ponto em ' + fmt(p.t) + '" title="' + fmt(p.t) + '"></button>';
    }).join('') + '<span class="lt-cabeca" id="cabeca-camera-h" style="left:' + Math.max(0, Math.min(100, relMs() / dur * 100)) + '%"></span>';
    desenharAcoesCamera();
  }
  function desenharAcoesCamera() {
    var el = $('#acoes-camera-h');
    if (!el || !corte()) return;
    var i = pontoPertoH(relMs()), l = pontosH();
    var chave = i + ':' + l.length + ':' + (i >= 0 ? l[i].trans + l[i].dur : '');
    if (el.getAttribute('data-chave') === chave) return;
    el.setAttribute('data-chave', chave);
    var base = '<button class="pequeno principal" data-acao="edZoomAqui">+ Zoom aqui</button>' +
      '<button class="pequeno" data-acao="edTelaInteira" title="Cria um ponto que volta para a gravação inteira">⤢ Tela inteira aqui</button>';
    if (i < 0) { el.innerHTML = base + '<span class="ajuda">' + l.length + ' ponto(s)</span>'; return; }
    var p = l[i], ultimo = i === l.length - 1;
    el.innerHTML = base + '<span class="rotulo">Ponto em ' + fmt(p.t) + '</span>' +
      (ultimo ? '<span class="ajuda">Último: fica assim até o fim.</span>' :
        '<label class="campo" style="flex-direction:row;align-items:center;gap:6px"><span class="rotulo">Até o próximo:</span><select data-trans-h="' + i + '">' +
        opcoes([['rapido', 'Desliza e para'], ['suave', 'Desliza o tempo todo'], ['corte', 'Corte seco']], p.trans) + '</select></label>' +
        (p.trans === 'rapido' ? '<select data-dur-h="' + i + '" aria-label="Duração do movimento">' + opcoes([[250, 'em 0,25 s'], [500, 'em 0,5 s'], [800, 'em 0,8 s'], [1200, 'em 1,2 s'], [2000, 'em 2 s']], p.dur || 600) + '</select>' : '')) +
      '<button class="pequeno perigo" data-acao="edApagarPonto">Apagar ponto</button>';
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-ir-ponto-h]');
    if (!b || !ed()) return;
    var p = pontosH()[Number(b.getAttribute('data-ir-ponto-h'))];
    if (p) ed().player.ir(ed().corte.ini / 1000 + p.t / 1000 + 0.001, false);
  });
  document.addEventListener('pointerdown', function (ev) {
    var tr = ev.target.closest && ev.target.closest('[data-trilha-h]');
    if (!tr || ev.target.hasAttribute('data-ir-ponto-h') || !ed()) return;
    var r = tr.getBoundingClientRect(), f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    ed().player.ir(ed().corte.ini / 1000 + f * durMs() / 1000, false);
  });

  function apagar(id) {
    corte().anotacoes = anotacoes().filter(function (a) { return a.id !== id; });
    if (st.sel === id) st.sel = '';
    salvar();
    desenharPainel();
  }
  function anotDoEl(el) { var r = el.closest && el.closest('[data-anot]'); return r ? anotacao(r.getAttribute('data-anot')) : null; }

  Object.assign(A.ACOES, {
    edEditar: function () { st.editando = !st.editando; if (!st.editando) st.ferramenta = ''; desenharPainel(); },
    edFerramenta: function (el) {
      var t = el.getAttribute('data-tipo');
      st.ferramenta = st.ferramenta === t ? '' : t;
      if (st.ferramenta && st.qual === 'h') st.editando = true;
      var e = ed();
      if (e && e.player && !e.player.video.paused) e.player.video.pause();
      desenharPainel();
    },
    edEscolher: function (el) {
      var a = anotDoEl(el);
      if (!a) return;
      st.sel = st.sel === a.id ? '' : a.id;
      // vai para um instante em que ela aparece
      if (st.sel) { var t = relMs(); if (t < a.ini || t >= a.fim) ed().player.ir((ed().corte.ini + a.ini + Math.min(400, (a.fim - a.ini) / 2)) / 1000, false); }
      desenharPainel();
    },
    edApagar: function (el) { var a = anotDoEl(el); if (a) apagar(a.id); },
    edAqui: function (el) {
      var a = anotDoEl(el);
      if (!a) return;
      var campo = el.getAttribute('data-campo-t'), t = Math.max(0, Math.min(durMs(), relMs()));
      if (campo === 'ini') { a.ini = t; if (a.fim < t + 100) a.fim = Math.min(durMs(), t + 3000); }
      else { a.fim = Math.max(t, a.ini + 100); }
      Object.assign(a, N.normalizar(a));
      corte().anotacoes = N.normalizarLista(anotacoes());
      salvar();
      desenharPainel();
    },
    edVer: function (el) {
      var a = anotDoEl(el), e = ed();
      if (!a || !e) return;
      e.player.tocarTrecho((e.corte.ini + Math.max(0, a.ini - 800)) / 1000, (e.corte.ini + Math.min(durMs(), a.fim + 800)) / 1000);
    },
    edDuplicar: function (el) {
      var a = anotDoEl(el);
      if (!a || anotacoes().length >= N.MAX) return;
      var b = N.normalizar(Object.assign({}, a, { id: '', x1: a.x1 + 0.03, y1: a.y1 + 0.03, x2: a.x2 + 0.03, y2: a.y2 + 0.03 }));
      corte().anotacoes.push(b);
      st.sel = b.id;
      salvar();
      desenharPainel();
    },
    edZoomAqui: function () {
      var d = dim(), b = caixaH();
      // sem zoom ainda: começa pela metade da tela, no meio
      var cheia = Cam.inteira(d.W, d.H, ASP);
      if (Math.abs(b.w - cheia.w) < 0.002) b = { x: 0.25, y: 0.25, w: cheia.w / 2 };
      gravarPontoH(b);
      if (!st.editando) { st.editando = true; desenharPainel(); }
    },
    edTelaInteira: function () { var d = dim(); gravarPontoH(Cam.inteira(d.W, d.H, ASP)); },
    edApagarPonto: function () {
      var i = pontoPertoH(relMs());
      if (i < 0) return;
      var d = dim(), l = pontosH().slice();
      l.splice(i, 1);
      corte().horizontal.camera = l.length ? Cam.normalizar(l, d.W, d.H, ASP) : [];
      desenharTrilha();
      salvar();
    },
  });

  function aoEditar(ev) {
    var el = ev.target, campo = el.getAttribute && el.getAttribute('data-an');
    if (!campo || !ed()) return;
    var a = anotDoEl(el);
    if (!a) return;
    if (campo === 'ini' || campo === 'fim') {
      if (ev.type !== 'change') return;
      var t = A.Cortes.lerTempo(el.value);
      if (t == null) { A.aviso('Use o formato minutos:segundos, por exemplo 0:12.5', 'erro'); desenharPainel(); return; }
      a[campo] = Math.round(t * 1000);
      if (campo === 'ini' && a.fim < a.ini + 100) a.fim = a.ini + 3000;
      Object.assign(a, N.normalizar(a));
      corte().anotacoes = N.normalizarLista(anotacoes());
      salvar();
      desenharPainel();
      return;
    }
    a[campo] = el.hasAttribute('data-num') ? Number(el.value) : el.value;
    var eco = $('[data-eco-an="' + campo + '"]');
    if (eco) eco.textContent = el.value;
    Object.assign(a, N.normalizar(a));
    salvar();
    if (campo === 'entrada' || (campo === 'texto' && ev.type === 'change')) desenharPainel();
  }
  document.addEventListener('input', aoEditar);
  document.addEventListener('change', function (ev) {
    aoEditar(ev);
    var el = ev.target;
    if (!ed() || !el.getAttribute) return;
    var it = el.getAttribute('data-trans-h'), idur = el.getAttribute('data-dur-h');
    if (it != null) { var p = pontosH()[Number(it)]; if (p) { p.trans = el.value; if (p.trans === 'rapido' && !p.dur) p.dur = 500; salvar(); desenharAcoesCamera(); } }
    if (idur != null) { var p2 = pontosH()[Number(idur)]; if (p2) { p2.dur = Number(el.value); salvar(); } }
  });

  // ================================================================ exportação
  /** PNGs das anotações no tamanho da gravação (iguais para todos os formatos). */
  function pngsAnotacoes(c, sessao) {
    var lista = (c && c.anotacoes) || [];
    if (!lista.length) return [];
    var e = ed();
    var f = (sessao && sessao.fonte) || (e && e.s.fonte) || {};
    var v = e && e.player && e.player.video;
    var W = (v && v.videoWidth) || f.largura || 1920, H = (v && v.videoHeight) || f.altura || 1080;
    return lista.map(function (a) {
      var l = N.limites(medidor(), a, W, H);
      var x = Math.floor(l.x), y = Math.floor(l.y);
      var cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.ceil(l.x + l.w) - x);
      cv.height = Math.max(1, Math.ceil(l.y + l.h) - y);
      var ctx = cv.getContext('2d');
      ctx.translate(-x, -y);
      N.desenhar(ctx, a, W, H, 1);
      return { png: cv.toDataURL('image/png'), x: x, y: y, ini: a.ini, fim: a.fim, entrada: a.entrada, fade: a.fade };
    });
  }

  // ================================================================ ciclo de vida
  function montar(qual) {
    sair();
    garantir(corte());
    st.qual = qual;
    st.editando = false;
    st.ferramenta = '';
    st.sel = '';
    desenharPainel();
    st.raf = requestAnimationFrame(laco);
  }
  function sair() {
    if (st.raf) cancelAnimationFrame(st.raf);
    st.raf = 0;
    st.arrasto = null;
    st.caixaArrasto = null;
    st.geoH = null;
  }
  function tique() {
    var cab = $('#cabeca-camera-h');
    if (cab) cab.style.left = Math.max(0, Math.min(100, relMs() / durMs() * 100)) + '%';
    desenharAcoesCamera();
  }

  A.Edicao = { painel: painel, montar: montar, sair: sair, tique: tique, desenharNaPrevia: desenharNaPrevia, pngsAnotacoes: pngsAnotacoes, garantir: garantir, _st: st };
})();
