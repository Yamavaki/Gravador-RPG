'use strict';
// Configuração do app: mesas (perfis), jogadores, overlay, OBS, gravação e atalhos.
// Tudo passa por normalizar(), então um arquivo antigo, incompleto ou editado à mão
// nunca quebra o app: o que faltar volta ao padrão e o que for inválido é corrigido.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Layout = require('./layout-retratos');
const Leg = require('./legendas');
const Id = require('./identidade');

// 2: lista de canais do StreamKit por mesa (v0.3) e música
// 3: overlay com posição livre (âncora, direção, ordem, deslocamento) (v0.3.2)
// 4: retratos do vertical com posição livre (v0.3.4)
const VERSAO = 4;

const MODOS_NOME = ['personagem', 'jogador', 'discord', 'personagem-jogador', 'nenhum'];
const MODOS_NOME_JOGADOR = ['padrao', ...MODOS_NOME, 'personalizado'];
const QUANDO_NOME = ['sempre', 'falando'];
const LAYOUTS = ['faixa-baixo', 'faixa-cima', 'coluna-direita', 'coluna-esquerda', 'quem-fala'];
const EFEITOS = ['brilho', 'aumentar', 'pular', 'nenhum'];
const FORMAS = ['circulo', 'arredondado', 'quadrado'];
const PAPEIS = ['mestre', 'jogador'];
const DESTINOS = ['lixeira', 'apagar'];
const RETRATOS_CORTES = ['como-overlay', 'nenhum'];
const LAYOUTS_VERTICAL = ['faixa-baixo', 'faixa-cima', 'quem-fala', 'nenhum'];
const PRESETS_IDS = ['youtube-2k', 'youtube-1080', 'whatsapp', 'vertical', 'whatsapp-vertical', 'rapido'];

function novoId() {
  return crypto.randomBytes(6).toString('hex');
}

function padraoJogador(dados = {}) {
  return {
    id: novoId(),
    discordId: '',
    discordNome: '',
    jogador: '',
    personagem: '',
    imagem: '',
    foco: { x: 50, y: 50, zoom: 100 },
    cor: '#F0B44C',
    nomeModo: 'padrao',
    nomeTexto: '',
    ...dados,
  };
}

function padraoMesa(nome = 'Minha mesa') {
  return {
    id: novoId(),
    nome,
    papel: 'mestre',
    jogadores: [],
    ignorados: [],
    nomes: { modo: 'personagem', quando: 'sempre' },
    overlay: {
      ativo: true,
      ancora: 'baixo',          // um dos 9 pontos da tela
      direcao: 'horizontal',    // fila deitada (horizontal) ou em pé (vertical)
      ordem: 'normal',          // invertida: a fila começa pela outra ponta
      mostrar: 'todos',         // ou só quem está falando
      deslocX: 0,
      deslocY: 0,
      espaco: 18,               // espaço entre os retratos (% do tamanho)
      tamanho: 110,
      efeito: 'brilho',
      forma: 'circulo',
      moldura: true,
      apagarSilenciosos: true,
      ocultarAusentes: true,
      margem: 32,
    },
    cortes: { retratos: 'como-overlay' },
    // retratos no vídeo vertical (quadro 1080×1920): mesma ideia do overlay
    vertical: { ativo: true, ancora: 'baixo', direcao: 'horizontal', ordem: 'normal', mostrar: 'todos', deslocX: 0, deslocY: 0, espaco: 18, tamanho: 150, margem: 90, esconderQuietos: true, fundo: Id.normalizarFundo(null) },
    // identidade visual: camadas (logo, textos) ao vivo e/ou nos cortes, e a imagem final dos cortes
    identidade: { camadas: [] },
    final: Id.normalizarFinal(null),
    cameras: [],
    // legendas dos cortes: estilo e posição (no horizontal e no vertical) valem para todos os cortes da mesa
    legendas: { estilo: { ...Leg.ESTILO_PADRAO }, h: { ...Leg.POS_PADRAO.h }, v: { ...Leg.POS_PADRAO.v } },
    streamkit: { url: '', ativo: '', canais: [] },
    musica: { canal: '' },
  };
}

