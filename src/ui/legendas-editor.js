/* Legendas nos editores de corte (horizontal e vertical):
   gerar (transcrição no PC), corrigir o texto, escolher quem fala, aparência e posição
   (arrastar na prévia: mover, puxar o canto para o tamanho, puxar a lateral para a largura). */
(function () {
  'use strict';
  var A = window.App, L = window.Legendas;
  var $ = A.$, $$ = A.$$, esc = A.esc;
  var C = function () { return A.Cortes; };
  var ed = function () { return A.Cortes && A.Cortes.ed(); };

  var EXEMPLO = 'Sua legenda aparece aqui';
  var st = { qual: '', raf: 0, versao: 0, blocos: null, chaveBlocos: '', caixa: null, arrasto: null, espera: 0, prog: null, guia: false };

  function mesaLeg() { return A.mesa().legendas; }
  function estilo() { return L.normalizarEstilo(mesaLeg().estilo); }
  function pos(qual) { return L.normalizarPos(mesaLeg()[qual], qual); }
  function leg() { var e = ed(); return e && e.corte.legendas; }

  function cores(sessao) {
    var mapa = C().corPorChave(sessao), c = {}, n = {};
    Object.keys(mapa).forEach(function (k) { c[k] = mapa[k].cor; n[k] = mapa[k].nome; });
    return { cores: c, nomes: n };
  }
  function blocos() {
    var l = leg(), e = estilo();
    var chave = st.versao + ':' + e.palavras;
    if (st.chaveBlocos !== chave || !st.blocos) { st.blocos = L.blocos(l ? l.segmentos : [], e); st.chaveBlocos = chave; }
    return st.blocos;
  }
  function mudouTexto() { st.versao++; }
  function fmtRel(ms) { var e = ed(); return C().fmt(Math.max(0, (ms - e.corte.ini) / 1000)); }
  function novoId() { return Math.random().toString(36).slice(2, 10); }

  // ================================================================ painel
  function opcoes(lista, valor) {
    return lista.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(valor) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function faixa(campo, rotulo, valor, min, max, sufixo) {
    return '<label class="campo"><span class="rotulo">' + rotulo + ': <span data-eco="leg-' + campo + '">' + valor + '</span>' + sufixo + '</span>' +
      '<input type="range" min="' + min + '" max="' + max + '" step="1" value="' + valor + '" data-campo="m.legendas.estilo.' + campo + '" data-num data-eco-alvo="leg-' + campo + '" data-leg-estilo></label>';
  }
  function marca(campo, rotulo, valor) {
    return '<label class="opcao"><input type="checkbox" data-campo="m.legendas.estilo.' + campo + '"' + A.marcado(valor) + ' data-leg-estilo>' + rotulo + '</label>';
  }
  function cor(campo, rotulo, valor) {
    return '<label class="leg-cor"><input type="color" value="' + esc(valor) + '" data-campo="m.legendas.estilo.' + campo + '" data-leg-estilo><span>' + rotulo + '</span></label>';
  }

  function painel(qual) {
    var e = estilo();
    var l = leg();
    var tr = A.cfg().transcricao || { modelo: 'preciso', idioma: 'pt' };
    return '<section class="painel" id="painel-legendas"><div class="titulo"><h2>Legendas</h2>' +
      '<label class="opcao"><input type="checkbox" id="leg-ativo"' + A.marcado(l && l.ativo) + '>Mostrar neste corte</label></div>' +
      '<div id="leg-corpo"></div>' +
      '<details class="leg-detalhes" id="leg-aparencia"><summary>Aparência <small>(vale para todos os cortes desta mesa)</small></summary><div class="coluna" style="gap:10px;margin-top:10px">' +
      '<div class="leg-linha">' +
      '<label class="campo" style="flex:1"><span class="rotulo">Fonte</span><select data-campo="m.legendas.estilo.fonte" data-leg-estilo>' + opcoes(L.FONTES.map(function (f) { return [f, f]; }), e.fonte) + '</select></label>' +
      '<label class="campo" style="flex:1"><span class="rotulo">Palavras por vez</span><select data-campo="m.legendas.estilo.palavras" data-num data-leg-estilo>' +
      opcoes([[0, 'Frase inteira'], [1, '1 (uma por vez)'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6'], [8, '8']], e.palavras) + '</select></label></div>' +
      faixa('tamanho', 'Tamanho', e.tamanho, 16, 240, ' px') +
      '<div class="leg-linha">' + marca('negrito', 'Negrito', e.negrito) + marca('maiusculas', 'MAIÚSCULAS', e.maiusculas) + marca('mostrarNome', 'Nome de quem fala', e.mostrarNome) + '</div>' +
      '<div class="leg-linha">' + cor('corTexto', 'Texto', e.corTexto) + marca('corPersonagem', 'Usar a cor de cada personagem', e.corPersonagem) + '</div>' +
      '<div class="leg-linha">' + marca('destaque', 'Destacar a palavra falada', e.destaque) + cor('corDestaque', 'Destaque', e.corDestaque) + '</div>' +
      '<div class="leg-linha">' + marca('fundo', 'Caixa atrás do texto', e.fundo) + '</div>' +
      '<div id="leg-com-contorno" class="coluna" style="gap:10px"' + (e.fundo ? ' hidden' : '') + '>' +
      '<div class="leg-linha">' + cor('corContorno', 'Contorno', e.corContorno) + '</div>' +
      faixa('contorno', 'Espessura do contorno', e.contorno, 0, 20, ' px') +
      faixa('sombra', 'Sombra', e.sombra, 0, 20, ' px') + '</div>' +
      '<div id="leg-com-fundo" class="coluna" style="gap:10px"' + (e.fundo ? '' : ' hidden') + '>' +
      '<div class="leg-linha">' + cor('corFundo', 'Caixa', e.corFundo) + '</div>' +
      faixa('opacidadeFundo', 'Opacidade da caixa', e.opacidadeFundo, 0, 100, '%') + '</div>' +
      '<div class="linha"><button class="pequeno" data-acao="legCentralizar">Centralizar na horizontal</button>' +
      '<button class="pequeno" data-acao="legPosPadrao">Posição padrão</button></div>' +
      '<p class="ajuda">Na prévia: arraste a legenda para mover, puxe a bolinha do canto para o tamanho e as laterais para a largura. ' +
      'A posição do horizontal e a do vertical são separadas.</p>' +
      '</div></details>' +
      '<details class="leg-detalhes"><summary>Transcrição</summary><div class="coluna" style="gap:10px;margin-top:10px">' +
      '<div class="leg-linha">' +
      '<label class="campo" style="flex:1"><span class="rotulo">Modelo</span><select data-campo="c.transcricao.modelo">' +
      opcoes([['preciso', 'Preciso (baixa ~550 MB uma vez)'], ['rapido', 'Rápido (baixa ~190 MB uma vez)']], tr.modelo) + '</select></label>' +
      '<label class="campo" style="flex:1"><span class="rotulo">Idioma</span><select data-campo="c.transcricao.idioma">' +
      opcoes([['pt', 'Português'], ['en', 'Inglês'], ['es', 'Espanhol'], ['auto', 'Detectar']], tr.idioma) + '</select></label></div>' +
      '<p class="ajuda">Roda aqui no seu PC (nada vai para a internet além do download do modelo na primeira vez). ' +
      'Os nomes dos personagens da mesa ajudam a escrever certo.</p></div></details>' +
      '</section>';
  }

  function quemOpcoes(chave) {
    var mapa = C().corPorChave();
    var lista = [['', '—']].concat(Object.keys(mapa).map(function (k) { return [k, mapa[k].nome]; }));
    if (chave && !mapa[chave]) lista.push([chave, chave.indexOf('nome:') === 0 ? chave.slice(5) : 'Visitante']);
    return opcoes(lista, chave || '');
  }

  function desenharCorpo() {
    var alvo = $('#leg-corpo');
    var e = ed();
    if (!alvo || !e) return;
    var l = leg();
    if (st.prog) {
      var p = st.prog;
      var nomes = {
        preparando: 'Preparando…', 'baixando-programa': 'Baixando o programa de transcrição (só na primeira vez)…',
        baixando: 'Baixando o modelo de transcrição (só na primeira vez)…', extraindo: 'Separando o áudio do corte…', transcrevendo: 'Transcrevendo…',
      };
      var pct = Math.round((p.progresso || 0) * 100);
      alvo.innerHTML = '<div class="leg-progresso" role="status"><span>' + esc(nomes[p.etapa] || 'Trabalhando…') +
        (p.totalMb ? ' ' + p.mb + ' de ' + p.totalMb + ' MB' : '') + '</span>' +
        '<div class="barra"><i style="width:' + pct + '%"></i></div>' +
        '<span class="ajuda">Pode continuar mexendo no app; as legendas aparecem aqui quando terminar.</span></div>';
      return;
    }
    if (!l.segmentos.length) {
      alvo.innerHTML = '<p class="ajuda">Ninguém transcreveu este corte ainda. O app escuta o áudio (faixa 1) e escreve o que foi falado, ' +
        'já marcando quem falou pelo StreamKit. Depois você corrige o que quiser.</p>' +
        '<div class="linha"><button class="principal" data-acao="legGerar">Gerar legendas</button>' +
        '<button class="pequeno" data-acao="legAdicionar">Escrever à mão</button></div>';
      return;
    }
    var T = e.T * 1000;
    alvo.innerHTML =
      '<div class="linha leg-ferramentas"><button class="pequeno" data-acao="legAdicionar" title="Nova legenda no ponto atual do vídeo">+ Legenda aqui</button>' +
      '<button class="pequeno" data-acao="legGerar">Transcrever de novo</button>' +
      '<span class="ajuda" style="margin-left:auto">' + l.segmentos.length + ' trecho(s)</span></div>' +
      '<div class="leg-lista" id="leg-lista">' + l.segmentos.map(function (s) {
        var atual = T >= s.ini && T < s.fim;
        return '<div class="leg-seg' + (atual ? ' atual' : '') + '" data-seg="' + esc(s.id) + '">' +
          '<div class="leg-seg-topo"><button class="pequeno mono" data-acao="legIr" title="Ouvir este trecho" aria-label="Ouvir este trecho">▶</button>' +
          '<input type="text" class="mono leg-tempo" data-leg-ini value="' + fmtRel(s.ini) + '" aria-label="Começa em" title="Começa em">' +
          '<span class="ajuda">até</span><input type="text" class="mono leg-tempo" data-leg-fim value="' + fmtRel(s.fim) + '" aria-label="Termina em" title="Termina em">' +
          '<select data-leg-quem aria-label="Quem fala">' + quemOpcoes(s.chave) + '</select>' +
          '<button class="pequeno icone" data-acao="legApagar" aria-label="Apagar este trecho" title="Apagar">✕</button></div>' +
          '<textarea rows="1" data-leg-texto aria-label="Texto da legenda" spellcheck="true">' + esc(s.texto) + '</textarea></div>';
      }).join('') + '</div>' +
      '<details class="leg-detalhes"><summary>Trocar uma palavra em tudo</summary><div class="leg-linha" style="margin-top:8px">' +
      '<input type="text" id="leg-de" placeholder="Errado (ex.: Cael)" style="flex:1"><span>→</span><input type="text" id="leg-para" placeholder="Certo (ex.: Kael)" style="flex:1">' +
      '<button class="pequeno" data-acao="legTrocar">Trocar</button></div></details>';
    $$('#leg-lista textarea').forEach(ajustarAltura);
  }
  function ajustarAltura(t) { t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight + 2) + 'px'; }

  function seg(el) {
    var row = el.closest && el.closest('[data-seg]');
    if (!row || !leg()) return null;
    var id = row.getAttribute('data-seg');
    return leg().segmentos.filter(function (s) { return s.id === id; })[0] || null;
  }

  function salvar() { mudouTexto(); C().salvarCorte(); }

  // ================================================================ gerar (transcrição)
  function acompanhar() {
    var e = ed();
    if (!e) return;
    clearTimeout(st.espera);
    var sid = e.s.id, cid = e.corte.id;
    window.api.legendar(sid, cid, 'ver').then(function (r) {
      var e2 = ed();
      if (!e2 || e2.corte.id !== cid) return;
      if (!r || r.erro && !r.estado) { st.prog = null; A.aviso((r && r.erro) || 'Erro na transcrição.', 'erro'); desenharCorpo(); return; }
      if (r.estado === 'rodando') { st.prog = r; desenharCorpo(); st.espera = setTimeout(acompanhar, 700); return; }
      st.prog = null;
      if (r.estado === 'erro') A.aviso(r.erro, 'erro');
      if (r.estado === 'pronto' && r.corte) {
        e2.corte.legendas = r.corte.legendas;
        mudouTexto();
        var chk = $('#leg-ativo');
        if (chk) chk.checked = true;
        (r.avisos || []).forEach(function (a) { A.aviso(a); });
        if (!(r.avisos || []).length) A.aviso('Legendas prontas. Confira o texto e corrija o que precisar.', 'ok');
      }
      desenharCorpo();
    });
  }

  Object.assign(A.ACOES, {
    legGerar: function () {
      var e = ed();
      if (!e) return;
      if (leg().segmentos.length && !confirm('Transcrever de novo apaga as legendas atuais deste corte (inclusive suas correções). Continuar?')) return;
      clearTimeout(e.salvarTimer);
      return window.api.salvarCorte(e.s.id, e.corte).then(function () {
        return window.api.legendar(e.s.id, e.corte.id);
      }).then(function (r) {
        if (r && r.erro && !r.estado) { A.aviso(r.erro, 'erro'); return; }
        st.prog = r;
        desenharCorpo();
        st.espera = setTimeout(acompanhar, 500);
      });
    },
    legAdicionar: function () {
      var e = ed();
      if (!e) return;
      var t = Math.round(Math.max(e.corte.ini, Math.min(e.corte.fim - 500, e.T * 1000)));
      var l = leg();
      // quem fala agora (StreamKit)
      var quem = '';
      e.s.falas.forEach(function (f) { if (!quem && t >= f.ini - 300 && t <= f.fim + 300) quem = f.chave; });
      var proximo = l.segmentos.filter(function (s) { return s.ini > t; })[0];
      var fim = Math.min(t + 2500, proximo ? Math.max(t + 400, proximo.ini) : t + 2500, e.corte.fim);
      var novo = { id: novoId(), ini: t, fim: Math.max(fim, t + 300), texto: '', chave: quem };
      l.segmentos.push(novo);
      l.segmentos.sort(function (a, b) { return a.ini - b.ini; });
      if (!l.ativo) { l.ativo = true; var chk = $('#leg-ativo'); if (chk) chk.checked = true; }
      salvar();
      desenharCorpo();
      var area = $('[data-seg="' + novo.id + '"] textarea');
      if (area) { area.focus(); area.scrollIntoView({ block: 'nearest' }); }
    },
    legApagar: function (el) {
      var s = seg(el);
      if (!s) return;
      leg().segmentos = leg().segmentos.filter(function (x) { return x !== s; });
      salvar();
      desenharCorpo();
    },
    legIr: function (el) {
      var s = seg(el), e = ed();
      if (s && e && e.player) e.player.tocarTrecho(s.ini / 1000, Math.min(e.corte.fim, s.fim + 300) / 1000);
    },
    legTrocar: function () {
      var de = ($('#leg-de') || {}).value || '', para = ($('#leg-para') || {}).value || '';
      if (!de.trim()) return;
      var n = 0;
      var re = new RegExp('(^|[^\\p{L}\\p{N}])(' + de.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(?=$|[^\\p{L}\\p{N}])', 'giu');
      leg().segmentos.forEach(function (s) {
        var novo = s.texto.replace(re, function (_m, a) { n++; return a + para.trim(); });
        s.texto = novo;
      });
      if (!n) { A.aviso('Não achei “' + de.trim() + '” nas legendas.'); return; }
      salvar();
      desenharCorpo();
      A.aviso(n + (n === 1 ? ' troca feita.' : ' trocas feitas.'), 'ok');
    },
    legCentralizar: function () {
      var q = st.qual || 'h';
      var p = pos(q);
      p.x = 0.5;
      mesaLeg()[q] = p;
      A.salvar(true);
    },
    legPosPadrao: function () {
      var q = st.qual || 'h';
      mesaLeg()[q] = L.normalizarPos(null, q);
      A.salvar(true);
    },
  });

  // edição do texto, tempos e quem fala
  document.addEventListener('input', function (ev) {
    var el = ev.target;
    if (!ed()) return;
    if (el.hasAttribute && el.hasAttribute('data-leg-texto')) {
      var s = seg(el);
      if (!s) return;
      s.texto = el.value.replace(/\s+/g, ' ').slice(0, 500);
      ajustarAltura(el);
      salvar();
    }
    if (el.hasAttribute && el.hasAttribute('data-leg-estilo')) { st.chaveBlocos = ''; mostrarOpcoesFundo(); }
  });
  document.addEventListener('change', function (ev) {
    var el = ev.target, e = ed();
    if (!e) return;
    if (el.id === 'leg-ativo') { leg().ativo = el.checked; salvar(); return; }
    if (el.hasAttribute('data-leg-quem')) { var s = seg(el); if (s) { s.chave = el.value; salvar(); } return; }
    if (el.hasAttribute('data-leg-ini') || el.hasAttribute('data-leg-fim')) {
      var s2 = seg(el);
      if (!s2) return;
      var t = C().lerTempo(el.value);
      if (t == null) { A.aviso('Use o formato minutos:segundos, por exemplo 0:12.5', 'erro'); desenharCorpo(); return; }
      var ms = Math.round(e.corte.ini + t * 1000);
      if (el.hasAttribute('data-leg-ini')) { s2.ini = Math.max(0, Math.min(ms, s2.fim - 200)); leg().segmentos.sort(function (a, b) { return a.ini - b.ini; }); }
      else s2.fim = Math.max(ms, s2.ini + 200);
      salvar();
      desenharCorpo();
    }
    if (el.hasAttribute('data-leg-estilo')) { st.chaveBlocos = ''; mostrarOpcoesFundo(); }
  });
  function mostrarOpcoesFundo() {
    var e = estilo();
    var a = $('#leg-com-contorno'), b = $('#leg-com-fundo');
    if (a) a.hidden = e.fundo;
    if (b) b.hidden = !e.fundo;
  }
  // atalhos dentro do texto: Enter = próximo trecho
  document.addEventListener('keydown', function (ev) {
    var el = ev.target;
    if (!el.hasAttribute || !el.hasAttribute('data-leg-texto')) return;
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      var row = el.closest('[data-seg]');
      var prox = row && row.nextElementSibling && $('textarea', row.nextElementSibling);
      if (prox) prox.focus(); else el.blur();
    }
  });

  // ================================================================ prévia e mouse
  /** Desenha a legenda do momento atual num canvas que representa o vídeo final (W×H). */
  function desenharEm(ctx, W, H, qual, editavel) {
    var e = ed(), l = leg();
    st.caixa = null;
    if (!e || !l || !l.ativo) return;
    var est = estilo(), p = st.arrasto ? st.arrasto.pos : pos(qual);
    var tamOrig = est.tamanho;
    if (st.arrasto && st.arrasto.tamanho) est.tamanho = st.arrasto.tamanho;
    var k = qual === 'v' ? W / 1080 : H / 1080;
    var cc = cores();
    var r = L.desenhar(ctx, { W: W, H: H, estilo: est, pos: p, k: k, blocos: blocos(), t: e.T * 1000, cores: cc.cores, nomes: cc.nomes, exemplo: editavel ? EXEMPLO : '' });
    est.tamanho = tamOrig;
    if (!editavel) return;
    // caixa de edição: largura máxima (linhas quebram dentro dela) e altura do texto
    var largura = p.w * W, cx = p.x * W, cy = p.y * H;
    var alt = r ? r.altura : est.tamanho * k;
    var caixa = { x: cx - largura / 2, y: cy - alt / 2 - 4, largura: largura, altura: alt + 8, cx: cx, cy: cy };
    st.caixa = caixa;
    ctx.save();
    if (st.guia) {
      ctx.strokeStyle = 'rgba(143,180,240,.8)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    }
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = st.arrasto ? 'rgba(240,180,76,.95)' : 'rgba(240,180,76,.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(caixa.x, caixa.y, caixa.largura, caixa.altura);
    ctx.setLineDash([]);
    ctx.fillStyle = '#F0B44C';
    ctx.strokeStyle = '#1A1405';
    [[caixa.x, cy], [caixa.x + caixa.largura, cy]].forEach(function (q) {
      ctx.fillRect(q[0] - 3, q[1] - 9, 6, 18); ctx.strokeRect(q[0] - 3, q[1] - 9, 6, 18);
    });
    ctx.beginPath();
    ctx.arc(caixa.x + caixa.largura, caixa.y + caixa.altura, 7, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function oQueTem(px, py) {
    var c = st.caixa;
    if (!c) return null;
    if (Math.hypot(px - (c.x + c.largura), py - (c.y + c.altura)) <= 11) return 'tamanho';
    if (Math.abs(py - c.cy) <= 14 && Math.abs(px - c.x) <= 8) return 'largura-esq';
    if (Math.abs(py - c.cy) <= 14 && Math.abs(px - (c.x + c.largura)) <= 8) return 'largura-dir';
    if (px >= c.x - 4 && px <= c.x + c.largura + 4 && py >= c.y - 4 && py <= c.y + c.altura + 4) return 'mover';
    return null;
  }
  var CURSORES = { tamanho: 'nwse-resize', 'largura-esq': 'ew-resize', 'largura-dir': 'ew-resize', mover: 'move' };

  function canvasAlvo(el) {
    if (!el || !ed()) return null;
    if (st.qual === 'h' && el.id === 'leg-h') return { cv: el, W: el.width, H: el.height };
    if (st.qual === 'v' && el.id === 'previa-vertical') return { cv: el, W: el.width, H: el.height };
    return null;
  }
  function pontoNo(alvo, ev) {
    var r = alvo.cv.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * alvo.W / r.width, y: (ev.clientY - r.top) * alvo.H / r.height };
  }

  // fase de captura: a legenda tem prioridade sobre os retratos quando estão um em cima do outro
  document.addEventListener('pointerdown', function (ev) {
    var alvo = canvasAlvo(ev.target);
    if (!alvo) return;
    var p0 = pontoNo(alvo, ev);
    var modo = oQueTem(p0.x, p0.y);
    if (!modo) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    var cv = alvo.cv;
    cv.setPointerCapture(ev.pointerId);
    var e = ed();
    if (e.player && !e.player.video.paused) e.player.video.pause();
    var q = st.qual, ini = pos(q), est = estilo();
    var caixa0 = st.caixa;
    st.arrasto = { modo: modo, pos: { x: ini.x, y: ini.y, w: ini.w }, tamanho: est.tamanho };
    var mover = function (e2) {
      var p = pontoNo(alvo, e2);
      var dx = p.x - p0.x, dy = p.y - p0.y;
      var a = st.arrasto;
      if (modo === 'mover') {
        var nx = ini.x + dx / alvo.W;
        st.guia = Math.abs(nx - 0.5) < 0.015;
        a.pos.x = Math.max(0, Math.min(1, st.guia ? 0.5 : nx));
        a.pos.y = Math.max(0.02, Math.min(0.98, ini.y + dy / alvo.H));
      } else if (modo === 'largura-dir' || modo === 'largura-esq') {
        var d = modo === 'largura-dir' ? dx : -dx;
        a.pos.w = Math.max(0.1, Math.min(1, ini.w + 2 * d / alvo.W));
      } else {
        // o canto estica a letra: proporcional ao quanto a caixa cresceu na diagonal
        var f = Math.max(0.2, 1 + (dy / Math.max(20, caixa0.altura)) * 0.9 + (dx / Math.max(40, caixa0.largura)) * 0.3);
        a.tamanho = Math.round(Math.max(16, Math.min(240, est.tamanho * f)));
        var inp = $('[data-campo="m.legendas.estilo.tamanho"]'), eco = $('[data-eco="leg-tamanho"]');
        if (inp) inp.value = a.tamanho;
        if (eco) eco.textContent = a.tamanho;
      }
      if (q === 'h') desenharH();
    };
    var soltar = function () {
      cv.removeEventListener('pointermove', mover);
      cv.removeEventListener('pointerup', soltar);
      cv.removeEventListener('pointercancel', soltar);
      var a = st.arrasto;
      st.arrasto = null;
      st.guia = false;
      if (!a) return;
      mesaLeg()[q] = L.normalizarPos(a.pos, q);
      mesaLeg().estilo.tamanho = a.tamanho;
      A.salvar(true);
      if (q === 'h') desenharH();
    };
    cv.addEventListener('pointermove', mover);
    cv.addEventListener('pointerup', soltar);
    cv.addEventListener('pointercancel', soltar);
  }, true);
  document.addEventListener('pointermove', function (ev) {
    var alvo = canvasAlvo(ev.target);
    if (!alvo || st.arrasto) return;
    var p = pontoNo(alvo, ev);
    var m = oQueTem(p.x, p.y);
    if (m) { alvo.cv.style.cursor = CURSORES[m]; ev.stopImmediatePropagation(); }
    else if (alvo.cv.id === 'leg-h') alvo.cv.style.cursor = '';
  }, true);

  // horizontal: camada por cima do vídeo
  function ajustarCanvasH() {
    var cv = $('#leg-h');
    if (!cv) return null;
    var r = cv.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(16, Math.round(r.width * dpr)), h = Math.max(9, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return cv;
  }
  function desenharH() {
    var cv = ajustarCanvasH();
    if (!cv) return;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    var l = leg();
    var IU = A.IdentidadeUI;
    // camadas da identidade visual por baixo da legenda; a imagem final por cima de tudo
    if (IU) IU.desenharEditor(ctx, cv.width, cv.height, 'h', 'leg-h');
    var temCamadas = IU && IU.camadasDoCorte(ed().corte, 'h').length;
    cv.style.pointerEvents = (l && l.ativo) || temCamadas ? 'auto' : 'none';
    desenharEm(ctx, cv.width, cv.height, 'h', true);
    if (IU) IU.desenharFinalEditor(ctx, cv.width, cv.height, 'h');
  }

  // destaca na lista o trecho que está tocando
  var ultimoAtual = '';
  function tique() {
    var e = ed();
    if (!e || st.prog) return;
    var T = e.T * 1000;
    var atual = (leg().segmentos.filter(function (s) { return T >= s.ini && T < s.fim; })[0] || {}).id || '';
    if (atual === ultimoAtual) return;
    ultimoAtual = atual;
    $$('#leg-lista .leg-seg').forEach(function (row) {
      var sim = row.getAttribute('data-seg') === atual;
      row.classList.toggle('atual', sim);
      if (sim && e.player && !e.player.video.paused && !row.contains(document.activeElement)) row.scrollIntoView({ block: 'nearest' });
    });
  }

  function montar(qual) {
    sair();
    st.qual = qual;
    st.versao++;
    ultimoAtual = '';
    desenharCorpo();
    // retoma o acompanhamento se uma transcrição deste corte ainda estiver rodando
    acompanhar();
    if (qual === 'h') {
      var loop = function () {
        if (!ed() || !$('#leg-h')) { st.raf = 0; return; }
        desenharH();
        st.raf = requestAnimationFrame(loop);
      };
      st.raf = requestAnimationFrame(loop);
    }
  }
  function sair() {
    if (st.raf) cancelAnimationFrame(st.raf);
    st.raf = 0;
    clearTimeout(st.espera);
    st.prog = null;
    st.arrasto = null;
    st.caixa = null;
  }

  // ================================================================ exportação
  var medidor = null;
  /** O .ass deste corte para um formato (W×H). null se as legendas estiverem desligadas. */
  function assPara(corte, preset, sessao) {
    var l = corte.legendas;
    if (!l || !l.ativo || !l.segmentos.length || !preset || !preset.largura || !preset.altura) return null;
    var qual = preset.tipo === 'v' ? 'v' : 'h';
    var e = estilo();
    var k = qual === 'v' ? preset.largura / 1080 : preset.altura / 1080;
    medidor = medidor || document.createElement('canvas').getContext('2d');
    var cc = cores(sessao);
    return L.gerarAss({
      W: preset.largura, H: preset.altura, estilo: e, pos: pos(qual), k: k,
      segmentos: l.segmentos, inicio: corte.ini, duracao: corte.fim - corte.ini,
      cores: cc.cores, nomes: cc.nomes,
      medir: function (t, tam) { medidor.font = L.fonteCanvas(e, tam); return medidor.measureText(t).width; },
    });
  }

  A.EditorLegendas = { painel: painel, montar: montar, sair: sair, tique: tique, desenharEm: desenharEm, assPara: assPara, _st: st };
})();
