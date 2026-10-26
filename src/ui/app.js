/* Interface do Gravador RPG. Sem bibliotecas: telas em HTML montado aqui,
   um estado vindo do app (E) e um rascunho da configuração (cfg) que é salvo sozinho. */
(function () {
  'use strict';

  // ================================================================ utilidades
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function novoId() {
    var a = new Uint8Array(6);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }
  function copia(o) { return JSON.parse(JSON.stringify(o)); }
  function dois(n) { return ('0' + n).slice(-2); }
  function tempo(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return dois(Math.floor(s / 3600)) + ':' + dois(Math.floor(s % 3600 / 60)) + ':' + dois(s % 60);
  }
  function horas(h) {
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    if (mm === 60) { hh++; mm = 0; }
    return hh + ' h' + (mm ? ' ' + mm + ' min' : '');
  }
  function iniciais(nome) {
    var p = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }
  function aviso(texto, tipo) {
    var el = document.createElement('div');
    el.className = 'aviso ' + (tipo || '');
    el.textContent = texto;
    $('#avisos').appendChild(el);
    setTimeout(function () { el.remove(); }, tipo === 'erro' ? 7000 : 3500);
  }
  function resultado(r, ok) {
    if (r && r.erro) aviso(r.erro, 'erro');
    else if (r && r.ok === false) aviso(r.mensagem || 'Não deu certo.', 'erro');
    else if (ok) aviso(typeof ok === 'string' ? ok : (r && r.mensagem) || 'Feito.', 'ok');
    return r;
  }

  // ================================================================ estado
  var E = null;          // último estado vindo do app
  var cfg = null;        // rascunho da configuração (salvo sozinho)
  var tela = 'sessao';
  var rotaParams = [];
  var editando = 0;      // edições ainda não confirmadas pelo app
  var salvarTimer = null;
  var salvando = Promise.resolve();

  /** Antes de uma ação que muda a config no app, manda o que ainda está esperando para salvar. */
  function salvarPendente() {
    if (!editando) return salvando;
    clearTimeout(salvarTimer);
    var enviado = editando;
    salvando = window.api.salvarConfig(cfg).then(function (r) {
      if (r && !r.erro && enviado === editando) { cfg = r; editando = 0; }
    });
    return salvando;
  }

  function mesa() {
    for (var i = 0; i < cfg.mesas.length; i++) if (cfg.mesas[i].id === cfg.mesaAtiva) return cfg.mesas[i];
    return cfg.mesas[0];
  }
  function jogador(id) {
    var m = mesa();
    for (var i = 0; i < m.jogadores.length; i++) if (m.jogadores[i].id === id) return m.jogadores[i];
    return null;
  }
  function urlImagem(nome) {
    if (!nome || !E || !E.overlayUrl) return '';
    try { return new URL(E.overlayUrl).origin + '/img/' + encodeURIComponent(nome); } catch (e) { return ''; }
  }

  /** Salva o rascunho depois de uma pausa (digitação), ou na hora. */
  function salvar(imediato) {
    editando++;
    clearTimeout(salvarTimer);
    salvarTimer = setTimeout(function () {
      var enviado = editando;
      salvando = window.api.salvarConfig(cfg).then(function (r) {
        if (r && r.erro) { aviso('Não foi possível salvar: ' + r.erro, 'erro'); if (enviado === editando) editando = 0; return; }
        // só troca o rascunho pelo salvo se nada mudou enquanto salvava
        if (enviado === editando) { cfg = r; editando = 0; }
      });
    }, imediato ? 0 : 350);
  }

  // ================================================================ nomes (igual ao app)
  var MODOS = {
    personagem: 'Nome do personagem', jogador: 'Nome do jogador', discord: 'Nome no Discord',
    'personagem-jogador': 'Personagem (jogador)', nenhum: 'Nenhum nome',
  };
  function nomeNoVideo(j, aoVivo) {
    var m = mesa();
    var d = (j.discordNome || aoVivo || '').trim(), p = (j.personagem || '').trim(), jo = (j.jogador || '').trim();
    var modo = j.nomeModo && j.nomeModo !== 'padrao' ? j.nomeModo : m.nomes.modo;
    if (modo === 'personalizado') {
      if ((j.nomeTexto || '').trim()) return j.nomeTexto.trim();
      modo = m.nomes.modo;
    }
    function prim() { for (var i = 0; i < arguments.length; i++) if (arguments[i]) return arguments[i]; return ''; }
    if (modo === 'nenhum') return '';
    if (modo === 'jogador') return prim(jo, d, p);
    if (modo === 'discord') return prim(d, jo, p);
    if (modo === 'personagem-jogador') return p && jo ? p + ' (' + jo + ')' : prim(p, jo, d);
    return prim(p, jo, d);
  }
  function rotuloPessoa(j) { return j.personagem || j.jogador || j.discordNome || 'Sem nome'; }

  // ================================================================ peças
  function avatarHtml(j, opc) {
    opc = opc || {};
    var src = urlImagem(j.imagem);
    var f = j.foco || { x: 50, y: 50, zoom: 100 };
    var estilo = 'object-position:' + f.x + '% ' + f.y + '%;transform-origin:' + f.x + '% ' + f.y + '%;transform:scale(' + (f.zoom / 100) + ')';
    return '<span class="avatar' + (opc.grande ? ' grande' : '') + (opc.falando ? ' falando' : '') + '" style="--cor:' + esc(j.cor) + '"' +
      (opc.idFala ? ' data-fala-avatar="' + esc(j.id) + '"' : '') + ' aria-hidden="true">' +
      esc(iniciais(rotuloPessoa(j))) +
      (src ? '<img alt="" src="' + esc(src) + '" style="' + estilo + '">' : '') +
      '</span>';
  }
  function select(campo, opcoes, valor, extra) {
    return '<select data-campo="' + campo + '"' + (extra || '') + '>' + Object.keys(opcoes).map(function (k) {
      return '<option value="' + esc(k) + '"' + (k === valor ? ' selected' : '') + '>' + esc(opcoes[k]) + '</option>';
    }).join('') + '</select>';
  }
  function marcado(v) { return v ? ' checked' : ''; }
  function tecla(nome) { return cfg.atalhos[nome] ? '<kbd>' + esc(cfg.atalhos[nome]) + '</kbd>' : ''; }

  function statusOBS() {
    if (!E) return { classe: '', texto: 'Carregando…' };
    if (!E.obs.conectado) return { classe: 'erro', texto: 'OBS desconectado' };
    if (E.obs.gravando) return { classe: 'gravando', texto: 'Gravando' };
    return { classe: 'ok', texto: 'OBS conectado' };
  }
  function statusSK() {
    if (!E) return { classe: '', texto: '' };
    var sk = E.streamkit;
    if (!sk.configurado) return { classe: '', texto: 'Discord não configurado' };
    if (!sk.conectado) return { classe: 'erro', texto: 'Discord sem leitura' };
    if (!sk.presentes) return { classe: 'alerta', texto: 'Discord: canal vazio' };
    return { classe: 'ok', texto: 'Discord: ' + sk.presentes + (sk.presentes === 1 ? ' pessoa' : ' pessoas') };
  }
  function pilula(s) { return '<span class="pilula"><span class="ponto ' + s.classe + '"></span>' + esc(s.texto) + '</span>'; }

  // ================================================================ telas
  var TELAS = {};

  // ---------------------------------------------------------------- sessão ao vivo
  TELAS.sessao = {
    html: function () {
      return '' +
        '<header class="cabecalho"><div><h1>Sessão ao vivo</h1>' +
        '<p>Deixe o app aberto durante o jogo. Os atalhos funcionam mesmo com o Foundry na frente.</p></div>' +
        '<div class="coluna" style="align-items:flex-end;gap:8px"><div class="linha" id="vivo-pilulas"></div>' +
        (seletorCanalHtml('sessao-canal') ? '<label class="linha" style="gap:8px"><span class="rotulo">Canal</span>' + seletorCanalHtml('sessao-canal') + '</label>' : '') +
        '</div></header>' +
        '<section class="painel gravacao" id="vivo-gravacao" aria-label="Gravação"></section>' +
        '<div class="grade">' +
        '<section class="painel" aria-label="Quem está na mesa"><div class="titulo"><h2>Na mesa agora</h2></div><div id="vivo-mesa-agora" class="coluna"></div></section>' +
        '<section class="painel" aria-label="Marcadores"><div class="titulo"><h2>Marcadores desta sessão</h2></div>' +
        '<p class="ajuda">Clique no nome para escrever o que aconteceu. Eles viram clipes na fase de cortes.</p><div id="vivo-marcadores"></div></section>' +
        '<section class="painel" aria-label="Espaço em disco"><div class="titulo"><h2>Gravações guardadas</h2></div><div id="vivo-disco" class="coluna"></div></section>' +
        '</div>';
    },
    vivo: function () {
      $('#vivo-pilulas').innerHTML = pilula(statusOBS()) + pilula(statusSK());
      var g = E.obs.gravando, con = E.obs.conectado;
      $('#vivo-gravacao').innerHTML =
        '<div class="linha" style="gap:14px;flex:1 1 260px">' +
        '<span class="ponto ' + (g ? 'gravando' : con ? 'ok' : 'erro') + '" style="width:14px;height:14px"></span>' +
        '<div><div class="estado-rotulo' + (g ? ' gravando' : '') + '">' +
        (g ? 'GRAVANDO' : con ? 'PARADO' : 'OBS DESCONECTADO') + '</div>' +
        '<div class="relogio" data-relogio>' + (E.sessao ? tempo(Date.now() - E.sessao.inicio) : '00:00:00') + '</div>' +
        (!con ? '<a href="#conexoes">Conectar ao OBS</a>' : '') + '</div></div>' +
        '<div class="acoes-gravacao">' +
        '<button class="principal" data-acao="marcar"' + (g ? '' : ' disabled') + '>Marcar momento ' + tecla('marcar') + '</button>' +
        '<button data-acao="marcarNome"' + (g ? '' : ' disabled') + '>Marcar com nome ' + tecla('marcarNome') + '</button>' +
        '<button data-acao="replay"' + (con ? '' : ' disabled') + '>Salvar replay ' + tecla('replay') + '</button>' +
        '<button data-acao="gravar" class="' + (g ? 'perigo' : '') + '"' + (con ? '' : ' disabled') + '>' + (g ? 'Parar gravação ' : 'Começar a gravar ') + tecla('gravar') + '</button>' +
        '</div>';

      var m = mesa(), sk = E.streamkit, linhas = '';
      m.jogadores.forEach(function (j) {
        var p = sk.jogadores[j.id];
        if (sk.conectado && !p && m.overlay.ocultarAusentes) return;
        var fala = !!(p && p.falando);
        var nome = nomeNoVideo(j, p && p.nome);
        linhas += '<div class="pessoa-linha' + (fala ? ' falando' : '') + '">' + avatarHtml(j, { falando: fala }) +
          '<div class="dados"><div class="nome">' + esc(rotuloPessoa(j)) + '</div><div class="sub">' +
          (nome ? 'No vídeo: “' + esc(nome) + '”' : 'Sem nome no vídeo') +
          (sk.conectado && !p ? ' · fora do canal' : '') + '</div></div>' +
          (fala ? '<span class="etiqueta-falando">falando</span>' : '') + '</div>';
      });
      sk.desconhecidos.forEach(function (d) {
        linhas += '<div class="pessoa-linha"><span class="avatar" aria-hidden="true">' + esc(iniciais(d.nome)) + '</span>' +
          '<div class="dados"><div class="nome">' + esc(d.nome || 'Sem nome') + '</div><div class="sub">No canal, mas não está na mesa</div></div>' +
          '<button class="pequeno" data-acao="adicionarDetectado" data-id="' + esc(d.discordId) + '" data-nome="' + esc(d.nome) + '">Adicionar</button></div>';
      });
      if (!linhas) {
        linhas = '<div class="vazio">' + (m.jogadores.length ? 'Ninguém no canal de voz agora.' :
          'Nenhum jogador cadastrado. <a href="#mesa">Cadastrar jogadores</a>') + '</div>';
      }
      $('#vivo-mesa-agora').innerHTML = linhas;

      var caixa = $('#vivo-marcadores');
      if (!caixa.contains(document.activeElement)) {
        var ms = E.sessao ? E.sessao.marcadores : [];
        caixa.innerHTML = ms.length ? ms.map(function (mk) {
          return '<div class="marcador"><span class="tempo">' + esc(mk.tempo) + '</span>' +
            '<input type="text" aria-label="Nome do marcador das ' + esc(mk.tempo) + '" data-marcador="' + mk.t + '" value="' + esc(mk.nome) + '" placeholder="Sem nome — clique para nomear"></div>';
        }).join('') : '<div class="vazio">' + (E.sessao ? 'Aperte ' + esc(cfg.atalhos.marcar || 'o atalho') + ' quando algo legal acontecer.' : 'Os marcadores aparecem aqui durante a gravação.') + '</div>';
      }
      $('#vivo-disco').innerHTML = discoHtml();
    },
  };

  function discoHtml() {
    var d = E.disco, lim = cfg.gravacao.limiteHoras;
    var pct = Math.min(100, d.horas / lim * 100);
    return '<div><strong>' + esc(horas(d.horas)) + '</strong> de ' + esc(horas(lim)) + ' · ' + d.gb.toFixed(1) + ' GB de ' + cfg.gravacao.limiteGB + ' GB</div>' +
      '<div class="barra' + (d.acimaDoLimite ? ' cheia' : '') + '"><div style="width:' + pct.toFixed(1) + '%"></div></div>' +
      '<div class="ajuda">' + d.pedacos + (d.pedacos === 1 ? ' pedaço' : ' pedaços') + ' · ' + d.protegidos + ' protegido(s) por marcador' +
      (d.aApagar ? ' · ' + d.aApagar + ' sai(em) na próxima limpeza' : '') + '</div>' +
      (d.acimaDoLimite ? '<div class="erro-campo">Acima do limite, mas o que sobrou está protegido por marcadores ou ainda gravando.</div>' : '') +
      (d.ultimaLimpeza ? '<div class="ajuda">Última limpeza: ' + new Date(d.ultimaLimpeza.t).toLocaleTimeString('pt-BR') + ' · ' + d.ultimaLimpeza.feitos + ' arquivo(s)' +
        (cfg.gravacao.destino === 'lixeira' ? ' para a Lixeira' : ' apagados') + '</div>' : '') +
      (d.ultimaLimpeza && d.ultimaLimpeza.feitos && cfg.gravacao.destino === 'lixeira' ? '<div class="ajuda">O espaço só volta quando a Lixeira do Windows for esvaziada.</div>' : '');
  }

  // ---------------------------------------------------------------- mesa e jogadores
  TELAS.mesa = {
    html: function () {
      var m = mesa();
      var jogadores = m.jogadores.map(jogadorHtml).join('') ||
        '<div class="vazio">Nenhum jogador ainda. Clique em “Adicionar jogador” ou entre no canal de voz: quem aparecer lá pode ser adicionado com um clique.</div>';
      return '' +
        '<header class="cabecalho"><div><h1>Mesa e jogadores</h1>' +
        '<p>Cada mesa guarda seus jogadores, retratos e nomes. Troque de mesa no menu ao lado.</p></div>' +
        '<div class="linha"><button data-acao="novaMesa">Nova mesa</button>' +
        '<button class="perigo" data-acao="excluirMesa"' + (cfg.mesas.length < 2 ? ' disabled title="É a única mesa"' : '') + '>Excluir esta mesa</button></div></header>' +

        '<section class="painel"><div class="campos">' +
        '<label class="campo"><span class="rotulo">Nome da mesa</span><input type="text" data-campo="m.nome" value="' + esc(m.nome) + '" data-atualiza-menu></label>' +
        '<label class="campo"><span class="rotulo">Seu papel nesta mesa</span>' + select('m.papel', { mestre: 'Mestre', jogador: 'Jogador' }, m.papel, ' data-atualiza-menu') + '</label>' +
        '</div><p class="ajuda">Como jogador em outra mesa, tudo funciona igual: você só cadastra as imagens de cada pessoa aqui.</p></section>' +

        '<section class="painel"><div class="titulo"><h2>Nome que aparece no vídeo</h2></div>' +
        '<div class="campos">' +
        '<label class="campo"><span class="rotulo">Padrão da mesa</span>' + select('m.nomes.modo', MODOS, m.nomes.modo, ' data-rerender') + '</label>' +
        '<label class="campo"><span class="rotulo">Quando mostrar</span>' + select('m.nomes.quando', { sempre: 'Sempre', falando: 'Só de quem está falando' }, m.nomes.quando) + '</label>' +
        '</div><p class="ajuda">Cada jogador pode ter uma exceção (por exemplo, o mestre aparecer como “Narrador”). Vale para o overlay e para os cortes.</p></section>' +

        '<section class="painel" aria-label="Jogadores"><div class="titulo"><h2>Jogadores (' + m.jogadores.length + ')</h2>' +
        '<button class="principal" data-acao="addJogador">Adicionar jogador</button></div>' +
        '<div id="vivo-detectados"></div>' +
        '<div class="coluna" style="gap:14px">' + jogadores + '</div></section>' +
        ignoradosHtml(m);
    },
    vivo: function () {
      var sk = E.streamkit;
      $$('[data-canal]').forEach(function (el) {
        var p = sk.jogadores[el.getAttribute('data-canal')];
        var j = jogador(el.getAttribute('data-canal'));
        var semLigacao = j && !j.discordId && !j.discordNome;
        var classe = p ? (p.falando ? 'alerta' : 'ok') : sk.conectado ? 'erro' : '';
        var txt = semLigacao ? 'Sem ligação com o Discord (preencha nome ou ID)' :
          p ? (p.falando ? 'Falando agora' : 'No canal de voz') : sk.conectado ? 'Fora do canal' : 'Discord sem leitura';
        el.innerHTML = '<span class="ponto ' + classe + '"></span>' + esc(txt);
      });
      $$('[data-fala-avatar]').forEach(function (el) {
        var p = sk.jogadores[el.getAttribute('data-fala-avatar')];
        el.classList.toggle('falando', !!(p && p.falando));
      });
      var det = $('#vivo-detectados');
      if (det) {
        det.innerHTML = sk.desconhecidos.length ? '<div class="painel" style="background:var(--painel-2)"><h3>No canal de voz e ainda não cadastrados</h3>' +
          sk.desconhecidos.map(function (d) {
            return '<div class="pessoa-linha"><span class="avatar" aria-hidden="true">' + esc(iniciais(d.nome)) + '</span>' +
              '<div class="dados"><div class="nome">' + esc(d.nome || 'Sem nome') + '</div><div class="sub">' + (d.discordId ? 'ID ' + esc(d.discordId) : 'sem foto no Discord: liga pelo nome') + '</div></div>' +
              '<button class="pequeno principal" data-acao="adicionarDetectado" data-id="' + esc(d.discordId) + '" data-nome="' + esc(d.nome) + '">Adicionar à mesa</button>' +
              (d.discordId ? '<button class="pequeno" data-acao="ignorarDetectado" data-id="' + esc(d.discordId) + '" title="Para bots, como o de música">Ignorar</button>' : '') + '</div>';
          }).join('') + '</div>' : '';
      }
    },
  };

  function jogadorHtml(j) {
    var temImg = !!j.imagem;
    var modos = { padrao: 'Padrão da mesa (' + MODOS[mesa().nomes.modo] + ')' };
    Object.keys(MODOS).forEach(function (k) { modos[k] = MODOS[k]; });
    modos.personalizado = 'Texto personalizado…';
    var pre = 'j.' + j.id + '.';
    var nomeAgora = nomeNoVideo(j);
    return '<article class="jogador" data-jogador="' + esc(j.id) + '">' +
      '<div class="retrato-col">' + avatarHtml(j, { grande: true, idFala: true }) +
      '<div class="linha"><button class="pequeno" data-acao="imagem" data-id="' + esc(j.id) + '">' + (temImg ? 'Trocar imagem' : 'Escolher imagem') + '</button>' +
      (temImg ? '<button class="pequeno icone" data-acao="tirarImagem" data-id="' + esc(j.id) + '" aria-label="Tirar imagem" title="Tirar imagem">✕</button>' : '') + '</div>' +
      (temImg ? '<div class="enquadrar"><span class="rotulo">Enquadramento</span>' +
        '<label>Horizontal<input type="range" min="0" max="100" value="' + j.foco.x + '" data-campo="' + pre + 'foco.x" data-num data-avatar></label>' +
        '<label>Vertical<input type="range" min="0" max="100" value="' + j.foco.y + '" data-campo="' + pre + 'foco.y" data-num data-avatar></label>' +
        '<label>Zoom<input type="range" min="100" max="300" value="' + j.foco.zoom + '" data-campo="' + pre + 'foco.zoom" data-num data-avatar></label></div>' :
        '<p class="ajuda" style="text-align:center">Qualquer imagem: token, retrato, arte, foto. PNG, JPG, WEBP ou GIF.</p>') +
      '<div class="status-canal" data-canal="' + esc(j.id) + '"></div>' +
      '</div>' +
      '<div class="coluna">' +
      '<div class="campos">' +
      '<label class="campo"><span class="rotulo">Personagem</span><input type="text" data-campo="' + pre + 'personagem" value="' + esc(j.personagem) + '" placeholder="Ex.: Kael" data-nome-previa></label>' +
      '<label class="campo"><span class="rotulo">Jogador</span><input type="text" data-campo="' + pre + 'jogador" value="' + esc(j.jogador) + '" placeholder="Ex.: Ana" data-nome-previa></label>' +
      '<label class="campo"><span class="rotulo">Nome no Discord</span><input type="text" data-campo="' + pre + 'discordNome" value="' + esc(j.discordNome) + '" placeholder="Como aparece na chamada" data-nome-previa></label>' +
      '<label class="campo"><span class="rotulo">ID do Discord <small>(opcional, mais seguro)</small></span><input type="text" inputmode="numeric" data-campo="' + pre + 'discordId" value="' + esc(j.discordId) + '" placeholder="18 a 19 números"></label>' +
      '</div>' +
      '<div class="campos">' +
      '<label class="campo"><span class="rotulo">Nome no vídeo</span>' + select(pre + 'nomeModo', modos, j.nomeModo, ' data-rerender') + '</label>' +
      (j.nomeModo === 'personalizado' ? '<label class="campo"><span class="rotulo">Texto</span><input type="text" data-campo="' + pre + 'nomeTexto" value="' + esc(j.nomeTexto) + '" placeholder="Ex.: Narrador" data-nome-previa></label>' : '') +
      '<label class="campo"><span class="rotulo">Cor do destaque</span><input type="color" data-campo="' + pre + 'cor" value="' + esc(j.cor) + '" data-avatar></label>' +
      '</div>' +
      '<div class="linha" style="justify-content:space-between"><span class="ajuda" data-nome-final="' + esc(j.id) + '">' + (nomeAgora ? 'No vídeo aparece: <strong>' + esc(nomeAgora) + '</strong>' : 'No vídeo: sem nome') + '</span>' +
      '<button class="pequeno perigo" data-acao="removerJogador" data-id="' + esc(j.id) + '">Remover</button></div>' +
      '</div></article>';
  }

  function ignoradosHtml(m) {
    if (!m.ignorados.length) return '';
    return '<section class="painel"><div class="titulo"><h2>Ignorados no canal</h2></div>' +
      '<p class="ajuda">Não aparecem no vídeo nem na linha do tempo (bots, por exemplo).</p>' +
      m.ignorados.map(function (id) {
        return '<div class="linha"><code>' + esc(id) + '</code><button class="pequeno" data-acao="designorar" data-id="' + esc(id) + '">Voltar a mostrar</button></div>';
      }).join('') + '</section>';
  }

  // ---------------------------------------------------------------- overlay
  TELAS.overlay = {
    html: function () {
      var o = mesa().overlay;
      return '' +
        '<header class="cabecalho"><div><h1>Overlay</h1><p>Os retratos que aparecem no OBS. Tudo aqui muda ao vivo.</p></div>' +
        '<label class="opcao"><input type="checkbox" data-campo="m.overlay.ativo"' + marcado(o.ativo) + '><span><strong>Mostrar retratos no OBS</strong><small>Desligado, o overlay fica transparente</small></span></label></header>' +
        '<div class="grade" style="grid-template-columns:minmax(0,1.3fr) minmax(300px,1fr)">' +
        '<section class="painel"><div class="titulo"><h2>Prévia</h2><span class="ajuda">Fala automática para testar · arraste para mover · puxe a bolinha para o tamanho</span></div>' +
        '<div class="previa" id="previa">' + (E && E.overlayUrl ? '<iframe title="Prévia do overlay" src="' + esc(E.overlayUrl) + '?demo=1&origem=app"></iframe>' : '') +
        '<div class="arrastar-previa" title="Arraste para mover os retratos"><div class="caixa-grupo" id="caixa-grupo"><span class="alca-grupo" title="Puxe para aumentar ou diminuir"></span></div></div></div>' +
        '<div class="separador"></div>' +
        '<h3>Colocar no OBS</h3>' +
        '<div class="url-overlay"><input type="text" readonly value="' + esc(E ? E.overlayUrl : '') + '" aria-label="Endereço do overlay"><button data-acao="copiarOverlay">Copiar</button></div>' +
        '<ol class="ajuda" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">' +
        '<li>No OBS, na cena do jogo: <strong>+</strong> em Fontes → <strong>Navegador</strong>.</li>' +
        '<li>Cole o endereço acima em <strong>URL</strong>. Largura <strong>1920</strong>, altura <strong>1080</strong>.</li>' +
        '<li>Desmarque “Desligar fonte quando não estiver visível”. Deixe a fonte por cima da captura do Foundry.</li></ol>' +
        '<div id="vivo-overlay-obs"></div></section>' +
        '<section class="painel"><h2>Posição</h2>' +
        '<div class="posicao-grade">' +
        '<div class="campo"><span class="rotulo">Ponto da tela</span><div class="ancoras" role="radiogroup" aria-label="Ponto da tela">' +
        ANCORAS.map(function (a) {
          return '<label class="ancora" title="' + esc(NOMES_ANCORA[a]) + '"><input type="radio" name="ancora" value="' + a + '" data-campo="m.overlay.ancora"' + marcado(o.ancora === a) + ' aria-label="' + esc(NOMES_ANCORA[a]) + '"><span></span></label>';
        }).join('') + '</div></div>' +
        '<div class="coluna" style="gap:12px;flex:1;min-width:200px">' +
        '<div class="campo"><span class="rotulo">Fila</span><div class="segmentos">' +
        '<label class="segmento"><input type="radio" name="direcao" value="horizontal" data-campo="m.overlay.direcao"' + marcado(o.direcao === 'horizontal') + '><span>▭▭▭ Deitada</span></label>' +
        '<label class="segmento"><input type="radio" name="direcao" value="vertical" data-campo="m.overlay.direcao"' + marcado(o.direcao === 'vertical') + '><span>▯ Em pé</span></label></div></div>' +
        '<label class="campo"><span class="rotulo">Começa por</span><select data-campo="m.overlay.ordem" id="ordem-overlay">' + opcoesOrdem(o) + '</select></label>' +
        '<div class="campo"><span class="rotulo">Mostrar</span><div class="segmentos">' +
        '<label class="segmento"><input type="radio" name="mostrar" value="todos" data-campo="m.overlay.mostrar"' + marcado(o.mostrar === 'todos') + '><span>Todo mundo</span></label>' +
        '<label class="segmento"><input type="radio" name="mostrar" value="falando" data-campo="m.overlay.mostrar"' + marcado(o.mostrar === 'falando') + '><span>Só quem fala</span></label></div></div>' +
        '</div></div>' +
        faixaOverlay('tamanho', 'Tamanho dos retratos', o.tamanho, 24, 400, ' px (num vídeo 1080p)') +
        faixaOverlay('espaco', 'Espaço entre os retratos', o.espaco, 0, 200, '% do tamanho') +
        faixaOverlay('margem', 'Distância da borda', o.margem, 0, 400, ' px') +
        '<div class="separador"></div>' +
        '<div class="titulo"><h3>Ajuste fino</h3><button class="pequeno" data-acao="centralizarOverlay">Voltar ao ponto escolhido</button></div>' +
        '<p class="ajuda">Arraste os retratos na prévia para levá-los aonde quiser, ou use os controles.</p>' +
        faixaOverlay('deslocX', 'Para os lados', o.deslocX, -960, 960, ' px') +
        faixaOverlay('deslocY', 'Para cima / para baixo', o.deslocY, -540, 540, ' px') +
        '<div class="campos">' +
        '<label class="campo"><span class="rotulo">Quando alguém fala</span>' + select('m.overlay.efeito', { brilho: 'Brilho na cor', aumentar: 'Aumenta', pular: 'Pula de leve', nenhum: 'Sem efeito' }, o.efeito) + '</label>' +
        '<label class="campo"><span class="rotulo">Formato</span>' + select('m.overlay.forma', { circulo: 'Círculo', arredondado: 'Quadrado arredondado', quadrado: 'Quadrado' }, o.forma) + '</label>' +
        '</div>' +
        '<label class="opcao"><input type="checkbox" data-campo="m.overlay.moldura"' + marcado(o.moldura) + '>Moldura branca fina</label>' +
        '<label class="opcao"><input type="checkbox" data-campo="m.overlay.apagarSilenciosos"' + marcado(o.apagarSilenciosos) + '>Apagar um pouco quem não está falando</label>' +
        '<label class="opcao"><input type="checkbox" data-campo="m.overlay.ocultarAusentes"' + marcado(o.ocultarAusentes) + '>Esconder quem não está no canal de voz</label>' +
        '<div class="separador"></div>' +
        '<h3>Nos cortes (próxima fase)</h3>' +
        '<label class="opcao"><input type="radio" name="cortes" value="como-overlay" data-campo="m.cortes.retratos"' + marcado(mesa().cortes.retratos === 'como-overlay') + '><span>Redesenhar os retratos nos cortes<small>No vertical você escolhe outra posição</small></span></label>' +
        '<label class="opcao"><input type="radio" name="cortes" value="nenhum" data-campo="m.cortes.retratos"' + marcado(mesa().cortes.retratos === 'nenhum') + '><span>Cortes sem retratos</span></label>' +
        '</section></div>';
    },
    depois: function () { ajustarPrevia(); },
    vivo: function () {
      desenharCaixaOverlay();
      var el = $('#vivo-overlay-obs');
      if (!el) return;
      el.innerHTML = E.erroServidor ? '<div class="erro-campo">' + esc(E.erroServidor) + '</div>' :
        E.overlayNoOBS ? '<div class="ok-campo">● O OBS está mostrando o overlay agora.</div>' :
          '<div class="ajuda">Ainda não aberto no OBS (o OBS precisa estar aberto com a fonte na cena).</div>';
    },
  };
  var ANCORAS = ['topo-esq', 'topo', 'topo-dir', 'meio-esq', 'centro', 'meio-dir', 'baixo-esq', 'baixo', 'baixo-dir'];
  var NOMES_ANCORA = {
    'topo-esq': 'Em cima, à esquerda', topo: 'Em cima, no meio', 'topo-dir': 'Em cima, à direita',
    'meio-esq': 'No meio, à esquerda', centro: 'No centro', 'meio-dir': 'No meio, à direita',
    'baixo-esq': 'Embaixo, à esquerda', baixo: 'Embaixo, no meio', 'baixo-dir': 'Embaixo, à direita',
  };
  function opcoesOrdem(o) {
    var r = o.direcao === 'vertical' ? { normal: 'De cima para baixo', invertida: 'De baixo para cima' } :
      { normal: 'Da esquerda para a direita', invertida: 'Da direita para a esquerda' };
    return Object.keys(r).map(function (k) { return '<option value="' + k + '"' + (o.ordem === k ? ' selected' : '') + '>' + r[k] + '</option>'; }).join('');
  }
  function faixaOverlay(campo, rotulo, valor, min, max, sufixo) {
    return '<label class="campo"><span class="rotulo">' + rotulo + ': <span data-eco="' + campo + '">' + valor + '</span>' + sufixo + '</span>' +
      '<input type="range" min="' + min + '" max="' + max + '" step="1" value="' + valor + '" data-campo="m.overlay.' + campo + '" data-num data-eco-alvo="' + campo + '"></label>';
  }
  // ---- edição com o mouse na prévia: arrastar move, a bolinha estica (o OBS acompanha ao vivo)
  var Lay = window.LayoutRetratos;
  function quantosNaPrevia(o) {
    if (o.mostrar === 'falando') return 1;
    var m = mesa();
    if (!m.jogadores.length) return 4;      // a prévia mostra 4 de exemplo
    if (E && E.streamkit && E.streamkit.conectado && o.ocultarAusentes) {
      return Math.max(1, m.jogadores.filter(function (j) { return E.streamkit.jogadores[j.id]; }).length);
    }
    return m.jogadores.length;
  }
  function grupoOverlay() {
    var o = mesa().overlay;
    return Lay.posicoes({
      W: 1920, H: 1080, ancora: o.ancora, direcao: o.direcao, ordem: o.ordem, mostrar: o.mostrar, espaco: o.espaco,
      deslocX: o.deslocX, deslocY: o.deslocY, tamanho: o.tamanho, margem: o.margem,
      comNome: mesa().nomes.modo !== 'nenhum', quantidade: quantosNaPrevia(o),
    }).grupo;
  }
  function desenharCaixaOverlay() {
    var cx = $('#caixa-grupo'), p = $('#previa');
    if (!cx || !p || !cfg) return;
    var o = mesa().overlay;
    var e = p.clientWidth / 1920;
    var g = grupoOverlay();
    var f = 6;
    cx.style.left = (g.x * e - f) + 'px';
    cx.style.top = (g.y * e - f) + 'px';
    cx.style.width = (g.largura * e + 2 * f) + 'px';
    cx.style.height = (g.altura * e + 2 * f) + 'px';
    var pt = Lay.partes(o.ancora);
    var al = cx.querySelector('.alca-grupo');
    al.style.left = pt.h === 'dir' ? '0' : '100%';
    al.style.top = pt.v === 'baixo' ? '0' : '100%';
    cx.hidden = !o.ativo;
  }
  function mostrarValores(campos) {
    var o = mesa().overlay;
    campos.forEach(function (k) {
      var inp = $('[data-campo="m.overlay.' + k + '"]'), eco = $('[data-eco="' + k + '"]');
      if (inp) inp.value = Math.round(o[k]);
      if (eco) eco.textContent = Math.round(o[k]);
    });
  }
  var arraste = null, ultimoEnvio = 0;
  document.addEventListener('pointerdown', function (ev) {
    var alvo = ev.target.closest && ev.target.closest('.arrastar-previa');
    if (!alvo || !cfg) return;
    var o = mesa().overlay;
    arraste = {
      modo: ev.target.closest('.alca-grupo') ? 'esticar' : 'mover',
      x: ev.clientX, y: ev.clientY, dx: o.deslocX, dy: o.deslocY, tam: o.tamanho,
      escala: 1920 / alvo.clientWidth, grupo: grupoOverlay(),
    };
    alvo.setPointerCapture(ev.pointerId);
    alvo.classList.add('arrastando');
    ev.preventDefault();
  });
  document.addEventListener('pointermove', function (ev) {
    if (!arraste) return;
    var o = mesa().overlay;
    var dx = (ev.clientX - arraste.x) * arraste.escala, dy = (ev.clientY - arraste.y) * arraste.escala;
    if (arraste.modo === 'mover') {
      o.deslocX = Math.max(-1920, Math.min(1920, Math.round(arraste.dx + dx)));
      o.deslocY = Math.max(-1080, Math.min(1080, Math.round(arraste.dy + dy)));
      mostrarValores(['deslocX', 'deslocY']);
    } else {
      o.tamanho = Math.max(24, Math.min(400, Math.round(arraste.tam * Lay.fatorEsticar(o.ancora, arraste.grupo, dx, dy))));
      mostrarValores(['tamanho']);
    }
    desenharCaixaOverlay();
    // a cada movimento marca que há edição pendente (a resposta de um envio antigo não desfaz o arraste);
    // de tempos em tempos envia na hora, para o OBS acompanhar ao vivo
    if (Date.now() - ultimoEnvio > 90) { ultimoEnvio = Date.now(); salvar(true); } else salvar(false);
  });
  document.addEventListener('pointerup', function () {
    if (!arraste) return;
    arraste = null;
    var a = $('.arrastar-previa');
    if (a) a.classList.remove('arrastando');
    salvar(true);
  });

  function portaOverlay() {
    try { return E && E.overlayUrl ? new URL(E.overlayUrl).port : String(cfg.overlayPorta); } catch (e) { return String(cfg.overlayPorta); }
  }
  function ajustarPrevia() {
    var p = $('#previa'), f = p && $('iframe', p);
    if (f) f.style.transform = 'scale(' + (p.clientWidth / 1920) + ')';
    desenharCaixaOverlay();
  }
  window.addEventListener('resize', ajustarPrevia);

  // ---------------------------------------------------------------- conexões
  TELAS.conexoes = {
    html: function () {
      var m = mesa();
      return '' +
        '<header class="cabecalho"><div><h1>Conexões</h1><p>O app conversa com o OBS e lê o StreamKit do Discord. Nada vai para a internet.</p></div></header>' +
        '<div class="grade">' +
        '<section class="painel"><div class="titulo"><h2>OBS</h2><span id="vivo-obs"></span></div>' +
        '<ol class="ajuda" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">' +
        '<li>No OBS: <strong>Ferramentas → Configurações do servidor WebSocket</strong>.</li>' +
        '<li>Marque <strong>Ativar servidor WebSocket</strong>.</li>' +
        '<li>Clique em <strong>Mostrar informações de conexão</strong> e copie a senha para cá.</li></ol>' +
        '<div class="campos">' +
        '<label class="campo"><span class="rotulo">Endereço</span><input type="text" data-campo="c.obs.host" value="' + esc(cfg.obs.host) + '"></label>' +
        '<label class="campo"><span class="rotulo">Porta</span><input type="number" min="1" max="65535" data-campo="c.obs.porta" data-num value="' + cfg.obs.porta + '"></label>' +
        '<label class="campo"><span class="rotulo">Senha</span><input type="password" data-campo="c.obs.senha" value="' + esc(cfg.obs.senha) + '" autocomplete="off"></label>' +
        '</div><p class="ajuda">O app reconecta sozinho se o OBS fechar e abrir de novo.</p></section>' +

        '<section class="painel"><div class="titulo"><h2>Discord (StreamKit)</h2><span id="vivo-sk-pilula"></span></div>' +
        '<ol class="ajuda" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">' +
        '<li>Deixe o Discord aberto no PC.</li>' +
        '<li>Clique em <strong>Abrir StreamKit</strong> e em <strong>Install for OBS</strong>. O Discord pede para autorizar: aceite (é só uma vez).</li>' +
        '<li>Escolha <strong>Voice Widget</strong>, o servidor e o canal de voz da mesa.</li>' +
        '<li>O link aparece aqui sozinho. Se não aparecer, copie o link de lá e cole abaixo.</li></ol>' +
        '<div class="linha"><button class="principal" data-acao="abrirStreamKit">Abrir StreamKit</button>' +
        '<button data-acao="recarregarStreamKit">Recarregar leitura</button></div>' +
        '<h3 style="margin:6px 0 0">Canais de voz desta mesa</h3>' +
        '<p class="ajuda">Salve um link para cada canal onde vocês jogam. Na hora da sessão, troque com um clique aqui, no menu ao lado ou na Sessão ao vivo (funciona até no meio da gravação).</p>' +
        canaisHtml(m) +
        '<div class="linha"><button data-acao="novoCanal">Adicionar canal</button></div>' +
        '<div id="vivo-sk"></div></section>' +
        '<section class="painel"><div class="titulo"><h2>Foundry (opcional)</h2>' +
        '<label class="opcao"><input type="checkbox" data-campo="c.foundry.ativo"' + marcado(cfg.foundry.ativo) + '>Aceitar marcadores do Foundry</label></div>' +
        '<p class="ajuda">Com o módulo “Gravador RPG — Marcadores” ativo no mundo, combates, críticos e trocas de cena viram marcadores sozinhos. Só o mestre precisa do módulo.</p>' +
        '<ol class="ajuda" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">' +
        '<li>Copie a pasta <code>modulo-foundry/gravador-rpg-marcadores</code> (vem no ZIP do app) para <code>Data/modules</code> do Foundry, ou suba na Forge.</li>' +
        '<li>Ative o módulo no mundo.</li>' +
        '<li>Em Configurações do módulo, cole a <strong>chave</strong> e a <strong>porta</strong> abaixo.</li></ol>' +
        '<div class="campos"><label class="campo"><span class="rotulo">Chave</span><div class="url-overlay"><input type="text" readonly value="' + esc(cfg.foundry.chave) + '"><button class="pequeno" data-acao="copiarTexto" data-texto="' + esc(cfg.foundry.chave) + '">Copiar</button></div></label>' +
        '<label class="campo"><span class="rotulo">Porta</span><div class="url-overlay"><input type="text" readonly value="' + esc(portaOverlay()) + '"><button class="pequeno" data-acao="copiarTexto" data-texto="' + esc(portaOverlay()) + '">Copiar</button></div></label></div>' +
        '</section>' +
        '</div>';
    },
    depois: function () { validarSK(); },
    vivo: function () {
      var o = E.obs;
      $('#vivo-obs').innerHTML = pilula(statusOBS());
      if (!o.conectado && o.erro) $('#vivo-obs').innerHTML += '<div class="erro-campo" style="margin-top:6px">' + esc(o.erro) + '</div>';
      else if (o.conectado && o.versao) $('#vivo-obs').innerHTML += '<div class="ajuda" style="margin-top:4px">OBS ' + esc(o.versao) + '</div>';
      $('#vivo-sk-pilula').innerHTML = pilula(statusSK());
      var sk = E.streamkit, t = '';
      if (sk.configurado && sk.conectado && !sk.presentes) {
        t = '<p class="ajuda">A página do StreamKit abriu, mas não mostra ninguém. Entre no canal de voz. ' +
          (sk.texto ? 'A página diz: “' + esc(sk.texto) + '”. ' : '') +
          'Se pedir autorização, clique em Abrir StreamKit e faça o passo 2.</p>';
      } else if (sk.configurado && !sk.conectado) {
        t = '<p class="erro-campo">Sem leitura do StreamKit. O Discord está aberto? Tente “Recarregar leitura”.</p>';
      } else if (sk.conectado && sk.presentes) {
        t = '<p class="ok-campo">● Lendo o canal: ' + sk.presentes + ' pessoa(s). Veja quem é quem em Mesa e jogadores.</p>';
      }
      $('#vivo-sk').innerHTML = t;
    },
  };
  var RE_SK = /^https:\/\/streamkit\.discord\.com\/overlay\/voice\/\d{15,22}\/\d{15,22}(\/)?(\?.*)?$/;
  function canaisHtml(m) {
    var cs = m.streamkit.canais || [];
    if (!cs.length) return '<div class="vazio">Nenhum canal ainda. Clique em <strong>Abrir StreamKit</strong>, escolha Voice Widget, o servidor e o canal: o link entra aqui sozinho.</div>';
    return '<div class="coluna canais">' + cs.map(function (c) {
      var ativo = c.id === m.streamkit.ativo;
      return '<div class="canal' + (ativo ? ' ativo' : '') + '" data-canal-id="' + esc(c.id) + '">' +
        '<div class="linha" style="gap:8px">' +
        (ativo ? '<span class="pilula"><span class="ponto ok"></span>Em uso</span>' :
          '<button class="pequeno principal" data-acao="trocarCanal" data-id="' + esc(c.id) + '">Usar este</button>') +
        '<input type="text" aria-label="Nome do canal" data-campo="k.' + esc(c.id) + '.nome" value="' + esc(c.nome) + '" placeholder="Nome (ex.: Mesa de sábado)" style="flex:1" data-atualiza-menu>' +
        '<button class="pequeno perigo" data-acao="removerCanal" data-id="' + esc(c.id) + '" title="Tirar da lista">Remover</button></div>' +
        '<input type="url" aria-label="Link do widget de voz" data-campo="k.' + esc(c.id) + '.url" value="' + esc(c.url) + '" placeholder="https://streamkit.discord.com/overlay/voice/…" data-valida-sk>' +
        '<div data-valida-saida></div></div>';
    }).join('') + '</div>';
  }
  function validarSK() {
    $$('[data-valida-sk]').forEach(function (inp) {
      var el = inp.parentNode.querySelector('[data-valida-saida]');
      if (!el) return;
      var v = inp.value.trim();
      el.innerHTML = !v ? '<span class="ajuda">Cole o link do Voice Widget deste canal.</span>' : RE_SK.test(v) ? '' :
        /streamkit\.discord\.com/.test(v) ? '<span class="erro-campo">Esse link do StreamKit não é do widget de voz. Escolha “Voice Widget”, o servidor e o canal.</span>' :
          '<span class="erro-campo">O link precisa começar com https://streamkit.discord.com/overlay/voice/</span>';
    });
  }
  function canalAtivo() {
    var m = mesa();
    return (m.streamkit.canais || []).filter(function (c) { return c.id === m.streamkit.ativo; })[0] || null;
  }
  /** Seletor de canal (menu e Sessão ao vivo). Vazio se a mesa tem menos de 2 canais. */
  function seletorCanalHtml(id) {
    var m = mesa(), cs = m.streamkit.canais || [];
    if (cs.length < 2) return '';
    return '<select id="' + id + '" data-troca-canal aria-label="Canal de voz">' + cs.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === m.streamkit.ativo ? ' selected' : '') + '>' + esc(c.nome) + '</option>';
    }).join('') + '</select>';
  }

  // ---------------------------------------------------------------- gravação e atalhos
  var ATALHOS = {
    marcar: ['Marcar momento', 'Cria um marcador agora'],
    marcarNome: ['Marcar com nome', 'Marca agora e abre uma caixinha para escrever'],
    replay: ['Salvar replay', 'Salva os últimos minutos (Replay Buffer do OBS)'],
    gravar: ['Começar / parar gravação', 'Liga e desliga a gravação do OBS'],
  };
  TELAS.gravacao = {
    html: function () {
      var g = cfg.gravacao;
      return '' +
        '<header class="cabecalho"><div><h1>Gravação e atalhos</h1><p>O OBS grava em pedaços; o app guarda as últimas horas e tira as mais antigas sozinho.</p></div></header>' +
        '<div class="grade">' +
        '<section class="painel"><h2>Quanto guardar</h2>' +
        '<div class="campos">' +
        '<label class="campo"><span class="rotulo">Máximo de horas</span><input type="number" min="1" max="200" step="1" data-campo="c.gravacao.limiteHoras" data-num value="' + g.limiteHoras + '"></label>' +
        '<label class="campo"><span class="rotulo">Máximo de espaço (GB)</span><input type="number" min="1" max="4000" step="1" data-campo="c.gravacao.limiteGB" data-num value="' + g.limiteGB + '"></label>' +
        '</div>' +
        '<p class="ajuda">Vale o que chegar primeiro. Pedaços perto de um marcador nunca saem sozinhos. Só arquivos que o OBS gravou com o app aberto são tocados.</p>' +
        '<label class="opcao"><input type="radio" name="destino" value="lixeira" data-campo="c.gravacao.destino"' + marcado(g.destino === 'lixeira') + '><span>Mandar para a Lixeira<small>Mais seguro. Lembre de esvaziar a Lixeira para liberar o espaço.</small></span></label>' +
        '<label class="opcao"><input type="radio" name="destino" value="apagar" data-campo="c.gravacao.destino"' + marcado(g.destino === 'apagar') + '><span>Apagar de vez<small>Libera o espaço na hora. Não dá para desfazer.</small></span></label>' +
        '<div class="separador"></div>' +
        '<div id="vivo-disco2" class="coluna"></div>' +
        '<div class="linha"><button data-acao="simularLimpeza">Ver o que sairia agora</button><button data-acao="limpar">Limpar agora</button></div>' +
        '<div id="resultado-simulacao" class="ajuda"></div></section>' +

        '<section class="painel"><h2>Atalhos</h2><p class="ajuda">Funcionam com qualquer janela na frente. Clique no campo e aperte a combinação. <kbd>Esc</kbd> cancela, <kbd>Backspace</kbd> apaga.</p>' +
        Object.keys(ATALHOS).map(function (k) {
          return '<div class="atalho"><div><strong>' + esc(ATALHOS[k][0]) + '</strong><div class="ajuda">' + esc(ATALHOS[k][1]) + '</div></div>' +
            '<input type="text" readonly data-atalho="' + k + '" value="' + esc(cfg.atalhos[k]) + '" aria-label="Atalho: ' + esc(ATALHOS[k][0]) + '">' +
            '<span data-atalho-status="' + k + '"></span></div>';
        }).join('') +
        '<div class="separador"></div>' +
        '<h2>Outros</h2>' +
        '<label class="opcao"><input type="checkbox" data-campo="c.avisos.marcador"' + marcado(cfg.avisos.marcador) + '><span>Aviso do Windows ao marcar<small>Um aviso discreto confirma cada marcador</small></span></label>' +
        '<label class="opcao"><input type="checkbox" data-campo="c.gravacao.gravarAoEntrar"' + marcado(g.gravarAoEntrar) + '><span>Começar a gravar quando alguém entrar no canal<small>Precisa do OBS e do StreamKit conectados</small></span></label>' +
        '<label class="opcao"><input type="checkbox" data-campo="c.app.fecharParaBandeja"' + marcado(cfg.app.fecharParaBandeja) + '><span>O X da janela deixa o app na bandeja (perto do relógio)<small>Gravação, retratos e música continuam. Para sair de vez: botão direito no ícone → Sair</small></span></label>' +
        '<div class="separador"></div><h2>Atualizações</h2><div id="vivo-atualizacao-tela"></div>' +
        '<label class="opcao"><input type="checkbox" data-campo="c.app.procurarAtualizacoes"' + marcado(cfg.app.procurarAtualizacoes) + '><span>Procurar versão nova sozinho<small>Quando abre o app e a cada 6 horas. Só avisa: atualiza quando você clicar</small></span></label>' +
        '<div class="separador"></div>' +
        '<label class="campo"><span class="rotulo">Tamanho de cada pedaço no OBS (minutos, só para referência)</span><input type="number" min="5" max="240" data-campo="c.gravacao.minutosPedaco" data-num value="' + g.minutosPedaco + '"></label>' +
        '<label class="campo"><span class="rotulo">Porta do overlay (avançado)</span><input type="number" min="1024" max="65535" data-campo="c.overlayPorta" data-num value="' + cfg.overlayPorta + '"></label>' +
        '<div class="linha"><button class="pequeno" data-acao="abrirPasta" data-qual="sessoes">Abrir pasta das sessões</button>' +
        '<button class="pequeno" data-acao="abrirPasta" data-qual="imagens">Abrir pasta das imagens</button></div>' +
        '</section>' +
        '<section class="painel"><h2>Cortes</h2>' +
        '<div class="campo"><span class="rotulo">Pasta onde os cortes são salvos</span><code id="pasta-cortes" style="word-break:break-all">' + esc(E ? E.pastaCortes : '') + '</code>' +
        '<div class="linha"><button class="pequeno" data-acao="escolherPastaCortes">Escolher pasta</button><button class="pequeno" data-acao="abrirPastaCortes">Abrir</button></div></div>' +
        '<div class="campos">' +
        '<label class="campo"><span class="rotulo">Segundos antes do marcador</span><input type="number" min="0" max="600" data-campo="c.cortes.antes" data-num value="' + cfg.cortes.antes + '"></label>' +
        '<label class="campo"><span class="rotulo">Segundos depois do marcador</span><input type="number" min="1" max="600" data-campo="c.cortes.depois" data-num value="' + cfg.cortes.depois + '"></label>' +
        '</div>' +
        '<div class="campo"><span class="rotulo">Nome das faixas de áudio do OBS</span><div class="campos">' +
        cfg.cortes.nomesFaixas.map(function (n, i) {
          return '<label class="campo"><span class="rotulo">Faixa ' + (i + 1) + '</span><input type="text" data-campo="c.cortes.nomesFaixas.' + i + '" value="' + esc(n) + '"></label>';
        }).join('') + '</div></div>' +
        '<div class="separador"></div><h3>FFmpeg (o programa que gera os vídeos)</h3><div id="vivo-ffmpeg"></div>' +
        '<label class="campo"><span class="rotulo">Caminho do ffmpeg.exe (vazio = automático)</span><input type="text" data-campo="c.cortes.ffmpeg" value="' + esc(cfg.cortes.ffmpeg) + '" placeholder="automático"></label>' +
        '<div class="linha"><button class="pequeno" data-acao="escolherFFmpeg">Escolher ffmpeg.exe</button><button class="pequeno" data-acao="verificarFFmpeg">Procurar de novo</button></div>' +
        '</section></div>';
    },
    vivo: function () {
      $('#vivo-disco2').innerHTML = discoHtml();
      var ff = E.ffmpeg || {};
      var vf = $('#vivo-ffmpeg');
      if (vf) vf.innerHTML = ff.verificando ? '<p class="ajuda">Procurando…</p>' : ff.ok ?
        '<p class="ok-campo">● FFmpeg ' + esc(ff.versao) + (ff.nvenc ? ' · placa NVIDIA (NVENC) disponível' : ' · sem NVENC: exporta pelo processador, mais devagar') + '</p>' :
        '<p class="erro-campo">' + esc(ff.erro || 'FFmpeg não encontrado.') + '</p>';
      var pc = $('#pasta-cortes');
      if (pc) pc.textContent = E.pastaCortes || '';
      Object.keys(ATALHOS).forEach(function (k) {
        var st = (E.atalhos || {})[k];
        var el = $('[data-atalho-status="' + k + '"]');
        if (!el) return;
        el.innerHTML = st === 'ok' ? '<span class="ok-campo">● Ativo</span>' :
          st === 'ocupado' ? '<span class="erro-campo">Usado por outro programa</span>' :
            st === 'invalido' ? '<span class="erro-campo">Combinação inválida</span>' :
              st === 'vazio' ? '<span class="ajuda">Sem atalho</span>' : '<span class="ajuda">—</span>';
      });
    },
  };

  // ---------------------------------------------------------------- primeiros passos
  TELAS.ajuda = {
    html: function () {
      return '' +
        '<header class="cabecalho"><div><h1>Primeiros passos</h1><p>Faça uma vez, na ordem. Os itens ficam verdes sozinhos quando estiverem certos.</p></div></header>' +
        '<ol class="passos">' +
        passo('obs', 'Ligar o OBS ao app', '<p>No OBS: <strong>Ferramentas → Configurações do servidor WebSocket</strong>, ative e copie a senha para <a href="#conexoes">Conexões</a>.</p>') +
        passo('config', 'Configurar a gravação no OBS (uma vez)', configOBS()) +
        passo('sk', 'Ligar o Discord (StreamKit)', '<p>Em <a href="#conexoes">Conexões</a>, clique em <strong>Abrir StreamKit</strong>, autorize no Discord e escolha o canal de voz da mesa.</p>') +
        passo('jogadores', 'Cadastrar os jogadores', '<p>Em <a href="#mesa">Mesa e jogadores</a>: entre no canal de voz e clique em <strong>Adicionar à mesa</strong> em cada pessoa. Depois escolha a imagem e o nome do personagem.</p>') +
        passo('overlay', 'Colocar o overlay na cena do OBS', '<p>Em <a href="#overlay">Overlay</a>, copie o endereço e crie uma fonte <strong>Navegador</strong> de 1920×1080 por cima da captura do Foundry.</p>') +
        passo('teste', 'Fazer um teste de 1 minuto', '<ul><li>Aperte <kbd>' + esc(cfg.atalhos.gravar) + '</kbd> para gravar.</li><li>Fale no Discord e veja seu retrato acender.</li><li>Aperte <kbd>' + esc(cfg.atalhos.marcar) + '</kbd> e confira o marcador em <a href="#sessao">Sessão ao vivo</a>.</li><li>Aperte <kbd>' + esc(cfg.atalhos.gravar) + '</kbd> de novo para parar.</li></ul>') +
        passo('musica', 'Bot de música (opcional)', '<p>Em <a href="#musica">Música</a>, crie o seu bot no Discord (uns 3 minutos, o app mostra o passo a passo), adicione a pasta das suas trilhas e toque. Ele entra no canal da mesa e é gravado junto com o Discord.</p>') +
        passo('corte', 'Fazer o primeiro corte', '<p>Em <a href="#momentos">Momentos e cortes</a>, clique em <strong>Criar corte</strong> no marcador do teste, ajuste e exporte. Para vertical, use <strong>Editar vertical →</strong>.</p>') +
        '</ol>';
    },
    vivo: function () {
      var m = mesa(), sk = E.streamkit;
      var ligados = m.jogadores.filter(function (j) { return sk.jogadores[j.id]; }).length;
      var feitos = {
        obs: E.obs.conectado,
        config: false,
        sk: sk.configurado && sk.conectado,
        jogadores: m.jogadores.length > 0 && (ligados > 0 || !sk.conectado),
        overlay: E.overlayNoOBS > 0,
        teste: !!(E.sessao && E.sessao.marcadores.length) || E.disco.pedacos > 0,
        corte: (E.fila || []).some(function (x) { return x.estado === 'pronto'; }),
      };
      Object.keys(feitos).forEach(function (k) {
        var el = $('[data-passo="' + k + '"]');
        if (el) el.classList.toggle('feito', !!feitos[k]);
      });
    },
  };
  function passo(id, titulo, corpo) {
    return '<li class="passo" data-passo="' + id + '"><span class="numero" aria-hidden="true"></span><div class="coluna"><h2>' + esc(titulo) + '</h2>' + corpo + '</div></li>';
  }
  function configOBS() {
    return '<p>Em <strong>Configurações → Saída</strong>, mude <strong>Modo de saída</strong> para <strong>Avançado</strong> e, na aba <strong>Gravação</strong>:</p>' +
      '<table class="tabela"><tr><th>Opção</th><th>Valor</th><th>Por quê</th></tr>' +
      '<tr><td>Formato da gravação</td><td><strong>MP4 Híbrido</strong></td><td>Guarda os marcadores e não corrompe se o PC travar</td></tr>' +
      '<tr><td>Codificador de vídeo</td><td><strong>NVIDIA NVENC HEVC</strong></td><td>Usa a sua RTX, quase sem pesar no jogo, e ocupa menos espaço</td></tr>' +
      '<tr><td>Controle de taxa</td><td><strong>Quantização constante</strong> (CQP), nível <strong>16</strong></td><td>Qualidade fixa: mapa parado gasta pouco, cena com movimento ganha bits</td></tr>' +
      '<tr><td>Predefinição</td><td><strong>P7</strong> (mais lento, melhor qualidade)</td><td>A RTX 5070 Ti dá conta sem pesar no jogo</td></tr>' +
      '<tr><td>Dividir arquivo automaticamente</td><td><strong>Por tempo, ' + cfg.gravacao.minutosPedaco + ' min</strong></td><td>Pedaços que o app consegue limpar</td></tr>' +
      '<tr><td>Faixas de áudio</td><td><strong>1, 2, 3 e 4</strong></td><td>1 = tudo junto, 2 = seu microfone, 3 = Discord, 4 = Foundry</td></tr></table>' +
      '<p class="ajuda">Para separar o áudio: adicione a fonte <strong>Captura de áudio de aplicativo</strong> para o Discord e outra para o navegador/app do Foundry. Em <strong>Propriedades avançadas de áudio</strong>, marque a faixa 1 em todas e a faixa própria de cada uma.</p>' +
      '<p class="ajuda">Replay (opcional): <strong>Saída → Buffer de replay</strong> → ativar, 120 segundos. O app liga o buffer sozinho quando a gravação começa.</p>' +
      '<p class="ajuda">Em <strong>Vídeo</strong>, use a resolução de saída em que quer o vídeo final (1920×1080 ou 2560×1440) e 30 ou 60 FPS. Este passo o app não consegue conferir sozinho: siga a tabela uma vez e pronto.</p>';
  }

  // ================================================================ desenho
  function desenharMenu() {
    var noMenu = (TELAS[tela] && TELAS[tela].menu) || tela;
    $$('.menu a[data-tela]').forEach(function (a) {
      if (a.getAttribute('data-tela') === noMenu) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    var sel = $('#seletor-mesa');
    sel.innerHTML = cfg.mesas.map(function (m) {
      return '<option value="' + esc(m.id) + '"' + (m.id === cfg.mesaAtiva ? ' selected' : '') + '>' + esc(m.nome) + ' (' + (m.papel === 'mestre' ? 'mestre' : 'jogador') + ')</option>';
    }).join('');
    var caixa = $('#menu-canal');
    if (caixa && !caixa.contains(document.activeElement)) {
      var html = seletorCanalHtml('seletor-canal');
      caixa.innerHTML = html ? '<label class="rotulo" for="seletor-canal">Canal de voz</label>' + html : '';
    }
  }
  function desenhar() {
    if (!cfg) return;
    var t = TELAS[tela] || TELAS.sessao;
    if (desenhada && desenhada !== t && desenhada.sair) desenhada.sair();
    desenhada = t;
    var rolagem = window.scrollY;
    $('#tela').innerHTML = t.html();
    desenharMenu();
    if (t.depois) t.depois();
    aoVivo();
    window.scrollTo(0, rolagem);
  }
  var desenhada = null;
  /** Versão do app e atualização (menu e tela Gravação). */
  function atualizacaoHtml(completo) {
    var a = (E && E.atualizacao) || {};
    var v = E && E.versao ? 'v' + E.versao : '';
    if (!completo) {
      if (a.baixando) return '<span class="ajuda">Baixando atualização ' + Math.round((a.progresso || 0) * 100) + '%…</span>';
      if (a.disponivel) return '<button class="principal pequeno" data-acao="atualizarAgora">Atualizar para ' + esc(a.disponivel) + '</button>';
      return '<span class="ajuda versao-app">Gravador RPG ' + esc(v) + '</span>';
    }
    return '<p>Você está na versão <strong>' + esc(v) + '</strong>.' +
      (a.verificando ? ' Procurando versão nova…' : a.disponivel ? ' <strong class="ok-campo">Versão ' + esc(a.disponivel) + ' disponível!</strong>' :
        a.verificadoEm ? ' É a mais nova.' : '') + '</p>' +
      (a.erro ? '<p class="erro-campo">' + esc(a.erro) + '</p>' : '') +
      (a.disponivel && a.notas ? '<details class="leg-detalhes" open><summary>O que mudou</summary><pre class="novidades">' + esc(a.notas) + '</pre></details>' : '') +
      (a.baixando ? '<div class="leg-progresso"><span>Baixando… ' + Math.round((a.progresso || 0) * 100) + '%</span><div class="barra"><i style="width:' + Math.round((a.progresso || 0) * 100) + '%"></i></div></div>' : '') +
      '<div class="linha">' + (a.disponivel ? '<button class="principal" data-acao="atualizarAgora"' + (a.baixando ? ' disabled' : '') + '>Atualizar agora</button>' : '') +
      '<button class="pequeno" data-acao="procurarAtualizacao"' + (a.verificando ? ' disabled' : '') + '>Procurar agora</button>' +
      (a.pagina ? '<button class="pequeno" data-acao="abrirExterno" data-url="' + esc(a.pagina) + '">Página do app no GitHub</button>' : '') + '</div>' +
      '<p class="ajuda">Ao atualizar, o app fecha, copia os arquivos novos e abre de novo sozinho (pode aparecer uma janelinha preta por alguns segundos). Suas configurações, mesas, músicas e gravações não mudam.</p>';
  }

  function aoVivo() {
    if (!E || !cfg) return;
    var va = $('#vivo-atualizacao');
    if (va) { var h = atualizacaoHtml(false); if (va.getAttribute('data-h') !== h) { va.innerHTML = h; va.setAttribute('data-h', h); } }
    var va2 = $('#vivo-atualizacao-tela');
    if (va2) { var h2 = atualizacaoHtml(true); if (va2.getAttribute('data-h') !== h2) { va2.innerHTML = h2; va2.setAttribute('data-h', h2); } }
    var s1 = statusOBS(), s2 = statusSK();
    var rodando = (E.fila || []).filter(function (x) { return x.estado === 'rodando'; })[0];
    var esperando = (E.fila || []).filter(function (x) { return x.estado === 'espera'; }).length;
    $('#vivo-menu').innerHTML = '<span class="linha" style="gap:6px"><span class="ponto ' + s1.classe + '"></span>' + esc(s1.texto) + '</span>' +
      '<span class="linha" style="gap:6px"><span class="ponto ' + s2.classe + '"></span>' + esc(s2.texto) + '</span>' +
      (rodando ? '<a href="#momentos" class="linha" style="gap:6px;padding:0;color:var(--destaque)"><span class="ponto alerta"></span>Exportando ' + Math.round(rodando.progresso * 100) + '%' + (esperando ? ' (+' + esperando + ')' : '') + '</a>' : '');
    var t = TELAS[tela];
    if (t && t.vivo) t.vivo();
  }
  function lerRota(hash) {
    var partes = String(hash || '').replace(/^#/, '').split('/');
    return { tela: TELAS[partes[0]] ? partes[0] : 'sessao', params: partes.slice(1).map(function (x) { try { return decodeURIComponent(x); } catch (e) { return x; } }) };
  }
  function irPara(hash) {
    var r = lerRota(hash);
    tela = r.tela;
    rotaParams = r.params;
    window.scrollTo(0, 0);
    desenhar();
    $('#tela').focus({ preventScroll: true });
  }

  // ================================================================ edição de campos
  function definir(caminho, valor) {
    var partes = caminho.split('.');
    var alvo;
    if (partes[0] === 'm') { alvo = mesa(); partes.shift(); }
    else if (partes[0] === 'c') { alvo = cfg; partes.shift(); }
    else if (partes[0] === 'j') { alvo = jogador(partes[1]); partes.splice(0, 2); }
    else if (partes[0] === 'k') {
      var mk = mesa();
      alvo = (mk.streamkit.canais || []).filter(function (c) { return c.id === partes[1]; })[0];
      // o link do canal em uso também é o link ativo da mesa
      if (alvo && partes[2] === 'url' && alvo.id === mk.streamkit.ativo) mk.streamkit.url = valor;
      partes.splice(0, 2);
    }
    if (!alvo) return;
    for (var i = 0; i < partes.length - 1; i++) {
      if (alvo[partes[i]] == null || typeof alvo[partes[i]] !== 'object') alvo[partes[i]] = {};
      alvo = alvo[partes[i]];
    }
    alvo[partes[partes.length - 1]] = valor;
  }
  function valorDe(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.hasAttribute('data-num')) return Number(el.value);
    return el.value;
  }

  function aoEditar(ev) {
    var el = ev.target;
    if (el.hasAttribute('data-marcador')) return; // marcador salva ao sair do campo
    var campo = el.getAttribute('data-campo');
    if (!campo) return;
    if (el.type === 'radio' && !el.checked) return;
    // números digitados salvam quando o campo perde o foco (evita salvar "1" no meio de "10")
    if (ev.type === 'input' && el.type === 'number') return;
    definir(campo, valorDe(el));
    salvar(el.type === 'checkbox' || el.type === 'radio' || el.tagName === 'SELECT');

    var eco = el.getAttribute('data-eco-alvo');
    if (eco) { var e2 = $('[data-eco="' + eco + '"]'); if (e2) e2.textContent = el.value; }
    if (el.hasAttribute('data-avatar') || el.hasAttribute('data-nome-previa')) atualizarCartao(el);
    if (el.hasAttribute('data-atualiza-menu')) desenharMenu();
    if (el.hasAttribute('data-valida-sk')) validarSK();
    if (campo === 'm.overlay.direcao') { var so = $('#ordem-overlay'); if (so) so.innerHTML = opcoesOrdem(mesa().overlay); }
    if (campo && campo.indexOf('m.overlay.') === 0) desenharCaixaOverlay();
    if (el.hasAttribute('data-rerender') && ev.type === 'change') desenhar();
  }

  function atualizarCartao(el) {
    var card = el.closest('[data-jogador]');
    if (!card) return;
    var j = jogador(card.getAttribute('data-jogador'));
    if (!j) return;
    var av = $('.avatar', card);
    var novo = document.createElement('div');
    novo.innerHTML = avatarHtml(j, { grande: true, idFala: true });
    av.replaceWith(novo.firstChild);
    var n = nomeNoVideo(j);
    var alvo = $('[data-nome-final]', card);
    if (alvo) alvo.innerHTML = n ? 'No vídeo aparece: <strong>' + esc(n) + '</strong>' : 'No vídeo: sem nome';
  }

  // ---------------------------------------------------------------- captura de atalho
  var TECLAS = {
    ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    Pause: 'Pause', ScrollLock: 'Scrolllock', PrintScreen: 'PrintScreen',
  };
  function acelerador(ev) {
    var k = ev.key, tecla = '';
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(k)) tecla = k;
    else if (/^Numpad[0-9]$/.test(ev.code)) tecla = 'num' + ev.code.slice(6);
    else if (/^Key[A-Z]$/.test(ev.code)) tecla = ev.code.slice(3);
    else if (/^Digit[0-9]$/.test(ev.code)) tecla = ev.code.slice(5);
    else if (TECLAS[k]) tecla = TECLAS[k];
    if (!tecla) return null;
    var mods = [];
    if (ev.ctrlKey) mods.push('Ctrl');
    if (ev.altKey) mods.push('Alt');
    if (ev.shiftKey) mods.push('Shift');
    if (ev.metaKey) mods.push('Super');
    var soLetra = /^[A-Z0-9]$/.test(tecla) || tecla === 'Space';
    if (soLetra && !mods.filter(function (m) { return m !== 'Shift'; }).length) return { erro: 'Letras e números precisam de Ctrl ou Alt (senão atrapalham a digitação).' };
    return { valor: mods.concat([tecla]).join('+') };
  }
  function aoTeclarAtalho(ev) {
    var el = ev.target;
    var nome = el.getAttribute && el.getAttribute('data-atalho');
    if (!nome) return;
    if (ev.key === 'Tab') return;
    ev.preventDefault();
    if (ev.key === 'Escape') { el.value = cfg.atalhos[nome]; el.blur(); return; }
    if (ev.key === 'Backspace') { cfg.atalhos[nome] = ''; el.value = ''; salvar(true); return; }
    if (['Control', 'Shift', 'Alt', 'Meta'].indexOf(ev.key) >= 0) return;
    var r = acelerador(ev);
    if (!r) { aviso('Essa tecla não pode ser atalho.', 'erro'); return; }
    if (r.erro) { aviso(r.erro, 'erro'); return; }
    var outro = Object.keys(cfg.atalhos).filter(function (k) { return k !== nome && cfg.atalhos[k] === r.valor; })[0];
    if (outro) { aviso(r.valor + ' já é o atalho de “' + ATALHOS[outro][0] + '”.', 'erro'); return; }
    cfg.atalhos[nome] = r.valor;
    el.value = r.valor;
    salvar(true);
    el.blur();
  }

  function trocarCanal(id) {
    return salvarPendente().then(function () { return window.api.trocarCanal(id); }).then(function (r) {
      if (r && !r.erro) {
        cfg = r; editando = 0; desenhar();
        var c = canalAtivo();
        aviso('Lendo agora: ' + (c ? c.nome : 'canal') + '.', 'ok');
      } else resultado(r);
    });
  }

  // ================================================================ ações dos botões
  var ACOES = {
    marcar: function () { return window.api.marcar('').then(function (r) { resultado(r, true); }); },
    marcarNome: function () { return window.api.marcarComNome().then(function (r) { resultado(r); }); },
    replay: function () { return window.api.replay().then(function (r) { resultado(r, true); }); },
    gravar: function () { return window.api.gravar().then(function (r) { resultado(r); }); },
    adicionarDetectado: function (el) {
      return salvarPendente().then(function () { return window.api.adicionarDetectado(el.getAttribute('data-id'), el.getAttribute('data-nome')).then(function (r) {
        if (r && !r.erro) { cfg = r; editando = 0; desenhar(); aviso('Adicionado. Agora escolha a imagem e o personagem.', 'ok'); } else resultado(r);
      }); });
    },
    ignorarDetectado: function (el) {
      return salvarPendente().then(function () { return window.api.ignorarDetectado(el.getAttribute('data-id')).then(function (r) {
        if (r && !r.erro) { cfg = r; editando = 0; desenhar(); } else resultado(r);
      }); });
    },
    designorar: function (el) {
      var m = mesa(), id = el.getAttribute('data-id');
      m.ignorados = m.ignorados.filter(function (x) { return x !== id; });
      salvar(true); desenhar();
    },
    addJogador: function () {
      mesa().jogadores.push({
        id: novoId(), discordId: '', discordNome: '', jogador: '', personagem: '', imagem: '',
        foco: { x: 50, y: 50, zoom: 100 }, cor: '#F0B44C', nomeModo: 'padrao', nomeTexto: '',
      });
      salvar(true); desenhar();
      var cards = $$('[data-jogador]');
      var ult = cards[cards.length - 1];
      if (ult) { ult.scrollIntoView({ block: 'center' }); $('input[type=text]', ult).focus(); }
    },
    removerJogador: function (el) {
      var j = jogador(el.getAttribute('data-id'));
      if (!j || !confirm('Remover ' + rotuloPessoa(j) + ' da mesa?')) return;
      var m = mesa();
      m.jogadores = m.jogadores.filter(function (x) { return x.id !== j.id; });
      salvar(true); desenhar();
    },
    imagem: function (el) {
      var id = el.getAttribute('data-id');
      return window.api.escolherImagem(id).then(function (r) {
        if (!r || r.cancelado) return;
        if (r.erro) return aviso(r.erro, 'erro');
        var j = jogador(id);
        if (!j) return;
        j.imagem = r.nome;
        j.foco = { x: 50, y: 50, zoom: 100 };
        salvar(true); desenhar();
      });
    },
    procurarAtualizacao: function () { return window.api.procurarAtualizacao(); },
    atualizarAgora: function (el) {
      var a = (E && E.atualizacao) || {};
      if (!confirm('Atualizar o Gravador RPG para a versão ' + (a.disponivel || 'nova') + ' agora?\n\nO app fecha, instala e abre de novo sozinho. Suas configurações não mudam.')) return;
      el.disabled = true;
      return window.api.atualizarAgora().then(function (r) {
        if (r && r.erro) { el.disabled = false; aviso(r.erro, 'erro'); return; }
        aviso((r && r.mensagem) || 'Atualizando…', 'ok');
      });
    },
    abrirExterno: function (el) { return window.api.abrirExterno(el.getAttribute('data-url')); },
    tirarImagem: function (el) {
      var j = jogador(el.getAttribute('data-id'));
      if (!j) return;
      j.imagem = '';
      salvar(true); desenhar();
    },
    novaMesa: function () {
      var nome = 'Nova mesa ' + (cfg.mesas.length + 1);
      var m = copia(mesa());
      m.id = novoId(); m.nome = nome; m.jogadores = []; m.ignorados = []; m.streamkit = { url: '', ativo: '', canais: [] }; m.musica = { canal: '' };
      cfg.mesas.push(m);
      cfg.mesaAtiva = m.id;
      salvar(true); irPara('mesa');
      aviso('Mesa criada com as mesmas opções de overlay. Dê um nome e cadastre os jogadores.', 'ok');
    },
    excluirMesa: function () {
      if (cfg.mesas.length < 2) return;
      var m = mesa();
      if (!confirm('Excluir a mesa “' + m.nome + '” e os jogadores dela? As gravações não são apagadas.')) return;
      cfg.mesas = cfg.mesas.filter(function (x) { return x.id !== m.id; });
      cfg.mesaAtiva = cfg.mesas[0].id;
      salvar(true); desenhar();
    },
    centralizarOverlay: function () {
      var o = mesa().overlay;
      o.deslocX = 0; o.deslocY = 0;
      mostrarValores(['deslocX', 'deslocY']);
      desenharCaixaOverlay();
      salvar(true);
    },
    copiarOverlay: function () {
      return window.api.copiar(E.overlayUrl).then(function () { aviso('Endereço copiado. Cole na fonte Navegador do OBS.', 'ok'); });
    },
    abrirStreamKit: function () { return window.api.abrirStreamKit(); },
    trocarCanal: function (el) { return trocarCanal(el.getAttribute('data-id')); },
    novoCanal: function () {
      var m = mesa();
      m.streamkit.canais = m.streamkit.canais || [];
      m.streamkit.canais.push({ id: novoId(), nome: 'Canal ' + (m.streamkit.canais.length + 1), url: '' });
      salvar(true); desenhar();
      var ins = $$('[data-canal-id] input[type=url]');
      if (ins.length) ins[ins.length - 1].focus();
    },
    removerCanal: function (el) {
      var m = mesa(), id = el.getAttribute('data-id');
      var c = m.streamkit.canais.filter(function (x) { return x.id === id; })[0];
      if (!c || !confirm('Tirar “' + c.nome + '” da lista?')) return;
      m.streamkit.canais = m.streamkit.canais.filter(function (x) { return x.id !== id; });
      if (m.streamkit.ativo === id) { m.streamkit.ativo = ''; m.streamkit.url = ''; }
      salvar(true); desenhar();
    },
    recarregarStreamKit: function () { return window.api.recarregarStreamKit().then(function () { aviso('Recarregando a leitura do StreamKit…'); }); },
    simularLimpeza: function () {
      return window.api.simularLimpeza().then(function (p) {
        if (!p || p.erro) return resultado(p);
        $('#resultado-simulacao').textContent = p.apagar.length ?
          'Sairiam ' + p.apagar.length + ' pedaço(s): ' + p.apagar.map(function (c) { return c.split(/[\\/]/).pop(); }).join(', ') :
          'Nada sairia agora: está dentro do limite.';
      });
    },
    limpar: function () {
      return window.api.limpar().then(function (r) {
        if (!r || r.erro) return resultado(r);
        aviso(r.feitos.length ? r.feitos.length + ' pedaço(s) removido(s).' : 'Nada para limpar.', 'ok');
        if (r.falhas.length) aviso(r.falhas.length + ' arquivo(s) não puderam sair (em uso?).', 'erro');
      });
    },
    abrirPasta: function (el) { return window.api.abrirPasta(el.getAttribute('data-qual')); },
    copiarTexto: function (el) {
      return window.api.copiar(el.getAttribute('data-texto')).then(function () { aviso('Copiado.', 'ok'); });
    },
    escolherPastaCortes: function () {
      return salvarPendente().then(function () { return window.api.escolherPastaCortes(); }).then(function (r) {
        if (r && !r.erro && !r.cancelado) { cfg = r; editando = 0; aviso('Pasta dos cortes trocada.', 'ok'); } else if (r && r.erro) aviso(r.erro, 'erro');
      });
    },
    escolherFFmpeg: function () {
      return salvarPendente().then(function () { return window.api.escolherFFmpeg(); }).then(function (r) {
        if (r && !r.erro && !r.cancelado) { cfg = r; editando = 0; desenhar(); } else if (r && r.erro) aviso(r.erro, 'erro');
      });
    },
    verificarFFmpeg: function () { return window.api.verificarFFmpeg(); },
  };

  // ================================================================ início
  function ligarEventos() {
    window.addEventListener('hashchange', function () { irPara(location.hash); });
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-acao]');
      if (!b || b.disabled) return;
      var fn = ACOES[b.getAttribute('data-acao')];
      if (!fn) return;
      ev.preventDefault();
      b.disabled = true;
      Promise.resolve(fn(b, ev)).catch(function (e) { aviso(String(e && e.message || e), 'erro'); })
        .then(function () { if (document.contains(b)) b.disabled = false; aoVivo(); });
    });
    // imagem que não carrega (arquivo sumiu): mostra as iniciais
    document.addEventListener('error', function (ev) {
      if (ev.target.tagName === 'IMG' && ev.target.closest('.avatar')) ev.target.remove();
    }, true);
    document.addEventListener('input', aoEditar);
    document.addEventListener('change', aoEditar);
    document.addEventListener('keydown', aoTeclarAtalho);
    // marcador: salva ao sair do campo ou com Enter
    document.addEventListener('focusout', function (ev) {
      var el = ev.target;
      if (el.hasAttribute && el.hasAttribute('data-marcador')) {
        window.api.nomearMarcador(el.getAttribute('data-marcador'), el.value, false);
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && ev.target.hasAttribute && ev.target.hasAttribute('data-marcador')) ev.target.blur();
    });
    document.addEventListener('change', function (ev) {
      if (ev.target.hasAttribute && ev.target.hasAttribute('data-troca-canal')) trocarCanal(ev.target.value);
    });
    $('#seletor-mesa').addEventListener('change', function (ev) {
      cfg.mesaAtiva = ev.target.value;
      salvar(true);
      desenhar();
    });
    setInterval(function () {
      var r = $('[data-relogio]');
      if (r && E && E.sessao) r.textContent = tempo(Date.now() - E.sessao.inicio);
    }, 500);
  }

  function receber(est) {
    E = est;
    if (!cfg || (!editando && JSON.stringify(cfg) !== JSON.stringify(est.config))) {
      var primeira = !cfg;
      var mudouMesa = cfg && cfg.mesaAtiva !== est.config.mesaAtiva;
      var mudouJogadores = cfg && JSON.stringify(mesa().jogadores.map(function (j) { return j.id; })) !==
        JSON.stringify((est.config.mesas.filter(function (m) { return m.id === est.config.mesaAtiva; })[0] || { jogadores: [] }).jogadores.map(function (j) { return j.id; }));
      cfg = copia(est.config);
      if (primeira || mudouMesa || mudouJogadores) { desenhar(); return; }
    }
    aoVivo();
  }

  // ================================================================ para as outras telas (cortes.js)
  window.App = {
    TELAS: TELAS, ACOES: ACOES,
    E: function () { return E; },
    cfg: function () { return cfg; },
    params: function () { return rotaParams; },
    mesa: mesa, jogador: jogador, salvar: salvar, aviso: aviso, resultado: resultado, esc: esc, $: $, $$: $$,
    tempo: tempo, horas: horas, iniciais: iniciais, urlImagem: urlImagem, nomeNoVideo: nomeNoVideo, rotuloPessoa: rotuloPessoa,
    avatarHtml: avatarHtml, select: select, marcado: marcado, desenhar: desenhar, irPara: irPara, novoId: novoId, copia: copia,
    pilulaHtml: pilula, salvarPendente: salvarPendente,
  };

  // começa só depois que todos os scripts (cortes.js, musica.js) registraram as telas deles
  function iniciar() { window.api.estado().then(comecar); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  function comecar(est) {
    var r = lerRota(location.hash);
    tela = r.tela;
    rotaParams = r.params;
    ligarEventos();
    receber(est);
    window.api.aoMudar(receber);
    window.api.aoLinkStreamKit(function (link) {
      salvarPendente().then(function () { return window.api.adicionarCanal(link); }).then(function (r) {
        if (!r || r.erro) return resultado(r);
        cfg = r.config; editando = 0;
        if (tela === 'conexoes') desenhar(); else desenharMenu();
        aviso(r.novo ? 'Canal novo salvo e em uso. Dê um nome para ele em Conexões. Já pode fechar a janela do StreamKit.' :
          'Esse canal já estava salvo: agora está em uso.', 'ok');
        if (r.novo && tela === 'conexoes') {
          var inp = $('[data-canal-id="' + r.canalId + '"] input[type=text]');
          if (inp) { inp.focus(); inp.select(); }
        }
      });
    });
  }
})();
