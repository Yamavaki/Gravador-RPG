/* Legendas: estilo, divisão em blocos (frase inteira ou poucas palavras por vez, estilo TikTok),
   quebra de linha e o arquivo .ass que o FFmpeg (libass) queima no vídeo.
   O mesmo código roda na interface (prévia) e no Node (testes, deslocar tempos na exportação). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Legendas = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FONTES = ['Arial Black', 'Arial', 'Segoe UI', 'Impact', 'Verdana', 'Trebuchet MS', 'Georgia', 'Comic Sans MS', 'Courier New'];

  // o "tamanho" do ASS (libass) é a altura da linha (ascendente + descendente da fonte), não o
  // tamanho em em do navegador; esta é a fração do em de cada fonte (para a prévia bater com o vídeo)
  var EM = {
    'Arial Black': 0.71, Arial: 0.87, 'Segoe UI': 0.75, Impact: 0.82, Verdana: 0.82,
    'Trebuchet MS': 0.86, Georgia: 0.88, 'Comic Sans MS': 0.72, 'Courier New': 0.88,
  };
  /** Fonte do canvas que desenha igual ao libass com este tamanho (px de altura de linha). */
  function fonteCanvas(estilo, tam) {
    return (estilo.negrito ? 'bold ' : '') + (tam * (EM[estilo.fonte] || 0.85)).toFixed(2) + 'px "' + estilo.fonte + '"';
  }

  var ESTILO_PADRAO = {
    fonte: 'Arial Black',
    tamanho: 64,            // px num quadro de 1080 (altura no horizontal, largura no vertical)
    negrito: true,
    maiusculas: false,
    corTexto: '#FFFFFF',
    corPersonagem: true,    // usa a cor de quem fala
    corContorno: '#000000',
    contorno: 5,            // px
    sombra: 2,              // px
    fundo: false,           // caixa atrás do texto (no lugar do contorno)
    corFundo: '#000000',
    opacidadeFundo: 60,     // %
    palavras: 3,            // 0 = frase inteira; 1 a 8 = tantas palavras por vez
    destaque: true,         // a palavra falada agora muda de cor
    corDestaque: '#F0B44C',
    mostrarNome: false,     // "Kael: ..."
  };
  // posição: centro do bloco (frações do quadro) e largura máxima (fração da largura)
  var POS_PADRAO = { h: { x: 0.5, y: 0.82, w: 0.8 }, v: { x: 0.5, y: 0.68, w: 0.86 } };

  function num(v, a, b, p) { v = Number(v); return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : p; }
  function cor(v, p) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : p; }
  function bool(v, p) { return typeof v === 'boolean' ? v : p; }

  function normalizarEstilo(e) {
    e = e && typeof e === 'object' ? e : {};
    var p = ESTILO_PADRAO;
    return {
      fonte: FONTES.indexOf(e.fonte) >= 0 ? e.fonte : p.fonte,
      tamanho: Math.round(num(e.tamanho, 16, 240, p.tamanho)),
      negrito: bool(e.negrito, p.negrito),
      maiusculas: bool(e.maiusculas, p.maiusculas),
      corTexto: cor(e.corTexto, p.corTexto),
      corPersonagem: bool(e.corPersonagem, p.corPersonagem),
      corContorno: cor(e.corContorno, p.corContorno),
      contorno: Math.round(num(e.contorno, 0, 20, p.contorno)),
      sombra: Math.round(num(e.sombra, 0, 20, p.sombra)),
      fundo: bool(e.fundo, p.fundo),
      corFundo: cor(e.corFundo, p.corFundo),
      opacidadeFundo: Math.round(num(e.opacidadeFundo, 0, 100, p.opacidadeFundo)),
      palavras: Math.round(num(e.palavras, 0, 8, p.palavras)),
      destaque: bool(e.destaque, p.destaque),
      corDestaque: cor(e.corDestaque, p.corDestaque),
      mostrarNome: bool(e.mostrarNome, p.mostrarNome),
    };
  }
  function normalizarPos(p, qual) {
    var d = POS_PADRAO[qual];
    p = p && typeof p === 'object' ? p : {};
    return { x: num(p.x, 0, 1, d.x), y: num(p.y, 0, 1, d.y), w: num(p.w, 0.1, 1, d.w) };
  }

  /**
   * Segmentos ({ini, fim, texto, chave}, ms) → blocos que aparecem na tela.
   * Com "palavras" > 0, cada segmento vira pedaços de N palavras; o tempo de cada palavra
   * é proporcional ao tamanho dela (a transcrição dá o tempo da frase).
   */
  function blocos(segmentos, estilo) {
    var n = estilo.palavras | 0;
    var out = [];
    (segmentos || []).forEach(function (s) {
      var texto = String(s.texto || '').replace(/\s+/g, ' ').trim();
      if (!texto || !(s.fim > s.ini)) return;
      var ps = texto.split(' ');
      var pesos = ps.map(function (w) { return w.length + 1; });
      var total = pesos.reduce(function (a, b) { return a + b; }, 0);
      var dur = s.fim - s.ini, acc = 0;
      var palavras = ps.map(function (w, i) {
        var ini = s.ini + dur * acc / total;
        acc += pesos[i];
        return { texto: w, ini: ini, fim: s.ini + dur * acc / total };
      });
      var tam = n > 0 ? n : palavras.length;
      for (var i = 0; i < palavras.length; i += tam) {
        var grupo = palavras.slice(i, i + tam);
        out.push({ ini: grupo[0].ini, fim: grupo[grupo.length - 1].fim, palavras: grupo, chave: s.chave || '', primeiro: i === 0 });
      }
    });
    return out;
  }

  /** Quebra as palavras em linhas que caibam em maxLargura (medir(texto) → largura). */
  function quebrar(palavras, maxLargura, medir) {
    var linhas = [], atual = [];
    palavras.forEach(function (w, i) {
      var tenta = atual.concat([w]);
      if (atual.length && medir(tenta.map(function (x) { return x.texto; }).join(' ')) > maxLargura) {
        linhas.push(atual);
        atual = [w];
      } else atual = tenta;
    });
    if (atual.length) linhas.push(atual);
    return linhas;
  }

  /** Texto que aparece de cada palavra (maiúsculas, nome de quem fala). */
  function textoPalavra(w, estilo) { return estilo.maiusculas ? w.texto.toLocaleUpperCase('pt-BR') : w.texto; }

  /** "#RRGGBB" + opacidade (0-100) → "&HAABBGGRR" do ASS (no ASS, 00 = opaco). */
  function corAss(hex, opacidade) {
    var h = String(hex || '#FFFFFF').replace('#', '');
    var a = Math.round(255 * (1 - (opacidade == null ? 100 : opacidade) / 100));
    var p2 = function (n) { return ('0' + n.toString(16).toUpperCase()).slice(-2); };
    return '&H' + p2(a) + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2);
  }
  function tempoAss(ms) {
    ms = Math.max(0, Math.round(ms / 10) * 10);
    var cs = Math.floor(ms / 10) % 100, s = Math.floor(ms / 1000) % 60, m = Math.floor(ms / 60000) % 60, h = Math.floor(ms / 3600000);
    var d = function (n) { return (n < 10 ? '0' : '') + n; };
    return h + ':' + d(m) + ':' + d(s) + '.' + d(cs);
  }
  function escaparAss(t) { return String(t).replace(/\\/g, '/').replace(/[{}]/g, function (c) { return c === '{' ? '(' : ')'; }); }

  /**
   * Monta o .ass. o: {
   *   W, H, estilo, pos {x,y,w}, k (escala do tamanho: altura/1080 ou largura/1080),
   *   segmentos [{ini, fim, texto, chave}] (ms), inicio (ms do começo do vídeo, no mesmo relógio),
   *   duracao (ms), cores {chave: '#hex'}, nomes {chave: 'Kael'}, medir (texto, tamanhoPx) → largura
   * }
   */
  function gerarAss(o) {
    var e = o.estilo, W = o.W, H = o.H;
    var tam = Math.round(e.tamanho * o.k);
    var medir = function (t) { return o.medir(t, tam); };
    var bl = blocos(o.segmentos, e);
    var cab = [
      '[Script Info]', 'ScriptType: v4.00+', 'PlayResX: ' + W, 'PlayResY: ' + H, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
      '[V4+ Styles]',
      'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
      'Style: Legenda,' + e.fonte + ',' + tam + ',' + corAss(e.corTexto) + ',' + corAss(e.corDestaque) + ',' +
        (e.fundo ? corAss(e.corFundo, e.opacidadeFundo) : corAss(e.corContorno)) + ',' + corAss('#000000', 60) + ',' +
        (e.negrito ? -1 : 0) + ',0,0,0,100,100,0,0,' + (e.fundo ? 3 : 1) + ',' +
        (e.fundo ? Math.round(tam * 0.18) : Math.round(e.contorno * o.k)) + ',' + Math.round(e.sombra * o.k) + ',5,0,0,0,1',
      '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ];
    var x = Math.round(o.pos.x * W), y = Math.round(o.pos.y * H), maxL = o.pos.w * W;
    var linhasOut = [];
    var ini0 = o.inicio || 0, fimVideo = (o.duracao || Infinity);
    bl.forEach(function (b, bi) {
      var a = b.ini - ini0, z = Math.min(b.fim - ini0, fimVideo);
      // segura até o próximo bloco (no máximo 0,6 s) para não piscar
      var prox = bl[bi + 1];
      if (prox) z = Math.max(z, Math.min(prox.ini - ini0, b.fim - ini0 + 600));
      if (z <= 0 || a >= fimVideo) return;
      var mb = montarBloco(b, e, o.cores, o.nomes, maxL, medir);
      var corBase = mb.cor, palavras = mb.palavras, linhas = mb.linhas;
      var montar = function (ativa) {
        return linhas.map(function (l) {
          return l.map(function (w) {
            var t = escaparAss(w.texto);
            if (w === ativa) return '{\\c' + corAss(e.corDestaque) + '}' + t + '{\\c' + corAss(corBase) + '}';
            return t;
          }).join(' ');
        }).join('\\N');
      };
      var base = '{\\an5\\pos(' + x + ',' + y + ')\\c' + corAss(corBase) + '}';
      var faladas = palavras.filter(function (w) { return !w.nome; });
      if (e.destaque && faladas.length > 1) {
        // uma fala por palavra, com a palavra da vez destacada
        faladas.forEach(function (w, i) {
          var wa = i === 0 ? a : w.ini - ini0;
          var wz = i === faladas.length - 1 ? z : faladas[i + 1].ini - ini0;
          if (wz <= wa || wz <= 0) return;
          linhasOut.push('Dialogue: 0,' + tempoAss(Math.max(0, wa)) + ',' + tempoAss(wz) + ',Legenda,,0,0,0,,' + base + montar(w));
        });
      } else {
        linhasOut.push('Dialogue: 0,' + tempoAss(Math.max(0, a)) + ',' + tempoAss(z) + ',Legenda,,0,0,0,,' + base + montar(null));
      }
    });
    return cab.concat(linhasOut).join('\n') + '\n';
  }

  /** Palavras (com o nome de quem fala, se for o caso), cor e linhas de um bloco. */
  function montarBloco(b, e, cores, nomes, maxL, medir) {
    var corBase = e.corPersonagem && cores && cores[b.chave] ? cores[b.chave] : e.corTexto;
    var prefixo = e.mostrarNome && b.primeiro && nomes && nomes[b.chave] ? nomes[b.chave] + ':' : '';
    var palavras = b.palavras.map(function (w) { return { texto: textoPalavra(w, e), ini: w.ini, fim: w.fim, orig: w }; });
    if (prefixo) palavras = [{ texto: estiloTexto(prefixo, e), ini: b.ini, fim: b.ini, nome: true }].concat(palavras);
    return { cor: corBase, palavras: palavras, linhas: quebrar(palavras, maxL, medir) };
  }
  function estiloTexto(t, e) { return e.maiusculas ? t.toLocaleUpperCase('pt-BR') : t; }

  /**
   * Desenha a legenda do instante t num canvas, do jeito que o libass desenha no vídeo.
   * o: { W, H, estilo, pos, k, blocos (de blocos()), t, cores, nomes, exemplo (texto se não houver fala) }
   * Devolve o retângulo do texto { x, y, largura, altura } (ou null).
   */
  function desenhar(ctx, o) {
    var e = o.estilo;
    var tam = e.tamanho * o.k;
    var achado = blocoEm(o.blocos || [], o.t);
    var b = achado ? achado.bloco : null, ativa = achado ? achado.ativa : null;
    if (!b && o.exemplo) {
      var ps = o.exemplo.split(' ').map(function (w) { return { texto: w, ini: 0, fim: 0 }; });
      b = { palavras: ps, chave: '', primeiro: false, ini: 0, fim: 0 };
      ativa = null;
    }
    if (!b) return null;
    ctx.save();
    ctx.font = fonteCanvas(e, tam);
    var medir = function (t) { return ctx.measureText(t).width; };
    var mb = montarBloco(b, e, o.cores, o.nomes, o.pos.w * o.W, medir);
    var cx = o.pos.x * o.W, cy = o.pos.y * o.H;
    var altLinha = tam;
    var altura = mb.linhas.length * altLinha;
    var topo = cy - altura / 2;
    var larguraMax = 0;
    var sombra = e.sombra * o.k;
    var contorno = e.fundo ? tam * 0.18 : e.contorno * o.k;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (o.exemplo && !achado) ctx.globalAlpha = 0.55;
    mb.linhas.forEach(function (l, i) {
      var textos = l.map(function (w) { return w.texto; });
      var larg = medir(textos.join(' '));
      larguraMax = Math.max(larguraMax, larg);
      var x = cx - larg / 2, y = topo + altLinha * (i + 0.5);
      if (e.fundo) {
        var hexF = e.corFundo, a = e.opacidadeFundo / 100;
        ctx.fillStyle = 'rgba(' + parseInt(hexF.slice(1, 3), 16) + ',' + parseInt(hexF.slice(3, 5), 16) + ',' + parseInt(hexF.slice(5, 7), 16) + ',' + a + ')';
        ctx.fillRect(x - contorno, y - altLinha / 2 - contorno * 0.2, larg + contorno * 2, altLinha + contorno * 0.4);
      }
      var px = x;
      l.forEach(function (w, j) {
        var t = w.texto + (j < l.length - 1 ? ' ' : '');
        var cor = w.orig && w.orig === ativa && e.destaque && b.palavras.length > 1 ? e.corDestaque : mb.cor;
        if (sombra > 0 && !e.fundo) {
          ctx.fillStyle = ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          if (contorno > 0) { ctx.lineWidth = contorno * 2; ctx.strokeText(w.texto, px + sombra, y + sombra); }
          ctx.fillText(w.texto, px + sombra, y + sombra);
        }
        if (!e.fundo && contorno > 0) { ctx.strokeStyle = e.corContorno; ctx.lineWidth = contorno * 2; ctx.strokeText(w.texto, px, y); }
        ctx.fillStyle = cor;
        ctx.fillText(w.texto, px, y);
        px += medir(t);
      });
    });
    ctx.restore();
    return { x: cx - larguraMax / 2, y: topo, largura: larguraMax, altura: altura };
  }

  /** Desloca todos os tempos de um .ass (ms; negativo = mais cedo). Corta o que ficar antes do zero. */
  function deslocarAss(ass, ms) {
    if (!ms) return ass;
    var lerT = function (t) { var p = t.split(':'); return ((+p[0]) * 3600 + (+p[1]) * 60 + parseFloat(p[2])) * 1000; };
    return ass.split('\n').map(function (l) {
      var m = l.match(/^Dialogue: (\d+),([\d:.]+),([\d:.]+),(.*)$/);
      if (!m) return l;
      var a = lerT(m[2]) + ms, z = lerT(m[3]) + ms;
      if (z <= 0) return null;
      return 'Dialogue: ' + m[1] + ',' + tempoAss(Math.max(0, a)) + ',' + tempoAss(z) + ',' + m[4];
    }).filter(function (l) { return l !== null; }).join('\n');
  }

  /** Qual bloco aparece no instante t (ms), e qual palavra está sendo falada. Para a prévia. */
  function blocoEm(bl, t) {
    for (var i = 0; i < bl.length; i++) {
      var b = bl[i], prox = bl[i + 1];
      var z = b.fim;
      if (prox) z = Math.max(z, Math.min(prox.ini, b.fim + 600));
      if (t >= b.ini && t < z) {
        var ativa = null;
        for (var k = 0; k < b.palavras.length; k++) if (t >= b.palavras[k].ini) ativa = b.palavras[k];
        return { bloco: b, ativa: ativa };
      }
    }
    return null;
  }

  return {
    FONTES: FONTES, EM: EM, fonteCanvas: fonteCanvas, desenhar: desenhar, montarBloco: montarBloco, ESTILO_PADRAO: ESTILO_PADRAO, POS_PADRAO: POS_PADRAO,
    normalizarEstilo: normalizarEstilo, normalizarPos: normalizarPos, blocos: blocos, quebrar: quebrar,
    textoPalavra: textoPalavra, gerarAss: gerarAss, deslocarAss: deslocarAss, blocoEm: blocoEm, corAss: corAss, tempoAss: tempoAss,
  };
});