function padraoConfig() {
  const mesa = padraoMesa();
  return {
    versao: VERSAO,
    mesaAtiva: mesa.id,
    mesas: [mesa],
    obs: { host: '127.0.0.1', porta: 4455, senha: '' },
    gravacao: { limiteHoras: 10, limiteGB: 40, destino: 'lixeira', minutosPedaco: 30, gravarAoEntrar: false },
    atalhos: { marcar: 'F9', marcarNome: 'Shift+F9', replay: 'F10', gravar: 'Ctrl+F9' },
    avisos: { marcador: true },
    overlayPorta: 47800,
    cortes: {
      pasta: '', antes: 30, depois: 15, ffmpeg: '',
      nomesFaixas: ['Tudo junto', 'Microfone', 'Discord', 'Foundry'],
      presets: ['youtube-1080'],
    },
    foundry: { chave: crypto.randomBytes(8).toString('hex'), ativo: true },
    app: { fecharParaBandeja: true, procurarAtualizacoes: true },
    transcricao: { modelo: 'preciso', idioma: 'pt' },
    navegador: { abas: [], favoritos: require('./musica/endereco').FAVORITOS_PADRAO.map(f => ({ ...f })) },
    musica: { volume: 80, volumeFaixas: 80, volumeYoutube: 70, ouvirNoPC: false, entrarAoConectar: true, botId: '', abasNovas: 'discord' },
  };
}

// ---------------------------------------------------------------- validação

const texto = (v, padrao = '', max = 200) => (typeof v === 'string' ? v.slice(0, max) : padrao);
const escolha = (v, opcoes, padrao) => (opcoes.includes(v) ? v : padrao);
const booleano = (v, padrao) => (typeof v === 'boolean' ? v : padrao);
function numero(v, min, max, padrao) {
  const n = Number(v);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, n));
}
function cor(v, padrao) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toUpperCase() : padrao;
}
// Nome de arquivo de imagem guardado pelo app: só o nome, nunca um caminho.
function nomeImagem(v) {
  if (typeof v !== 'string' || !v) return '';
  const base = path.basename(v);
  return /^[A-Za-z0-9._-]{1,120}$/.test(base) && base === v ? base : '';
}
const snowflake = v => (typeof v === 'string' && /^\d{15,22}$/.test(v.trim()) ? v.trim() : '');

function normalizarJogador(j) {
  const p = padraoJogador();
  j = j && typeof j === 'object' ? j : {};
  const foco = j.foco && typeof j.foco === 'object' ? j.foco : {};
  return {
    id: /^[a-f0-9]{6,32}$/.test(j.id) ? j.id : p.id,
    discordId: snowflake(j.discordId),
    discordNome: texto(j.discordNome, '', 80),
    jogador: texto(j.jogador, '', 80),
    personagem: texto(j.personagem, '', 80),
    imagem: nomeImagem(j.imagem),
    foco: {
      x: numero(foco.x, 0, 100, 50),
      y: numero(foco.y, 0, 100, 50),
      zoom: numero(foco.zoom, 100, 300, 100),
    },
    cor: cor(j.cor, p.cor),
    nomeModo: escolha(j.nomeModo, MODOS_NOME_JOGADOR, 'padrao'),
    nomeTexto: texto(j.nomeTexto, '', 80),
  };
}

