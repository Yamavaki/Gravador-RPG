'use strict';
// Leitura do StreamKit (overlay oficial do Discord para OBS).
// O app abre a página do widget de voz numa janela escondida e lê, no HTML dela,
// quem está no canal e quem está falando. Nada aqui fala com o Discord diretamente.

/**
 * Confere um link do widget de voz do StreamKit e devolve os IDs.
 * Aceita o link como o site do StreamKit entrega:
 *   https://streamkit.discord.com/overlay/voice/<servidor>/<canal>?icon=true&...
 * Garante icon=true (as imagens trazem o ID de cada pessoa) e online=true.
 */
function validarUrl(entrada) {
  let u;
  try {
    u = new URL(String(entrada || '').trim());
  } catch {
    return { ok: false, erro: 'Não parece um link. Copie o link inteiro do StreamKit, começando com https://' };
  }
  if (u.protocol !== 'https:' || u.hostname !== 'streamkit.discord.com') {
    return { ok: false, erro: 'O link precisa ser do streamkit.discord.com.' };
  }
  const m = u.pathname.match(/^\/overlay\/voice\/(\d{15,22})\/(\d{15,22})\/?$/);
  if (!m) {
    return { ok: false, erro: 'Esse é um link do StreamKit, mas não do widget de voz. Escolha "Voice Widget", o servidor e o canal.' };
  }
  u.searchParams.set('icon', 'true');
  u.searchParams.set('online', 'true');
  return { ok: true, url: u.toString(), servidor: m[1], canal: m[2] };
}

/**
 * Roda DENTRO da página do StreamKit (é convertida em texto e injetada).
 * Precisa ser autocontida: sem variáveis de fora.
 * Estrutura conhecida do widget:
 *   ul.voice-states > li.voice-state[data-reactid*=<id>]
 *     img.avatar(.speaking) [src=https://cdn.discordapp.com/avatars/<id>/...]
 *     div.user > span.name
 * Se o Discord mudar nomes de classe, ainda tenta achar pelo formato das imagens.
 */
function coletarStreamKit(doc) {
  const d = doc || document;
  let itens = Array.from(d.querySelectorAll('li.voice-state'));
  if (!itens.length) {
    itens = Array.from(d.querySelectorAll('li')).filter(li => li.querySelector('img'));
  }
  return itens.map(li => {
    const img = li.querySelector('img.avatar') || li.querySelector('img');
    const nomeEl = li.querySelector('.name') || li.querySelector('span');
    const classes = [];
    const juntar = el => { if (el && el.classList) classes.push(...Array.from(el.classList)); };
    juntar(li);
    juntar(img);
    li.querySelectorAll('[class*="speaking"]').forEach(juntar);
    return {
      reactid: li.getAttribute('data-reactid') || '',
      src: img ? img.getAttribute('src') || '' : '',
      nome: nomeEl ? (nomeEl.textContent || '').trim() : '',
      falando: classes.some(c => /speaking/i.test(c)),
    };
  });
}

/** Do bruto coletado para presenças: { discordId, nome, falando }. */
function interpretar(brutos) {
  if (!Array.isArray(brutos)) return [];
  const saida = [];
  const vistos = new Set();
  for (const b of brutos) {
    if (!b || typeof b !== 'object') continue;
    let id = '';
    const doSrc = String(b.src || '').match(/\/avatars\/(\d{15,22})\//);
    if (doSrc) id = doSrc[1];
    if (!id) {
      const doReact = String(b.reactid || '').match(/(\d{15,22})/);
      if (doReact) id = doReact[1];
    }
    const nome = String(b.nome || '').trim().slice(0, 80);
    if (!id && !nome) continue;
    const chave = id || 'nome:' + nome.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push({ discordId: id, nome, falando: !!b.falando });
  }
  return saida;
}

module.exports = { validarUrl, coletarStreamKit, interpretar };
