'use strict';
// Junta a mesa configurada com quem o StreamKit está vendo no canal de voz
// e decide o que o overlay mostra: imagem, nome, cor, quem está falando.

/**
 * Nome que aparece no vídeo para um jogador.
 * modo da mesa: personagem | jogador | discord | personagem-jogador | nenhum
 * modo do jogador: padrao (usa o da mesa) | qualquer um acima | personalizado
 * Se o campo escolhido estiver vazio, cai para o próximo que existir,
 * para nunca aparecer um retrato sem nome por esquecimento.
 */
function resolverNome(j, nomesMesa, nomeDiscordAoVivo = '') {
  const discord = (j.discordNome || nomeDiscordAoVivo || '').trim();
  const personagem = (j.personagem || '').trim();
  const jogador = (j.jogador || '').trim();
  let modo = j.nomeModo && j.nomeModo !== 'padrao' ? j.nomeModo : (nomesMesa && nomesMesa.modo) || 'personagem';

  if (modo === 'personalizado') {
    const t = (j.nomeTexto || '').trim();
    if (t) return t;
    modo = (nomesMesa && nomesMesa.modo) || 'personagem';
    if (modo === 'personalizado') modo = 'personagem';
  }
  if (modo === 'nenhum') return '';
  const primeiro = (...xs) => xs.find(x => x) || '';
  switch (modo) {
    case 'jogador': return primeiro(jogador, discord, personagem);
    case 'discord': return primeiro(discord, jogador, personagem);
    case 'personagem-jogador':
      if (personagem && jogador) return `${personagem} (${jogador})`;
      return primeiro(personagem, jogador, discord);
    case 'personagem':
    default: return primeiro(personagem, jogador, discord);
  }
}

const normal = s => (s || '').trim().toLowerCase();

/**
 * Liga cada jogador da mesa a uma pessoa vista no StreamKit.
 * Primeiro pelo ID do Discord (não muda nunca), depois pelo nome exibido.
 * Retorna { porJogador: Map(id -> presenca), desconhecidos: [presenca] }.
 */
function casarPresencas(mesa, presencas) {
  const porJogador = new Map();
  const usadas = new Set();
  const ignorados = new Set(mesa.ignorados || []);
  const lista = (presencas || []).filter(p => !(p.discordId && ignorados.has(p.discordId)));

  for (const j of mesa.jogadores) {
    if (!j.discordId) continue;
    const i = lista.findIndex((p, k) => !usadas.has(k) && p.discordId === j.discordId);
    if (i >= 0) { porJogador.set(j.id, lista[i]); usadas.add(i); }
  }
  for (const j of mesa.jogadores) {
    if (porJogador.has(j.id) || !j.discordNome) continue;
    const i = lista.findIndex((p, k) => !usadas.has(k) && normal(p.nome) === normal(j.discordNome));
    if (i >= 0) { porJogador.set(j.id, lista[i]); usadas.add(i); }
  }
  const desconhecidos = lista.filter((_, k) => !usadas.has(k));
  return { porJogador, desconhecidos };
}

function iniciais(nome) {
  const partes = (nome || '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return '?';
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
}

/**
 * O que o overlay desenha agora.
 * conectado: se o StreamKit está mandando dados. Sem ele, todos aparecem
 * (ninguém falando), para dar para montar a cena no OBS antes da sessão.
 */
function vistaOverlay(mesa, presencas, { conectado = false, urlImagem = n => `/img/${encodeURIComponent(n)}` } = {}) {
  const { porJogador } = casarPresencas(mesa, presencas);
  const ov = mesa.overlay;
  const pessoas = [];
  for (const j of mesa.jogadores) {
    const p = porJogador.get(j.id);
    const presente = conectado ? !!p : true;
    const falando = !!(p && p.falando);
    if (ov.ocultarAusentes && conectado && !presente) continue;
    let nome = resolverNome(j, mesa.nomes, p && p.nome);
    if (mesa.nomes.quando === 'falando' && !falando) nome = '';
    pessoas.push({
      id: j.id,
      nome,
      iniciais: iniciais(j.personagem || j.jogador || j.discordNome || (p && p.nome)),
      imagem: j.imagem ? urlImagem(j.imagem) : '',
      foco: j.foco,
      cor: j.cor,
      falando,
      presente,
    });
  }
  return {
    ativo: ov.ativo,
    ancora: ov.ancora,
    direcao: ov.direcao,
    ordem: ov.ordem,
    mostrar: ov.mostrar,
    deslocX: ov.deslocX,
    deslocY: ov.deslocY,
    espaco: ov.espaco,
    tamanho: ov.tamanho,
    efeito: ov.efeito,
    forma: ov.forma,
    moldura: ov.moldura,
    apagarSilenciosos: ov.apagarSilenciosos,
    margem: ov.margem,
    pessoas,
    // identidade visual ao vivo (logo, textos), na posição do horizontal
    camadas: ((mesa.identidade && mesa.identidade.camadas) || []).filter(c => c.aoVivo)
      .map(c => ({ ...c, url: c.tipo === 'imagem' && c.imagem ? urlImagem(c.imagem) : '' })),
  };
}

module.exports = { resolverNome, casarPresencas, vistaOverlay, iniciais };