function normalizarMesa(m) {
  const p = padraoMesa();
  m = m && typeof m === 'object' ? m : {};
  const ov = m.overlay && typeof m.overlay === 'object' ? m.overlay : {};
  const nomes = m.nomes && typeof m.nomes === 'object' ? m.nomes : {};
  const jogadores = Array.isArray(m.jogadores) ? m.jogadores.slice(0, 40).map(normalizarJogador) : [];
  // ids repetidos (cópia manual do arquivo) ganham id novo
  const vistos = new Set();
  for (const j of jogadores) {
    if (vistos.has(j.id)) j.id = novoId();
    vistos.add(j.id);
  }
  return {
    id: /^[a-f0-9]{6,32}$/.test(m.id) ? m.id : p.id,
    nome: texto(m.nome, p.nome, 60).trim() || p.nome,
    papel: escolha(m.papel, PAPEIS, 'mestre'),
    jogadores,
    ignorados: Array.isArray(m.ignorados) ? [...new Set(m.ignorados.map(snowflake).filter(Boolean))].slice(0, 50) : [],
    nomes: {
      modo: escolha(nomes.modo, MODOS_NOME, 'personagem'),
      quando: escolha(nomes.quando, QUANDO_NOME, 'sempre'),
    },
    overlay: (() => {
      // config antiga (até a 0.3.1) só tinha "layout": vira âncora + direção
      const velho = ov.ancora ? null : Layout.deLayout(escolha(ov.layout, LAYOUTS, 'faixa-baixo'));
      const tamVelho = ov.layout === 'quem-fala' && !ov.ancora ? Number(ov.tamanho) * 1.6 : ov.tamanho;
      return {
      ativo: booleano(ov.ativo, true),
      ancora: velho ? velho.ancora : escolha(ov.ancora, Layout.ANCORAS, 'baixo'),
      direcao: velho ? velho.direcao : escolha(ov.direcao, ['horizontal', 'vertical'], 'horizontal'),
      ordem: escolha(ov.ordem, ['normal', 'invertida'], 'normal'),
      mostrar: velho ? velho.mostrar : escolha(ov.mostrar, ['todos', 'falando'], 'todos'),
      deslocX: Math.round(numero(ov.deslocX, -1920, 1920, 0)),
      deslocY: Math.round(numero(ov.deslocY, -1080, 1080, 0)),
      espaco: Math.round(numero(ov.espaco, 0, 200, 18)),
      tamanho: numero(tamVelho, 24, 400, 110),
      efeito: escolha(ov.efeito, EFEITOS, 'brilho'),
      forma: escolha(ov.forma, FORMAS, 'circulo'),
      moldura: booleano(ov.moldura, true),
      apagarSilenciosos: booleano(ov.apagarSilenciosos, true),
      ocultarAusentes: booleano(ov.ocultarAusentes, true),
      margem: numero(ov.margem, 0, 400, 32),
      };
    })(),
    cortes: { retratos: escolha(m.cortes && m.cortes.retratos, RETRATOS_CORTES, 'como-overlay') },
    vertical: (() => {
      const v = m.vertical && typeof m.vertical === 'object' ? m.vertical : {};
      // config antiga (até a 0.3.3): "layout" vira ponto + direção; "nenhum" vira retratos desligados
      const lay = escolha(v.layout, LAYOUTS_VERTICAL, 'faixa-baixo');
      const velho = v.ancora ? null : Layout.deLayout(lay);
      return {
        ativo: velho ? lay !== 'nenhum' : booleano(v.ativo, true),
        ancora: velho ? velho.ancora : escolha(v.ancora, Layout.ANCORAS, 'baixo'),
        direcao: velho ? velho.direcao : escolha(v.direcao, ['horizontal', 'vertical'], 'horizontal'),
        ordem: escolha(v.ordem, ['normal', 'invertida'], 'normal'),
        mostrar: velho ? velho.mostrar : escolha(v.mostrar, ['todos', 'falando'], 'todos'),
        deslocX: Math.round(numero(v.deslocX, -1080, 1080, 0)),
        deslocY: Math.round(numero(v.deslocY, -1920, 1920, 0)),
        espaco: Math.round(numero(v.espaco, 0, 200, 18)),
        tamanho: numero(velho && lay === 'quem-fala' ? Number(v.tamanho) * 1.6 : v.tamanho, 24, 600, 150),
        margem: numero(v.margem, 0, 600, 90),
        esconderQuietos: booleano(v.esconderQuietos, true),
        fundo: Id.normalizarFundo(v.fundo),
      };
    })(),
    identidade: Id.normalizarIdentidade(m.identidade),
    final: Id.normalizarFinal(m.final),
    cameras: Array.isArray(m.cameras) ? m.cameras.slice(0, 12).filter(c => c && typeof c === 'object').map(c => ({
      nome: texto(c.nome, 'Câmera', 40).trim() || 'Câmera',
      x: numero(c.x, 0, 1, 0), y: numero(c.y, 0, 1, 0), w: numero(c.w, 0.01, 1, 0.3),
    })) : [],
    legendas: (() => {
      const l = m.legendas && typeof m.legendas === 'object' ? m.legendas : {};
      return { estilo: Leg.normalizarEstilo(l.estilo), h: Leg.normalizarPos(l.h, 'h'), v: Leg.normalizarPos(l.v, 'v') };
    })(),
    streamkit: normalizarStreamKit(m.streamkit),
    musica: { canal: /^\d{15,22}\/\d{15,22}$/.test(m.musica && m.musica.canal) ? m.musica.canal : '' },
  };
}

