/* Gravador RPG — Marcadores
   Manda eventos do jogo para o app Gravador RPG, que roda no PC do mestre junto com o OBS.
   Só o mestre ativo manda (os jogadores não precisam de nada). */

const ID = 'gravador-rpg-marcadores';

// ------------------------------------------------------------------ partes sem Foundry (testáveis)

/** Resultados de d20 que valeram numa rolagem (ignora dados descartados, ex.: vantagem). */
export function resultadosD20(roll) {
  const saida = [];
  const termos = (roll && (roll.dice || roll.terms)) || [];
  for (const t of termos) {
    if (!t || t.faces !== 20 || !Array.isArray(t.results)) continue;
    for (const r of t.results) {
      if (r.active === false || r.discarded) continue;
      saida.push(r.result);
    }
  }
  return saida;
}

/** "Crítico" / "Falha crítica" de uma mensagem de chat, ou null. */
export function criticoDaMensagem(msg, quem = '') {
  const rolls = (msg && msg.rolls) || [];
  let critico = false, falha = false;
  for (const roll of rolls) {
    for (const v of resultadosD20(roll)) {
      if (v === 20) critico = true;
      if (v === 1) falha = true;
    }
  }
  const nome = quem ? `: ${quem}` : '';
  if (critico) return `Crítico${nome}`;
  if (falha) return `Falha crítica${nome}`;
  return null;
}

/** Envia ao app. Responde { ok, mensagem }. */
export async function enviar({ porta, chave, tipo, nome = '' }, f = globalThis.fetch) {
  const ctrl = new AbortController();
  const limite = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await f(`http://127.0.0.1:${porta}/foundry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave, tipo, nome: String(nome).slice(0, 120) }),
      signal: ctrl.signal,
    });
    const d = await r.json().catch(() => ({}));
    return { ok: !!d.ok, mensagem: d.mensagem || '', ...d };
  } catch (e) {
    return { ok: false, mensagem: 'App Gravador RPG não encontrado. Ele está aberto neste PC? A porta está certa?' };
  } finally {
    clearTimeout(limite);
  }
}

// ------------------------------------------------------------------ dentro do Foundry
const cfg = chave => game.settings.get(ID, chave);

function souOMestreQueManda() {
  if (!game.user.isGM) return false;
  const ativo = game.users.activeGM;
  return !ativo || ativo.id === game.user.id;
}

async function marcar(nome, tipo = 'marcar') {
  if (!souOMestreQueManda()) return { ok: false, mensagem: 'Só o mestre ativo manda marcadores.' };
  const chave = cfg('chave');
  if (!chave) return { ok: false, mensagem: 'Cole a chave do app nas configurações do módulo.' };
  return enviar({ porta: cfg('porta'), chave, tipo, nome });
}

async function testar(avisar = true) {
  const r = await marcar('', 'ping');
  if (!avisar) return r;
  if (r.ok) ui.notifications.info(`Gravador RPG conectado (mesa: ${r.mesa || '—'}${r.gravando ? ', gravando' : ''}).`);
  else ui.notifications.warn('Gravador RPG: ' + (r.mensagem || 'sem resposta.'));
  return r;
}

function registrar() {
  const s = (chave, dados) => game.settings.register(ID, chave, { config: true, ...dados });
  s('chave', { name: 'Chave do app', hint: 'No app Gravador RPG: Conexões → Foundry → Chave.', scope: 'client', type: String, default: '' });
  s('porta', { name: 'Porta do app', hint: 'No app: Conexões → Foundry → Porta (padrão 47800).', scope: 'client', type: Number, default: 47800 });
  s('combate', { name: 'Marcar início e fim de combate', scope: 'world', type: Boolean, default: true });
  s('rodada', { name: 'Marcar cada rodada nova', scope: 'world', type: Boolean, default: false });
  s('critico', { name: 'Marcar crítico e falha crítica no d20', scope: 'world', type: Boolean, default: true });
  s('cena', { name: 'Marcar troca de cena', scope: 'world', type: Boolean, default: true });

  game.keybindings.register(ID, 'marcar', {
    name: 'Marcar momento (Gravador RPG)',
    hint: 'Abre uma caixinha para dar nome ao momento.',
    editable: [],
    restricted: true,
    onDown: () => { pedirNome(); return true; },
  });
}

async function pedirNome() {
  const nome = await foundry.applications.api.DialogV2.prompt({
    window: { title: 'Marcar momento' },
    content: '<label>Nome do momento <input name="nome" type="text" autofocus placeholder="Ex.: Emboscada na ponte"></label>',
    ok: { label: 'Marcar', callback: (ev, botao) => botao.form.elements.nome.value },
    rejectClose: false,
  }).catch(() => null);
  if (nome == null) return;
  const r = await marcar(nome || 'Marcador');
  if (!r.ok) ui.notifications.warn('Gravador RPG: ' + r.mensagem);
}

function ligarEventos() {
  Hooks.on('combatStart', combat => {
    if (!cfg('combate')) return;
    // nomes dos inimigos (combatentes sem dono jogador), no máximo dois
    const quem = (combat.combatants?.contents || []).filter(c => c.actor && !c.actor.hasPlayerOwner).map(c => c.name);
    const unicos = [...new Set(quem)].slice(0, 2).join(', ');
    marcar('Combate' + (unicos ? ': ' + unicos : ''));
  });
  Hooks.on('updateCombat', (combat, mudou) => {
    if (cfg('rodada') && 'round' in mudou && mudou.round > 1) marcar(`Rodada ${mudou.round}`);
  });
  Hooks.on('deleteCombat', combat => {
    if (cfg('combate') && combat.started) marcar('Fim do combate');
  });
  Hooks.on('createChatMessage', msg => {
    if (!cfg('critico') || !msg.rolls?.length) return;
    const quem = msg.speaker?.alias || msg.author?.name || '';
    const nome = criticoDaMensagem(msg, quem);
    if (nome) marcar(nome);
  });
  // cena ativada para os jogadores (o mestre só espiar uma cena não conta)
  Hooks.on('updateScene', (cena, mudou) => {
    if (cfg('cena') && mudou.active === true) marcar('Cena: ' + cena.name);
  });
}

if (typeof Hooks !== 'undefined') {
  Hooks.once('init', registrar);
  Hooks.once('ready', () => {
    if (!game.user.isGM) return;
    ligarEventos();
    globalThis.GravadorRPG = { marcar: nome => marcar(nome || 'Marcador'), testar };
    if (cfg('chave')) testar(true);
    else ui.notifications.info('Gravador RPG: cole a chave do app nas configurações do módulo para ativar os marcadores.');
  });
}
