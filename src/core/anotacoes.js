/* Anotações dos cortes (para tutoriais): seta, linha, retângulo, círculo, marca-texto,
   destaque (escurece o resto da tela) e texto. Ficam presas ao vídeo original (frações da
   imagem da gravação), então acompanham o zoom da câmera no horizontal e no vertical.
   Cada uma tem início e fim (ms desde o começo do corte) e entra/sai com fade ou corte seco.
   O mesmo desenho serve para a prévia e para os PNGs da exportação. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Anotacoes = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TIPOS = ['seta', 'linha', 'retangulo', 'circulo', 'marcador', 'destaque', 'texto'];
  var NOMES = { seta: 'Seta', linha: 'Linha', retangulo: 'Retângulo', circulo: 'Círculo', marcador: 'Marca-texto', destaque: 'Destaque', texto: 'Texto' };
  var MAX = 80;

  function num(v, a, b, p) { v = Number(v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : p; }
  function cor(v, p) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : p; }
  function novoId() { return Math.random().toString(36).slice(2, 10); }

  function normalizar(a) {
    a = a && typeof a === 'object' ? a : {};
    var tipo = TIPOS.indexOf(a.tipo) >= 0 ? a.tipo : 'seta';
    var ini = Math.max(0, Math.round(num(a.ini, 0, 86400000, 0)));
    var fim = Math.round(num(a.fim, 0, 86400000, ini + 3000));
    if (fim < ini + 100) fim = ini + 100;
    return {
      id: typeof a.id === 'string' && /^[\w-]{1,24}$/.test(a.id) ? a.id : novoId(),
      tipo: tipo,
      ini: ini, fim: fim,
      entrada: a.entrada === 'corte' ? 'corte' : 'fade',
      fade: Math.round(num(a.fade, 50, 3000, 300)),
      cor: cor(a.cor, tipo === 'marcador' ? '#FFE14D' : '#F0B44C'),
      espessura: Math.round(num(a.espessura, 1, 40, 8)),          // px num vídeo de 1080 de altura
      opacidade: Math.round(num(a.opacidade, 10, 95, 60)),        // destaque: quanto escurece o resto
      tamanho: Math.round(num(a.tamanho, 16, 200, 56)),           // texto
      texto: typeof a.texto === 'string' ? a.texto.slice(0, 200) : (tipo === 'texto' ? 'Clique aqui' : ''),
      x1: num(a.x1, -0.2, 1.2, 0.4), y1: num(a.y1, -0.2, 1.2, 0.4),
      x2: num(a.x2, -0.2, 1.2, 0.6), y2: num(a.y2, -0.2, 1.2, 0.6),
    };
  }
  function normalizarLista(l) {
    var ids = {};
    return (Array.isArray(l) ? l : []).slice(0, MAX).map(normalizar).filter(function (a) {
      if (ids[a.id]) return false;
      ids[a.id] = true;
      return true;
    }).sort(function (a, b) { return a.ini - b.ini; });
  }

  /** Opacidade (0 a 1) no instante t (ms desde o começo do corte). */
  function alfaEm(a, t) {
    if (t < a.ini || t >= a.fim) return 0;
    if (a.entrada === 'corte') return 1;
    var f = Math.min(a.fade, (a.fim - a.ini) / 2);
    return Math.max(0, Math.min(1, (t - a.ini) / f, (a.fim - t) / f));
  }

  function caixa(a, W, H) {
    var x = Math.min(a.x1, a.x2) * W, y = Math.min(a.y1, a.y2) * H;
    return { x: x, y: y, w: Math.abs(a.x2 - a.x1) * W, h: Math.abs(a.y2 - a.y1) * H };
  }
  function fonte(a, px) { return 'bold ' + px.toFixed(1) + 'px "Segoe UI", Arial, sans-serif'; }
  function retArredondado(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function rgba(hex, a) {
    return 'rgba(' + parseInt(hex.slice(1, 3), 16) + ',' + parseInt(hex.slice(3, 5), 16) + ',' + parseInt(hex.slice(5, 7), 16) + ',' + a + ')';
  }

  /** Medidas do texto (caixa com fundo) em px da fonte, centrado em x1,y1. */
  function medidasTexto(ctx, a, W, H) {
    var k = H / 1080, px = a.tamanho * k;
    ctx.save();
    ctx.font = fonte(a, px);
    var w = ctx.measureText(a.texto || ' ').width;
    ctx.restore();
    var pad = px * 0.35;
    return { x: a.x1 * W - w / 2 - pad, y: a.y1 * H - px * 0.6 - pad, w: w + pad * 2, h: px * 1.2 + pad * 2, px: px };
  }

  /** Retângulo (px da fonte) que contém o desenho: para recortar o PNG da exportação. */
  function limites(ctx, a, W, H) {
    if (a.tipo === 'destaque') return { x: 0, y: 0, w: W, h: H };
    var k = H / 1080, m = a.espessura * k * 3 + 6;
    if (a.tipo === 'texto') { var t = medidasTexto(ctx, a, W, H); return { x: t.x - 6, y: t.y - 6, w: t.w + 12, h: t.h + 12 }; }
    var c = caixa(a, W, H);
    return { x: c.x - m, y: c.y - m, w: c.w + 2 * m, h: c.h + 2 * m };
  }

  /** Desenha a anotação num canvas cujas coordenadas são as do vídeo original (W×H px). */
  function desenhar(ctx, a, W, H, alfa) {
    if (alfa == null) alfa = 1;
    if (alfa <= 0) return;
    var k = H / 1080, lw = a.espessura * k;
    var x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H;
    var c = caixa(a, W, H);
    ctx.save();
    ctx.globalAlpha = alfa;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // contorno escuro por baixo: a marca aparece em qualquer fundo
    var sombra = function (desenho) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = lw + Math.max(2, lw * 0.6);
      desenho();
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = a.cor;
      ctx.lineWidth = lw;
      desenho();
      ctx.stroke();
    };
    if (a.tipo === 'seta' || a.tipo === 'linha') {
      var ang = Math.atan2(y2 - y1, x2 - x1), cab = Math.max(lw * 3.2, 14 * k);
      var fimLinha = a.tipo === 'seta' ? { x: x2 - Math.cos(ang) * cab * 0.6, y: y2 - Math.sin(ang) * cab * 0.6 } : { x: x2, y: y2 };
      sombra(function () { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(fimLinha.x, fimLinha.y); });
      if (a.tipo === 'seta') {
        var ponta = function () {
          ctx.beginPath();
          ctx.moveTo(x2, y2);
          ctx.lineTo(x2 - Math.cos(ang - 0.45) * cab, y2 - Math.sin(ang - 0.45) * cab);
          ctx.lineTo(x2 - Math.cos(ang + 0.45) * cab, y2 - Math.sin(ang + 0.45) * cab);
          ctx.closePath();
        };
        ctx.save();
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = Math.max(2, lw * 0.6);
        ponta();
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = a.cor;
        ponta();
        ctx.fill();
      }
    } else if (a.tipo === 'retangulo') {
      sombra(function () { ctx.beginPath(); retArredondado(ctx, c.x, c.y, c.w, c.h, lw * 1.5); });
    } else if (a.tipo === 'circulo') {
      sombra(function () { ctx.beginPath(); ctx.ellipse(c.x + c.w / 2, c.y + c.h / 2, Math.max(1, c.w / 2), Math.max(1, c.h / 2), 0, 0, Math.PI * 2); });
    } else if (a.tipo === 'marcador') {
      ctx.fillStyle = rgba(a.cor, 0.38);
      ctx.beginPath();
      retArredondado(ctx, c.x, c.y, c.w, c.h, Math.min(c.h * 0.2, 12 * k));
      ctx.fill();
    } else if (a.tipo === 'destaque') {
      // escurece tudo menos o retângulo
      ctx.fillStyle = 'rgba(0,0,0,' + (a.opacidade / 100) + ')';
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      retArredondado(ctx, c.x, c.y, c.w, c.h, 14 * k);
      ctx.fill('evenodd');
      ctx.strokeStyle = a.cor;
      ctx.lineWidth = Math.max(2, lw * 0.5);
      ctx.beginPath();
      retArredondado(ctx, c.x, c.y, c.w, c.h, 14 * k);
      ctx.stroke();
    } else if (a.tipo === 'texto') {
      var t = medidasTexto(ctx, a, W, H);
      ctx.fillStyle = 'rgba(12,13,16,0.78)';
      ctx.beginPath();
      retArredondado(ctx, t.x, t.y, t.w, t.h, t.px * 0.3);
      ctx.fill();
      ctx.strokeStyle = a.cor;
      ctx.lineWidth = Math.max(2, t.px * 0.06);
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = fonte(a, t.px);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(a.texto, a.x1 * W, a.y1 * H);
    }
    ctx.restore();
  }

  /** Para editar com o mouse: onde a anotação foi clicada ('p1', 'p2' = pontas, 'corpo') ou null. */
  function acertar(ctx, a, W, H, px, py, raio) {
    raio = raio || 10;
    if (a.tipo !== 'texto') {
      if (Math.hypot(px - a.x2 * W, py - a.y2 * H) <= raio) return 'p2';
      if (Math.hypot(px - a.x1 * W, py - a.y1 * H) <= raio) return 'p1';
    }
    if (a.tipo === 'seta' || a.tipo === 'linha') {
      var x1 = a.x1 * W, y1 = a.y1 * H, x2 = a.x2 * W, y2 = a.y2 * H;
      var L = Math.hypot(x2 - x1, y2 - y1) || 1;
      var u = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / (L * L)));
      var d = Math.hypot(px - (x1 + u * (x2 - x1)), py - (y1 + u * (y2 - y1)));
      return d <= Math.max(raio, a.espessura * H / 1080) ? 'corpo' : null;
    }
    if (a.tipo === 'texto') {
      var t = medidasTexto(ctx, a, W, H);
      return px >= t.x && px <= t.x + t.w && py >= t.y && py <= t.y + t.h ? 'corpo' : null;
    }
    var c = caixa(a, W, H);
    if (a.tipo === 'retangulo' || a.tipo === 'circulo' || a.tipo === 'destaque') {
      // só a borda (dentro dá para clicar em outras coisas), com folga
      var dentro = px >= c.x - raio && px <= c.x + c.w + raio && py >= c.y - raio && py <= c.y + c.h + raio;
      var miolo = px > c.x + raio && px < c.x + c.w - raio && py > c.y + raio && py < c.y + c.h - raio;
      return dentro && !miolo ? 'corpo' : null;
    }
    return px >= c.x && px <= c.x + c.w && py >= c.y && py <= c.y + c.h ? 'corpo' : null;
  }

  return {
    TIPOS: TIPOS, NOMES: NOMES, MAX: MAX,
    normalizar: normalizar, normalizarLista: normalizarLista, alfaEm: alfaEm,
    desenhar: desenhar, limites: limites, acertar: acertar, novoId: novoId,
  };
});