/**
 * Canais de voz salvos da mesa. `url` é sempre o link do canal ativo (é o que o resto
 * do app usa). Config antiga (só `url`) vira uma lista com um canal, sem perder o link.
 */
function normalizarStreamKit(sk) {
  sk = sk && typeof sk === 'object' ? sk : {};
  const canais = [];
  const ids = new Set();
  for (const c of Array.isArray(sk.canais) ? sk.canais.slice(0, 30) : []) {
    if (!c || typeof c !== 'object') continue;
    let id = /^[a-f0-9]{6,32}$/.test(c.id) ? c.id : novoId();
    if (ids.has(id)) id = novoId();
    ids.add(id);
    canais.push({ id, nome: texto(c.nome, '', 60).trim() || 'Canal ' + (canais.length + 1), url: texto(c.url, '', 2000).trim() });
  }
  const url = texto(sk.url, '', 2000).trim();
  let ativo = canais.find(c => c.id === sk.ativo);
  if (!ativo && url) {
    // link solto (config antiga ou colado direto): entra na lista
    ativo = canais.find(c => c.url === url);
    if (!ativo) {
      ativo = { id: novoId(), nome: canais.length ? 'Canal ' + (canais.length + 1) : 'Canal principal', url };
      canais.push(ativo);
    }
  }
  return { url: ativo ? ativo.url : '', ativo: ativo ? ativo.id : '', canais };
}

function normalizar(c) {
  const p = padraoConfig();
  c = c && typeof c === 'object' ? c : {};
  let mesas = Array.isArray(c.mesas) ? c.mesas.slice(0, 30).map(normalizarMesa) : [];
  if (!mesas.length) mesas = p.mesas;
  const ids = new Set();
  for (const m of mesas) {
    if (ids.has(m.id)) m.id = novoId();
    ids.add(m.id);
  }
  const obs = c.obs || {};
  const g = c.gravacao || {};
  const a = c.atalhos || {};
  return {
    versao: VERSAO,
    mesaAtiva: ids.has(c.mesaAtiva) ? c.mesaAtiva : mesas[0].id,
    mesas,
    obs: {
      host: texto(obs.host, p.obs.host, 120).trim() || p.obs.host,
      porta: Math.round(numero(obs.porta, 1, 65535, p.obs.porta)),
      senha: texto(obs.senha, '', 200),
    },
    gravacao: {
      limiteHoras: numero(g.limiteHoras, 1, 200, p.gravacao.limiteHoras),
      limiteGB: numero(g.limiteGB, 1, 4000, p.gravacao.limiteGB),
      destino: escolha(g.destino, DESTINOS, 'lixeira'),
      minutosPedaco: Math.round(numero(g.minutosPedaco, 5, 240, 30)),
      gravarAoEntrar: booleano(g.gravarAoEntrar, false),
    },
    atalhos: {
      marcar: texto(a.marcar, p.atalhos.marcar, 40),
      marcarNome: texto(a.marcarNome, p.atalhos.marcarNome, 40),
      replay: texto(a.replay, p.atalhos.replay, 40),
      gravar: texto(a.gravar, p.atalhos.gravar, 40),
    },
    avisos: { marcador: booleano(c.avisos && c.avisos.marcador, true) },
    overlayPorta: Math.round(numero(c.overlayPorta, 1024, 65535, 47800)),
    cortes: (() => {
      const k = c.cortes && typeof c.cortes === 'object' ? c.cortes : {};
      const nf = Array.isArray(k.nomesFaixas) ? k.nomesFaixas : [];
      return {
        pasta: texto(k.pasta, '', 500).trim(),
        antes: Math.round(numero(k.antes, 0, 600, 30)),
        depois: Math.round(numero(k.depois, 1, 600, 15)),
        ffmpeg: texto(k.ffmpeg, '', 500).trim(),
        nomesFaixas: p.cortes.nomesFaixas.map((padrao, i) => texto(nf[i], padrao, 30).trim() || padrao),
        presets: Array.isArray(k.presets) ? [...new Set(k.presets.filter(x => PRESETS_IDS.includes(x)))] : p.cortes.presets,
      };
    })(),
    foundry: {
      chave: c.foundry && /^[a-f0-9]{16}$/.test(c.foundry.chave) ? c.foundry.chave : p.foundry.chave,
      ativo: booleano(c.foundry && c.foundry.ativo, true),
    },
    app: { fecharParaBandeja: booleano(c.app && c.app.fecharParaBandeja, true), procurarAtualizacoes: booleano(c.app && c.app.procurarAtualizacoes, true) },
    transcricao: {
      modelo: escolha(c.transcricao && c.transcricao.modelo, ['preciso', 'rapido'], 'preciso'),
      idioma: escolha(c.transcricao && c.transcricao.idioma, ['pt', 'en', 'es', 'auto'], 'pt'),
    },
    navegador: (() => {
      const { enderecoPermitido } = require('./musica/endereco');
      const n = c.navegador && typeof c.navegador === 'object' ? c.navegador : null;
      const url = v => (typeof v === 'string' && v.length <= 2000 && enderecoPermitido(v) ? v : '');
      return {
        // abas abertas da última vez (reabrem sem tocar sozinhas)
        abas: n && Array.isArray(n.abas) ? n.abas.map(url).filter(Boolean).slice(0, 12) : [],
        favoritos: n && Array.isArray(n.favoritos)
          ? n.favoritos.filter(f => f && url(f.url)).slice(0, 30).map(f => ({ nome: texto(f.nome, '', 40).trim() || 'Site', url: f.url }))
          : p.navegador.favoritos,
      };
    })(),
    musica: (() => {
      const mu = c.musica && typeof c.musica === 'object' ? c.musica : {};
      return {
        volume: Math.round(numero(mu.volume, 0, 100, 80)),
        volumeFaixas: Math.round(numero(mu.volumeFaixas, 0, 100, 80)),
        volumeYoutube: Math.round(numero(mu.volumeYoutube, 0, 100, 70)),
        ouvirNoPC: booleano(mu.ouvirNoPC, false),
        abasNovas: escolha(mu.abasNovas, ['discord', 'previa'], 'discord'),
        entrarAoConectar: booleano(mu.entrarAoConectar, true),
        botId: snowflake(mu.botId),
      };
    })(),
  };
}

