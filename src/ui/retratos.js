/* Desenha os "adesivos" dos retratos (imagem recortada, brilho, nome) num canvas.
   As mesmas imagens servem para a prévia do vertical e para a exportação,
   então o vídeo final sai igual ao que aparece na tela. */
(function () {
  'use strict';
  var L = window.LayoutRetratos;
  var cacheImg = {};

  function carregarImagem(url) {
    if (!url) return Promise.resolve(null);
    if (cacheImg[url]) return cacheImg[url];
    cacheImg[url] = new Promise(function (res) {
      var img = new Image();
      img.crossOrigin = 'anonymous'; // o servidor do app libera: o canvas não fica "sujo"
      img.onload = function () { res(img); };
      img.onerror = function () { delete cacheImg[url]; res(null); };
      img.src = url;
    });
    return cacheImg[url];
  }

  function caminhoForma(ctx, forma, x, y, t) {
    ctx.beginPath();
    if (forma === 'circulo') { ctx.arc(x + t / 2, y + t / 2, t / 2, 0, Math.PI * 2); return; }
    var r = forma === 'arredondado' ? t * 0.18 : Math.min(4, t * 0.04);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + t, y, x + t, y + t, r);
    ctx.arcTo(x + t, y + t, x, y + t, r);
    ctx.arcTo(x, y + t, x, y, r);
    ctx.arcTo(x, y, x + t, y, r);
    ctx.closePath();
  }

  /**
   * o: { img, foco:{x,y,zoom}, cor, nome, iniciais, falando, tamanho, forma, efeito, moldura, apagar }
   * Devolve um canvas do tamanho de LayoutRetratos.medidas(tamanho, temNome).
   */
  function desenhar(o) {
    var m = L.medidas(o.tamanho, !!o.nome);
    var c = document.createElement('canvas');
    c.width = m.largura;
    c.height = m.altura;
    var ctx = c.getContext('2d');
    var t = m.tam;
    var escala = o.falando && o.efeito === 'aumentar' ? 1.12 : 1;
    var tt = t * escala;
    var x = m.cx - tt / 2, y = m.cy - tt / 2;

    ctx.save();
    if (!o.falando && o.apagar) { ctx.globalAlpha = 0.5; ctx.filter = 'saturate(0.6)'; }

    // brilho / anel de quem fala
    if (o.falando && o.efeito !== 'nenhum') {
      ctx.save();
      if (o.efeito === 'brilho') { ctx.shadowColor = o.cor; ctx.shadowBlur = t * 0.35; }
      caminhoForma(ctx, o.forma, x - t * 0.05, y - t * 0.05, tt + t * 0.1);
      ctx.fillStyle = o.cor;
      ctx.fill();
      ctx.restore();
    }

    // fundo + imagem recortada no formato
    ctx.save();
    caminhoForma(ctx, o.forma, x, y, tt);
    ctx.clip();
    ctx.fillStyle = o.cor || '#4A5A7A';
    ctx.fillRect(x, y, tt, tt);
    if (o.img) {
      var f = o.foco || { x: 50, y: 50, zoom: 100 };
      var iw = o.img.naturalWidth || o.img.width, ih = o.img.naturalHeight || o.img.height;
      var s = Math.max(tt / iw, tt / ih) * ((f.zoom || 100) / 100);
      var dw = iw * s, dh = ih * s;
      // mesma conta do CSS object-position + transform-origin do overlay
      var dx = x + (tt - dw) * (f.x / 100);
      var dy = y + (tt - dh) * (f.y / 100);
      ctx.drawImage(o.img, dx, dy, dw, dh);
    } else {
      ctx.fillStyle = '#fff';
      ctx.font = '700 ' + Math.round(tt * 0.38) + 'px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.45)';
      ctx.shadowBlur = 6;
      ctx.fillText(o.iniciais || '?', x + tt / 2, y + tt / 2 + 1);
    }
    ctx.restore();

    if (o.moldura) {
      caminhoForma(ctx, o.forma, x + t * 0.02, y + t * 0.02, tt - t * 0.04);
      ctx.lineWidth = t * 0.04;
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.stroke();
    }

    // nome
    if (o.nome) {
      var maxW = m.largura - 8;
      var fonte = m.fonte;
      var medir = function (t) { return ctx.measureText(t).width + 20; };
      ctx.font = '600 ' + fonte + 'px "Segoe UI", system-ui, sans-serif';
      // nome comprido: diminui a letra (até 72%); se não couber, duas linhas; só então corta com "…"
      while (medir(o.nome) > maxW && fonte > m.fonte * 0.72) {
        fonte--;
        ctx.font = '600 ' + fonte + 'px "Segoe UI", system-ui, sans-serif';
      }
      var linhas = [o.nome];
      if (medir(o.nome) > maxW) {
        fonte = Math.round(m.fonte * 0.8);
        ctx.font = '600 ' + fonte + 'px "Segoe UI", system-ui, sans-serif';
        var palavras = o.nome.split(/\s+/), l1 = '', i = 0;
        while (i < palavras.length && medir((l1 ? l1 + ' ' : '') + palavras[i]) <= maxW) { l1 = (l1 ? l1 + ' ' : '') + palavras[i]; i++; }
        if (!l1) { l1 = palavras[0]; i = 1; }
        linhas = [l1, palavras.slice(i).join(' ')].filter(Boolean);
      }
      linhas = linhas.map(function (t) {
        while (medir(t) > maxW && t.length > 1) t = t.slice(0, -2) + '…';
        return t;
      });
      var alturaLinha = Math.round(fonte * 1.2);
      var w = Math.min(maxW, Math.max.apply(null, linhas.map(medir)));
      var h = linhas.length > 1 ? alturaLinha * linhas.length + 8 : m.nomeAltura;
      var nx = m.cx - w / 2, ny = m.cy + t / 2 + 8 + (escala > 1 ? t * 0.06 : 0);
      if (ny + h > m.altura) ny = m.altura - h;
      ctx.beginPath();
      var r = Math.min(h / 2, linhas.length > 1 ? 10 : h / 2);
      ctx.moveTo(nx + r, ny);
      ctx.arcTo(nx + w, ny, nx + w, ny + h, r);
      ctx.arcTo(nx + w, ny + h, nx, ny + h, r);
      ctx.arcTo(nx, ny + h, nx, ny, r);
      ctx.arcTo(nx, ny, nx + w, ny, r);
      ctx.closePath();
      ctx.fillStyle = 'rgba(10,11,14,.78)';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      linhas.forEach(function (txt, k) {
        var meio = ny + h / 2 + (k - (linhas.length - 1) / 2) * alturaLinha + 1;
        ctx.fillText(txt, m.cx, meio);
      });
    }
    ctx.restore();
    return c;
  }

  /**
   * Adesivos de todos os jogadores, falando e quieto.
   * jogadores: [{ chave, url, foco, cor, nome, iniciais }]
   * opc: { tamanho, forma, efeito, moldura, apagar, comNome }
   * comoDataURL: true para mandar ao app; false para desenhar na prévia.
   */
  function adesivos(jogadores, opc, comoDataURL) {
    return Promise.all(jogadores.map(function (j) {
      return carregarImagem(j.url).then(function (img) {
        var base = {
          img: img, foco: j.foco, cor: j.cor, nome: opc.comNome ? j.nome : '', iniciais: j.iniciais,
          tamanho: opc.tamanho, forma: opc.forma, efeito: opc.efeito, moldura: opc.moldura, apagar: opc.apagar,
        };
        var fa = desenhar(Object.assign({}, base, { falando: true }));
        // "nome só de quem fala": o adesivo de quem está quieto vai sem nome
        var qu = desenhar(Object.assign({}, base, { falando: false, nome: opc.nomeQuieto === false ? '' : base.nome }));
        return {
          chave: j.chave,
          falando: comoDataURL ? fa.toDataURL('image/png') : fa,
          quieto: comoDataURL ? qu.toDataURL('image/png') : qu,
        };
      });
    }));
  }

  window.Retratos = { desenhar: desenhar, adesivos: adesivos, carregarImagem: carregarImagem };
})();
