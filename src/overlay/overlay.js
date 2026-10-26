/* Overlay do Gravador RPG: recebe o estado do app e desenha os retratos.
   ?demo=1 faz os retratos falarem sozinhos (prévia no app). */
(function () {
  'use strict';
  var palco = document.getElementById('palco');
  var params = new URLSearchParams(location.search);
  var demo = params.get('demo') === '1';
  var SEGURAR_MS = 300;        // evita piscar entre sílabas
  var SEGURAR_QUEM_FALA = 1500; // no layout "só quem fala", o último fica um pouco mais

  var estado = null;
  var ultimaFala = {};          // id -> ms em que estava falando
  var elementos = {};           // id -> elemento
  var demoFalando = -1;

  function falandoAgora(p, agora) {
    if (p.falando) ultimaFala[p.id] = agora;
    var segura = estado && estado.mostrar === 'falando' ? SEGURAR_QUEM_FALA : SEGURAR_MS;
    return !!ultimaFala[p.id] && agora - ultimaFala[p.id] < segura;
  }

  function criar(p) {
    var el = document.createElement('div');
    el.className = 'pessoa';
    el.innerHTML = '<div class="retrato"><span class="iniciais"></span><img alt="" hidden></div><div class="nome"></div>';
    var img = el.querySelector('img');
    img.addEventListener('error', function () { img.hidden = true; });
    img.addEventListener('load', function () { img.hidden = false; });
    elementos[p.id] = el;
    return el;
  }

  function atualizarPessoa(el, p, falando) {
    el.style.setProperty('--cor', p.cor || '#F0B44C');
    el.classList.toggle('falando', falando);
    el.classList.toggle('ausente', p.presente === false);
    el.querySelector('.iniciais').textContent = p.iniciais || '';
    var nome = el.querySelector('.nome');
    if (nome.textContent !== (p.nome || '')) { nome.textContent = p.nome || ''; nome.removeAttribute('data-ajustado'); }
    var img = el.querySelector('img');
    if (p.imagem) {
      if (img.getAttribute('src') !== p.imagem) { img.hidden = true; img.setAttribute('src', p.imagem); }
      var f = p.foco || { x: 50, y: 50, zoom: 100 };
      img.style.objectPosition = f.x + '% ' + f.y + '%';
      img.style.transformOrigin = f.x + '% ' + f.y + '%';
      img.style.transform = 'scale(' + (f.zoom || 100) / 100 + ')';
    } else {
      img.removeAttribute('src');
      img.hidden = true;
    }
  }

  function desenhar() {
    if (!estado) return;
    var agora = Date.now();
    var vertical = estado.direcao === 'vertical';
    palco.className = 'palco ' + (vertical ? 'vertical' : 'horizontal') +
      (estado.ordem === 'invertida' ? ' invertida' : '') +
      ' efeito-' + (estado.efeito || 'brilho') +
      ' forma-' + (estado.forma || 'circulo') +
      (estado.moldura ? ' com-moldura' : '') +
      (estado.apagarSilenciosos ? ' apagar' : '') +
      (estado.ativo === false ? ' oculto' : '');
    var tamBase = estado.tamanho || 110;
    palco.style.setProperty('--tam', Math.round(tamBase * escalaCaber) + 'px');
    palco.style.setProperty('--espaco', (estado.espaco == null ? 18 : estado.espaco) / 100);
    posicionar(estado);
    var pessoas = (estado.pessoas || []).slice();
    if (demo) {
      if (!pessoas.length) {
        pessoas = ['Kael', 'Iris', 'Bram', 'Mestre'].map(function (n, i) {
          return { id: 'demo' + i, nome: n, iniciais: n[0], cor: ['#7A5BC2', '#3F7F6B', '#9A5A3C', '#4A5A7A'][i], presente: true };
        });
      }
      pessoas = pessoas.map(function (p, i) {
        var c = Object.assign({}, p);
        c.falando = i === demoFalando;
        return c;
      });
    }

    var visiveis = [];
    var vivos = {};
    pessoas.forEach(function (p) {
      var f = falandoAgora(p, agora);
      if (estado.mostrar === 'falando' && !f) return;
      visiveis.push({ p: p, falando: f });
      vivos[p.id] = true;
    });

    Object.keys(elementos).forEach(function (id) {
      if (!vivos[id]) { elementos[id].remove(); delete elementos[id]; }
    });
    visiveis.forEach(function (v, i) {
      var el = elementos[v.p.id] || criar(v.p);
      atualizarPessoa(el, v.p, v.falando);
      if (palco.children[i] !== el) palco.insertBefore(el, palco.children[i] || null);
    });
    // nomes compridos: diminui a letra até caber; se ainda não couber, quebra em duas linhas
    var chave = palco.className + '|' + palco.style.getPropertyValue('--tam');
    visiveis.forEach(function (v) { ajustarNome(elementos[v.p.id].querySelector('.nome'), chave); });
    caber(tamBase);
  }

  /** Coloca o grupo no ponto escolhido (9 pontos da tela) + o deslocamento fino. */
  function posicionar(e) {
    var a = e.ancora || 'baixo';
    var v = a.indexOf('topo') === 0 ? 'topo' : a.indexOf('baixo') === 0 ? 'baixo' : 'meio';
    var h = /-esq$/.test(a) ? 'esq' : /-dir$/.test(a) ? 'dir' : 'centro';
    var m = e.margem == null ? 32 : e.margem;
    var dx = Number(e.deslocX) || 0, dy = Number(e.deslocY) || 0;
    var st = palco.style;
    st.left = st.right = st.top = st.bottom = 'auto';
    var tx = '0', ty = '0';
    if (h === 'esq') st.left = (m + dx) + 'px';
    else if (h === 'dir') st.right = (m - dx) + 'px';
    else { st.left = 'calc(50% + ' + dx + 'px)'; tx = '-50%'; }
    if (v === 'topo') st.top = (m + dy) + 'px';
    else if (v === 'baixo') st.bottom = (m - dy) + 'px';
    else { st.top = 'calc(50% + ' + dy + 'px)'; ty = '-50%'; }
    st.transform = 'translate(' + tx + ',' + ty + ')';
    // a fila "encosta" do lado da âncora
    palco.style.alignItems = e.direcao === 'vertical' ? (h === 'esq' ? 'flex-start' : h === 'dir' ? 'flex-end' : 'center') : (v === 'topo' ? 'flex-start' : v === 'baixo' ? 'flex-end' : 'center');
  }

  /** Muita gente para o espaço: diminui todos até caber na tela (e volta quando sobra espaço). */
  var escalaCaber = 1;
  function caber(tamBase) {
    var r = palco.getBoundingClientRect();
    if (!r.width && !r.height) return;
    var vertical = palco.classList.contains('vertical');
    var m = (estado && estado.margem != null ? estado.margem : 32);
    var disp = (vertical ? window.innerHeight : window.innerWidth) - 2 * m;
    var usado = vertical ? r.height : r.width;
    var nova = escalaCaber;
    if (usado > disp + 1) nova = Math.max(0.3, escalaCaber * disp / usado * 0.98);
    else if (escalaCaber < 1 && usado / escalaCaber < disp) nova = 1;
    if (Math.abs(nova - escalaCaber) > 0.01) {
      escalaCaber = nova;
      palco.style.setProperty('--tam', Math.round(tamBase * escalaCaber) + 'px');
    }
  }

  function ajustarNome(el, chave) {
    if (!el.textContent || el.getAttribute('data-ajustado') === chave) return;
    el.setAttribute('data-ajustado', chave);
    el.classList.remove('duas-linhas');
    el.style.fontSize = '';
    var base = parseFloat(getComputedStyle(el).fontSize) || 16;
    var f = base;
    while (el.scrollWidth > el.clientWidth + 1 && f > base * 0.72) {
      f -= 1;
      el.style.fontSize = f + 'px';
    }
    if (el.scrollWidth > el.clientWidth + 1) {
      el.classList.add('duas-linhas');
      el.style.fontSize = Math.round(base * 0.8) + 'px';
    }
  }

  var versaoVista = null;
  function receber(dados) {
    // o app foi atualizado (código do overlay mudou): recarrega a página para pegar o novo
    if (dados && dados._v) {
      if (versaoVista && dados._v !== versaoVista) { location.reload(); return; }
      versaoVista = dados._v;
    }
    // quem acabou de parar de falar: conta o "segurar" a partir de agora
    var agora = Date.now();
    var antes = {};
    ((estado && estado.pessoas) || []).forEach(function (p) { antes[p.id] = p.falando; });
    ((dados && dados.pessoas) || []).forEach(function (p) {
      if (p.falando || antes[p.id]) ultimaFala[p.id] = agora;
    });
    estado = dados;
    desenhar();
    desenharCamadas();
  }

  // ---- identidade visual ao vivo: camadas desenhadas num canvas do tamanho da tela
  var cvCamadas = document.getElementById('camadas');
  var imgsCamadas = {};
  var chaveCamadas = '';
  function imagemDe(url) {
    if (!url) return null;
    if (!imgsCamadas[url]) {
      var im = new Image();
      im.onload = function () { chaveCamadas = ''; desenharCamadas(); };
      im.src = url;
      imgsCamadas[url] = im;
    }
    return imgsCamadas[url].complete && imgsCamadas[url].naturalWidth ? imgsCamadas[url] : null;
  }
  function desenharCamadas() {
    if (!cvCamadas || !window.Identidade) return;
    var camadas = (estado && estado.camadas) || [];
    var W = window.innerWidth, H = window.innerHeight;
    var chave = JSON.stringify(camadas) + W + 'x' + H;
    if (chave === chaveCamadas) return;
    var dpr = window.devicePixelRatio || 1;
    cvCamadas.width = Math.round(W * dpr);
    cvCamadas.height = Math.round(H * dpr);
    var ctx = cvCamadas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var faltando = false;
    camadas.forEach(function (c) {
      var img = c.tipo === 'imagem' ? imagemDe(c.url) : null;
      if (c.tipo === 'imagem' && !img) { faltando = true; return; }
      window.Identidade.desenharCamada(ctx, c, W, H, 'h', img);
    });
    chaveCamadas = faltando ? '' : chave;
  }
  window.addEventListener('resize', function () { chaveCamadas = ''; desenharCamadas(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { chaveCamadas = ''; desenharCamadas(); });

  // atualiza o "segurar" mesmo sem mensagens novas
  setInterval(desenhar, 150);

  if (demo) {
    setInterval(function () {
      var n = (estado && estado.pessoas && estado.pessoas.length) || 4;
      // cada um fala por vez, com um momento de silêncio no fim da volta
      demoFalando = demoFalando + 1 >= n ? -1 : demoFalando + 1;
      desenhar();
    }, 1600);
  }

  function conectar() {
    if (typeof EventSource === 'undefined') return consultar();
    var origem = params.get('origem');
    var es = new EventSource('/eventos' + (origem ? '?origem=' + encodeURIComponent(origem) : ''));
    es.onmessage = function (ev) {
      try { receber(JSON.parse(ev.data)); } catch (e) { /* mensagem ruim: ignora */ }
    };
  }
  function consultar() {
    fetch('/estado').then(function (r) { return r.json(); }).then(receber).catch(function () {})
      .finally(function () { setTimeout(consultar, 500); });
  }

  window.__overlay = { receber: receber, estado: function () { return estado; } };
  conectar();
})();
