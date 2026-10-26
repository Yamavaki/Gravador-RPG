'use strict';
// Tudo o que a interface pode pedir ao app. O main.js liga isto ao IPC do Electron;
// os testes ligam a um servidor local. Assim a interface testada é a mesma do app.

/**
 * @param {object} o
 *  ctl: Controlador
 *  escolherArquivoImagem(): Promise<string|null>  caminho escolhido
 *  abrirSiteStreamKit, recarregarStreamKit, mostrarStreamKit, marcarComNome, fecharMarcador
 *  abrirCaminho(caminho), abrirExterno(url), copiar(texto), statusAtalhos()
 */
function criarAcoes(o) {
  const { ctl } = o;
  return {
    estado: () => ({ ...ctl.estadoPublico(), atalhos: o.statusAtalhos() }),
    salvarConfig: cfg => ctl.salvarConfig(cfg),
    escolherImagem: async jogadorId => {
      const caminho = await o.escolherArquivoImagem();
      if (!caminho) return { cancelado: true };
      return { nome: ctl.importarImagem(caminho, jogadorId) };
    },
    marcar: nome => ctl.marcar(nome || '', 'botao'),
    marcarComNome: () => o.marcarComNome(),
    gravar: () => ctl.alternarGravacao(),
    replay: () => ctl.salvarReplay(),
    nomearMarcador: (t, nome, capitulo) => ctl.renomearMarcador(Number(t), nome, { capitulo: !!capitulo }),
    fecharMarcador: () => o.fecharMarcador(),
    abrirStreamKit: () => o.abrirSiteStreamKit(),
    recarregarStreamKit: () => o.recarregarStreamKit(),
    mostrarStreamKit: () => o.mostrarStreamKit(),
    trocarCanal: id => ctl.trocarCanal(String(id || '')),
    adicionarCanal: (url, nome) => ctl.adicionarCanal(url, nome),
    adicionarDetectado: (id, nome) => ctl.adicionarDetectado(id, nome),
    ignorarDetectado: id => ctl.ignorarDetectado(id),
    simularLimpeza: () => ctl.simularLimpeza(),
    limpar: () => ctl.limpar(),
    abrirPasta: qual => {
      const pastas = { dados: ctl.pastaDados, imagens: ctl.pastaImagens, sessoes: ctl.pastaSessoes };
      return pastas[qual] ? o.abrirCaminho(pastas[qual]) : null;
    },
    abrirExterno: url => o.abrirExterno(url),
    copiar: texto => o.copiar(String(texto || '')),

    // ---- cortes
    sessoes: () => ctl.biblioteca.listar(),
    sessao: id => ctl.biblioteca.abrir(id),
    criarCorte: (id, opcoes) => ctl.biblioteca.criarCorte(id, opcoes || {}),
    momentos: (id, modo) => ctl.biblioteca.momentos(id, ['cache', 'refazer'].includes(modo) ? modo : ''),
    descartarMomento: (id, t) => ctl.biblioteca.descartarMomento(id, t),
    cortesDosMarcadores: id => ctl.biblioteca.cortesDosMarcadores(id),
    procurarAtualizacao: () => ctl.atualizador.verificar(),
    atualizarAgora: () => (o.aplicarAtualizacao ? o.aplicarAtualizacao() : Promise.reject(new Error('Atualização indisponível aqui.'))),
    legendar: (id, corteId, modo) => ctl.biblioteca.legendar(id, corteId, modo === 'ver' ? 'ver' : ''),
    estadoTranscricao: () => ctl.transcricao.estado(),
    salvarCorte: (id, corte) => ctl.biblioteca.salvarCorte(id, corte),
    excluirCorte: (id, corteId) => ctl.biblioteca.excluirCorte(id, corteId),
    exportar: pedido => ctl.biblioteca.exportar(pedido || {}),
    compilado: pedido => ctl.biblioteca.compilado(pedido || {}),
    cancelarExportacao: id => ctl.fila.cancelar(id),
    limparFila: () => { ctl.fila.limparConcluidas(); return true; },
    mostrarArquivo: id => {
      // só arquivos que a própria fila criou
      const t = ctl.fila.lista().find(x => x.id === id && x.estado === 'pronto');
      return t ? o.mostrarNaPasta(t.saida) : false;
    },
    abrirPastaCortes: () => o.abrirCaminho(ctl.biblioteca.pastaSaida(), true),
    verificarFFmpeg: () => ctl.verificarFFmpeg(),
    escolherPastaCortes: async () => {
      const p = await o.escolherPasta();
      if (!p) return { cancelado: true };
      const cfg = JSON.parse(JSON.stringify(ctl.cfg));
      cfg.cortes.pasta = p;
      return ctl.salvarConfig(cfg);
    },
    // ---- música e bot
    musicaFaixas: () => ctl.musica.listar(),
    musicaAdicionarArquivos: async () => {
      const cs = await o.escolherAudios();
      if (!cs || !cs.length) return { cancelado: true };
      return ctl.musica.adicionarArquivos(cs);
    },
    musicaAdicionarPasta: async () => {
      const p = await o.escolherPastaAudio();
      if (!p) return { cancelado: true };
      return ctl.musica.adicionarPasta(p);
    },
    musicaAtualizarFaixa: (id, campos) => ctl.musica.atualizarFaixa(id, campos),
    musicaRemoverFaixas: ids => ctl.musica.removerFaixas(ids),
    musicaSecoes: (id, secoes, duracao) => ctl.musica.salvarSecoes(id, secoes, duracao),
    musicaUrl: id => ctl.musica.urlFaixa(id),
    musicaTocar: id => ctl.musica.tocar(id),
    musicaTocarFila: (ids, aleatorio) => ctl.musica.tocarFila(ids, aleatorio),
    musicaAdicionarNaFila: (camadaId, ids) => ctl.musica.adicionarNaFila(camadaId, ids),
    musicaComando: (cmd, args) => ctl.musica.comando(cmd, args),
    botToken: token => ctl.musica.salvarToken(token),
    botLigar: () => ctl.musica.ligarBot(),
    botDesligar: () => ctl.musica.desligarBot(),
    botEntrar: (servidor, canal) => ctl.musica.entrar(servidor, canal),
    botSair: () => ctl.musica.sair(),
    botDiagnostico: () => {
      const b = ctl.musica.bot.bibliotecas();
      return { ok: b.ok, erro: b.erro || '', relatorio: b.relatorio || '' };
    },
    // ---- navegador interno (abas com som para o bot)
    navAbrir: () => {
      const n = o.navegador();
      if (!ctl.musica.abas.size) n.restaurar(ctl.cfg.navegador.abas);
      return true;
    },
    navArea: area => {
      o.navegador().definirArea(area && typeof area === 'object'
        ? { x: Number(area.x), y: Number(area.y), largura: Number(area.largura), altura: Number(area.altura) } : null);
      return true;
    },
    navNova: texto => o.navegador().nova(String(texto || ''), true),
    navFechar: id => { o.navegador().fechar(String(id)); return true; },
    navAtivar: id => { o.navegador().ativar(String(id)); return true; },
    navIr: (id, texto) => o.navegador().ir(String(id || ''), String(texto || '')),
    navAcao: (id, acao) => o.navegador().acao(String(id || ''), String(acao || '')),
    navVolume: (id, volume, mudo, ouvir) => ctl.musica.volumeAba(String(id), volume, mudo, ouvir),
    navFavoritos: lista => {
      const cfg = JSON.parse(JSON.stringify(ctl.cfg));
      cfg.navegador.favoritos = Array.isArray(lista) ? lista : [];
      return ctl.salvarConfig(cfg).navegador.favoritos;
    },
    escolherFFmpeg: async () => {
      const p = await o.escolherExecutavel();
      if (!p) return { cancelado: true };
      const cfg = JSON.parse(JSON.stringify(ctl.cfg));
      cfg.cortes.ffmpeg = p;
      return ctl.salvarConfig(cfg);
    },
  };
}

/** Embrulha cada ação para nunca derrubar o app: erro vira { erro: mensagem }. */
async function executarAcao(acoes, nome, args) {
  if (!Object.prototype.hasOwnProperty.call(acoes, nome)) return { erro: 'Ação desconhecida: ' + nome };
  try {
    const r = await acoes[nome](...(Array.isArray(args) ? args : []));
    return r === undefined ? null : r;
  } catch (e) {
    return { erro: (e && e.message) || String(e) };
  }
}

module.exports = { criarAcoes, executarAcao };
