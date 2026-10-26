/* Onde cada retrato fica no vídeo (overlay redesenhado nos cortes).
   Igual no app e na interface: a prévia e a exportação batem. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.LayoutRetratos = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Medidas do "adesivo" de um retrato (imagem com brilho e nome embaixo). */
  function medidas(tamanho, comNome) {
    var tam = Math.round(tamanho);
    var fonte = Math.round(12 + tam * 0.07);
    var folga = Math.round(tam * 0.28);            // espaço para o brilho
    var nomeAltura = comNome ? Math.round(fonte * 1.25 + 10) : 0;
    var largura = Math.round(tam * 1.35 + folga * 2);
    var altura = tam + folga * 2 + (comNome ? nomeAltura + 8 : 0);
    return {
      tam: tam, fonte: fonte, folga: folga, nomeAltura: nomeAltura, largura: largura, altura: altura,
      // centro do retrato dentro do adesivo
      cx: largura / 2, cy: folga + tam / 2,
    };
  }

  var ANCORAS = ['topo-esq', 'topo', 'topo-dir', 'meio-esq', 'centro', 'meio-dir', 'baixo-esq', 'baixo', 'baixo-dir'];

  /** Posições antigas (até a 0.3.1) no formato novo. */
  function deLayout(layout) {
    switch (layout) {
      case 'faixa-cima': return { ancora: 'topo', direcao: 'horizontal', mostrar: 'todos' };
      case 'coluna-direita': return { ancora: 'meio-dir', direcao: 'vertical', mostrar: 'todos' };
      case 'coluna-esquerda': return { ancora: 'meio-esq', direcao: 'vertical', mostrar: 'todos' };
      case 'quem-fala': return { ancora: 'baixo', direcao: 'horizontal', mostrar: 'falando' };
      default: return { ancora: 'baixo', direcao: 'horizontal', mostrar: 'todos' };
    }
  }

  /** "baixo-esq" → { h: 'esq', v: 'baixo' } */
  function partes(ancora) {
    var a = ANCORAS.indexOf(ancora) >= 0 ? ancora : 'baixo';
    var v = a.indexOf('topo') === 0 ? 'topo' : a.indexOf('baixo') === 0 ? 'baixo' : 'meio';
    var h = /-esq$/.test(a) ? 'esq' : /-dir$/.test(a) ? 'dir' : 'centro';
    return { h: h, v: v };
  }

  /**
   * Centros dos retratos no quadro W×H.
   * o: { W, H, quantidade, tamanho, margem, comNome,
   *      ancora (9 pontos), direcao ('horizontal'|'vertical'), ordem ('normal'|'invertida'),
   *      deslocX, deslocY (px, já na escala do quadro), espaco (% do tamanho), mostrar ('todos'|'falando') }
   * Também aceita o formato antigo ({ layout: 'faixa-baixo' | ... }).
   * Se não couberem, diminui o tamanho até caber. Com "só quem fala", há um lugar só.
   */
  function posicoes(o) {
    var legado = !o.ancora;
    var p = legado ? deLayout(o.layout) : o;
    var W = o.W, H = o.H, margem = o.margem || 0;
    var falando = p.mostrar === 'falando';
    var n = falando ? 1 : Math.max(1, o.quantidade);
    // no formato antigo, "só quem fala" era 60% maior
    var tamanho = legado && o.layout === 'quem-fala' ? o.tamanho * 1.6 : o.tamanho;
    var m = medidas(tamanho, o.comNome);
    var vertical = p.direcao === 'vertical';
    var gap = m.tam * (o.espaco == null ? 18 : Math.max(0, o.espaco)) / 100;
    var extraNome = o.comNome ? m.nomeAltura + 8 : 0;
    var passo = vertical ? (m.tam + extraNome + gap) : (m.tam * 1.35 + gap);
    var total = n * passo - gap;
    var disponivel = (vertical ? H : W) - 2 * margem;
    if (total > disponivel && m.tam > 8) {
      var escala = disponivel / total;
      return posicoes(Object.assign({}, o, legado ? deLayout(o.layout) : {}, { layout: undefined, tamanho: tamanho * escala * 0.98 }));
    }
    var larg = vertical ? m.tam * 1.35 : total;
    var alt = vertical ? total : m.tam + extraNome;
    var pt = partes(p.ancora);
    var gx = pt.h === 'esq' ? margem : pt.h === 'dir' ? W - margem - larg : (W - larg) / 2;
    var gy = pt.v === 'topo' ? margem : pt.v === 'baixo' ? H - margem - alt : (H - alt) / 2;
    gx = Math.max(0, Math.min(W - larg, gx + (Number(o.deslocX) || 0)));
    gy = Math.max(0, Math.min(H - alt, gy + (Number(o.deslocY) || 0)));
    var lugares = [];
    for (var i = 0; i < n; i++) {
      var k = p.ordem === 'invertida' ? n - 1 - i : i;
      if (vertical) lugares.push({ x: gx + larg / 2, y: gy + k * passo + m.tam / 2 });
      else lugares.push({ x: gx + k * passo + (m.tam * 1.35) / 2, y: gy + m.tam / 2 });
    }
    return { tamanho: tamanho, medidas: m, centros: lugares, grupo: { x: gx, y: gy, largura: larg, altura: alt } };
  }

  /**
   * Edição com o mouse: a alça de esticar fica no canto oposto ao ponto escolhido
   * (o grupo cresce a partir do ponto, então a alça acompanha o mouse).
   */
  function alcaDoGrupo(grupo, ancora) {
    var p = partes(ancora);
    return {
      x: p.h === 'dir' ? grupo.x : grupo.x + grupo.largura,
      y: p.v === 'baixo' ? grupo.y : grupo.y + grupo.altura,
    };
  }

  /** Quanto o tamanho muda arrastando a alça dx/dy pixels (no quadro). */
  function fatorEsticar(ancora, grupo, dx, dy) {
    var p = partes(ancora);
    var sx = (p.h === 'dir' ? -1 : 1) * (p.h === 'centro' ? 2 : 1);
    var sy = (p.v === 'baixo' ? -1 : 1) * (p.v === 'meio' ? 2 : 1);
    var fx = (grupo.largura + sx * dx) / Math.max(1, grupo.largura);
    var fy = (grupo.altura + sy * dy) / Math.max(1, grupo.altura);
    var f = Math.abs(fx - 1) > Math.abs(fy - 1) ? fx : fy;
    return Math.max(0.1, f);
  }

  /** Canto de cima à esquerda do adesivo para um centro de retrato. */
  function cantoAdesivo(centro, m) {
    return { x: Math.round(centro.x - m.cx), y: Math.round(centro.y - m.cy) };
  }

  return { medidas: medidas, posicoes: posicoes, cantoAdesivo: cantoAdesivo, alcaDoGrupo: alcaDoGrupo, fatorEsticar: fatorEsticar, deLayout: deLayout, partes: partes, ANCORAS: ANCORAS };
});
