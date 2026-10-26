/* Tela de Música: bot do Discord, volumes, o que está tocando (camadas, seções, fila),
   YouTube e a biblioteca de faixas do PC. E o editor de seções (loop de chefe). */
(function () {
  'use strict';
  var A = window.App;
  var $ = A.$, $$ = A.$$, esc = A.esc;
  var TU = window.TrilhaUtil, AN = window.AnaliseMusica;

  var TIPOS = { musica: 'Música', ambiente: 'Ambiente', efeito: 'Efeito' };
  var ACOES_SECAO = { next: 'Segue para a próxima', loop: 'Repete (loop)', stop: 'Para no fim' };
  var MODOS = { secao: 'Repetir esta seção', seguir: 'Seguir a música', inteira: 'Repetir a música inteira' };
  var MODOS_FILA = { uma: 'Tocar uma vez e parar', fila: 'Repetir a lista', atual: 'Repetir esta faixa' };
  var PORTAL = 'https://discord.com/developers/applications';

  var faixas = null;          // biblioteca (carregada ao abrir a tela)
  var marcadas = {};          // id -> true
  var filtro = '';
  var fechados = {};          // grupos recolhidos
  var trocandoToken = false;
  var assinaturas = {};       // evita redesenhar o que não mudou
  var raf = null;

  function M() { var E = A.E(); return (E && E.musica) || null; }
  function cfgM() { return A.cfg().musica; }
  function resultado(r, ok) { return A.resultado(r, ok); }
  function comando(cmd) {
    var args = Array.prototype.slice.call(arguments, 1);
    return window.api.musicaComando(cmd, args).then(function (r) { if (r && r.erro) A.aviso(r.erro, 'erro'); return r; });
  }
  function carregarFaixas() {
    return window.api.musicaFaixas().then(function (l) {
      if (Array.isArray(l)) faixas = l;
      desenharBiblioteca();
    });
  }
  function faixa(id) { return (faixas || []).filter(function (f) { return f.id === id; })[0] || null; }

  // ================================================================ informação ao vivo de uma camada
  function info(c, duracoes) {
    var seg = c && c.seg;
    if (!seg) return null;
    var t = Date.now();
    if (c.prox && c.prox.seg && !c.pausa && t >= c.prox.em) seg = c.prox.seg;
    var item = (c.fila || []).filter(function (i) { return i.id === seg.itemId; })[0] || null;
    var dur = duracoes[seg.src] || 0;
    var pos, volta;
    if (c.pausa) { pos = c.pausa.pos; volta = 1; } else {
      var r = TU.posDoSeg(seg, (t - seg.inicio) / 1000, dur);
      pos = r.pos; volta = r.volta;
    }
    var secoes = TU.temSecoes(item) ? TU.secoesOrd(item) : [];
    var S = null;
    for (var i = 0; i < secoes.length; i++) {
      if (seg.secao ? secoes[i].id === seg.secao : (pos >= secoes[i].inicio && pos < secoes[i].termino)) { S = secoes[i]; break; }
    }
    return { item: item, dur: dur, pos: pos, volta: volta, secoes: secoes, S: S, seg: seg };
  }
  function camadas() {
    var m = M();
    var e = m && m.motor && m.motor.estado;
    if (!e || !e.camadas) return [];
    return Object.keys(e.camadas).map(function (k) { return e.camadas[k]; })
      .filter(function (c) { return c.seg || c.pausa; })
      .sort(function (a, b) { return (a.criado || 0) - (b.criado || 0); });
  }

  // ================================================================ tela principal
  A.TELAS.musica = {
    html: function () {
      return '<header class="cabecalho"><div><h1>Música</h1>' +
        '<p>Um bot seu no Discord toca as músicas do PC (com loops de chefe e camadas) e o YouTube, no canal de voz da mesa.</p></div>' +
        '<div class="linha" id="vivo-musica-pilulas"></div></header>' +
        '<div class="grade grade-musica">' +
        '<section class="painel" id="vivo-bot" aria-label="Bot do Discord"></section>' +
        '<section class="painel" aria-label="Volumes e YouTube"><div class="titulo"><h2>Volumes</h2></div>' + volumesHtml() +
        '<div class="titulo" style="margin-top:8px"><h2>Navegador (YouTube e outros sites)</h2></div><div id="vivo-youtube"></div></section>' +
        '</div>' +
        '<section class="painel" aria-label="Tocando agora"><div class="titulo"><h2>Tocando agora</h2>' +
        '<button class="pequeno perigo" data-acao="mParar" id="botao-parar-tudo">Parar tudo</button></div><div id="vivo-tocando" class="coluna"></div></section>' +
        '<section class="painel" aria-label="Biblioteca"><div class="titulo"><h2>Biblioteca</h2><div class="linha">' +
        '<button class="principal" data-acao="mAdicionarArquivos">Adicionar músicas</button>' +
        '<button data-acao="mAdicionarPasta">Adicionar pasta</button></div></div>' +
        '<div id="biblioteca" class="coluna"><div class="vazio">Carregando…</div></div></section>';
    },
    depois: function () {
      assinaturas = {};
      carregarFaixas();
      animar();
    },
    sair: function () { cancelAnimationFrame(raf); raf = null; },
    vivo: function () {
      var m = M();
      if (!m) return;
      var pil = $('#vivo-musica-pilulas');
      if (pil) pil.innerHTML = A.pilulaHtml(statusBot(m)) + (m.somSaindo ? A.pilulaHtml({ classe: 'ok', texto: 'Som saindo' }) : '');
      redesenhar('bot', JSON.stringify([m.bot, m.temToken, m.alvo, trocandoToken, A.mesa().musica, A.mesa().streamkit.ativo, cfgM().entrarAoConectar]), '#vivo-bot', botHtml);
      redesenhar('yt', JSON.stringify([cfgM().abasNovas, (m.abas || []).map(function (a) { return [a.id, a.titulo, a.tocando, a.mudo, a.ouvir, a.volume]; })]), '#vivo-youtube', youtubeHtml);
      var e = m.motor || {};
      redesenhar('tocando', JSON.stringify([e.pronto, e.estado && e.estado.rev, Object.keys(e.duracoes || {}).length, e.estado && e.estado.camadas && Object.keys(e.estado.camadas)]), '#vivo-tocando', tocandoHtml);
    },
  };

  /** Só troca o HTML de um painel quando o conteúdo mudou e ninguém está mexendo nele. */
  function redesenhar(chave, assinatura, seletor, fn) {
    var el = $(seletor);
    if (!el) return;
    if (assinaturas[chave] === assinatura) return;
    if (el.contains(document.activeElement) && document.activeElement.matches('input[type=text], input[type=password], input[type=range]')) return;
    assinaturas[chave] = assinatura;
    el.innerHTML = fn();
  }

  function statusBot(m) {
    var b = m.bot;
    if (b.etapa === 'online' && b.voz === 'no-canal') return { classe: 'ok', texto: 'Bot no canal' + (b.canal ? ': ' + b.canal.nome : '') };
    if (b.etapa === 'online' && (b.voz === 'entrando' || b.voz === 'reconectando')) return { classe: 'alerta', texto: 'Bot entrando no canal…' };
    if (b.etapa === 'online') return { classe: 'alerta', texto: 'Bot ligado, fora do canal' };
    if (b.etapa === 'conectando') return { classe: 'alerta', texto: 'Ligando o bot…' };
    if (b.etapa === 'erro') return { classe: 'erro', texto: 'Bot com problema' };
    return { classe: '', texto: 'Bot desligado' };
  }

  // ---------------------------------------------------------------- bot
  function botHtml() {
    var m = M(), b = m.bot, mesa = A.mesa();
    var html = '<div class="titulo"><h2>Bot do Discord</h2>' + A.pilulaHtml(statusBot(m)) + '</div>';
    if (!m.temToken || trocandoToken) {
      return html + '<p class="ajuda">O bot é seu: você cria uma vez no site do Discord (grátis) e ele entra no canal para tocar. Leva uns 3 minutos.</p>' +
        '<ol class="passos-bot">' +
        '<li>Abra o <button class="link" data-acao="mPortal">Discord Developer Portal</button> e clique em <strong>New Application</strong>. Dê um nome (ex.: “Bardo”).</li>' +
        '<li>No menu da esquerda, abra <strong>Bot</strong>, clique em <strong>Reset Token</strong> e depois em <strong>Copy</strong>.</li>' +
        '<li>Cole o token aqui e salve. Ele fica guardado só neste PC, protegido pelo Windows.</li></ol>' +
        '<div class="linha"><input type="password" id="campo-token" placeholder="Cole o token do bot" autocomplete="off" style="flex:1;min-width:220px">' +
        '<button class="principal" data-acao="mSalvarToken">Salvar token</button>' +
        (m.temToken ? '<button data-acao="mCancelarToken">Cancelar</button>' : '') + '</div>' +
        '<p class="ajuda">Nunca mande esse token para ninguém: com ele, qualquer um controla o seu bot.</p>';
    }
    var ligado = b.etapa === 'online';
    html += '<div class="linha">' +
      (ligado ? '<button data-acao="mDesligarBot">Desligar o bot</button>' :
        '<button class="principal" data-acao="mLigarBot"' + (b.etapa === 'conectando' ? ' disabled' : '') + '>Ligar o bot</button>') +
      '<button data-acao="mConvidar" title="Abre o Discord para escolher o servidor da mesa">Convidar para o servidor</button>' +
      '<button class="link" data-acao="mTrocarToken">Trocar token</button></div>';
    if (b.erro) html += '<p class="erro-campo">' + esc(b.erro) + '</p>';
    if (b.etapa === 'erro' && /INSTALAR|bibliotec/i.test(b.erro)) html += '<button class="pequeno" data-acao="mDiagnostico">Ver detalhes técnicos</button><pre id="diag-bot" class="diag" hidden></pre>';
    if (b.usuario) html += '<p class="ajuda">Ligado como <strong>' + esc(b.usuario.nome) + '</strong>. Ele fica ignorado nos retratos e na linha do tempo automaticamente.</p>';

    // canal de voz
    var cAtivo = (mesa.streamkit.canais || []).filter(function (c) { return c.id === mesa.streamkit.ativo; })[0];
    var opcoes = '<option value="">Mesmo canal do StreamKit' + (cAtivo ? ' (' + esc(cAtivo.nome) + ')' : ' (nenhum configurado)') + '</option>';
    (b.servidores || []).forEach(function (s) {
      opcoes += '<optgroup label="' + esc(s.nome) + '">' + s.canais.map(function (c) {
        var v = s.id + '/' + c.id;
        return '<option value="' + esc(v) + '"' + (mesa.musica.canal === v ? ' selected' : '') + '>' + esc(c.nome) + '</option>';
      }).join('') + '</optgroup>';
    });
    if (mesa.musica.canal && !(b.servidores || []).some(function (s) { return s.canais.some(function (c) { return s.id + '/' + c.id === mesa.musica.canal; }); })) {
      opcoes += '<option value="' + esc(mesa.musica.canal) + '" selected>Canal escolhido antes (ligue o bot para ver o nome)</option>';
    }
    html += '<label class="campo"><span class="rotulo">Canal de voz do bot (nesta mesa)</span><select data-campo="m.musica.canal">' + opcoes + '</select></label>';
    if (ligado && !(b.servidores || []).length) html += '<p class="erro-campo">O bot ainda não está em nenhum servidor. Clique em <strong>Convidar para o servidor</strong>.</p>';
    html += '<div class="linha">' +
      (b.voz === 'fora' ? '<button class="principal" data-acao="mEntrar"' + (ligado ? '' : ' disabled') + '>Entrar no canal</button>' :
        '<button data-acao="mSair">Sair do canal</button>') +
      '<label class="opcao"><input type="checkbox" data-campo="c.musica.entrarAoConectar"' + A.marcado(cfgM().entrarAoConectar) + '>Entrar sozinho ao ligar</label></div>' +
      '<p class="ajuda">Quando você troca o canal da mesa (em Conexões ou no menu), o bot vai junto.</p>';
    return html;
  }

  // ---------------------------------------------------------------- volumes e YouTube
  function volumesHtml() {
    var c = cfgM();
    function faixaVol(campo, rotulo, v, ajuda) {
      return '<label class="campo"><span class="rotulo">' + rotulo + ' <span data-eco="' + campo + '">' + v + '</span>%</span>' +
        '<input type="range" min="0" max="100" step="1" data-campo="c.musica.' + campo + '" data-num data-eco-alvo="' + campo + '" value="' + v + '">' +
        (ajuda ? '<small class="ajuda">' + ajuda + '</small>' : '') + '</label>';
    }
    return '<div class="coluna">' +
      faixaVol('volume', 'Volume do bot', c.volume, 'Tudo o que o bot toca no Discord') +
      faixaVol('volumeFaixas', 'Músicas do PC', c.volumeFaixas) +
      faixaVol('volumeYoutube', 'Navegador (todas as abas)', c.volumeYoutube) +
      '<label class="opcao"><input type="checkbox" data-campo="c.musica.ouvirNoPC"' + A.marcado(c.ouvirNoPC) + '><span>Ouvir aqui no PC também<small>Deixe desligado se você está no canal de voz (senão ouve duas vezes)</small></span></label></div>';
  }

  function youtubeHtml() {
    var abas = M().abas || [];
    var html = '<p class="ajuda">YouTube e outros sites tocam em abas aqui dentro do app, várias ao mesmo tempo. O som vai para o bot e continua quando você troca de tela.</p>';
    if (abas.length) {
      html += '<div class="coluna abas-som">' + abas.map(function (a) {
        return '<div class="linha-aba' + (a.tocando ? ' tocando' : '') + '">' +
          '<span class="nota" aria-hidden="true">' + (a.tocando ? (a.mudo ? '🔇' : '♪') : '·') + '</span>' +
          '<button class="link" data-acao="mIrAba" data-id="' + esc(a.id) + '" title="Ir para a aba">' + esc(a.titulo || a.url) + '</button>' +
          '<button class="chave-nav' + (a.ouvir ? ' on' : '') + '" data-acao="navOuvir" data-id="' + esc(a.id) + '" aria-pressed="' + !!a.ouvir + '" title="Tocar também aqui no PC">🎧</button>' +
          '<button class="chave-nav' + (a.mudo ? ' mudo' : ' on') + '" data-acao="navMudo" data-id="' + esc(a.id) + '" aria-pressed="' + !a.mudo + '">' + (a.mudo ? '🔇 Fora do Discord' : '📢 No Discord') + '</button>' +
          '<input type="range" min="0" max="1" step="0.01" value="' + a.volume + '" data-nav-volume="' + esc(a.id) + '" aria-label="Volume de ' + esc(a.titulo) + ' no Discord"' + (a.mudo ? ' disabled' : '') + '></div>';
      }).join('') + '</div>';
    }
    return html + '<div class="linha"><button data-acao="mYoutube">' + (abas.length ? 'Ir para o navegador' : 'Abrir o navegador') + '</button>' +
      '<label class="campo" style="flex:1;min-width:210px"><span class="rotulo">Abas novas começam</span>' +
      A.select('c.musica.abasNovas', { discord: 'No Discord (todo mundo ouve)', previa: 'Só aqui no PC (prévia)' }, cfgM().abasNovas) + '</label></div>';
  }

  // ---------------------------------------------------------------- tocando agora
  function tocandoHtml() {
    var m = M(), e = m.motor || {};
    var cs = camadas();
    var b = $('#botao-parar-tudo');
    if (b) b.hidden = !cs.length;
    if (!cs.length) return '<div class="vazio">Nada tocando. Clique em ▶ numa faixa da biblioteca.' + (e.aviso ? '<br><span class="erro-campo">' + esc(e.aviso) + '</span>' : '') + '</div>';
    return cs.map(function (c) { return camadaHtml(c, e.duracoes || {}); }).join('');
  }

  function camadaHtml(c, duracoes) {
    var inf = info(c, duracoes) || { item: null, secoes: [], dur: 0 };
    var item = inf.item || (c.fila && c.fila[0]) || {};
    var pedido = c.prox && c.prox.quando !== 'auto' ? c.prox : null;
    var naFila = pedido && pedido.seg ? pedido.seg.secao : null;
    var modoAtual = inf.seg && inf.seg.secao ? inf.seg.modo : 'inteira';
    var fila = c.fila || [];
    var id = esc(c.id);
    var html = '<div class="camada" data-camada="' + id + '">' +
      '<div class="linha camada-topo"><span class="etiqueta-tipo t-' + esc(c.tipo) + '">' + esc(TIPOS[c.tipo] || c.tipo) + '</span>' +
      '<strong class="camada-nome">' + esc(item.nome || 'Faixa') + '</strong>' +
      '<span class="ajuda" data-status="' + id + '"></span><span style="flex:1"></span>' +
      (fila.length > 1 ? '<button class="pequeno" data-acao="mPular" data-camada="' + id + '" data-dir="-1">Anterior</button>' : '') +
      '<button class="pequeno" data-acao="' + (c.pausa ? 'mRetomar' : 'mPausar') + '" data-camada="' + id + '">' + (c.pausa ? 'Continuar' : 'Pausar') + '</button>' +
      (fila.length > 1 ? '<button class="pequeno" data-acao="mPular" data-camada="' + id + '" data-dir="1">Próxima</button>' : '') +
      '<button class="pequeno perigo" data-acao="mPararCamada" data-camada="' + id + '">Parar</button></div>';

    // blocos das seções (ou a música inteira) com a agulha
    html += '<div class="blocos" data-blocos="' + id + '">';
    if (inf.secoes.length) {
      html += inf.secoes.map(function (s) {
        var atual = inf.S && s.id === inf.S.id;
        var loopOn = atual && modoAtual === 'secao' && !c.pausa;
        var loopFila = naFila === s.id && pedido.seg.modo === 'secao';
        return '<div class="bloco' + (atual ? ' atual' : '') + (s.id === naFila ? ' fila' : '') + '" data-acao="mBuscar" data-camada="' + id + '" data-ini="' + s.inicio + '" data-fim="' + s.termino + '" data-bloco="' + esc(s.id) + '" style="flex-grow:' + Math.max(0.5, s.termino - s.inicio).toFixed(2) + ';--cor:' + esc(s.cor) + '" title="Clique para tocar a partir daqui">' +
          (atual ? '<div class="bloco-prog" data-prog="' + id + '"></div>' : '') +
          '<span class="bloco-nome">' + esc(s.nome) + '</span><span class="bloco-info">' + TU.fmtTempo(s.inicio) + '–' + TU.fmtTempo(s.termino) + (s.acao === 'loop' ? ' · loop' : '') + '</span>' +
          '<button class="bloco-loop' + (loopOn ? ' on' : '') + (loopFila ? ' na-fila' : '') + '" data-acao="mRepetir" data-camada="' + id + '" data-secao="' + esc(s.id) + '" title="' + (loopOn ? 'Parar de repetir (segue a música)' : loopFila ? 'Desistir' : atual ? 'Repetir esta seção' : 'Repetir esta seção (entra no fim da volta)') + '" aria-label="Repetir ' + esc(s.nome) + '">⟳</button></div>';
      }).join('');
    } else {
      html += '<div class="bloco atual" data-acao="mBuscar" data-camada="' + id + '" data-ini="0" data-fim="' + inf.dur + '" data-bloco="inteira" style="flex-grow:1;--cor:#d9b44a" title="Clique para tocar a partir daqui">' +
        '<div class="bloco-prog" data-prog="' + id + '"></div><span class="bloco-nome">Música inteira</span><span class="bloco-info">' + TU.fmtTempo(inf.dur) + '</span></div>';
    }
    html += '</div><div class="linha camada-sub"><span class="ajuda" data-tempo="' + id + '"></span><span style="flex:1"></span>' +
      (c.prox ? '<span class="' + (pedido ? 'pilula-fila' : 'ajuda') + '" data-prox="' + id + '"></span>' : '') +
      (pedido ? '<button class="link" data-acao="mCancelarPedido" data-camada="' + id + '">cancelar</button>' : '') + '</div>';

    // seções: trocar no fim da volta ou agora
    if (inf.secoes.length) {
      html += '<div class="secoes-troca">' + inf.secoes.filter(function (s) { return !inf.S || s.id !== inf.S.id; }).map(function (s) {
        return '<div class="sec-cartao' + (s.id === naFila ? ' fila' : '') + '"><span class="quadrado" style="background:' + esc(s.cor) + '"></span><strong>' + esc(s.nome) + '</strong>' +
          '<div class="linha"><button class="pequeno principal" data-acao="mSecao" data-quando="volta" data-camada="' + id + '" data-secao="' + esc(s.id) + '">No fim da volta</button>' +
          '<button class="pequeno" data-acao="mSecao" data-quando="agora" data-camada="' + id + '" data-secao="' + esc(s.id) + '">Agora</button></div></div>';
      }).join('') + '</div>' +
        '<div class="linha"><label class="campo"><span class="rotulo">Ao chegar no fim da seção</span>' +
        '<select data-m-modo="' + id + '">' + Object.keys(MODOS).map(function (k) { return '<option value="' + k + '"' + (modoAtual === k ? ' selected' : '') + '>' + MODOS[k] + '</option>'; }).join('') + '</select></label>' +
        '<label class="opcao"><input type="checkbox" data-m-direto="' + id + '"' + A.marcado(c.livre) + '>Tocar direto (ignorar loops salvos)</label></div>';
    }
    // volume, crossfade, fila
    html += '<div class="linha camada-controles">' +
      '<label class="campo" style="min-width:160px;flex:1"><span class="rotulo">Volume</span><input type="range" min="0" max="1" step="0.01" value="' + (c.volume != null ? c.volume : 0.7) + '" data-m-volume="' + id + '"></label>' +
      '<label class="campo"><span class="rotulo">Crossfade</span><select data-m-crossfade="' + id + '">' + [0, 0.5, 1, 1.5, 2, 3, 5].map(function (v) {
        return '<option value="' + v + '"' + (Number(c.crossfade) === v ? ' selected' : '') + '>' + String(v).replace('.', ',') + ' s</option>';
      }).join('') + '</select></label>' +
      '<label class="campo"><span class="rotulo">No fim da faixa</span><select data-m-modofila="' + id + '">' + Object.keys(MODOS_FILA).map(function (k) {
        return '<option value="' + k + '"' + ((c.modoFila || 'uma') === k ? ' selected' : '') + '>' + MODOS_FILA[k] + '</option>';
      }).join('') + '</select></label>' +
      (fila.length > 1 ? '<label class="opcao"><input type="checkbox" data-m-aleatorio="' + id + '"' + A.marcado(c.aleatorio) + '>Aleatório</label>' : '') +
      '</div>';
    if (fila.length > 1) {
      var ordem = (c.ordem && c.ordem.length ? c.ordem : fila.map(function (i) { return i.id; }));
      html += '<details class="fila-camada"><summary>Fila (' + fila.length + ' faixas)</summary><ol>' + ordem.map(function (iid) {
        var it = fila.filter(function (x) { return x.id === iid; })[0];
        if (!it) return '';
        var atual = inf.item && it.id === inf.item.id;
        return '<li class="' + (atual ? 'atual' : '') + '"><button class="link" data-acao="mTocarItem" data-camada="' + id + '" data-item="' + esc(it.id) + '">' + esc(it.nome) + '</button>' +
          (atual ? ' <span class="ajuda">tocando</span>' : '<button class="link perigo" data-acao="mTirarItem" data-camada="' + id + '" data-item="' + esc(it.id) + '" aria-label="Tirar da fila">✕</button>') + '</li>';
      }).join('') + '</ol></details>';
    }
    return html + '</div>';
  }

  function textoStatus(c, inf) {
    var S = inf.S;
    if (c.pausa) return 'Pausada' + (S ? ' em ' + S.nome : '');
    if (inf.seg && inf.seg.secao && S) {
      if (inf.seg.modo === 'secao') return S.nome + ' em loop · ' + inf.volta + 'ª volta';
      if (inf.seg.modo === 'inteira') return S.nome + ' · depois a música inteira';
      return S.nome + ' · tocando';
    }
    if (inf.seg && inf.seg.modo === 'inteira') return 'Música inteira em loop · ' + inf.volta + 'ª volta';
    return S ? S.nome + ' · tocando' : 'Tocando';
  }
  function textoProx(c, inf) {
    var p = c.prox;
    if (!p) return '';
    var falta = TU.fmtTempo(Math.max(0, (p.em - Date.now()) / 1000));
    var nome = null;
    if (p.seg && p.seg.secao && inf.item) {
      var s = TU.secoesOrd(inf.item).filter(function (x) { return x.id === p.seg.secao; })[0];
      nome = s ? s.nome : null;
    }
    var loop = p.seg && p.seg.modo === 'secao' ? ' e repete' : '';
    if (p.alvo && p.alvo.tipo === 'ir') return 'Pulando…';
    if (p.quando === 'volta') return 'Na fila: ' + (nome || '—') + loop + ' · entra no fim desta volta (em ' + falta + ')';
    if (p.quando === 'agora') return 'Entrando agora: ' + (nome || 'próxima');
    if (!p.seg) return 'Depois: fim (em ' + falta + ')';
    if (p.alvo && p.alvo.tipo === 'continuar') return 'Depois: música inteira (em ' + falta + ')';
    if (nome && inf.item && p.seg.itemId === inf.item.id) return 'Depois: ' + nome + ' (em ' + falta + ')';
    var prox = (c.fila || []).filter(function (i) { return i.id === p.seg.itemId; })[0];
    return 'Depois: ' + (prox ? prox.nome : 'próxima faixa') + ' (em ' + falta + ')';
  }

  /** Barra de progresso, agulha e textos andando sozinhos (sem redesenhar a tela). */
  function animar() {
    cancelAnimationFrame(raf);
    var ultimo = 0;
    (function passo(t) {
      raf = requestAnimationFrame(passo);
      if (t - ultimo < 100) return;
      ultimo = t;
      var m = M();
      if (!m || !m.motor) return;
      var dur = m.motor.duracoes || {};
      var mudouSecao = false;
      camadas().forEach(function (c) {
        var inf = info(c, dur);
        if (!inf) return;
        var bloco = $('[data-blocos="' + c.id + '"] .bloco.atual');
        var idBloco = inf.S ? inf.S.id : 'inteira';
        if (bloco && bloco.getAttribute('data-bloco') !== idBloco && inf.secoes.length) mudouSecao = true;
        var ini = inf.S ? inf.S.inicio : 0, fim = inf.S ? inf.S.termino : inf.dur;
        var frac = Math.max(0, Math.min(1, (inf.pos - ini) / Math.max(0.01, fim - ini)));
        var prog = $('[data-prog="' + c.id + '"]');
        if (prog) prog.style.width = (frac * 100) + '%';
        var st = $('[data-status="' + c.id + '"]');
        if (st) st.textContent = textoStatus(c, inf);
        var tp = $('[data-tempo="' + c.id + '"]');
        if (tp) tp.textContent = inf.S ? TU.fmtTempo(inf.pos - inf.S.inicio) + ' de ' + TU.fmtTempo(inf.S.termino - inf.S.inicio) + ' nesta volta' : TU.fmtTempo(inf.pos) + ' de ' + TU.fmtTempo(inf.dur);
        var px = $('[data-prox="' + c.id + '"]');
        if (px) px.textContent = textoProx(c, inf);
      });
      // a música passou para outra seção: redesenha para mudar o bloco destacado
      if (mudouSecao) { assinaturas.tocando = null; A.TELAS.musica.vivo(); }
    })(0);
  }

  // ---------------------------------------------------------------- biblioteca
  function desenharBiblioteca() {
    var el = $('#biblioteca');
    if (!el || !faixas) return;
    if (!faixas.length) {
      el.innerHTML = '<div class="vazio">Nenhuma música ainda. Clique em <strong>Adicionar pasta</strong> e escolha a pasta das suas trilhas: cada subpasta vira um grupo (Chefes, Taverna, Exploração…).</div>';
      return;
    }
    var f = filtro.trim().toLowerCase();
    var visiveis = faixas.filter(function (x) { return !f || (x.nome + ' ' + x.grupo).toLowerCase().indexOf(f) >= 0; });
    var nMarc = Object.keys(marcadas).filter(function (k) { return marcadas[k] && faixa(k); }).length;
    var grupos = {}, ordemGrupos = [];
    visiveis.forEach(function (x) {
      var g = x.grupo || 'Sem grupo';
      if (!grupos[g]) { grupos[g] = []; ordemGrupos.push(g); }
      grupos[g].push(x);
    });
    ordemGrupos.sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
    var cs = camadas();
    var tocandoIds = {};
    cs.forEach(function (c) { (c.fila || []).forEach(function (i) { if (c.seg && i.id === c.seg.itemId) tocandoIds[i.uuid] = c.id; }); });
    var musicaFila = cs.filter(function (c) { return (c.fila || []).length > 0; }).slice(-1)[0];
    el.innerHTML = '<div class="linha biblioteca-barra">' +
      '<input type="search" id="filtro-musica" placeholder="Procurar faixa ou grupo…" value="' + esc(filtro) + '" style="flex:1;min-width:200px">' +
      '<button data-acao="mTocarMarcadas"' + (nMarc ? '' : ' disabled') + '>Tocar marcadas como fila' + (nMarc ? ' (' + nMarc + ')' : '') + '</button>' +
      '<label class="opcao"><input type="checkbox" id="fila-aleatoria">Aleatório</label>' +
      (musicaFila && nMarc ? '<button data-acao="mAdicionarFila" data-camada="' + esc(musicaFila.id) + '">Pôr na fila atual</button>' : '') +
      (nMarc ? '<button class="perigo" data-acao="mRemoverMarcadas">Tirar da biblioteca</button>' : '') + '</div>' +
      (!visiveis.length ? '<div class="vazio">Nada com “' + esc(filtro) + '”.</div>' : '') +
      ordemGrupos.map(function (g) {
        var lista = grupos[g];
        var aberto = f || !fechados[g];
        return '<details class="grupo-musica"' + (aberto ? ' open' : '') + ' data-grupo="' + esc(g) + '"><summary><strong>' + esc(g) + '</strong> <span class="ajuda">' + lista.length + '</span>' +
          '<button class="link" data-acao="mMarcarGrupo" data-grupo="' + esc(g) + '">marcar todas</button></summary>' +
          lista.map(function (x) { return faixaHtml(x, tocandoIds[x.id]); }).join('') + '</details>';
      }).join('');
  }

  function faixaHtml(x, camadaTocando) {
    var nSec = (x.secoes || []).length;
    return '<div class="faixa-musica' + (camadaTocando ? ' tocando' : '') + (x.existe === false ? ' sumiu' : '') + '" data-faixa="' + esc(x.id) + '">' +
      '<input type="checkbox" aria-label="Marcar ' + esc(x.nome) + '" data-m-marcar="' + esc(x.id) + '"' + A.marcado(marcadas[x.id]) + '>' +
      '<button class="pequeno icone' + (camadaTocando ? ' perigo' : ' principal') + '" data-acao="mTocar" data-id="' + esc(x.id) + '" aria-label="' + (camadaTocando ? 'Parar ' : 'Tocar ') + esc(x.nome) + '">' + (camadaTocando ? '■' : '▶') + '</button>' +
      '<div class="faixa-nome"><input type="text" value="' + esc(x.nome) + '" data-m-nome="' + esc(x.id) + '" aria-label="Nome da faixa">' +
      (x.existe === false ? '<small class="erro-campo">Arquivo não encontrado (foi movido ou apagado?)</small>' : '') + '</div>' +
      '<select data-m-tipo="' + esc(x.id) + '" aria-label="Tipo">' + Object.keys(TIPOS).map(function (k) { return '<option value="' + k + '"' + (x.tipo === k ? ' selected' : '') + '>' + TIPOS[k] + '</option>'; }).join('') + '</select>' +
      '<label class="opcao" title="Quando acabar, começa de novo"><input type="checkbox" data-m-repetir="' + esc(x.id) + '"' + A.marcado(x.repetir) + '>Repetir</label>' +
      '<a class="botao pequeno" href="#secoes/' + encodeURIComponent(x.id) + '">' + (nSec > 1 ? nSec + ' seções' : 'Seções') + '</a></div>';
  }

  // ================================================================ ações
  function camadaDe(el) { return el.getAttribute('data-camada'); }
  var ACOES = {
    mPortal: function () { return window.api.abrirExterno(PORTAL); },
    mSalvarToken: function () {
      var v = ($('#campo-token') || {}).value || '';
      return window.api.botToken(v).then(function (r) {
        if (r && r.erro) return A.aviso(r.erro, 'erro');
        trocandoToken = false; assinaturas.bot = null;
        A.aviso(v.trim() ? 'Token salvo. Agora convide o bot para o servidor e ligue.' : 'Token apagado.', 'ok');
        A.TELAS.musica.vivo();
      });
    },
    mTrocarToken: function () { trocandoToken = true; assinaturas.bot = null; A.TELAS.musica.vivo(); },
    mCancelarToken: function () { trocandoToken = false; assinaturas.bot = null; A.TELAS.musica.vivo(); },
    mLigarBot: function () { return window.api.botLigar().then(function (r) { resultado(r, r && !r.erro ? 'Bot ligado.' : null); }); },
    mDesligarBot: function () { return window.api.botDesligar().then(function (r) { resultado(r); }); },
    mConvidar: function () {
      var m = M();
      if (!m.convite) return A.aviso('Salve o token primeiro.', 'erro');
      return window.api.abrirExterno(m.convite).then(function () { A.aviso('No Discord, escolha o servidor da mesa e autorize. Depois volte aqui.', 'ok'); });
    },
    mDiagnostico: function () {
      return window.api.botDiagnostico().then(function (r) {
        var el = $('#diag-bot');
        if (el) { el.hidden = false; el.textContent = (r.erro || 'Bibliotecas carregadas.') + (r.relatorio ? '\n\n' + r.relatorio : ''); }
      });
    },
    mEntrar: function () { return A.salvarPendente().then(function () { return window.api.botEntrar(); }).then(function (r) { resultado(r); }); },
    mSair: function () { return window.api.botSair().then(function (r) { resultado(r); }); },
    mYoutube: function () { location.hash = '#navegador'; },
    mIrAba: function (el) {
      return window.api.navAtivar(el.getAttribute('data-id')).then(function () { location.hash = '#navegador'; });
    },
    mParar: function () { return comando('pararTudo'); },
    mPararCamada: function (el) { return comando('pararCamada', camadaDe(el), 1.2); },
    mPausar: function (el) { return comando('pausar', camadaDe(el)); },
    mRetomar: function (el) { return comando('retomar', camadaDe(el)); },
    mPular: function (el) { return comando('pular', camadaDe(el), Number(el.getAttribute('data-dir'))); },
    mRepetir: function (el) { return comando('repetirSecao', camadaDe(el), el.getAttribute('data-secao')); },
    mSecao: function (el) { return comando('irParaSecao', camadaDe(el), el.getAttribute('data-secao'), el.getAttribute('data-quando')); },
    mCancelarPedido: function (el) { return comando('cancelarPendente', camadaDe(el)); },
    mTocarItem: function (el) { return comando('tocarItem', camadaDe(el), el.getAttribute('data-item')); },
    mTirarItem: function (el) { return comando('removerItem', camadaDe(el), el.getAttribute('data-item')); },
    mTocar: function (el) {
      return window.api.musicaTocar(el.getAttribute('data-id')).then(function (r) { if (r && r.erro) A.aviso(r.erro, 'erro'); });
    },
    mTocarMarcadas: function () {
      var ids = (faixas || []).filter(function (x) { return marcadas[x.id]; }).map(function (x) { return x.id; });
      var al = $('#fila-aleatoria');
      return window.api.musicaTocarFila(ids, !!(al && al.checked)).then(function (r) {
        if (r && r.erro) return A.aviso(r.erro, 'erro');
        marcadas = {}; desenharBiblioteca();
      });
    },
    mAdicionarFila: function (el) {
      var ids = (faixas || []).filter(function (x) { return marcadas[x.id]; }).map(function (x) { return x.id; });
      return window.api.musicaAdicionarNaFila(camadaDe(el), ids).then(function (r) {
        if (r && r.erro) return A.aviso(r.erro, 'erro');
        marcadas = {}; desenharBiblioteca(); A.aviso('Na fila.', 'ok');
      });
    },
    mMarcarGrupo: function (el) {
      var g = el.getAttribute('data-grupo');
      var lista = (faixas || []).filter(function (x) { return (x.grupo || 'Sem grupo') === g; });
      var todas = lista.every(function (x) { return marcadas[x.id]; });
      lista.forEach(function (x) { marcadas[x.id] = !todas; });
      desenharBiblioteca();
    },
    mRemoverMarcadas: function () {
      var ids = Object.keys(marcadas).filter(function (k) { return marcadas[k]; });
      if (!ids.length || !confirm('Tirar ' + ids.length + ' faixa(s) da biblioteca? Os arquivos não são apagados.')) return;
      return window.api.musicaRemoverFaixas(ids).then(function (l) { if (Array.isArray(l)) faixas = l; marcadas = {}; desenharBiblioteca(); });
    },
    mAdicionarArquivos: function () {
      return window.api.musicaAdicionarArquivos().then(function (r) {
        if (!r || r.cancelado) return;
        if (r.erro) return A.aviso(r.erro, 'erro');
        faixas = r.faixas; desenharBiblioteca();
        A.aviso(r.novos ? r.novos + ' faixa(s) adicionada(s).' : 'Essas faixas já estavam na biblioteca.', 'ok');
      });
    },
    mAdicionarPasta: function () {
      return window.api.musicaAdicionarPasta().then(function (r) {
        if (!r || r.cancelado) return;
        if (r.erro) return A.aviso(r.erro, 'erro');
        faixas = r.faixas; desenharBiblioteca();
        A.aviso(r.novos ? r.novos + ' faixa(s) adicionada(s).' : 'Nenhuma música nova nessa pasta.', 'ok');
      });
    },
    mBuscar: function (el, ev) {
      if (ev && ev.target.closest('.bloco-loop')) return;
      var r = el.getBoundingClientRect();
      var ini = Number(el.getAttribute('data-ini')), fim = Number(el.getAttribute('data-fim'));
      var frac = Math.max(0, Math.min(1, ((ev ? ev.clientX : r.left) - r.left) / r.width));
      return comando('irPara', camadaDe(el), ini + frac * (fim - ini));
    },
  };
  Object.keys(ACOES).forEach(function (k) { A.ACOES[k] = ACOES[k]; });

  // campos ao vivo das camadas e da biblioteca (não passam pela config)
  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (!el.getAttribute) return;
    var v;
    if ((v = el.getAttribute('data-m-volume'))) comando('volume', v, Number(el.value));
    else if ((v = el.getAttribute('data-m-crossfade'))) comando('definirCrossfade', v, Number(el.value));
    else if ((v = el.getAttribute('data-m-modofila'))) comando('modoFila', v, el.value);
    else if ((v = el.getAttribute('data-m-aleatorio'))) comando('aleatorio', v, el.checked);
    else if ((v = el.getAttribute('data-m-modo'))) comando('mudarModo', v, el.value);
    else if ((v = el.getAttribute('data-m-direto'))) comando('tocarDireto', v, el.checked);
    else if ((v = el.getAttribute('data-m-marcar'))) { marcadas[v] = el.checked; desenharBiblioteca(); }
    else if ((v = el.getAttribute('data-m-tipo'))) atualizarFaixa(v, { tipo: el.value });
    else if ((v = el.getAttribute('data-m-repetir'))) atualizarFaixa(v, { repetir: el.checked });
    else if ((v = el.getAttribute('data-m-nome'))) atualizarFaixa(v, { nome: el.value });
    else if (el.matches('[data-campo="m.musica.canal"]')) {
      // salvar já é feito pelo app.js (data-campo); o bot acompanha sozinho se estiver no canal
      assinaturas.bot = null;
    }
  });
  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'filtro-musica') {
      filtro = ev.target.value;
      var pos = ev.target.selectionStart;
      desenharBiblioteca();
      var f = $('#filtro-musica');
      if (f) { f.focus(); f.setSelectionRange(pos, pos); }
    }
  });
  document.addEventListener('toggle', function (ev) {
    var d = ev.target;
    if (d.classList && d.classList.contains('grupo-musica') && !filtro) fechados[d.getAttribute('data-grupo')] = !d.open;
  }, true);
  function atualizarFaixa(id, campos) {
    return window.api.musicaAtualizarFaixa(id, campos).then(function (r) {
      if (r && r.erro) return A.aviso(r.erro, 'erro');
      for (var i = 0; i < (faixas || []).length; i++) if (faixas[i].id === id) faixas[i] = Object.assign({}, faixas[i], r);
    });
  }

  // ================================================================ editor de seções
  var ed = null;   // { id, faixa, dur, cortes[], props[], an, buf, audio, loop }

  A.TELAS.secoes = {
    menu: 'musica',
    html: function () {
      return '<header class="cabecalho"><div><a href="#musica" class="voltar">← Música</a><h1 id="titulo-secoes">Seções</h1>' +
        '<p>Divida a música em partes. As partes em <strong>loop</strong> ficam repetindo até você mandar trocar (efeito de luta de chefe).</p></div>' +
        '<div class="linha"><button class="principal" data-acao="edSalvar" disabled id="botao-salvar-secoes">Salvar seções</button></div></header>' +
        '<section class="painel" id="editor-secoes"><div class="vazio">Carregando a música…</div></section>';
    },
    depois: function () { abrirEditor(A.params()[0]); },
    sair: function () {
      if (ed && ed.audio) { ed.audio.pause(); ed.audio.removeAttribute('src'); try { ed.audio.load(); } catch (e) { /* */ } }
      if (ed && ed.raf) cancelAnimationFrame(ed.raf);
      if (ed && ed.ctx) ed.ctx.close().catch(function () {});
      ed = null;
    },
  };

  function abrirEditor(id) {
    var caixa = $('#editor-secoes');
    var cont = function (msg) { if (caixa) caixa.innerHTML = '<div class="vazio">' + msg + '</div>'; };
    var p = faixas ? Promise.resolve() : window.api.musicaFaixas().then(function (l) { faixas = Array.isArray(l) ? l : []; });
    p.then(function () {
      var f = faixa(id);
      if (!f) return cont('Faixa não encontrada. <a href="#musica">Voltar</a>');
      $('#titulo-secoes').textContent = f.nome;
      return window.api.musicaUrl(id).then(function (url) {
        if (!url || url.erro) return cont(esc((url && url.erro) || 'Não consegui abrir a faixa.'));
        var audio = new Audio();
        audio.preload = 'auto';
        audio.src = url;
        ed = { id: id, faixa: f, url: url, audio: audio, dur: 0, cortes: [], props: [], an: null, buf: null, loop: -1, grudar: true, mudou: false };
        audio.addEventListener('loadedmetadata', function () {
          if (!ed || ed.audio !== audio) return;
          ed.dur = audio.duration;
          if (ed.dur > TU.LIMITE_BUFFER) {
            return cont('Esta faixa tem mais de 10 minutos: ela toca inteira, sem seções (arquivos longos tocam em streaming).');
          }
          deSecoes(f.secoes || []);
          desenharEditor();
          analisarFaixa();
        }, { once: true });
        audio.addEventListener('error', function () { cont('Não consegui abrir o arquivo de áudio. Ele ainda existe? Formatos: MP3, OGG, WAV, FLAC, M4A.'); }, { once: true });
      });
    });
  }

  function analisarFaixa() {
    var meu = ed;
    fetch(meu.url).then(function (r) { return r.arrayBuffer(); }).then(function (dados) {
      meu.ctx = new (window.AudioContext || window.webkitAudioContext)();
      return meu.ctx.decodeAudioData(dados);
    }).then(function (buf) {
      if (ed !== meu) return;
      meu.buf = buf;
      meu.dur = buf.duration;
      meu.an = AN.analisar(buf);
      var b = $('#ed-analise');
      if (b) b.innerHTML = meu.an.batidas ? 'Ritmo: ~' + Math.round(meu.an.batidas.bpm) + ' BPM · os cortes grudam na batida' : 'Não achei um ritmo claro: os cortes ficam onde você soltar.';
      $$('[data-precisa-analise]').forEach(function (x) { x.disabled = false; });
      desenharOnda();
    }).catch(function (e) {
      var b = $('#ed-analise');
      if (b) b.textContent = 'Não consegui analisar a forma de onda (' + (e && e.message || e) + '). Dá para dividir à mão.';
    });
  }

  function deSecoes(secoes) {
    var ss = secoes.slice().sort(function (a, b) { return a.inicio - b.inicio; });
    ed.cortes = [];
    ed.props = [];
    if (ss.length < 2) { ed.props = [{ nome: 'Música inteira', acao: 'next', cor: TU.CORES_SECAO[1] }]; return; }
    ss.forEach(function (s, i) {
      if (i > 0) ed.cortes.push(s.inicio);
      ed.props.push({ id: s.id, nome: s.nome, acao: s.acao, cor: s.cor });
    });
  }
  function limites() { return [0].concat(ed.cortes, [ed.dur]); }
  function paraSecoes() {
    if (!ed.cortes.length) return [];
    var L = limites();
    return ed.props.map(function (p, i) {
      return { id: p.id, nome: p.nome, inicio: L[i], termino: L[i + 1], acao: p.acao, cor: p.cor };
    });
  }
  function marcarMudou() {
    ed.mudou = true;
    var b = $('#botao-salvar-secoes');
    if (b) b.disabled = false;
  }
  function grudar(t) {
    if (!ed.grudar || !ed.an) return t;
    var x = AN.grudarBatida(ed.an, t);
    if (Math.abs(x - t) > 0.6) x = t;              // batida longe demais: fica onde a pessoa pôs
    return ed.buf ? AN.grudarZero(ed.buf, x) : x;
  }
  function novaProp(i) {
    var usadas = ed.props.map(function (p) { return p.cor; });
    var cor = TU.CORES_SECAO.filter(function (c) { return usadas.indexOf(c) < 0; })[0] || TU.CORES_SECAO[i % TU.CORES_SECAO.length];
    return { nome: 'Parte ' + (i + 1), acao: 'next', cor: cor };
  }
  function adicionarCorte(t) {
    t = Math.round(grudar(t) * 1000) / 1000;
    if (t <= 0.2 || t >= ed.dur - 0.2) return false;
    if (ed.cortes.some(function (c) { return Math.abs(c - t) < 0.3; })) return false;
    var i = 0;
    while (i < ed.cortes.length && ed.cortes[i] < t) i++;
    ed.cortes.splice(i, 0, t);
    if (ed.props.length === 1 && ed.props[0].nome === 'Música inteira') ed.props[0].nome = 'Parte 1';
    ed.props.splice(i + 1, 0, novaProp(i + 1));
    marcarMudou();
    return true;
  }

  function desenharEditor() {
    var caixa = $('#editor-secoes');
    if (!caixa || !ed) return;
    var L = limites();
    var temAn = !!ed.an;
    caixa.innerHTML =
      '<div class="linha">' +
      '<button class="pequeno principal" data-acao="edTocar" id="ed-tocar">' + (ed.audio.paused ? 'Ouvir' : 'Pausar') + '</button>' +
      '<span class="ajuda" id="ed-tempo">0:00 / ' + TU.fmtTempo(ed.dur) + '</span><span class="ajuda">· só você ouve esta prévia</span><span style="flex:1"></span>' +
      '<button class="pequeno" data-acao="edCorteAqui">+ Marcar corte aqui</button>' +
      '<button class="pequeno" data-acao="edChefe" data-precisa-analise' + (temAn ? '' : ' disabled') + '>Modelo: música de chefe</button>' +
      '<button class="pequeno" data-acao="edSugerir" data-precisa-analise' + (temAn ? '' : ' disabled') + '>Sugerir cortes</button>' +
      '<button class="pequeno perigo" data-acao="edLimpar"' + (ed.cortes.length ? '' : ' disabled') + '>Sem seções</button></div>' +
      '<div class="onda-caixa"><canvas id="ed-onda" height="150" aria-label="Forma de onda: clique para ouvir dali, arraste as linhas para ajustar os cortes"></canvas></div>' +
      '<div class="linha"><label class="opcao"><input type="checkbox" id="ed-grudar"' + A.marcado(ed.grudar) + '>Grudar no tempo da música</label>' +
      '<span class="ajuda" id="ed-analise">' + (temAn ? '' : 'Analisando a música…') + '</span></div>' +
      '<table class="tabela tabela-secoes"><tr><th></th><th>Nome</th><th>Início</th><th>Fim</th><th>Quando acabar</th><th></th></tr>' +
      ed.props.map(function (p, i) {
        return '<tr data-sec="' + i + '"><td><button class="quadrado-botao' + (ed.loop === i ? ' on' : '') + '" data-acao="edOuvir" data-i="' + i + '" style="background:' + esc(p.cor) + '" title="Ouvir só esta parte em loop" aria-label="Ouvir ' + esc(p.nome) + '"></button></td>' +
          '<td><input type="text" value="' + esc(p.nome) + '" data-ed-nome="' + i + '" aria-label="Nome da parte"></td>' +
          '<td>' + (i === 0 ? TU.fmtTempo(0) : '<input type="text" class="tempo-curto" value="' + fmtCorte(L[i]) + '" data-ed-corte="' + (i - 1) + '" aria-label="Início">') + '</td>' +
          '<td>' + TU.fmtTempo(L[i + 1]) + '</td>' +
          '<td><select data-ed-acao="' + i + '">' + Object.keys(ACOES_SECAO).map(function (k) { return '<option value="' + k + '"' + (p.acao === k ? ' selected' : '') + '>' + ACOES_SECAO[k] + '</option>'; }).join('') + '</select></td>' +
          '<td>' + (ed.props.length > 1 ? '<button class="link perigo" data-acao="edRemover" data-i="' + i + '">' + (i === 0 ? 'juntar com a próxima' : 'juntar com a anterior') + '</button>' : '') + '</td></tr>';
      }).join('') + '</table>' +
      (ed.cortes.length ? '' : '<p class="ajuda">Sem cortes, a música toca inteira. Use o modelo de chefe, as sugestões ou dê play e marque os cortes.</p>');
    desenharOnda();
    loopPrevia();
  }
  function fmtCorte(t) {
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2).replace('.', ',');
  }

  function desenharOnda() {
    var cv = $('#ed-onda');
    if (!cv || !ed) return;
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth, h = 150;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    var g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var L = limites();
    var x = function (t) { return t / ed.dur * w; };
    for (var i = 0; i < ed.props.length; i++) {
      g.fillStyle = ed.props[i].cor + '33';
      g.fillRect(x(L[i]), 0, x(L[i + 1]) - x(L[i]), h);
      if (ed.props[i].acao === 'loop') {
        g.fillStyle = ed.props[i].cor;
        g.fillRect(x(L[i]), h - 5, x(L[i + 1]) - x(L[i]), 5);
      }
      g.fillStyle = '#ECEAE4';
      g.font = '12px system-ui, sans-serif';
      g.fillText(ed.props[i].nome + (ed.props[i].acao === 'loop' ? ' ⟳' : ''), x(L[i]) + 6, 16);
    }
    if (ed.an) {
      var onda = ed.an.onda, n = onda.length;
      g.fillStyle = 'rgba(236,234,228,.55)';
      for (var px = 0; px < w; px++) {
        var v = onda[Math.min(n - 1, Math.floor(px / w * n))];
        var alt = Math.max(1, v * (h - 40));
        g.fillRect(px, (h - alt) / 2 + 8, 1, alt);
      }
    }
    g.fillStyle = '#F0B44C';
    ed.cortes.forEach(function (c) { g.fillRect(x(c) - 1, 0, 2, h); g.fillRect(x(c) - 5, 0, 10, 8); });
    if (ed.loop >= 0) {
      g.strokeStyle = '#F0B44C'; g.lineWidth = 2;
      g.strokeRect(x(L[ed.loop]) + 1, 1, x(L[ed.loop + 1]) - x(L[ed.loop]) - 2, h - 2);
    }
    g.fillStyle = '#ffffff';
    g.fillRect(x(ed.audio.currentTime || 0) - 0.5, 0, 1.5, h);
  }

  /** Prévia: agulha andando e loop da parte escolhida. */
  function loopPrevia() {
    if (!ed) return;
    cancelAnimationFrame(ed.raf);
    var meu = ed;
    (function passo() {
      if (ed !== meu) return;
      meu.raf = requestAnimationFrame(passo);
      var a = meu.audio;
      if (meu.loop >= 0 && !a.paused) {
        var L = limites();
        if (a.currentTime >= L[meu.loop + 1] - 0.02 || a.currentTime < L[meu.loop] - 0.2) a.currentTime = L[meu.loop];
      }
      var t = $('#ed-tempo');
      if (t) t.textContent = TU.fmtTempo(a.currentTime) + ' / ' + TU.fmtTempo(meu.dur);
      var b = $('#ed-tocar');
      if (b) b.textContent = a.paused ? 'Ouvir' : 'Pausar';
      desenharOnda();
    })();
  }

  var ACOES_ED = {
    edTocar: function () { if (ed.audio.paused) ed.audio.play().catch(function () {}); else ed.audio.pause(); },
    edCorteAqui: function () {
      if (!adicionarCorte(ed.audio.currentTime)) A.aviso('Dê play e clique quando a música mudar (não dá para cortar muito perto de outro corte ou das pontas).', 'erro');
      else desenharEditor();
    },
    edChefe: function () {
      var cs = AN.cortesChefe(ed.an, ed.dur).map(function (t) { return Math.round(grudar(t) * 1000) / 1000; });
      ed.cortes = cs.filter(function (t, i) { return t > 0.2 && t < ed.dur - 0.2 && (i === 0 || t - cs[i - 1] > 0.3); });
      var nomes = ['Introdução', 'Fase 1', 'Transição', 'Fase final', 'Encerramento'];
      var acoes = ['next', 'loop', 'next', 'loop', 'next'];
      ed.props = ed.cortes.concat([null]).map(function (_, i) { return { nome: nomes[i] || 'Parte ' + (i + 1), acao: acoes[i] || 'next', cor: TU.CORES_SECAO[i % TU.CORES_SECAO.length] }; });
      ed.loop = -1;
      marcarMudou(); desenharEditor();
      A.aviso('Pronto: Fase 1 e Fase final ficam em loop. Ouça e ajuste os cortes arrastando as linhas.', 'ok');
    },
    edSugerir: function () {
      var cs = AN.sugerirCortes(ed.an, ed.dur, 30, 10).map(function (t) { return Math.round(grudar(t) * 1000) / 1000; })
        .filter(function (t) { return t > 1 && t < ed.dur - 1; }).sort(function (a, b) { return a - b; });
      if (!cs.length) return A.aviso('Não achei mudanças claras nesta música. Marque os cortes à mão.', 'erro');
      ed.cortes = cs;
      ed.props = cs.concat([null]).map(function (_, i) { return { nome: 'Parte ' + (i + 1), acao: 'next', cor: TU.CORES_SECAO[i % TU.CORES_SECAO.length] }; });
      ed.loop = -1;
      marcarMudou(); desenharEditor();
    },
    edLimpar: function () {
      if (!confirm('Tirar todas as seções? A música volta a tocar inteira.')) return;
      ed.cortes = []; ed.props = [{ nome: 'Música inteira', acao: 'next', cor: TU.CORES_SECAO[1] }]; ed.loop = -1;
      marcarMudou(); desenharEditor();
    },
    edRemover: function (el) {
      var i = Number(el.getAttribute('data-i'));
      if (ed.props.length < 2) return;
      // a parte i some: o corte que a começa sai (a primeira junta com a segunda)
      var corte = i === 0 ? 0 : i - 1;
      ed.cortes.splice(corte, 1);
      ed.props.splice(i === 0 ? 1 : i, 1);
      if (!ed.cortes.length) ed.props = [{ nome: 'Música inteira', acao: 'next', cor: ed.props[0].cor }];
      ed.loop = -1;
      marcarMudou(); desenharEditor();
    },
    edOuvir: function (el) {
      var i = Number(el.getAttribute('data-i'));
      if (ed.loop === i) { ed.loop = -1; ed.audio.pause(); } else {
        ed.loop = i;
        ed.audio.currentTime = limites()[i];
        ed.audio.play().catch(function () {});
      }
      desenharEditor();
    },
    edSalvar: function () {
      var secoes = paraSecoes();
      return window.api.musicaSecoes(ed.id, secoes, ed.dur).then(function (r) {
        if (r && r.erro) return A.aviso(r.erro, 'erro');
        for (var i = 0; i < (faixas || []).length; i++) if (faixas[i].id === ed.id) faixas[i] = Object.assign({}, faixas[i], r);
        ed.mudou = false;
        var b = $('#botao-salvar-secoes');
        if (b) b.disabled = true;
        A.aviso(secoes.length ? 'Seções salvas. Se a música estiver tocando, já valem.' : 'Seções tiradas: a música toca inteira.', 'ok');
      });
    },
  };
  Object.keys(ACOES_ED).forEach(function (k) { A.ACOES[k] = ACOES_ED[k]; });

  document.addEventListener('change', function (ev) {
    if (!ed) return;
    var el = ev.target, v;
    if (el.id === 'ed-grudar') { ed.grudar = el.checked; return; }
    if ((v = el.getAttribute('data-ed-nome')) != null) { ed.props[Number(v)].nome = el.value.trim() || 'Parte ' + (Number(v) + 1); marcarMudou(); desenharOnda(); }
    else if ((v = el.getAttribute('data-ed-acao')) != null) { ed.props[Number(v)].acao = el.value; marcarMudou(); desenharOnda(); }
    else if ((v = el.getAttribute('data-ed-corte')) != null) {
      var i = Number(v), t = TU.parseTempo(el.value);
      var min = (i > 0 ? ed.cortes[i - 1] : 0) + 0.3, max = (i < ed.cortes.length - 1 ? ed.cortes[i + 1] : ed.dur) - 0.3;
      if (!isFinite(t) || t < min || t > max) { A.aviso('Esse tempo passa da parte vizinha.', 'erro'); desenharEditor(); return; }
      ed.cortes[i] = Math.round(t * 1000) / 1000;
      marcarMudou(); desenharEditor();
    }
  });

  // arrastar os cortes na onda; clique solto = ouvir dali
  document.addEventListener('pointerdown', function (ev) {
    var cv = ev.target;
    if (!ed || cv.id !== 'ed-onda') return;
    var r = cv.getBoundingClientRect();
    var t = function (e) { return Math.max(0, Math.min(ed.dur, (e.clientX - r.left) / r.width * ed.dur)); };
    var perto = -1, melhor = 8;
    ed.cortes.forEach(function (c, i) { var d = Math.abs(c / ed.dur * r.width - (ev.clientX - r.left)); if (d < melhor) { melhor = d; perto = i; } });
    if (perto < 0) { ed.audio.currentTime = t(ev); return; }
    ev.preventDefault();
    cv.setPointerCapture(ev.pointerId);
    var mover = function (e) {
      var min = (perto > 0 ? ed.cortes[perto - 1] : 0) + 0.3, max = (perto < ed.cortes.length - 1 ? ed.cortes[perto + 1] : ed.dur) - 0.3;
      ed.cortes[perto] = Math.max(min, Math.min(max, t(e)));
      desenharOnda();
    };
    var soltar = function () {
      cv.removeEventListener('pointermove', mover);
      cv.removeEventListener('pointerup', soltar);
      var min = (perto > 0 ? ed.cortes[perto - 1] : 0) + 0.3, max = (perto < ed.cortes.length - 1 ? ed.cortes[perto + 1] : ed.dur) - 0.3;
      ed.cortes[perto] = Math.round(Math.max(min, Math.min(max, grudar(ed.cortes[perto]))) * 1000) / 1000;
      marcarMudou(); desenharEditor();
    };
    cv.addEventListener('pointermove', mover);
    cv.addEventListener('pointerup', soltar);
  });
  window.addEventListener('resize', function () { if (ed) desenharOnda(); });
  // sair do editor com mudanças não salvas
  window.addEventListener('hashchange', function (ev) {
    if (ed && ed.mudou && ev.oldURL.indexOf('#secoes/') >= 0 && !confirm('Sair sem salvar as seções?')) {
      history.replaceState(null, '', ev.oldURL);
      ev.stopImmediatePropagation();
    }
  }, true);
})();
