/* Identidade visual: camadas (imagens e textos) por cima do vídeo, imagem final dos cortes,
   fundo do vertical "tela inteira" e a música rápida dos cortes (volume por pontos no tempo).
   O mesmo código roda no app (validar), na interface (prévia e PNGs da exportação) e no overlay do OBS. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Identidade = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FONTES = ['Arial Black', 'Arial', 'Segoe UI', 'Impact', 'Verdana', 'Trebuchet MS', 'Georgia', 'Comic Sans MS', 'Courier New'];
  var MAX_CAMADAS = 12;
  var IMAGEM = /^[A-Za-z0-9._-]{1,120}$/;

  function num(v, a, b, p) { v = Number(v); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : p; }
  function cor(v, p) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : p; }
  function bool(v, p) { return typeof v === 'boolean' ? v : p; }
  function txt(v, p, max) { return typeof v === 'string' ? v.slice(0, max) : p; }
  function imagem(v) { return typeof v === 'string' && IMAGEM.test(v) && v.charAt(0) !== '.' ? v : ''; }
  function novoId() { return Math.random().toString(36).slice(2, 10); }

  // posição: centro (frações do quadro) e largura (fração da largura do quadro)
  var POS_PADRAO = { h: { x: 0.9, y: 0.1, w: 0.12 }, v: { x: 0.82, y: 0.06, w: 0.26 } };
  function normalizarPos(p, qual, d) {
    d = d || POS_PADRAO[qual];
    p = p && typeof p === 'object' ? p : {};
    return { x: num(p.x, -0.5, 1.5, d.x), y: num(p.y, -0.5, 1.5, d.y), w: num(p.w, 0.02, 1.5, d.w) };
  }

  function normalizarCamada(c) {
    c = c && typeof c === 'object' ? c : {};
    var tipo = c.tipo === 'texto' ? 'texto' : 'imagem';
    return {
      id: typeof c.id === 'string' && /^[\w-]{1,24}$/.test(c.id) ? c.id : novoId(),
      tipo: tipo,
      nome: txt(c.nome, '', 40).trim() || (tipo === 'texto' ? 'Texto' : 'Imagem'),
      imagem: imagem(c.imagem),
      texto: txt(c.texto, tipo === 'texto' ? 'discord.gg/minha-mesa' : '', 200),
      fonte: FONTES.indexOf(c.fonte) >= 0 ? c.fonte : 'Arial Black',
      negrito: bool(c.negrito, true),
      corTexto: cor(c.corTexto, '#FFFFFF'),
      corContorno: cor(c.corContorno, '#000000'),
      contorno: Math.round(num(c.contorno, 0, 30, 6)),
      sombra: Math.round(num(c.sombra, 0, 30, 3)),
      opacidade: Math.round(num(c.opacidade, 0, 100, 100)),
      aoVivo: bool(c.aoVivo, false),   // no overlay do OBS (e então já sai na gravação)
      cortes: bool(c.cortes, true),    // desenhada nos cortes exportados
      h: normalizarPos(c.h, 'h'),
      v: normalizarPos(c.v, 'v'),
    };
  }
  function normalizarIdentidade(i) {
    i = i && typeof i === 'object' ? i : {};
    var ids = {};
    var camadas = (Array.isArray(i.camadas) ? i.camadas : []).slice(0, MAX_CAMADAS).map(normalizarCamada).filter(function (c) {
      if (ids[c.id]) return false;
      ids[c.id] = true;
      return true;
    });
    return { camadas: camadas };
  }

  var FINAL_PADRAO = { ativo: false, imagem: '', duracao: 4, fade: 1, cor: '#000000', ajuste: 'caber' };
  function normalizarFinalUm(f) {
    f = f && typeof f === 'object' ? f : {};
    var fade = num(f.fade, 0, 5, FINAL_PADRAO.fade);
    return {
      ativo: bool(f.ativo, false),
      imagem: imagem(f.imagem),
      duracao: Math.round(num(f.duracao, 0.5, 20, FINAL_PADRAO.duracao) * 10) / 10,
      fade: Math.round(fade * 10) / 10,
      cor: cor(f.cor, FINAL_PADRAO.cor),
      ajuste: f.ajuste === 'cobrir' ? 'cobrir' : 'caber',
    };
  }
  function normalizarFinal(f) {
    f = f && typeof f === 'object' ? f : {};
    return { h: normalizarFinalUm(f.h), v: normalizarFinalUm(f.v) };
  }

  /** Fundo do vertical "tela inteira": desfocado (o próprio vídeo), cor ou imagem; e onde fica o vídeo. */
  function normalizarFundo(f) {
    f = f && typeof f === 'object' ? f : {};
    return {
      tipo: ['desfoque', 'cor', 'imagem'].indexOf(f.tipo) >= 0 ? f.tipo : 'desfoque',
      cor: cor(f.cor, '#101217'),
      imagem: imagem(f.imagem),
      y: num(f.y, 0, 1, 0.5),            // centro do vídeo (fração da altura)
      escala: num(f.escala, 0.4, 3, 1),  // 1 = largura inteira
    };
  }

  /** Música rápida de um corte. pontos: [{ t (ms desde o começo do corte), v (% do volume geral) }] */
  function normalizarMusica(m) {
    m = m && typeof m === 'object' ? m : {};
    var pontos = (Array.isArray(m.pontos) ? m.pontos : []).slice(0, 60)
      .filter(function (p) { return p && Number.isFinite(Number(p.t)); })
      .map(function (p) { return { t: Math.max(0, Math.round(Number(p.t))), v: Math.round(num(p.v, 0, 200, 100)) }; })
      .sort(function (a, b) { return a.t - b.t; });
    return {
      faixa: typeof m.faixa === 'string' && /^[\w-]{1,40}$/.test(m.faixa) ? m.faixa : '',
      inicio: Math.round(num(m.inicio, 0, 36000, 0) * 10) / 10,   // de onde a música começa (s)
      volume: Math.round(num(m.volume, 0, 200, 35)),
      fadeIn: Math.round(num(m.fadeIn, 0, 20, 1) * 10) / 10,
      fadeOut: Math.round(num(m.fadeOut, 0, 20, 2) * 10) / 10,
      pontos: pontos,
    };
  }

  /** Volume (fator) da curva no instante t (ms desde o começo do corte), sem os fades. */
  function curvaEm(pontos, t) {
    if (!pontos || !pontos.length) return 1;
    if (t <= pontos[0].t) return pontos[0].v / 100;
    for (var i = 1; i < pontos.length; i++) {
      var a = pontos[i - 1], b = pontos[i];
      if (t <= b.t) return (a.v + (b.v - a.v) * (b.t === a.t ? 1 : (t - a.t) / (b.t - a.t))) / 100;
    }
    return pontos[pontos.length - 1].v / 100;
  }
  /** Volume final (fator) no instante t (ms), com volume geral e fades; total = duração do vídeo (ms). */
  function ganhoEm(m, t, total) {
    var g = (m.volume / 100) * curvaEm(m.pontos, t);
    if (m.fadeIn > 0 && t < m.fadeIn * 1000) g *= Math.max(0, t / (m.fadeIn * 1000));
    if (m.fadeOut > 0 && total && t > total - m.fadeOut * 1000) g *= Math.max(0, (total - t) / (m.fadeOut * 1000));
    return g;
  }
  /** Expressão do FFmpeg (variável t em segundos) da curva × volume geral; deslocMs move os pontos. */
  function exprCurva(m, deslocMs) {
    var base = (m.volume / 100);
    var p = (m.pontos || []).map(function (x) { return { t: Math.max(0, (x.t - (deslocMs || 0)) / 1000), v: x.v / 100 * base }; });
    var f = function (n) { return (Math.round(n * 10000) / 10000).toString(); };
    if (!p.length) return f(base);
    var e = f(p[p.length - 1].v);
    for (var i = p.length - 1; i >= 1; i--) {
      var a = p[i - 1], b = p[i];
      var trecho = b.t > a.t ? f(a.v) + '+(' + f(b.v - a.v) + ')*(t-' + f(a.t) + ')/' + f(b.t - a.t) : f(b.v);
      e = 'if(lt(t,' + f(b.t) + '),' + trecho + ',' + e + ')';
    }
    return 'if(lt(t,' + f(p[0].t) + '),' + f(p[0].v) + ',' + e + ')';
  }

  // ---------------------------------------------------------------- desenho (canvas)

  function fonteTexto(c, px) { return (c.negrito ? 'bold ' : '') + px.toFixed(2) + 'px "' + c.fonte + '"'; }
  var BASE = 100; // px em que o texto é medido; depois escala para a largura pedida

  /** Tamanho natural de uma camada (px): imagem carregada ou texto medido em BASE px. */
  function natural(ctx, c, img) {
    if (c.tipo === 'texto') {
      ctx.save();
      ctx.font = fonteTexto(c, BASE);
      var w = ctx.measureText(c.texto || ' ').width;
      ctx.restore();
      var folga = (c.contorno + c.sombra) * 2;
      return { w: Math.max(10, w + folga), h: BASE * 1.25 + folga };
    }
    if (img && (img.naturalWidth || img.width)) return { w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
    return { w: 400, h: 400 };
  }

  /** Retângulo (px, canto de cima à esquerda) da camada num quadro W×H. */
  function retangulo(ctx, c, W, H, qual, img) {
    var p = c[qual] || POS_PADRAO[qual];
    var n = natural(ctx, c, img);
    var largura = p.w * W, altura = largura * n.h / n.w;
    return { x: p.x * W - largura / 2, y: p.y * H - altura / 2, largura: largura, altura: altura, escala: largura / n.w };
  }

  /** Desenha a camada; devolve o retângulo. img: imagem carregada (camadas de imagem). */
  function desenharCamada(ctx, c, W, H, qual, img) {
    var r = retangulo(ctx, c, W, H, qual, img);
    ctx.save();
    ctx.globalAlpha = c.opacidade / 100;
    if (c.tipo === 'texto') {
      var s = r.escala;
      ctx.translate(r.x, r.y);
      ctx.scale(s, s);
      ctx.font = fonteTexto(c, BASE);
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      var n = natural(ctx, c, null);
      var cx = n.w / 2, cy = n.h / 2;
      if (c.sombra > 0) {
        ctx.fillStyle = ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        if (c.contorno > 0) { ctx.lineWidth = c.contorno * 2; ctx.strokeText(c.texto, cx + c.sombra, cy + c.sombra); }
        ctx.fillText(c.texto, cx + c.sombra, cy + c.sombra);
      }
      if (c.contorno > 0) { ctx.strokeStyle = c.corContorno; ctx.lineWidth = c.contorno * 2; ctx.strokeText(c.texto, cx, cy); }
      ctx.fillStyle = c.corTexto;
      ctx.fillText(c.texto, cx, cy);
    } else if (img && (img.naturalWidth || img.width)) {
      ctx.drawImage(img, r.x, r.y, r.largura, r.altura);
    }
    ctx.restore();
    return r;
  }

  /** Imagem final composta num quadro W×H (cor de fundo + imagem caber/cobrir). */
  function desenharFinal(ctx, f, W, H, img) {
    ctx.save();
    ctx.fillStyle = f.cor || '#000000';
    ctx.fillRect(0, 0, W, H);
    if (img && (img.naturalWidth || img.width)) {
      var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      var e = f.ajuste === 'cobrir' ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
      ctx.drawImage(img, (W - iw * e) / 2, (H - ih * e) / 2, iw * e, ih * e);
    }
    ctx.restore();
  }
  /** Fundo do "tela inteira" (cor ou imagem cobrindo o quadro). */
  function desenharFundoImagem(ctx, f, W, H, img) {
    desenharFinal(ctx, { cor: f.cor, ajuste: 'cobrir' }, W, H, f.tipo === 'imagem' ? img : null);
  }
  /** Onde fica o vídeo (16:9 ou o que for) no "tela inteira": { x, y, largura, altura } px. */
  function quadroVideoInteira(f, W, H, vw, vh) {
    var largura = W * f.escala, altura = largura * (vh || 9) / (vw || 16);
    return { x: (W - largura) / 2, y: f.y * H - altura / 2, largura: largura, altura: altura };
  }

  return {
    FONTES: FONTES, MAX_CAMADAS: MAX_CAMADAS, POS_PADRAO: POS_PADRAO, FINAL_PADRAO: FINAL_PADRAO,
    normalizarCamada: normalizarCamada, normalizarIdentidade: normalizarIdentidade, normalizarPos: normalizarPos,
    normalizarFinal: normalizarFinal, normalizarFinalUm: normalizarFinalUm, normalizarFundo: normalizarFundo, normalizarMusica: normalizarMusica,
    curvaEm: curvaEm, ganhoEm: ganhoEm, exprCurva: exprCurva,
    natural: natural, retangulo: retangulo, desenharCamada: desenharCamada, desenharFinal: desenharFinal,
    desenharFundoImagem: desenharFundoImagem, quadroVideoInteira: quadroVideoInteira, novoId: novoId,
  };
});