function mesaAtiva(cfg) {
  return cfg.mesas.find(m => m.id === cfg.mesaAtiva) || cfg.mesas[0];
}

// ---------------------------------------------------------------- arquivo

class ArmazemConfig {
  constructor(arquivo) {
    this.arquivo = arquivo;
    this.dados = null;
  }

  carregar() {
    let bruto = null;
    if (fs.existsSync(this.arquivo)) {
      try {
        bruto = JSON.parse(fs.readFileSync(this.arquivo, 'utf8'));
      } catch {
        // arquivo corrompido: guarda uma cópia e recomeça, sem perder o original
        const copia = this.arquivo + '.corrompido-' + Date.now();
        try { fs.copyFileSync(this.arquivo, copia); } catch { /* sem cópia */ }
        bruto = null;
      }
    }
    // atualização do app: guarda uma cópia da config como estava antes de converter
    if (bruto && typeof bruto === 'object' && bruto.versao !== VERSAO) {
      const copia = this.arquivo.replace(/\.json$/, '') + `.antes-da-v${VERSAO}.json`;
      try { if (!fs.existsSync(copia)) fs.copyFileSync(this.arquivo, copia); } catch { /* sem cópia */ }
    }
    this.dados = normalizar(bruto);
    if (bruto && bruto.versao !== VERSAO) {
      try { this.salvar(); } catch { /* salva na próxima vez */ }
    }
    return this.dados;
  }

  salvar(novos = this.dados) {
    this.dados = normalizar(novos);
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    const tmp = this.arquivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.dados, null, 2), 'utf8');
    fs.renameSync(tmp, this.arquivo);
    return this.dados;
  }
}

module.exports = {
  VERSAO, LAYOUTS_VERTICAL, PRESETS_IDS, MODOS_NOME, MODOS_NOME_JOGADOR, QUANDO_NOME, LAYOUTS, EFEITOS, FORMAS, PAPEIS, DESTINOS,
  novoId, padraoJogador, padraoMesa, padraoConfig, normalizar, normalizarMesa, normalizarJogador,
  mesaAtiva, ArmazemConfig, normalizarStreamKit,
};
