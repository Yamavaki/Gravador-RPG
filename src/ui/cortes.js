/* Telas de cortes: Momentos (sessões, marcadores, cortes, compilado e fila),
   Editor de corte (início/fim, áudio, exportar) e Editor vertical (câmera e retratos). */
(function () {
  'use strict';
  var A = window.App;
  var $ = A.$, $$ = A.$$, esc = A.esc;
  var Cam = window.Camera, Lay = window.LayoutRetratos, Pau = window.Pausas, Ident = window.Identidade;

  // ================================================================ utilidades
  function fmt(s) {
    s = Math.max(0, s || 0);
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), seg = s % 60;
    var d = function (n) { return ('0' + n).slice(-2); };
    return (h ? h + ':' + d(m) : m) + ':' + d(Math.floor(seg)) + '.' + Math.floor((seg % 1) * 10);
  }
  function lerTempo(txt) {
    var p = String(txt || '').trim().replace(',', '.').split(':').map(Number);
    if (!p.length || p.some(function (x) { return !isFinite(x); })) return null;
    return p.reduce(function (t, x) { return t * 60 + x; }, 0);
  }
  function dataHora(ms) {
    return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function duracaoTexto(ms) {
    var m = Math.round(ms / 60000);
    return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min';
  }
  var PRESETS = {
    'youtube-2k': { nome: 'YouTube 2K', sub: '2560×1440', tipo: 'h', largura: 2560, altura: 1440 },
    'youtube-1080': { nome: 'YouTube 1080p', sub: '1920×1080', tipo: 'h', largura: 1920, altura: 1080 },
    whatsapp: { nome: 'WhatsApp', sub: '720p, até 16 MB', tipo: 'h', largura: 1280, altura: 720 },
    vertical: { nome: 'TikTok / Reels / Shorts', sub: '1080×1920', tipo: 'v', largura: 1080, altura: 1920 },
    'whatsapp-vertical': { nome: 'WhatsApp vertical', sub: '720×1280, até 16 MB', tipo: 'v', largura: 720, altura: 1280 },
    rapido: { nome: 'Corte rápido', sub: 'original, sem recodificar, todas as faixas', tipo: 'c' },
  };

  // ================================================================ fila de exportação
  function filaHtml() {
    var E = A.E();
    var lista = (E && E.fila) || [];
    var ff = (E && E.ffmpeg) || {};
    var aviso = ff.verificando ? '<p class="ajuda">Procurando o FFmpeg…</p>' :
      !ff.ok ? '<p class="erro-campo">' + esc(ff.erro || 'FFmpeg não encontrado.') + ' <a href="#gravacao">Configurar</a></p>' :
        '<p class="ajuda">FFmpeg ' + esc(ff.versao) + (ff.nvenc ? ' · usando a placa NVIDIA (NVENC)' : ' · usando o processador (NVENC não disponível)') + '</p>';
    var itens = lista.slice().reverse().map(function (t) {
      var pct = Math.round((t.progresso || 0) * 100);
      var estado = { espera: 'Na fila', rodando: pct + '%', pronto: 'Pronto', erro: 'Erro', cancelado: 'Cancelado' }[t.estado];
      return '<div class="item-fila" data-fila="' + esc(t.id) + '">' +
        '<div class="linha" style="justify-content:space-between"><strong>' + esc(t.titulo) + '</strong><span class="' + (t.estado === 'erro' ? 'erro-campo' : t.estado === 'pronto' ? 'ok-campo' : 'ajuda') + '">' + estado + '</span></div>' +
        (t.estado === 'rodando' || t.estado === 'espera' ? '<div class="barra"><div style="width:' + pct + '%"></div></div>' : '') +
        (t.erro ? '<div class="erro-campo">' + esc(t.erro) + '</div>' : '') +
        (t.avisos && t.avisos.length ? '<div class="ajuda">' + t.avisos.map(esc).join('<br>') + '</div>' : '') +
        '<div class="linha">' +
        (t.estado === 'rodando' || t.estado === 'espera' ? '<button class="pequeno" data-acao="cancelarExportacao" data-id="' + esc(t.id) + '">Cancelar</button>' : '') +
        (t.estado === 'pronto' ? '<button class="pequeno" data-acao="mostrarArquivo" data-id="' + esc(t.id) + '">Mostrar na pasta</button>' : '') +
        '</div></div>';
    }).join('');
    return '<div class="titulo"><h2>Exportações</h2><div class="linha">' +
      (lista.some(function (t) { return t.estado !== 'espera' && t.estado !== 'rodando'; }) ? '<button class="pequeno" data-acao="limparFila">Limpar concluídas</button>' : '') +
      '<button class="pequeno" data-acao="abrirPastaCortes">Abrir pasta dos cortes</button></div></div>' + aviso +
      (itens || '<p class="ajuda">Nada exportando. Os arquivos vão para: <code>' + esc((E && E.pastaCortes) || '') + '</code></p>');
  }
  function atualizarFila() {
    var el = $('#vivo-fila');
    if (el) el.innerHTML = filaHtml();
  }

  Object.assign(A.ACOES, {
    cancelarExportacao: function (el) { return window.api.cancelarExportacao(el.getAttribute('data-id')); },
    mostrarArquivo: function (el) { return window.api.mostrarArquivo(el.getAttribute('data-id')); },
    limparFila: function () { return window.api.limparFila(); },
    abrirPastaCortes: function () { return window.api.abrirPastaCortes(); },
  });

  // ================================================================ retratos para cortes
  /** Pessoas de uma sessão com tudo o que o adesivo precisa (dados atuais da mesa quando existem). */
  function pessoasDaSessao(s) {
    var m = A.mesa();
    var porId = {};
    m.jogadores.forEach(function (j) { porId[j.id] = j; });
    var lista = [];
    var vistos = {};
    (s.jogadores || []).forEach(function (snap) {
      var j = porId[snap.id] || Object.assign({ foco: { x: 50, y: 50, zoom: 100 }, cor: '#4A5A7A', nomeModo: 'padrao' }, snap);
      vistos[snap.id] = true;
      lista.push(j);
    });
    m.jogadores.forEach(function (j) { if (!vistos[j.id]) lista.push(j); });
    return lista.map(function (j) {
      return {
        chave: j.id, url: A.urlImagem(j.imagem), foco: j.foco, cor: j.cor,
        nome: A.nomeNoVideo(j), iniciais: A.iniciais(A.rotuloPessoa(j)),
      };
    });
  }
  function opcoesAdesivo(tamanho) {
    var m = A.mesa();
    return {
      tamanho: tamanho, forma: m.overlay.forma, efeito: m.overlay.efeito, moldura: m.overlay.moldura,
      apagar: m.overlay.apagarSilenciosos, comNome: m.nomes.modo !== 'nenhum', nomeQuieto: m.nomes.quando !== 'falando',
    };
  }
  /** Retratos e layout para um formato (o tamanho acompanha a resolução de saída). */
  function retratosPara(s, preset, corte) {
    var p = PRESETS[preset];
    var m = A.mesa();
    if (p.tipo === 'v') {
      var v = m.vertical;
      if (!v.ativo) return Promise.resolve({ retratos: [], layout: { layout: 'nenhum' } });
      var k = p.largura / 1080;
      var o = opcoesAdesivo(v.tamanho * k);
      return Retratos.adesivos(pessoasDaSessao(s), o, true).then(function (r) {
        return { retratos: r, layout: posVertical(m, k) };
      });
    }
    if (p.tipo === 'h' && corte.retratosHorizontal) {
      var kh = p.altura / 1080;
      var ov = m.overlay;
      var oh = opcoesAdesivo(ov.tamanho * kh);
      return Retratos.adesivos(pessoasDaSessao(s), oh, true).then(function (r) {
        // mesma posição do overlay ao vivo (âncora, direção, ordem, deslocamento), na escala do vídeo
        return { retratos: r, layout: {
          ancora: ov.ancora, direcao: ov.direcao, ordem: ov.ordem, mostrar: ov.mostrar, espaco: ov.espaco,
          deslocX: ov.deslocX * kh, deslocY: ov.deslocY * kh, tamanho: ov.tamanho * kh, margem: ov.margem * kh,
          comNome: oh.comNome, esconderQuietos: ov.ocultarAusentes,
        }, retratosHorizontal: true };
      });
    }
    return Promise.resolve({ retratos: [], layout: { layout: 'nenhum' } });
  }

  /** Exporta um corte salvo em vários formatos (cada um com seus retratos). */
  function exportarCorte(s, corte, presets) {
    if (!presets.length) { A.aviso('Escolha pelo menos um formato.', 'erro'); return Promise.resolve(); }
    var cadeia = Promise.resolve();
    var ok = 0;
    var comLegenda = corte.legendas && corte.legendas.ativo && corte.legendas.segmentos.length;
    if (comLegenda && presets.indexOf('rapido') >= 0) A.aviso('O corte rápido copia o vídeo original e não leva legendas; os outros formatos levam.');
    presets.forEach(function (preset) {
      cadeia = cadeia.then(function () { return retratosPara(s, preset, corte); }).then(function (r) {
        var legendas = {};
        var ass = comLegenda && A.EditorLegendas ? A.EditorLegendas.assPara(corte, PRESETS[preset], s) : null;
        if (ass) legendas[preset] = ass;
        return A.IdentidadeUI.visualPara(corte, PRESETS[preset]).then(function (vis) {
          var por = function (x) { var o = {}; if (x) o[preset] = x; return o; };
          return window.api.exportar({
            sessaoId: s.id, corteId: corte.id, presets: [preset], retratos: r.retratos, layout: r.layout, retratosHorizontal: !!r.retratosHorizontal,
            legendas: legendas, camadas: por(vis.camadas.length ? vis.camadas : null), final: por(vis.final), fundo: por(vis.fundo),
          });
        });
      }).then(function (r) {
        if (r && r.erro) A.aviso(r.erro, 'erro'); else ok++;
      });
    });
    return cadeia.then(function () { if (ok) A.aviso(ok === 1 ? 'Na fila de exportação.' : ok + ' arquivos na fila de exportação.', 'ok'); });
  }

  // ================================================================ MOMENTOS
  var abertas = {};      // sessão id -> dados (aberta na tela)
  var selecionados = []; // compilado: [{sessaoId, corteId, nome}]
  var sessoesLista = null;

  A.TELAS.momentos = {
    html: function () {
      return '<header class="cabecalho"><div><h1>Momentos e cortes</h1>' +
        '<p>Cada gravação vira uma sessão aqui, com os marcadores. Crie um corte, ajuste e exporte para YouTube, WhatsApp ou vertical.</p></div></header>' +
        '<section class="painel" id="vivo-fila"></section>' +
        '<section class="painel" id="compilado" hidden></section>' +
        '<div id="lista-sessoes" class="coluna" style="gap:14px"><div class="vazio">Carregando sessões…</div></div>';
    },
    depois: function () {
      atualizarFila();
      desenharCompilado();
      window.api.sessoes().then(function (lista) {
        sessoesLista = Array.isArray(lista) ? lista : [];
        desenharSessoes();
        // abre a mais recente sozinha
        if (sessoesLista[0] && !Object.keys(abertas).length) abrirSessao(sessoesLista[0].id);
        else Object.keys(abertas).forEach(function (id) { abrirSessao(id); });
      });
    },
    vivo: atualizarFila,
  };

  function desenharSessoes() {
    var el = $('#lista-sessoes');
    if (!el) return;
    if (!sessoesLista.length) {
      el.innerHTML = '<div class="vazio">Nenhuma sessão gravada ainda. Grave com o OBS conectado e os momentos aparecem aqui.</div>';
      return;
    }
    el.innerHTML = sessoesLista.map(function (s) {
      var semVideo = s.arquivos && !s.arquivosExistem;
      return '<section class="painel sessao-cartao" data-sessao="' + esc(s.id) + '">' +
        '<div class="titulo"><div><h2>' + esc(dataHora(s.inicio)) + (s.mesa ? ' · ' + esc(s.mesa) : '') + '</h2>' +
        '<div class="ajuda">' + duracaoTexto(s.duracao) + ' · ' + s.marcadores + ' marcador(es) · ' + s.cortes + ' corte(s)' +
        (semVideo ? ' · <span class="erro-campo">vídeo já apagado pela limpeza</span>' : s.arquivos && s.arquivosExistem < s.arquivos ? ' · parte do vídeo já foi apagada' : '') + '</div></div>' +
        '<button class="pequeno" data-acao="alternarSessao" data-id="' + esc(s.id) + '" aria-expanded="' + (abertas[s.id] ? 'true' : 'false') + '">' + (abertas[s.id] ? 'Fechar' : 'Abrir') + '</button></div>' +
        '<div class="corpo-sessao" data-corpo="' + esc(s.id) + '">' + (abertas[s.id] ? corpoSessao(abertas[s.id]) : '') + '</div></section>';
    }).join('');
  }

  function abrirSessao(id) {
    abertas[id] = abertas[id] || { carregando: true, id: id };
    var corpo = $('[data-corpo="' + id + '"]');
    if (corpo && abertas[id].carregando) corpo.innerHTML = '<p class="ajuda">Lendo a sessão…</p>';
    return window.api.sessao(id).then(function (s) {
      if (!s || s.erro) { A.aviso((s && s.erro) || 'Não foi possível abrir a sessão.', 'erro'); delete abertas[id]; return; }
      s.momentos = (abertas[id] && abertas[id].momentos) || null;
      abertas[id] = s;
      var c = $('[data-corpo="' + id + '"]');
      if (c) c.innerHTML = corpoSessao(s);
      if (!s.momentos && temVideo(s)) buscarMomentos(id, 'cache');
      var b = $('[data-acao="alternarSessao"][data-id="' + id + '"]');
      if (b) { b.textContent = 'Fechar'; b.setAttribute('aria-expanded', 'true'); }
    });
  }

  // ---------------------------------------------------------------- momentos sugeridos
  var esperaMomentos = {};
  function buscarMomentos(id, modo) {
    clearTimeout(esperaMomentos[id]);
    return window.api.momentos(id, modo || '').then(function (r) {
      var s = abertas[id];
      if (!s || s.carregando) return;
      if (!r || r.erro && r.estado !== 'erro') { s.momentos = { estado: 'erro', erro: (r && r.erro) || 'Falhou.' }; }
      else s.momentos = r;
      var el = $('[data-momentos="' + id + '"]');
      if (el) el.innerHTML = momentosHtml(s);
      // enquanto analisa, pergunta de novo a cada segundo
      if (r && r.estado === 'rodando') esperaMomentos[id] = setTimeout(function () { buscarMomentos(id); }, 1000);
    });
  }
  function momentosHtml(s) {
    var m = s.momentos;
    var botao = '<button class="pequeno principal" data-acao="procurarMomentos" data-sessao="' + esc(s.id) + '">✨ Procurar momentos</button>';
    if (!m || m.estado === 'nada') return '<p class="ajuda">O app ouve a sessão e sugere trechos animados que você não marcou: risadas, gritos, várias pessoas falando juntas.</p>' + botao;
    if (m.estado === 'rodando') {
      var pct = Math.round((m.progresso || 0) * 100);
      return '<p class="ajuda">Ouvindo a sessão… ' + pct + '%</p><div class="barra"><div style="width:' + pct + '%"></div></div>';
    }
    if (m.estado === 'erro') return '<p class="erro-campo">' + esc(m.erro) + '</p>' + botao;
    var lista = m.sugestoes || [];
    if (!lista.length) return '<p class="ajuda">Nada que se destaque além dos marcadores que você já fez.</p>' +
      '<button class="pequeno" data-acao="procurarMomentos" data-sessao="' + esc(s.id) + '" data-modo="refazer">Procurar de novo</button>';
    return lista.map(function (x) {
      return '<div class="marcador sugestao"><span class="tempo">' + fmt(x.t / 1000).replace(/\.\d$/, '') + '</span>' +
        '<span style="flex:1;min-width:0">' + esc(x.motivos.join(' · ')) + (x.quem && x.quem.length ? ' <span class="ajuda">· ' + esc(x.quem.join(', ')) + '</span>' : '') + '</span>' +
        '<button class="pequeno" data-acao="corteDoMomento" data-sessao="' + esc(s.id) + '" data-rel="' + x.t + '">Criar corte</button>' +
        '<button class="pequeno icone" data-acao="descartarMomento" data-sessao="' + esc(s.id) + '" data-t="' + x.t + '" title="Não é um momento bom" aria-label="Descartar sugestão">✕</button></div>';
    }).join('') + '<button class="pequeno" data-acao="procurarMomentos" data-sessao="' + esc(s.id) + '" data-modo="refazer" style="margin-top:6px">Procurar de novo</button>';
  }

  function temVideo(s) { return s.arquivos.some(function (a) { return a.existe; }); }

  function corpoSessao(s) {
    if (s.carregando) return '<p class="ajuda">Lendo a sessão…</p>';
    var video = temVideo(s);
    var marc = s.marcadores.length ? s.marcadores.map(function (m) {
      return '<div class="marcador"><span class="tempo">' + fmt(m.rel / 1000).replace(/\.\d$/, '') + '</span>' +
        '<span style="flex:1">' + esc(m.nome || 'Sem nome') + ' <span class="ajuda">' + esc({ atalho: '', 'atalho-nome': '', botao: '', foundry: '· Foundry', replay: '· replay' }[m.origem] || '') + '</span></span>' +
        (video ? '<button class="pequeno" data-acao="corteDoMarcador" data-sessao="' + esc(s.id) + '" data-rel="' + m.rel + '" data-nome="' + esc(m.nome) + '">Criar corte</button>' : '') + '</div>';
    }).join('') : '<p class="ajuda">Sem marcadores nesta sessão.</p>';
    var reps = s.replays.filter(function (r) { return r.existe; }).map(function (r) {
      return '<div class="marcador"><span class="tempo">' + fmt(r.rel / 1000).replace(/\.\d$/, '') + '</span><span style="flex:1">Replay salvo</span>' +
        '<button class="pequeno" data-acao="corteDoReplay" data-sessao="' + esc(s.id) + '" data-fonte="' + esc('replay:' + r.caminho) + '">Criar corte</button></div>';
    }).join('');
    var cortes = s.cortes.length ? s.cortes.map(function (c) {
      var sel = selecionados.some(function (x) { return x.corteId === c.id; });
      return '<div class="corte-linha">' +
        '<label class="opcao" style="flex:1;min-width:0"><input type="checkbox" data-compilado data-sessao="' + esc(s.id) + '" data-corte="' + esc(c.id) + '" data-nome="' + esc(c.nome) + '"' + (sel ? ' checked' : '') + ' aria-label="Pôr no compilado">' +
        '<span style="min-width:0"><strong>' + esc(c.nome) + '</strong><small>' + fmt(c.ini / 1000) + ' → ' + fmt(c.fim / 1000) + ' · ' + fmt((c.fim - c.ini) / 1000) + (c.fonte !== 'gravacao' ? ' · do replay' : '') + '</small></span></label>' +
        '<div class="linha"><a class="botao pequeno" href="#corte/' + encodeURIComponent(s.id) + '/' + encodeURIComponent(c.id) + '">Editar</a>' +
        '<a class="botao pequeno" href="#vertical/' + encodeURIComponent(s.id) + '/' + encodeURIComponent(c.id) + '">Vertical</a>' +
        '<button class="pequeno icone perigo" data-acao="excluirCorte" data-sessao="' + esc(s.id) + '" data-corte="' + esc(c.id) + '" aria-label="Excluir corte ' + esc(c.nome) + '" title="Excluir">✕</button></div></div>';
    }).join('') : '<p class="ajuda">Nenhum corte ainda. Clique em “Criar corte” num marcador.</p>';
    return '<div class="grade" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">' +
      '<div class="coluna"><h3>Marcadores</h3>' + marc + (reps ? '<h3 style="margin-top:8px">Replays</h3>' + reps : '') +
      (video ? '<div class="linha" style="margin-top:6px"><button class="pequeno" data-acao="corteInteiro" data-sessao="' + esc(s.id) + '">Corte da sessão inteira</button>' +
        (s.marcadores.length ? '<button class="pequeno" data-acao="cortesDosMarcadores" data-sessao="' + esc(s.id) + '">Criar corte de todos os marcadores</button>' : '') + '</div>' +
        '<h3 style="margin-top:10px">Momentos sugeridos</h3><div class="coluna" data-momentos="' + esc(s.id) + '">' + momentosHtml(s) + '</div>' :
        '<p class="erro-campo">O vídeo desta sessão já foi apagado: dá para ver os marcadores, mas não exportar.</p>') +
      '</div><div class="coluna"><h3>Cortes</h3>' + cortes + '</div></div>' +
      (s.erroFFmpeg ? '<p class="erro-campo">' + esc(s.erroFFmpeg) + '</p>' : '');
  }

  function desenharCompilado() {
    var el = $('#compilado');
    if (!el) return;
    el.hidden = !selecionados.length;
    if (!selecionados.length) return;
    var opcoes = Object.keys(PRESETS).filter(function (k) { return k !== 'rapido'; });
    el.innerHTML = '<div class="titulo"><h2>Compilado (' + selecionados.length + ' corte' + (selecionados.length > 1 ? 's' : '') + ')</h2>' +
      '<button class="pequeno" data-acao="limparCompilado">Desmarcar todos</button></div>' +
      '<ol class="lista-compilado">' + selecionados.map(function (x, i) {
        return '<li><span style="flex:1">' + esc(x.nome) + '</span>' +
          '<button class="pequeno icone" data-acao="moverCompilado" data-i="' + i + '" data-dir="-1" aria-label="Subir"' + (i ? '' : ' disabled') + '>↑</button>' +
          '<button class="pequeno icone" data-acao="moverCompilado" data-i="' + i + '" data-dir="1" aria-label="Descer"' + (i < selecionados.length - 1 ? '' : ' disabled') + '>↓</button></li>';
      }).join('') + '</ol>' +
      '<div class="campos"><label class="campo"><span class="rotulo">Nome do vídeo</span><input type="text" id="nome-compilado" value="Melhores momentos"></label>' +
      '<label class="campo"><span class="rotulo">Formato</span><select id="preset-compilado">' + opcoes.map(function (k) {
        return '<option value="' + k + '">' + esc(PRESETS[k].nome) + '</option>';
      }).join('') + '</select></label></div>' +
      '<div class="linha"><button class="principal" data-acao="montarCompilado">Montar compilado</button>' +
      '<span class="ajuda">Os cortes entram na ordem acima, cada um com a câmera e o áudio que você ajustou.</span></div>';
  }

  Object.assign(A.ACOES, {
    alternarSessao: function (el) {
      var id = el.getAttribute('data-id');
      if (abertas[id]) {
        delete abertas[id];
        $('[data-corpo="' + id + '"]').innerHTML = '';
        el.textContent = 'Abrir';
        el.setAttribute('aria-expanded', 'false');
        return;
      }
      return abrirSessao(id);
    },
    corteDoMarcador: function (el) {
      var id = el.getAttribute('data-sessao');
      return window.api.criarCorte(id, { rel: Number(el.getAttribute('data-rel')), nome: el.getAttribute('data-nome') || 'Corte' }).then(function (c) {
        if (c && c.erro) return A.aviso(c.erro, 'erro');
        location.hash = '#corte/' + encodeURIComponent(id) + '/' + encodeURIComponent(c.id);
      });
    },
    procurarMomentos: function (el) {
      var id = el.getAttribute('data-sessao');
      var s = abertas[id];
      if (s) { s.momentos = { estado: 'rodando', progresso: 0 }; var c = $('[data-momentos="' + id + '"]'); if (c) c.innerHTML = momentosHtml(s); }
      return buscarMomentos(id, el.getAttribute('data-modo') || '');
    },
    corteDoMomento: function (el) {
      var id = el.getAttribute('data-sessao');
      return window.api.criarCorte(id, { rel: Number(el.getAttribute('data-rel')), nome: 'Momento sugerido' }).then(function (c) {
        if (c && c.erro) return A.aviso(c.erro, 'erro');
        location.hash = '#corte/' + encodeURIComponent(id) + '/' + encodeURIComponent(c.id);
      });
    },
    descartarMomento: function (el) {
      var id = el.getAttribute('data-sessao'), t = Number(el.getAttribute('data-t'));
      return window.api.descartarMomento(id, t).then(function () {
        var s = abertas[id];
        if (s && s.momentos && s.momentos.sugestoes) s.momentos.sugestoes = s.momentos.sugestoes.filter(function (x) { return x.t !== t; });
        var c = $('[data-momentos="' + id + '"]');
        if (c && s) c.innerHTML = momentosHtml(s);
      });
    },
    cortesDosMarcadores: function (el) {
      var id = el.getAttribute('data-sessao');
      return window.api.cortesDosMarcadores(id).then(function (r) {
        if (r && r.erro) return A.aviso(r.erro, 'erro');
        A.aviso(r.criados ? r.criados + ' corte(s) criado(s). Marque vários e use o Compilado, ou exporte um por um.' : 'Todos os marcadores já têm corte.', 'ok');
        return abrirSessao(id);
      });
    },
    corteDoReplay: function (el) {
      var id = el.getAttribute('data-sessao');
      return window.api.criarCorte(id, { fonte: el.getAttribute('data-fonte'), nome: 'Replay' }).then(function (c) {
        if (c && c.erro) return A.aviso(c.erro, 'erro');
        location.hash = '#corte/' + encodeURIComponent(id) + '/' + encodeURIComponent(c.id);
      });
    },
    corteInteiro: function (el) {
      var id = el.getAttribute('data-sessao');
      return window.api.criarCorte(id, { inteira: true }).then(function (c) {
        if (c && c.erro) return A.aviso(c.erro, 'erro');
        location.hash = '#corte/' + encodeURIComponent(id) + '/' + encodeURIComponent(c.id);
      });
    },
    excluirCorte: function (el) {
      var id = el.getAttribute('data-sessao'), corte = el.getAttribute('data-corte');
      if (!confirm('Excluir este corte? Os vídeos já exportados continuam na pasta.')) return;
      selecionados = selecionados.filter(function (x) { return x.corteId !== corte; });
      return window.api.excluirCorte(id, corte).then(function () { desenharCompilado(); return abrirSessao(id); });
    },
    limparCompilado: function () {
      selecionados = [];
      $$('[data-compilado]').forEach(function (c) { c.checked = false; });
      desenharCompilado();
    },
    moverCompilado: function (el) {
      var i = Number(el.getAttribute('data-i')), d = Number(el.getAttribute('data-dir'));
      var x = selecionados[i];
      selecionados.splice(i, 1);
      selecionados.splice(i + d, 0, x);
      desenharCompilado();
    },
    montarCompilado: function () {
      var preset = $('#preset-compilado').value;
      var nome = $('#nome-compilado').value;
      var s0 = abertas[selecionados[0].sessaoId];
      var prep = s0 && !s0.carregando ? retratosPara(s0, preset, { retratosHorizontal: false }) : Promise.resolve({ retratos: [], layout: { layout: 'nenhum' } });
      return prep.then(function (r) {
        return A.IdentidadeUI.visualPara(null, PRESETS[preset]).then(function (vis) {
          return window.api.compilado({ itens: selecionados.map(function (x) { return { sessaoId: x.sessaoId, corteId: x.corteId }; }), preset: preset, nome: nome, retratos: r.retratos, layout: r.layout,
            camadas: vis.camadas, final: vis.final, fundo: vis.fundo });
        });
      }).then(function (r) { A.resultado(r, true); });
    },
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el.hasAttribute || !el.hasAttribute('data-compilado')) return;
    var corte = el.getAttribute('data-corte');
    selecionados = selecionados.filter(function (x) { return x.corteId !== corte; });
    if (el.checked) selecionados.push({ sessaoId: el.getAttribute('data-sessao'), corteId: corte, nome: el.getAttribute('data-nome') });
    desenharCompilado();
  });

  // ================================================================ player (vários pedaços de vídeo)
  /** Toca a gravação como se fosse um vídeo só, trocando de pedaço sozinho. */
  function Player(video, arquivos, aoTempo, pausas) {
    this.pausas = pausas || [];
    this.video = video;
    video.crossOrigin = 'anonymous'; // o servidor do app libera; a prévia pode ler os quadros
    this.arquivos = arquivos.filter(function (a) { return a.existe && a.url; });
    this.atual = -1;
    this.aoTempo = aoTempo;
    this.limite = null;  // segundos: para aqui
    var self = this;
    video.addEventListener('timeupdate', function () { self._tique(); });
    video.addEventListener('seeked', function () { self._tique(); });
    video.addEventListener('ended', function () {
      var prox = self.arquivos[self.atual + 1];
      if (prox) self.ir(prox.inicio, true);
    });
  }
  // os vídeos ficam no "tempo da gravação" (sem as pausas do OBS); a tela usa o tempo da sessão
  Player.prototype.T = function () {
    var a = this.arquivos[this.atual];
    if (!a) return 0;
    return Pau.paraSessao((a.inicio + (this.video.currentTime || 0)) * 1000, this.pausas) / 1000;
  };
  Player.prototype._tique = function () {
    var T = this.T();
    if (this.limite != null && !this.video.paused && T >= this.limite) { this.video.pause(); this.limite = null; }
    if (this.aoTempo) this.aoTempo(T);
  };
  Player.prototype.ir = function (T, tocar) {
    var lista = this.arquivos;
    if (!lista.length) return;
    T = Pau.paraGravacao(Math.max(0, T) * 1000, this.pausas) / 1000;
    var i = 0;
    for (var k = 0; k < lista.length; k++) if (T >= lista[k].inicio) i = k;
    var a = lista[i];
    var off = Math.max(0, Math.min(a.duracao - 0.05, T - a.inicio));
    var v = this.video;
    var self = this;
    if (i !== this.atual) {
      this.atual = i;
      v.src = a.url;
      v.addEventListener('loadedmetadata', function pronto() {
        v.removeEventListener('loadedmetadata', pronto);
        v.currentTime = off;
        if (tocar) v.play().catch(function () {});
        self._tique();
      });
    } else {
      v.currentTime = off;
      if (tocar) v.play().catch(function () {});
    }
  };
  Player.prototype.tocarTrecho = function (de, ate) { this.limite = ate; this.ir(de, true); };
  Player.prototype.alternar = function () {
    if (this.video.paused) { this.limite = null; this.video.play().catch(function () {}); } else this.video.pause();
  };
  Player.prototype.parar = function () { try { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); } catch (e) { /* */ } };

  // ================================================================ estado dos editores
  var ed = null; // { s, corte, player, T, salvarTimer, janela:[a,b], ... }

  function carregarEditor(depois) {
    var p = A.params();
    var sid = p[0], cid = p[1];
    var alvo = $('#editor');
    return window.api.sessao(sid).then(function (s) {
      if (!s || s.erro) { alvo.innerHTML = '<div class="vazio">' + esc((s && s.erro) || 'Sessão não encontrada.') + ' <a href="#momentos">Voltar</a></div>'; return; }
      var corte = s.cortes.filter(function (c) { return c.id === cid; })[0];
      if (!corte) { alvo.innerHTML = '<div class="vazio">Corte não encontrado. <a href="#momentos">Voltar</a></div>'; return; }
      ed = { s: s, corte: corte, T: corte.ini / 1000 };
      depois();
    });
  }

  /** Arquivos que formam o vídeo do corte (a gravação ou o replay). */
  function arquivosDoCorte() {
    if (ed.corte.fonte && ed.corte.fonte.indexOf('replay:') === 0) {
      var cam = ed.corte.fonte.slice(7);
      var r = ed.s.replays.filter(function (x) { return x.caminho === cam; })[0];
      if (!r) return [];
      // o replay termina no momento em que foi salvo
      var dur = r.duracao || ed.duracaoReplay || 30;
      return [{ url: r.url, existe: r.existe, inicio: Math.max(0, Pau.paraGravacao(r.rel, ed.s.pausas) / 1000 - dur), duracao: dur, replay: true }];
    }
    return ed.s.arquivos;
  }

  function salvarCorte(imediato) {
    clearTimeout(ed.salvarTimer);
    var st = $('#status-salvo');
    if (st) st.textContent = 'Salvando…';
    var s = ed.s, c = ed.corte;
    ed.salvarTimer = setTimeout(function () {
      var enviado = { ini: c.ini, fim: c.fim };
      window.api.salvarCorte(s.id, c).then(function (r) {
        if (r && r.erro) { A.aviso(r.erro, 'erro'); return; }
        // a resposta só vale se nada mudou enquanto salvava (senão desfaria a edição nova)
        if (ed && ed.corte === c && c.ini === enviado.ini && c.fim === enviado.fim && (r.ini !== c.ini || r.fim !== c.fim)) {
          c.ini = r.ini; c.fim = r.fim;
          atualizarCampos();
          desenharLinhaTempo();
        }
        var st2 = $('#status-salvo');
        if (st2) st2.textContent = 'Salvo';
      });
    }, imediato ? 0 : 500);
  }

  function presetsEscolhidos() {
    return $$('[data-preset]:checked').map(function (x) { return x.value; });
  }

  // usado pelo editor de legendas (legendas-editor.js)
  A.Cortes = {
    ed: function () { return ed; }, salvarCorte: function (i) { if (ed) salvarCorte(i); },
    fmt: fmt, lerTempo: lerTempo, corPorChave: corPorChave, PRESETS: PRESETS,
  };

  // ================================================================ EDITOR DE CORTE
  A.TELAS.corte = {
    menu: 'momentos',
    html: function () {
      return '<div id="editor" class="coluna" style="gap:16px"><div class="vazio">Carregando o corte…</div></div>';
    },
    depois: function () { carregarEditor(montarCorte); },
    vivo: atualizarFila,
    sair: function () { sairEditor(); },
  };

  function sairEditor() {
    if (A.EditorLegendas) A.EditorLegendas.sair();
    if (A.IdentidadeUI) A.IdentidadeUI.sair();
    if (ed && ed.player) ed.player.parar();
    if (ed && ed.salvarTimer) { clearTimeout(ed.salvarTimer); window.api.salvarCorte(ed.s.id, ed.corte); }
    if (ed && ed.raf) cancelAnimationFrame(ed.raf);
    ed = null;
  }

  function montarCorte() {
    var s = ed.s, c = ed.corte;
    var cfg = A.cfg();
    var nAudio = (s.fonte && s.fonte.audios) || 1;
    var faixas = '';
    for (var k = 2; k <= Math.min(nAudio, 8); k++) {
      faixas += '<label class="campo"><span class="rotulo">' + esc(cfg.cortes.nomesFaixas[k - 1] || 'Faixa ' + k) + ': <span data-eco-faixa="' + k + '">' + c.audio.volumes[k] + '</span>%</span>' +
        '<input type="range" min="0" max="200" step="5" value="' + c.audio.volumes[k] + '" data-volume="' + k + '"></label>';
    }
    var escolhidos = cfg.cortes.presets;
    $('#editor').innerHTML =
      '<header class="cabecalho"><div><a href="#momentos" class="ajuda">← Momentos</a>' +
      '<div class="linha" style="margin-top:6px"><input type="text" id="nome-corte" value="' + esc(c.nome) + '" aria-label="Nome do corte" style="font-size:20px;font-weight:600;min-width:320px;max-width:520px">' +
      '<span class="ajuda" id="status-salvo">Salvo</span></div>' +
      '<p>' + esc(dataHora(s.inicio)) + (s.mesa ? ' · ' + esc(s.mesa.nome) : '') + (c.fonte !== 'gravacao' ? ' · do replay' : '') + '</p></div>' +
      '<a class="botao principal" href="#vertical/' + encodeURIComponent(s.id) + '/' + encodeURIComponent(c.id) + '">Editar vertical →</a></header>' +
      '<div class="grade" style="grid-template-columns:minmax(0,1.6fr) minmax(300px,1fr)">' +
      '<section class="painel"><div class="video-caixa"><video id="video" preload="auto" playsinline></video><canvas id="leg-h" class="leg-camada" aria-label="Legenda: arraste para mover, puxe a bolinha para o tamanho e as laterais para a largura"></canvas><div class="sem-video" id="sem-video" hidden>Vídeo deste trecho não encontrado.</div></div>' +
      '<div class="linha controles-video">' +
      '<button class="icone" data-acao="tocar" aria-label="Tocar ou pausar (espaço)" title="Tocar/pausar (espaço)" id="botao-tocar">▶</button>' +
      '<button class="pequeno" data-acao="ouvirCorte" title="Toca só o trecho do corte">Ver o corte</button>' +
      '<span class="mono" id="tempo-atual">0:00.0</span>' +
      '<span class="ajuda" style="margin-left:auto"><kbd>I</kbd> início · <kbd>O</kbd> fim · <kbd>←</kbd><kbd>→</kbd> 0,1 s (com <kbd>Shift</kbd> 1 s)</span></div>' +
      '<div id="linha-tempo" class="linha-tempo" aria-label="Linha do tempo do corte"></div>' +
      '<div class="campos">' +
      '<label class="campo"><span class="rotulo">Início</span><div class="linha" style="flex-wrap:nowrap"><input type="text" id="campo-ini" class="mono"><button class="pequeno" data-acao="marcarIni" title="Usar o ponto atual (I)">Aqui</button></div></label>' +
      '<label class="campo"><span class="rotulo">Fim</span><div class="linha" style="flex-wrap:nowrap"><input type="text" id="campo-fim" class="mono"><button class="pequeno" data-acao="marcarFim" title="Usar o ponto atual (O)">Aqui</button></div></label>' +
      '<div class="campo"><span class="rotulo">Duração</span><strong id="duracao-corte" style="min-height:38px;display:flex;align-items:center"></strong></div>' +
      '</div></section>' +
      '<div class="coluna" style="gap:16px">' +
      '<section class="painel"><h2>Áudio</h2>' +
      '<label class="opcao"><input type="radio" name="modo-audio" value="faixa1"' + A.marcado(c.audio.modo !== 'mix') + '><span>Áudio pronto (' + esc(cfg.cortes.nomesFaixas[0]) + ')<small>A faixa 1 do OBS, com tudo junto</small></span></label>' +
      (nAudio > 1 ? '<label class="opcao"><input type="radio" name="modo-audio" value="mix"' + A.marcado(c.audio.modo === 'mix') + '><span>Misturar as faixas separadas<small>Abaixe a música ou tire uma conversa</small></span></label>' +
        '<div id="faixas" class="coluna"' + (c.audio.modo === 'mix' ? '' : ' hidden') + '>' + faixas + '</div>' :
        '<p class="ajuda">Este vídeo tem só uma faixa de áudio. Para separar microfone, Discord e Foundry, veja “Primeiros passos”.</p>') +
      '<label class="campo" id="volume-1"' + (c.audio.modo === 'mix' ? ' hidden' : '') + '><span class="rotulo">Volume: <span data-eco-faixa="1">' + c.audio.volumes[1] + '</span>%</span><input type="range" min="0" max="200" step="5" value="' + c.audio.volumes[1] + '" data-volume="1"></label>' +
      '<p class="ajuda">A prévia toca a faixa 1; a mistura vale na exportação.</p></section>' +
      '<section class="painel"><h2>Exportar</h2><div class="coluna" style="gap:2px">' +
      Object.keys(PRESETS).map(function (k) {
        return '<label class="opcao"><input type="checkbox" data-preset value="' + k + '"' + A.marcado(escolhidos.indexOf(k) >= 0) + '><span>' + esc(PRESETS[k].nome) + '<small>' + esc(PRESETS[k].sub) + '</small></span></label>';
      }).join('') + '</div>' +
      '<label class="opcao"><input type="checkbox" id="retratos-h"' + A.marcado(c.retratosHorizontal) + '><span>Desenhar retratos nos vídeos horizontais<small>Use se gravou com o overlay desligado</small></span></label>' +
      '<button class="principal" data-acao="exportarCorte">Exportar</button></section>' +
      A.EditorLegendas.painel('h') +
      A.IdentidadeUI.painel() +
      '<section class="painel" id="vivo-fila"></section>' +
      '</div></div>';

    var video = $('#video');
    ed.player = new Player(video, arquivosDoCorte(), function (T) { if (ed) { ed.T = T; atualizarTempo(); } }, ed.s.pausas);
    video.addEventListener('loadedmetadata', function () {
      if (ed && ed.corte.fonte !== 'gravacao' && !ed.duracaoReplay) {
        ed.duracaoReplay = video.duration;
        ed.player.arquivos = arquivosDoCorte().filter(function (a) { return a.existe && a.url; });
        ed.player.atual = 0;
      }
    });
    video.addEventListener('play', function () { var b = $('#botao-tocar'); if (b) b.textContent = '⏸'; });
    video.addEventListener('pause', function () { var b = $('#botao-tocar'); if (b) b.textContent = '▶'; });
    video.addEventListener('error', function () { var x = $('#sem-video'); if (x) { x.hidden = false; x.textContent = 'Não foi possível tocar este vídeo aqui (o arquivo pode ter sido movido ou usa um formato que a prévia não abre). A exportação ainda funciona.'; } });
    if (!ed.player.arquivos.length) $('#sem-video').hidden = false;
    janelaDoCorte();
    desenharLinhaTempo();
    atualizarCampos();
    atualizarFila();
    A.EditorLegendas.montar('h');
    A.IdentidadeUI.montar();
    ed.player.ir(c.ini / 1000, false);
  }

  /** Trecho visível na linha do tempo: o corte com uma folga dos dois lados. */
  function janelaDoCorte() {
    var c = ed.corte;
    var total = ed.s.duracao / 1000;
    var dur = (c.fim - c.ini) / 1000;
    var folga = Math.max(10, dur * 0.4);
    ed.janela = [Math.max(0, c.ini / 1000 - folga), Math.min(Math.max(total, c.fim / 1000), c.fim / 1000 + folga)];
  }

  function corPorChave(sessao) {
    var mapa = {};
    A.mesa().jogadores.forEach(function (j) { mapa[j.id] = { cor: j.cor, nome: A.rotuloPessoa(j) }; });
    ((sessao || ed.s).jogadores || []).forEach(function (j) { if (!mapa[j.id]) mapa[j.id] = { cor: '#8A93A3', nome: j.personagem || j.jogador || 'Jogador' }; });
    return mapa;
  }

  function desenharLinhaTempo() {
    var el = $('#linha-tempo');
    if (!el || !ed) return;
    var a = ed.janela[0], b = ed.janela[1], w = b - a;
    var pct = function (t) { return ((t - a) / w * 100).toFixed(3) + '%'; };
    var c = ed.corte;
    var cores = corPorChave();
    var chaves = [];
    ed.s.falas.forEach(function (f) { if (f.fim / 1000 > a && f.ini / 1000 < b && chaves.indexOf(f.chave) < 0) chaves.push(f.chave); });
    var marcas = ed.s.marcadores.filter(function (m) { return m.rel / 1000 >= a && m.rel / 1000 <= b; }).map(function (m) {
      return '<span class="lt-marca" style="left:' + pct(m.rel / 1000) + '" title="' + esc(m.nome || 'Marcador') + '"></span>';
    }).join('');
    var trilhas = chaves.map(function (k) {
      var info = cores[k] || { cor: '#5B616C', nome: k.indexOf('nome:') === 0 ? k.slice(5) : 'Visitante' };
      return '<div class="lt-trilha"><span class="lt-nome" style="color:' + esc(info.cor) + '">' + esc(info.nome) + '</span><div class="lt-faixa">' +
        ed.s.falas.filter(function (f) { return f.chave === k && f.fim / 1000 > a && f.ini / 1000 < b; }).map(function (f) {
          var ini = Math.max(a, f.ini / 1000), fim = Math.min(b, f.fim / 1000);
          return '<i style="left:' + pct(ini) + ';width:' + ((fim - ini) / w * 100).toFixed(3) + '%;background:' + esc(info.cor) + '"></i>';
        }).join('') + '</div></div>';
    }).join('');
    el.innerHTML = '<div class="lt-regua" data-lt-trilha>' +
      '<div class="lt-regiao" style="left:' + pct(c.ini / 1000) + ';width:' + ((c.fim - c.ini) / 1000 / w * 100).toFixed(3) + '%"></div>' +
      marcas +
      '<button class="lt-alca" data-alca="ini" style="left:' + pct(c.ini / 1000) + '" aria-label="Arrastar o início"></button>' +
      '<button class="lt-alca" data-alca="fim" style="left:' + pct(c.fim / 1000) + '" aria-label="Arrastar o fim"></button>' +
      '<span class="lt-cabeca" id="lt-cabeca" style="left:' + pct(ed.T) + '"></span>' +
      '</div><div class="lt-tempos"><span>' + fmt(a) + '</span><span>' + fmt((a + b) / 2) + '</span><span>' + fmt(b) + '</span></div>' +
      (trilhas ? '<div class="lt-trilhas">' + trilhas + '</div>' : '<p class="ajuda" style="margin-top:6px">Sem falas registradas neste trecho.</p>');
  }

  function atualizarTempo() {
    if (!ed) return;
    var t = $('#tempo-atual');
    if (t) t.textContent = fmt(ed.T);
    var cab = $('#lt-cabeca');
    if (cab && ed.janela) cab.style.left = ((ed.T - ed.janela[0]) / (ed.janela[1] - ed.janela[0]) * 100).toFixed(3) + '%';
    if (A.TELAS.vertical.desenharCaixa) A.TELAS.vertical.desenharCaixa();
    if (A.EditorLegendas) A.EditorLegendas.tique();
    if (A.IdentidadeUI) A.IdentidadeUI.tique();
  }

  function atualizarCampos() {
    var c = ed.corte;
    var i = $('#campo-ini'), f = $('#campo-fim');
    if (i && document.activeElement !== i) i.value = fmt(c.ini / 1000);
    if (f && document.activeElement !== f) f.value = fmt(c.fim / 1000);
    var d = $('#duracao-corte');
    if (d) d.textContent = fmt((c.fim - c.ini) / 1000);
  }

  function definirLimite(qual, T) {
    var c = ed.corte;
    var ms = Math.round(Math.max(0, T) * 1000);
    if (qual === 'ini') c.ini = Math.min(ms, c.fim - 300);
    else c.fim = Math.max(ms, c.ini + 300);
    if (c.ini / 1000 < ed.janela[0] || c.fim / 1000 > ed.janela[1]) janelaDoCorte();
    desenharLinhaTempo();
    atualizarCampos();
    salvarCorte();
  }

  Object.assign(A.ACOES, {
    tocar: function () { if (ed && ed.player) ed.player.alternar(); },
    ouvirCorte: function () { if (ed && ed.player) ed.player.tocarTrecho(ed.corte.ini / 1000, ed.corte.fim / 1000); },
    marcarIni: function () { if (ed) definirLimite('ini', ed.T); },
    marcarFim: function () { if (ed) definirLimite('fim', ed.T); },
    exportarCorte: function () {
      if (!ed) return;
      var presets = presetsEscolhidos();
      var cfg = A.cfg();
      cfg.cortes.presets = presets;
      A.salvar();
      clearTimeout(ed.salvarTimer);
      var s = ed.s, c = ed.corte;
      return window.api.salvarCorte(s.id, c).then(function () { return exportarCorte(s, c, presets); });
    },
  });

  // arrastar as alças e clicar na régua
  document.addEventListener('pointerdown', function (ev) {
    if (!ed || !ed.janela) return;
    var regua = ev.target.closest && ev.target.closest('[data-lt-trilha]');
    if (!regua) return;
    var rect = regua.getBoundingClientRect();
    var paraT = function (x) { return ed.janela[0] + Math.max(0, Math.min(1, (x - rect.left) / rect.width)) * (ed.janela[1] - ed.janela[0]); };
    var alca = ev.target.getAttribute('data-alca');
    if (!alca) { ed.player.ir(paraT(ev.clientX), !ed.player.video.paused); return; }
    ev.preventDefault();
    ev.target.setPointerCapture(ev.pointerId);
    var mover = function (e) {
      var T = paraT(e.clientX);
      var c = ed.corte;
      if (alca === 'ini') c.ini = Math.round(Math.min(T * 1000, c.fim - 300));
      else c.fim = Math.round(Math.max(T * 1000, c.ini + 300));
      var a = ed.janela[0], w = ed.janela[1] - a;
      ev.target.style.left = ((alca === 'ini' ? c.ini : c.fim) / 1000 - a) / w * 100 + '%';
      var reg = $('.lt-regiao');
      if (reg) { reg.style.left = (c.ini / 1000 - a) / w * 100 + '%'; reg.style.width = (c.fim - c.ini) / 1000 / w * 100 + '%'; }
      atualizarCampos();
      ed.player.ir(T, false);
    };
    var soltar = function () {
      ev.target.removeEventListener('pointermove', mover);
      ev.target.removeEventListener('pointerup', soltar);
      desenharLinhaTempo();
      salvarCorte();
    };
    ev.target.addEventListener('pointermove', mover);
    ev.target.addEventListener('pointerup', soltar);
  });

  // campos do editor de corte
  document.addEventListener('change', function (ev) {
    if (!ed) return;
    var el = ev.target;
    if (el.id === 'campo-ini' || el.id === 'campo-fim') {
      var t = lerTempo(el.value);
      if (t == null) { A.aviso('Use o formato minutos:segundos, por exemplo 12:30.5', 'erro'); atualizarCampos(); return; }
      definirLimite(el.id === 'campo-ini' ? 'ini' : 'fim', t);
    } else if (el.name === 'modo-audio') {
      ed.corte.audio.modo = el.value;
      var fx = $('#faixas'), v1 = $('#volume-1');
      if (fx) fx.hidden = el.value !== 'mix';
      if (v1) v1.hidden = el.value === 'mix';
      salvarCorte();
    } else if (el.id === 'retratos-h') {
      ed.corte.retratosHorizontal = el.checked;
      salvarCorte();
      A.IdentidadeUI.desenharPainelVisual();
    } else if (el.hasAttribute('data-preset')) {
      A.cfg().cortes.presets = presetsEscolhidos();
      A.salvar();
    }
  });
  document.addEventListener('input', function (ev) {
    if (!ed) return;
    var el = ev.target;
    if (el.id === 'nome-corte') { ed.corte.nome = el.value; salvarCorte(); }
    var k = el.getAttribute && el.getAttribute('data-volume');
    if (k) {
      ed.corte.audio.volumes[k] = Number(el.value);
      var eco = $('[data-eco-faixa="' + k + '"]');
      if (eco) eco.textContent = el.value;
      if (k === '1' && ed.player) ed.player.video.volume = Math.min(1, Number(el.value) / 100);
      salvarCorte();
    }
  });

  // atalhos de teclado nos editores
  document.addEventListener('keydown', function (ev) {
    if (!ed || !ed.player) return;
    var alvo = ev.target;
    if (alvo && (alvo.tagName === 'INPUT' || alvo.tagName === 'SELECT' || alvo.tagName === 'TEXTAREA') && alvo.type !== 'range' && alvo.type !== 'checkbox' && alvo.type !== 'radio') return;
    var passo = ev.shiftKey ? 1 : 0.1;
    if (ev.key === ' ') { ev.preventDefault(); ed.player.alternar(); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); ed.player.ir(ed.T - passo, false); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); ed.player.ir(ed.T + passo, false); }
    else if ((ev.key === 'i' || ev.key === 'I') && $('#campo-ini')) { ev.preventDefault(); definirLimite('ini', ed.T); }
    else if ((ev.key === 'o' || ev.key === 'O') && $('#campo-fim')) { ev.preventDefault(); definirLimite('fim', ed.T); }
    else if ((ev.key === 'k' || ev.key === 'K') && $('#quadro-fonte')) { ev.preventDefault(); A.ACOES.novoPonto(); }
  });

  // ================================================================ EDITOR VERTICAL
  var PRE_W = 324, PRE_H = 576;

  A.TELAS.vertical = {
    menu: 'momentos',
    html: function () {
      return '<div id="editor" class="coluna" style="gap:16px"><div class="vazio">Carregando o corte…</div></div>';
    },
    depois: function () { carregarEditor(montarVertical); },
    vivo: atualizarFila,
    sair: function () { A.TELAS.vertical.desenharCaixa = null; sairEditor(); },
  };

  function pontos() { return ed.corte.vertical.camera; }
  function dimFonte() {
    var f = ed.s.fonte || {};
    var v = ed.player && ed.player.video;
    return { W: (v && v.videoWidth) || f.largura || 1920, H: (v && v.videoHeight) || f.altura || 1080 };
  }
  function relMs() { return Math.round((ed.T - ed.corte.ini / 1000) * 1000); }
  function pontoPerto(t) {
    var lista = pontos();
    for (var i = 0; i < lista.length; i++) if (Math.abs(lista[i].t - t) <= 120) return i;
    return -1;
  }

  // ---------------------------------------------------------------- retratos do vertical (posição livre)
  var NOMES_ANCORA_V = {
    'topo-esq': 'Em cima, à esquerda', topo: 'Em cima, no meio', 'topo-dir': 'Em cima, à direita',
    'meio-esq': 'No meio, à esquerda', centro: 'No centro', 'meio-dir': 'No meio, à direita',
    'baixo-esq': 'Embaixo, à esquerda', baixo: 'Embaixo, no meio', 'baixo-dir': 'Embaixo, à direita',
  };
  function opcoesOrdemV(v) {
    var r = v.direcao === 'vertical' ? { normal: 'De cima para baixo', invertida: 'De baixo para cima' } :
      { normal: 'Da esquerda para a direita', invertida: 'Da direita para a esquerda' };
    return Object.keys(r).map(function (k) { return '<option value="' + k + '"' + (v.ordem === k ? ' selected' : '') + '>' + r[k] + '</option>'; }).join('');
  }
  function faixaV(campo, rotulo, valor, min, max, sufixo) {
    return '<label class="campo"><span class="rotulo">' + rotulo + ': <span data-eco="v-' + campo + '">' + Math.round(valor) + '</span>' + sufixo + '</span>' +
      '<input type="range" min="' + min + '" max="' + max + '" step="1" value="' + Math.round(valor) + '" data-campo="m.vertical.' + campo + '" data-num data-eco-alvo="v-' + campo + '" data-retratos-vertical></label>';
  }
  function painelRetratosVertical(v) {
    return '<section class="painel"><div class="titulo"><h2>Retratos no vertical</h2>' +
      '<label class="opcao"><input type="checkbox" data-campo="m.vertical.ativo"' + A.marcado(v.ativo) + ' data-retratos-vertical>Mostrar</label></div>' +
      '<div class="posicao-grade">' +
      '<div class="campo"><span class="rotulo">Ponto da tela</span><div class="ancoras" role="radiogroup" aria-label="Ponto da tela">' +
      Lay.ANCORAS.map(function (a) {
        return '<label class="ancora" title="' + esc(NOMES_ANCORA_V[a]) + '"><input type="radio" name="v-ancora" value="' + a + '" data-campo="m.vertical.ancora"' + A.marcado(v.ancora === a) + ' aria-label="' + esc(NOMES_ANCORA_V[a]) + '" data-retratos-vertical><span></span></label>';
      }).join('') + '</div></div>' +
      '<div class="coluna" style="gap:10px;flex:1;min-width:180px">' +
      '<div class="campo"><span class="rotulo">Fila</span><div class="segmentos">' +
      '<label class="segmento"><input type="radio" name="v-direcao" value="horizontal" data-campo="m.vertical.direcao"' + A.marcado(v.direcao === 'horizontal') + ' data-retratos-vertical><span>Deitada</span></label>' +
      '<label class="segmento"><input type="radio" name="v-direcao" value="vertical" data-campo="m.vertical.direcao"' + A.marcado(v.direcao === 'vertical') + ' data-retratos-vertical><span>Em pé</span></label></div></div>' +
      '<label class="campo"><span class="rotulo">Começa por</span><select data-campo="m.vertical.ordem" id="ordem-vertical" data-retratos-vertical>' + opcoesOrdemV(v) + '</select></label>' +
      '<div class="campo"><span class="rotulo">Mostrar</span><div class="segmentos">' +
      '<label class="segmento"><input type="radio" name="v-mostrar" value="todos" data-campo="m.vertical.mostrar"' + A.marcado(v.mostrar === 'todos') + ' data-retratos-vertical><span>Todo mundo</span></label>' +
      '<label class="segmento"><input type="radio" name="v-mostrar" value="falando" data-campo="m.vertical.mostrar"' + A.marcado(v.mostrar === 'falando') + ' data-retratos-vertical><span>Só quem fala</span></label></div></div>' +
      '</div></div>' +
      faixaV('tamanho', 'Tamanho', v.tamanho, 24, 600, ' px') +
      faixaV('espaco', 'Espaço entre os retratos', v.espaco, 0, 200, '%') +
      faixaV('margem', 'Distância da borda', v.margem, 0, 600, ' px') +
      '<div class="linha"><button class="pequeno" data-acao="centralizarVertical">Voltar ao ponto escolhido</button>' +
      '<span class="ajuda">Ajuste fino: arraste na prévia.</span></div>' +
      '<label class="opcao"><input type="checkbox" data-campo="m.vertical.esconderQuietos"' + A.marcado(v.esconderQuietos) + ' data-retratos-vertical>Esconder quem não fala neste corte</label>' +
      '<p class="ajuda">Imagem, nome, formato e efeito vêm de <a href="#mesa">Mesa</a> e <a href="#overlay">Overlay</a>.</p></section>';
  }
  /** Posição dos retratos do vertical na escala k (k = largura de saída / 1080). */
  function posVertical(m, k) {
    var v = m.vertical;
    return {
      ancora: v.ancora, direcao: v.direcao, ordem: v.ordem, mostrar: v.mostrar, espaco: v.espaco,
      deslocX: v.deslocX * k, deslocY: v.deslocY * k, tamanho: v.tamanho * k, margem: v.margem * k,
      comNome: m.nomes.modo !== 'nenhum', esconderQuietos: v.esconderQuietos,
    };
  }

  /** Controles do fundo do "tela inteira" (valem para a mesa toda). */
  function fundoInteiraHtml(fu) {
    var rad = function (v, t) { return '<label class="segmento"><input type="radio" name="fundo-tipo" value="' + v + '" data-campo="m.vertical.fundo.tipo"' + A.marcado(fu.tipo === v) + '><span>' + t + '</span></label>'; };
    return '<div class="leg-linha"><span class="rotulo">Fundo</span><div class="segmentos">' + rad('desfoque', 'Vídeo desfocado') + rad('cor', 'Cor') + rad('imagem', 'Imagem') + '</div>' +
      (fu.tipo === 'cor' ? '<label class="leg-cor"><input type="color" value="' + esc(fu.cor) + '" data-campo="m.vertical.fundo.cor"><span>Cor do fundo</span></label>' : '') +
      (fu.tipo === 'imagem' ? '<button class="pequeno" data-acao="fundoImagem">' + (fu.imagem ? 'Trocar imagem' : 'Escolher imagem') + '</button>' : '') + '</div>' +
      '<div class="leg-linha"><label class="campo" style="flex:1"><span class="rotulo">Tamanho do vídeo: <span data-eco="fundo-escala">' + Math.round(fu.escala * 100) + '</span>%</span>' +
      '<input type="range" min="40" max="300" step="1" value="' + Math.round(fu.escala * 100) + '" data-fundo="escala"></label>' +
      '<label class="campo" style="flex:1"><span class="rotulo">Altura: <span data-eco="fundo-y">' + Math.round(fu.y * 100) + '</span>%</span>' +
      '<input type="range" min="0" max="100" step="1" value="' + Math.round(fu.y * 100) + '" data-fundo="y"></label>' +
      '<button class="pequeno" data-acao="fundoCentralizar">Centralizar</button></div>' +
      '<p class="ajuda">Na prévia: arraste o vídeo para subir ou descer e use a rodinha para o tamanho. Vale para todos os cortes desta mesa.</p>';
  }

  function montarVertical() {
    if (ed.raf) cancelAnimationFrame(ed.raf);
    var s = ed.s, c = ed.corte;
    var m = A.mesa();
    var d0 = { W: (s.fonte && s.fonte.largura) || 1920, H: (s.fonte && s.fonte.altura) || 1080 };
    c.vertical.camera = Cam.normalizar(c.vertical.camera, d0.W, d0.H);
    var cams = m.cameras.map(function (k, i) {
      return '<span class="chip"><button class="pequeno" data-acao="usarCamera" data-i="' + i + '">' + esc(k.nome) + '</button>' +
        '<button class="pequeno icone" data-acao="apagarCamera" data-i="' + i + '" aria-label="Apagar câmera ' + esc(k.nome) + '">✕</button></span>';
    }).join('');
    $('#editor').innerHTML =
      '<header class="cabecalho"><div><a href="#corte/' + encodeURIComponent(s.id) + '/' + encodeURIComponent(c.id) + '" class="ajuda">← Editor de corte</a>' +
      '<h1 style="margin-top:6px">Vertical · ' + esc(c.nome) + '</h1><p>' + fmt((c.fim - c.ini) / 1000) + ' · <span id="status-salvo">Salvo</span></p></div>' +
      '<div class="linha"><button class="principal" data-acao="exportarVertical" data-preset="vertical">Exportar TikTok / Reels / Shorts</button>' +
      '<button data-acao="exportarVertical" data-preset="whatsapp-vertical">WhatsApp vertical</button></div></header>' +
      '<div class="grade" style="grid-template-columns:minmax(0,1.6fr) minmax(300px,1fr)">' +
      '<section class="painel">' +
      '<div class="linha" role="radiogroup" aria-label="Modo"><label class="opcao"><input type="radio" name="modo-vertical" value="camera"' + A.marcado(c.vertical.modo !== 'inteira') + '>Câmera (enquadrar e dar zoom)</label>' +
      '<label class="opcao"><input type="radio" name="modo-vertical" value="inteira"' + A.marcado(c.vertical.modo === 'inteira') + '>Tela inteira com fundo</label></div>' +
      '<div id="fundo-inteira" class="fundo-inteira"' + (c.vertical.modo === 'inteira' ? '' : ' hidden') + '>' + fundoInteiraHtml(m.vertical.fundo) + '</div>' +
      '<div class="quadro-fonte" id="quadro-fonte" style="aspect-ratio:' + d0.W + '/' + d0.H + '">' +
      '<video id="video" preload="auto" playsinline></video>' +
      '<div class="caixa-camera" id="caixa-camera" tabindex="0" aria-label="Câmera: arraste para mover, use a alça para o zoom"><span class="alca-zoom" data-zoom aria-hidden="true"></span></div>' +
      '</div>' +
      '<div class="linha controles-video"><button class="icone" data-acao="tocar" aria-label="Tocar ou pausar (espaço)" id="botao-tocar">▶</button>' +
      '<span class="mono" id="tempo-atual"></span>' +
      '<button class="pequeno" data-acao="somVertical" id="botao-som" aria-pressed="true" title="Som da prévia (só aqui no app)">🔊 Som</button>' +
      '<span class="ajuda" style="margin-left:auto">Arraste a caixa; a alça do canto dá zoom (ou a rodinha do mouse). Mexer cria um ponto no tempo atual.</span></div>' +
      '<div id="trilha-pontos" class="trilha-pontos" data-pontos aria-label="Pontos da câmera"></div>' +
      '<div class="linha" id="acoes-ponto"></div>' +
      '<div class="linha"><span class="rotulo">Câmeras salvas:</span>' + (cams || '<span class="ajuda">nenhuma</span>') +
      '<button class="pequeno" data-acao="salvarCamera">Salvar esta câmera</button></div>' +
      '</section>' +
      '<div class="coluna" style="gap:16px">' +
      '<section class="painel" style="align-items:center"><h2 style="align-self:flex-start">Prévia</h2>' +
      '<canvas id="previa-vertical" width="' + PRE_W + '" height="' + PRE_H + '" class="previa-vertical" aria-label="Prévia do vídeo vertical: arraste os retratos para mover, puxe a alça para mudar o tamanho"></canvas>' +
      '<p class="ajuda" style="align-self:stretch;text-align:center">Arraste os retratos e a legenda para mover · puxe as bolinhas amarelas para aumentar ou diminuir</p></section>' +
      painelRetratosVertical(m.vertical) +
      A.EditorLegendas.painel('v') +
      A.IdentidadeUI.painel() +
      '<section class="painel" id="vivo-fila"></section>' +
      '</div></div>';

    var video = $('#video');
    ed.player = new Player(video, arquivosDoCorte(), function (T) { if (ed) { ed.T = T; atualizarTempo(); } }, ed.s.pausas);
    video.addEventListener('play', function () { var b = $('#botao-tocar'); if (b) b.textContent = '⏸'; });
    video.addEventListener('pause', function () { var b = $('#botao-tocar'); if (b) b.textContent = '▶'; });
    video.addEventListener('loadedmetadata', function () {
      if (ed && ed.corte.fonte !== 'gravacao' && !ed.duracaoReplay) {
        ed.duracaoReplay = video.duration;
        ed.player.arquivos = arquivosDoCorte().filter(function (a) { return a.existe && a.url; });
        ed.player.atual = 0;
      }
      A.TELAS.vertical.desenharCaixa();
    });
    // a cada volta, a prévia some do fim do corte para o começo
    video.addEventListener('timeupdate', function () {
      if (ed && !video.paused && ed.T >= ed.corte.fim / 1000) ed.player.ir(ed.corte.ini / 1000, true);
    });
    A.TELAS.vertical.desenharCaixa = desenharCaixa;
    ligarCaixa();
    prepararAdesivos();
    desenharPontos();
    atualizarFila();
    A.EditorLegendas.montar('v');
    A.IdentidadeUI.montar();
    ed.player.ir(c.ini / 1000, false);
    var loop = function () {
      if (!ed || !$('#previa-vertical')) return;
      desenharPrevia();
      ed.raf = requestAnimationFrame(loop);
    };
    ed.raf = requestAnimationFrame(loop);
  }

  function caixaAgora() {
    var d = dimFonte();
    return Cam.caixaEm(pontos(), relMs(), d.W, d.H);
  }

  function desenharCaixa() {
    if (!ed) return;
    var el = $('#caixa-camera');
    if (!el) return;
    var inteira = ed.corte.vertical.modo === 'inteira';
    el.hidden = inteira;
    var b = ed.arrastando || caixaAgora();
    el.style.left = (b.x * 100) + '%';
    el.style.top = (b.y * 100) + '%';
    el.style.width = (b.w * 100) + '%';
    el.style.height = (b.h * 100) + '%';
    var i = pontoPerto(relMs());
    el.classList.toggle('no-ponto', i >= 0);
    var t = $('#tempo-atual');
    if (t) t.textContent = fmt(Math.max(0, ed.T - ed.corte.ini / 1000)) + ' / ' + fmt((ed.corte.fim - ed.corte.ini) / 1000);
    var cab = $('#cabeca-pontos');
    if (cab) cab.style.left = Math.max(0, Math.min(100, relMs() / (ed.corte.fim - ed.corte.ini) * 100)) + '%';
    desenharAcoesPonto();
  }

  /** Grava a caixa atual como ponto no tempo atual (atualiza se já houver um ali). */
  function gravarPonto(b) {
    var d = dimFonte();
    var lim = Cam.limitar(b, d.W, d.H);
    var t = Math.max(0, Math.min(ed.corte.fim - ed.corte.ini, relMs()));
    var lista = pontos();
    var i = pontoPerto(t);
    if (i >= 0) { lista[i].x = lim.x; lista[i].y = lim.y; lista[i].w = lim.w; }
    else {
      var anterior = lista.filter(function (p) { return p.t < t; }).pop();
      lista.push({ t: t, x: lim.x, y: lim.y, w: lim.w, trans: anterior ? anterior.trans : 'suave' });
    }
    ed.corte.vertical.camera = Cam.normalizar(lista, d.W, d.H);
    desenharPontos();
    salvarCorte();
  }

  function ligarCaixa() {
    var caixa = $('#caixa-camera'), quadro = $('#quadro-fonte');
    caixa.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      caixa.setPointerCapture(ev.pointerId);
      var zoom = ev.target.hasAttribute('data-zoom');
      var rect = quadro.getBoundingClientRect();
      var ini = caixaAgora();
      var x0 = ev.clientX, y0 = ev.clientY;
      var d = dimFonte();
      if (!ed.player.video.paused) ed.player.video.pause();
      var mover = function (e) {
        var dx = (e.clientX - x0) / rect.width, dy = (e.clientY - y0) / rect.height;
        var b;
        if (zoom) b = Cam.limitar({ x: ini.x, y: ini.y, w: ini.w + dx }, d.W, d.H);
        else b = Cam.limitar({ x: ini.x + dx, y: ini.y + dy, w: ini.w }, d.W, d.H);
        ed.arrastando = b;
        desenharCaixa();
      };
      var soltar = function () {
        caixa.removeEventListener('pointermove', mover);
        caixa.removeEventListener('pointerup', soltar);
        if (ed.arrastando) gravarPonto(ed.arrastando);
        ed.arrastando = null;
        desenharCaixa();
      };
      caixa.addEventListener('pointermove', mover);
      caixa.addEventListener('pointerup', soltar);
    });
    quadro.addEventListener('wheel', function (ev) {
      if (ed.corte.vertical.modo === 'inteira') return;
      ev.preventDefault();
      var b = ed.arrastando || caixaAgora(); // várias voltas seguidas da rodinha somam
      var d = dimFonte();
      var fator = ev.deltaY > 0 ? 1.08 : 1 / 1.08;
      var w = b.w * fator;
      var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      var h = (w * d.W) / Cam.ASPECTO / d.H;
      clearTimeout(ed.rodaTimer);
      ed.arrastando = Cam.limitar({ x: cx - w / 2, y: cy - h / 2, w: w }, d.W, d.H);
      desenharCaixa();
      ed.rodaTimer = setTimeout(function () { gravarPonto(ed.arrastando); ed.arrastando = null; desenharCaixa(); }, 250);
    }, { passive: false });
    // teclado na caixa: setas movem, + e - dão zoom
    caixa.addEventListener('keydown', function (ev) {
      var b = caixaAgora(), d = dimFonte(), p = ev.shiftKey ? 0.05 : 0.01;
      var novo = null;
      if (ev.key === 'ArrowLeft') novo = { x: b.x - p, y: b.y, w: b.w };
      else if (ev.key === 'ArrowRight') novo = { x: b.x + p, y: b.y, w: b.w };
      else if (ev.key === 'ArrowUp') novo = { x: b.x, y: b.y - p, w: b.w };
      else if (ev.key === 'ArrowDown') novo = { x: b.x, y: b.y + p, w: b.w };
      else if (ev.key === '+' || ev.key === '=') novo = { x: b.x, y: b.y, w: b.w / 1.08 };
      else if (ev.key === '-') novo = { x: b.x, y: b.y, w: b.w * 1.08 };
      if (!novo) return;
      ev.preventDefault();
      ev.stopPropagation();
      gravarPonto(Cam.limitar(novo, d.W, d.H));
      desenharCaixa();
    });
  }

  function desenharPontos() {
    var el = $('#trilha-pontos');
    if (!el || !ed) return;
    var dur = ed.corte.fim - ed.corte.ini;
    var atual = pontoPerto(relMs());
    el.innerHTML = pontos().map(function (p, i) {
      var nomeT = { suave: 'suave', rapido: 'rápida', corte: 'corte seco' }[p.trans];
      return '<button class="ponto-camera' + (i === atual ? ' atual' : '') + '" data-ir-ponto="' + i + '" style="left:' + Math.min(100, p.t / dur * 100) + '%" aria-label="Ponto em ' + fmt(p.t / 1000) + ', transição ' + nomeT + '" title="' + fmt(p.t / 1000) + ' · ' + nomeT + '"></button>';
    }).join('') + '<span class="lt-cabeca" id="cabeca-pontos" style="left:0"></span>';
    desenharAcoesPonto();
  }

  function desenharAcoesPonto() {
    var el = $('#acoes-ponto');
    if (!el || !ed) return;
    var i = pontoPerto(relMs());
    var chave = i + ':' + pontos().length + ':' + (i >= 0 ? pontos()[i].trans : '');
    if (el.getAttribute('data-chave') === chave) return; // evita redesenhar a cada quadro
    el.setAttribute('data-chave', chave);
    if (i < 0) {
      el.innerHTML = '<button class="pequeno principal" data-acao="novoPonto">+ Ponto aqui <kbd>K</kbd></button>' +
        '<span class="ajuda">' + pontos().length + ' ponto(s). Clique num losango para ir até ele.</span>';
      return;
    }
    var p = pontos()[i];
    var ultimo = i === pontos().length - 1;
    el.innerHTML = '<span class="rotulo">Ponto em ' + fmt(p.t / 1000) + '</span>' +
      (ultimo ? '<span class="ajuda">Último ponto: a câmera fica parada aqui até o fim.</span>' :
        '<label class="campo" style="flex-direction:row;align-items:center;gap:8px"><span class="rotulo">Até o próximo:</span><select data-trans="' + i + '">' +
        [['suave', 'Desliza devagar'], ['rapido', 'Desliza rápido no fim'], ['corte', 'Corte seco']].map(function (o) {
          return '<option value="' + o[0] + '"' + (p.trans === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select></label>') +
      (pontos().length > 1 ? '<button class="pequeno perigo" data-acao="apagarPonto" data-i="' + i + '">Apagar ponto</button>' : '');
  }

  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-ir-ponto]');
    if (!b || !ed) return;
    var p = pontos()[Number(b.getAttribute('data-ir-ponto'))];
    if (p) ed.player.ir(ed.corte.ini / 1000 + p.t / 1000 + 0.001, false);
  });
  document.addEventListener('pointerdown', function (ev) {
    if (!ed) return;
    var trilha = ev.target.closest && ev.target.closest('[data-pontos]');
    if (!trilha || ev.target.hasAttribute('data-ir-ponto')) return;
    var r = trilha.getBoundingClientRect();
    var f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    ed.player.ir(ed.corte.ini / 1000 + f * (ed.corte.fim - ed.corte.ini) / 1000, false);
  });
  document.addEventListener('change', function (ev) {
    if (!ed) return;
    var el = ev.target;
    if (el.hasAttribute && el.hasAttribute('data-trans')) {
      var p = pontos()[Number(el.getAttribute('data-trans'))];
      if (p) { p.trans = el.value; desenharPontos(); salvarCorte(); }
    } else if (el.name === 'modo-vertical') {
      ed.corte.vertical.modo = el.value;
      var fi = $('#fundo-inteira');
      if (fi) fi.hidden = el.value !== 'inteira';
      desenharCaixa();
      salvarCorte();
    } else if (el.getAttribute && el.getAttribute('data-campo') === 'm.vertical.fundo.tipo') {
      setTimeout(function () { var fi2 = $('#fundo-inteira'); if (fi2 && ed) fi2.innerHTML = fundoInteiraHtml(A.mesa().vertical.fundo); }, 30);
    }
    if (el.hasAttribute && el.hasAttribute('data-retratos-vertical')) setTimeout(prepararAdesivos, 50);
    if (el.getAttribute && el.getAttribute('data-campo') === 'm.vertical.direcao') {
      var so = $('#ordem-vertical');
      if (so) so.innerHTML = opcoesOrdemV(A.mesa().vertical);
    }
  });
  document.addEventListener('input', function (ev) {
    if (ed && ev.target.hasAttribute && ev.target.hasAttribute('data-retratos-vertical') && ev.target.type === 'range') {
      clearTimeout(ed.adesivoTimer);
      ed.adesivoTimer = setTimeout(prepararAdesivos, 120);
    }
  });

  // arrastar/esticar os retratos na prévia do vertical
  document.addEventListener('pointerdown', function (ev) {
    var cv = ev.target;
    if (!ed || cv.id !== 'previa-vertical' || !ed.grupoPrevia) return;
    var r = cv.getBoundingClientRect();
    var esc = PRE_W / r.width;
    var px = (ev.clientX - r.left) * esc, py = (ev.clientY - r.top) * esc;
    var g = ed.grupoPrevia, v = A.mesa().vertical;
    var al = Lay.alcaDoGrupo({ x: g.x - 3, y: g.y - 3, largura: g.largura + 6, altura: g.altura + 6 }, v.ancora);
    var k = PRE_W / 1080;
    var modo = Math.hypot(px - al.x, py - al.y) <= 12 ? 'esticar' :
      (px >= g.x - 10 && px <= g.x + g.largura + 10 && py >= g.y - 10 && py <= g.y + g.altura + 10) ? 'mover' : null;
    if (!modo) return;
    ev.preventDefault();
    cv.setPointerCapture(ev.pointerId);
    ed.editandoRetratos = { modo: modo, x: px, y: py, dx: v.deslocX, dy: v.deslocY, tam: v.tamanho, grupo: g };
    var mover = function (e) {
      var ex = (e.clientX - r.left) * esc, ey = (e.clientY - r.top) * esc;
      var st = ed.editandoRetratos;
      if (!st) return;
      if (st.modo === 'mover') {
        v.deslocX = Math.max(-1080, Math.min(1080, Math.round(st.dx + (ex - st.x) / k)));
        v.deslocY = Math.max(-1920, Math.min(1920, Math.round(st.dy + (ey - st.y) / k)));
      } else {
        v.tamanho = Math.max(24, Math.min(600, Math.round(st.tam * Lay.fatorEsticar(v.ancora, st.grupo, ex - st.x, ey - st.y))));
        var inp = $('[data-campo="m.vertical.tamanho"]'), eco = $('[data-eco="v-tamanho"]');
        if (inp) inp.value = v.tamanho;
        if (eco) eco.textContent = v.tamanho;
      }
    };
    var soltar = function () {
      cv.removeEventListener('pointermove', mover);
      cv.removeEventListener('pointerup', soltar);
      var st = ed.editandoRetratos;
      ed.editandoRetratos = null;
      A.salvar(true);
      if (st && st.modo === 'esticar') prepararAdesivos();
    };
    cv.addEventListener('pointermove', mover);
    cv.addEventListener('pointerup', soltar);
  });
  document.addEventListener('pointermove', function (ev) {
    var cv = ev.target;
    if (!ed || cv.id !== 'previa-vertical' || ed.editandoRetratos) return;
    var g = ed.grupoPrevia;
    if (!g) { cv.style.cursor = ''; return; }
    var r = cv.getBoundingClientRect(), esc = PRE_W / r.width;
    var px = (ev.clientX - r.left) * esc, py = (ev.clientY - r.top) * esc;
    var al = Lay.alcaDoGrupo({ x: g.x - 3, y: g.y - 3, largura: g.largura + 6, altura: g.altura + 6 }, A.mesa().vertical.ancora);
    cv.style.cursor = Math.hypot(px - al.x, py - al.y) <= 12 ? 'nwse-resize' :
      (px >= g.x - 10 && px <= g.x + g.largura + 10 && py >= g.y - 10 && py <= g.y + g.altura + 10) ? 'move' : '';
  });

  Object.assign(A.ACOES, {
    somVertical: function (el) {
      if (!ed || !ed.player) return;
      var v = ed.player.video;
      v.muted = !v.muted;
      el.textContent = v.muted ? '🔇 Sem som' : '🔊 Som';
      el.setAttribute('aria-pressed', String(!v.muted));
    },
    centralizarVertical: function () {
      var v = A.mesa().vertical;
      v.deslocX = 0; v.deslocY = 0;
      A.salvar(true);
    },
    novoPonto: function () { if (ed) { gravarPonto(caixaAgora()); desenharCaixa(); } },
    apagarPonto: function (el) {
      if (!ed) return;
      var d = dimFonte();
      var lista = pontos().slice();
      lista.splice(Number(el.getAttribute('data-i')), 1);
      ed.corte.vertical.camera = Cam.normalizar(lista, d.W, d.H);
      desenharPontos();
      desenharCaixa();
      salvarCorte();
    },
    salvarCamera: function () {
      if (!ed) return;
      var nome = prompt('Nome desta câmera (ex.: Mapa inteiro, Chat de rolagens):');
      if (!nome) return;
      var b = caixaAgora();
      var m = A.mesa();
      m.cameras.push({ nome: nome.slice(0, 40), x: b.x, y: b.y, w: b.w });
      if (m.cameras.length > 12) m.cameras.shift();
      A.salvar(true);
      montarVerticalMantendo();
    },
    usarCamera: function (el) {
      if (!ed) return;
      var k = A.mesa().cameras[Number(el.getAttribute('data-i'))];
      if (k) { gravarPonto(k); desenharCaixa(); }
    },
    apagarCamera: function (el) {
      var m = A.mesa();
      m.cameras.splice(Number(el.getAttribute('data-i')), 1);
      A.salvar(true);
      montarVerticalMantendo();
    },
    exportarVertical: function (el) {
      if (!ed) return;
      clearTimeout(ed.salvarTimer);
      var s = ed.s, c = ed.corte, preset = el.getAttribute('data-preset');
      return window.api.salvarCorte(s.id, c).then(function () { return exportarCorte(s, c, [preset]); });
    },
  });

  function montarVerticalMantendo() {
    var T = ed.T;
    if (ed.raf) cancelAnimationFrame(ed.raf);
    ed.player.parar();
    montarVertical();
    ed.player.ir(T, false);
  }


  // ---------------------------------------------------------------- tela inteira: fundo próprio e posição do vídeo
  document.addEventListener('input', function (ev) {
    var campo = ev.target.getAttribute && ev.target.getAttribute('data-fundo');
    if (!campo || !ed) return;
    var fu = A.mesa().vertical.fundo;
    fu[campo] = Number(ev.target.value) / 100;
    var eco = $('[data-eco="fundo-' + campo + '"]');
    if (eco) eco.textContent = ev.target.value;
    A.salvar();
  });
  function ecoFundo() {
    var fu = A.mesa().vertical.fundo;
    [['escala', fu.escala], ['y', fu.y]].forEach(function (x) {
      var i = $('[data-fundo="' + x[0] + '"]'), e = $('[data-eco="fundo-' + x[0] + '"]');
      if (i) i.value = Math.round(x[1] * 100);
      if (e) e.textContent = Math.round(x[1] * 100);
    });
  }
  Object.assign(A.ACOES, {
    fundoImagem: function () {
      return window.api.escolherImagem('fundo').then(function (r) {
        if (!r || r.cancelado) return;
        if (r.erro) return A.aviso(r.erro, 'erro');
        A.mesa().vertical.fundo.imagem = r.nome;
        A.salvar(true);
        var fi = $('#fundo-inteira');
        if (fi) fi.innerHTML = fundoInteiraHtml(A.mesa().vertical.fundo);
      });
    },
    fundoCentralizar: function () {
      var fu = A.mesa().vertical.fundo;
      fu.y = 0.5; fu.escala = 1;
      A.salvar(true);
      ecoFundo();
    },
  });
  // arrastar o vídeo (sobe/desce) na prévia; vem depois das camadas, dos retratos e da legenda
  document.addEventListener('pointerdown', function (ev) {
    var cv = ev.target;
    if (!ed || cv.id !== 'previa-vertical' || ev.defaultPrevented || ed.corte.vertical.modo !== 'inteira' || !ed.quadroVideo) return;
    var r = cv.getBoundingClientRect(), k = PRE_W / r.width;
    var py = (ev.clientY - r.top) * k, px = (ev.clientX - r.left) * k;
    var q = ed.quadroVideo;
    if (px < q.x || px > q.x + q.largura || py < q.y || py > q.y + q.altura) return;
    ev.preventDefault();
    cv.setPointerCapture(ev.pointerId);
    var fu = A.mesa().vertical.fundo, y0 = fu.y, p0 = py;
    var mover = function (e) {
      var ny = y0 + ((e.clientY - r.top) * k - p0) / PRE_H;
      fu.y = Math.max(0, Math.min(1, Math.abs(ny - 0.5) < 0.012 ? 0.5 : ny));
      ecoFundo();
    };
    var soltar = function () {
      cv.removeEventListener('pointermove', mover);
      cv.removeEventListener('pointerup', soltar);
      A.salvar(true);
    };
    cv.addEventListener('pointermove', mover);
    cv.addEventListener('pointerup', soltar);
  });
  document.addEventListener('wheel', function (ev) {
    var cv = ev.target;
    if (!ed || cv.id !== 'previa-vertical' || ed.corte.vertical.modo !== 'inteira') return;
    ev.preventDefault();
    var fu = A.mesa().vertical.fundo;
    fu.escala = Math.max(0.4, Math.min(3, Math.round(fu.escala * (ev.deltaY > 0 ? 1 / 1.05 : 1.05) * 100) / 100));
    ecoFundo();
    A.salvar();
  }, { passive: false });

  // ---------------------------------------------------------------- prévia vertical
  function prepararAdesivos() {
    if (!ed) return;
    var m = A.mesa();
    var k = PRE_W / 1080;
    if (!m.vertical.ativo) { ed.adesivos = []; return; }
    var tam = m.vertical.tamanho * k;
    var o = opcoesAdesivo(tam);
    var gen = (ed.geracao || 0) + 1;
    ed.geracao = gen;
    Retratos.adesivos(pessoasDaSessao(ed.s), o, false).then(function (lista) {
      // guarda o tamanho em que foram desenhados: esticando com o mouse, a prévia só escala até redesenhar
      if (ed && ed.geracao === gen) { ed.adesivos = lista; ed.tamAdesivos = tam; }
    });
  }

  function falandoEm(chave, msSessao) {
    var f = ed.s.falas;
    for (var i = 0; i < f.length; i++) if (f[i].chave === chave && msSessao >= f[i].ini && msSessao <= f[i].fim + 300) return true;
    return false;
  }
  function falaNoCorte(chave) {
    var c = ed.corte;
    return ed.s.falas.some(function (f) { return f.chave === chave && f.fim + 300 > c.ini && f.ini < c.fim; });
  }

  function desenharPrevia() {
    var cv = $('#previa-vertical');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    var v = ed.player.video;
    ctx.fillStyle = '#0B0C0F';
    ctx.fillRect(0, 0, PRE_W, PRE_H);
    if (v.readyState >= 2 && v.videoWidth) {
      if (ed.corte.vertical.modo === 'inteira') {
        var fu = A.mesa().vertical.fundo;
        if (fu.tipo === 'desfoque') {
          var esc2 = PRE_H / v.videoHeight;
          ctx.save();
          ctx.filter = 'blur(6px) brightness(0.9)';
          ctx.drawImage(v, (PRE_W - v.videoWidth * esc2) / 2, 0, v.videoWidth * esc2, PRE_H);
          ctx.restore();
        } else {
          Ident.desenharFundoImagem(ctx, fu, PRE_W, PRE_H, fu.tipo === 'imagem' ? A.IdentidadeUI.imagem(fu.imagem) : null);
        }
        var qv = ed.arrastoVideo || Ident.quadroVideoInteira(fu, PRE_W, PRE_H, v.videoWidth, v.videoHeight);
        ctx.drawImage(v, qv.x, qv.y, qv.largura, qv.altura);
        ed.quadroVideo = qv;
      } else {
        var b = ed.arrastando || caixaAgora();
        ctx.drawImage(v, b.x * v.videoWidth, b.y * v.videoHeight, b.w * v.videoWidth, b.h * v.videoHeight, 0, 0, PRE_W, PRE_H);
      }
    }
    A.IdentidadeUI.desenharEditor(ctx, PRE_W, PRE_H, 'v', 'previa-vertical');
    desenharRetratosPrevia(ctx);
    if (A.EditorLegendas) A.EditorLegendas.desenharEm(ctx, PRE_W, PRE_H, 'v', true);
    A.IdentidadeUI.desenharFinalEditor(ctx, PRE_W, PRE_H, 'v');
  }

  function desenharRetratosPrevia(ctx) {
    var m = A.mesa();
    var ad = ed.adesivos || [];
    ed.grupoPrevia = null;
    if (!ad.length || !m.vertical.ativo) return;
    var msSessao = ed.T * 1000;
    var visiveis = ad.filter(function (a) { return !m.vertical.esconderQuietos || falaNoCorte(a.chave); });
    var k = PRE_W / 1080;
    var soQuemFala = m.vertical.mostrar === 'falando';
    var lay = Lay.posicoes(Object.assign(posVertical(m, k), { W: PRE_W, H: PRE_H, quantidade: Math.max(1, visiveis.length) }));
    // os adesivos foram feitos num tamanho; se o layout encolheu (muitos jogadores) ou você está esticando, escala junto
    var fator = lay.medidas.tam / Lay.medidas(ed.tamAdesivos || m.vertical.tamanho * k, m.nomes.modo !== 'nenhum').tam;
    visiveis.forEach(function (a, i) {
      var fala = falandoEm(a.chave, msSessao);
      if (soQuemFala && !fala) return;
      var img = fala ? a.falando : a.quieto;
      var centro = soQuemFala ? lay.centros[0] : lay.centros[i];
      var w = img.width * fator, h = img.height * fator;
      ctx.drawImage(img, centro.x - lay.medidas.cx, centro.y - lay.medidas.cy, w, h);
    });
    // caixa de edição: arrastar move, a bolinha estica
    var g = lay.grupo;
    ed.grupoPrevia = g;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = ed.editandoRetratos ? 'rgba(240,180,76,.95)' : 'rgba(240,180,76,.55)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(g.x - 3, g.y - 3, g.largura + 6, g.altura + 6);
    ctx.setLineDash([]);
    var al = Lay.alcaDoGrupo({ x: g.x - 3, y: g.y - 3, largura: g.largura + 6, altura: g.altura + 6 }, m.vertical.ancora);
    ctx.fillStyle = '#F0B44C';
    ctx.strokeStyle = '#1A1405';
    ctx.beginPath();
    ctx.arc(al.x, al.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
})();
