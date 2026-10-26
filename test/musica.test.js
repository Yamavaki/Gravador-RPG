'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { MixerPCM, BYTES_PACOTE, QUADROS_PACOTE, TAXA } = require('../src/core/musica/mixer');
const { BibliotecaMusica, normalizarSecoes, tipoPeloNome } = require('../src/core/musica/biblioteca');
const { CofreToken } = require('../src/core/musica/cofre');
const { BotDiscord, idDoToken, linkConvite, explicarErro } = require('../src/core/musica/bot');
const TU = require('../src/core/musica/trilha-util');
const { discordFalso, SERVIDOR, CANAL, CANAL2, BOT_ID, TOKEN } = require('./discord-falso');

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
const espera = ms => new Promise(r => setTimeout(r, ms));

/** n instantes de um tom (estéreo, Int16 intercalado). */
function tom(n, amp = 8000, freq = 440, fase = 0) {
  const a = new Int16Array(n * 2);
  for (let i = 0; i < n; i++) a[i * 2] = a[i * 2 + 1] = Math.round(amp * Math.sin(2 * Math.PI * freq * (i + fase) / TAXA));
  return a;
}
const pico = buf => { let m = 0; for (let i = 0; i < buf.length; i += 2) m = Math.max(m, Math.abs(buf.readInt16LE(i))); return m; };

// ---------------------------------------------------------------- mixer

test('mixer: pacote de 20 ms, silêncio sem fontes', () => {
  const m = new MixerPCM();
  const p = m.pacote();
  assert.equal(p.length, BYTES_PACOTE);
  assert.equal(pico(p), 0);
});

test('mixer: espera o colchão encher antes de tocar e soma as fontes com volume', () => {
  const m = new MixerPCM();
  m.empurrar('motor', tom(QUADROS_PACOTE * 8, 8000));          // 160 ms: ainda não chega nos 250 ms
  assert.equal(pico(m.pacote()), 0, 'ainda enchendo');
  m.empurrar('motor', tom(QUADROS_PACOTE * 6, 8000));
  const p = m.pacote();
  assert.ok(pico(p) > 7500 && pico(p) <= 8000, 'motor sozinho');
  m.definirVolume('motor', 0.5);
  assert.ok(Math.abs(pico(m.pacote()) - 4000) < 300, 'volume da fonte');
  m.definirVolume(null, 0);
  assert.equal(pico(m.pacote()), 0, 'volume geral zerado');
});

test('mixer: duas fontes somam e não estouram (corta em 16 bits)', () => {
  const m = new MixerPCM();
  m.empurrar('motor', tom(QUADROS_PACOTE * 14, 30000));
  m.empurrar('youtube', tom(QUADROS_PACOTE * 14, 30000));
  const p = m.pacote();
  assert.ok(pico(p) >= 32767);
});

test('mixer: aceita Buffer com deslocamento ímpar e Uint8Array (como chega pelo IPC)', () => {
  const m = new MixerPCM();
  const t = tom(QUADROS_PACOTE * 14, 5000);
  const grande = Buffer.alloc(t.byteLength + 1);
  Buffer.from(t.buffer).copy(grande, 1);
  m.empurrar('motor', grande.subarray(1));
  m.empurrar('youtube', new Uint8Array(tom(QUADROS_PACOTE * 14, 5000).buffer));
  assert.ok(pico(m.pacote()) > 9000);
});

test('mixer: relógio adiantado ou atrasado é corrigido aos poucos, sem estourar o colchão', () => {
  for (const ritmo of [1.0015, 0.9985]) {
    const m = new MixerPCM();
    let fase = 0, sobra = 0, silencios = 0;
    // 3 minutos: a fonte manda 2048 instantes por vez no ritmo dela; o Discord lê um pacote a cada 20 ms
    const porPacote = QUADROS_PACOTE * ritmo;
    for (let i = 0; i < 9000; i++) {
      sobra += porPacote;
      while (sobra >= 2048) { m.empurrar('motor', tom(2048, 8000, 440, fase)); fase += 2048; sobra -= 2048; }
      const p = m.pacote();
      if (i > 50 && pico(p) === 0) silencios++;
    }
    const d = m.diagnostico()[0];
    assert.ok(d.colchaoMs < 700, `colchão sob controle (${ritmo}): ${d.colchaoMs} ms`);
    assert.equal(d.buracos, 0, `sem buracos (${ritmo})`);
    assert.equal(d.descartadosMs, 0, `nada jogado fora (${ritmo})`);
    assert.ok(silencios < 5, `quase nenhum buraco (${ritmo}): ${silencios}`);
    assert.ok(d.ajustes > 0, 'houve correção');
  }
});

test('mixer: fonte que some volta a esperar o colchão; atrasada demais joga o velho fora', () => {
  const m = new MixerPCM();
  m.empurrar('motor', tom(QUADROS_PACOTE * 9));
  for (let i = 0; i < 9; i++) m.pacote();
  assert.equal(pico(m.pacote()), 0, 'acabou: silêncio, sem travar');
  m.empurrar('motor', tom(TAXA * 3));       // 3 s de uma vez
  assert.ok(m.diagnostico()[0].colchaoMs <= 2000);
  assert.ok(m.diagnostico()[0].descartadosMs >= 900);
  m.aparar();
  assert.ok(m.diagnostico()[0].colchaoMs <= 300, 'aparar deixa só o necessário');
});

test('mixer: avisa quando começa e para de sair som', () => {
  let t = 0;
  const m = new MixerPCM({ agora: () => t });
  const ev = [];
  m.on('atividade', a => ev.push(a));
  m.empurrar('motor', new Int16Array(4000));          // silêncio não conta
  assert.deepEqual(ev, []);
  m.empurrar('motor', tom(2000));
  assert.deepEqual(ev, [true]);
  t = 2000; m.verificarSilencio();
  assert.deepEqual(ev, [true]);
  t = 3500; m.verificarSilencio();
  assert.deepEqual(ev, [true, false]);
});

test('mixer: saída para o Discord entrega pacotes e a anterior termina ao criar outra', async () => {
  const m = new MixerPCM();
  m.empurrar('motor', tom(TAXA));
  const s1 = m.criarSaida();
  const pedacos = [];
  s1.on('data', d => pedacos.push(d));
  await espera(20);
  s1.pause();
  assert.ok(pedacos.length >= 3 && pedacos.every(p => p.length === BYTES_PACOTE));
  let acabou = false;
  s1.on('end', () => { acabou = true; });
  const s2 = m.criarSaida();
  s1.resume();
  await espera(20);
  assert.equal(acabou, true);
  assert.equal(s2.read(BYTES_PACOTE).length, BYTES_PACOTE);
});

// ---------------------------------------------------------------- utilidades do Trilha Viva

test('trilha-util: posição com loop, fim da volta, tempo', () => {
  const seg = { inicio: 0, offset: 2, loopIni: 2, loopFim: 5 };
  assert.deepEqual(TU.posDoSeg(seg, 1, 8), { pos: 3, volta: 1 });
  assert.deepEqual(TU.posDoSeg(seg, 4, 8), { pos: 3, volta: 2 });
  assert.equal(TU.fimDaVolta(seg, 1000, 8), 3000);
  assert.equal(TU.fmtTempo(83), '1:23');
  assert.equal(TU.parseTempo('1:23,5'), 83.5);
  assert.ok(Number.isNaN(TU.parseTempo('1::2')));
  assert.equal(TU.nomeDoArquivo('C:\\Musica\\boss_final-tema.mp3'), 'Boss final tema');
});

// ---------------------------------------------------------------- biblioteca

test('biblioteca: adiciona só áudio, sem repetir, com tipo pelo nome', () => {
  const dir = tmp('grpg-mus-');
  const b = new BibliotecaMusica(path.join(dir, 'musica.json'));
  const novos = b.adicionar(['C:\\Musica\\Batalha.mp3', 'C:\\Musica\\chuva_ambiente.ogg', 'C:\\Musica\\capa.jpg', 'c:/musica/batalha.MP3', 'C:\\Musica\\sfx porta.wav']);
  assert.equal(novos.length, 3);
  assert.deepEqual(novos.map(f => f.tipo), ['musica', 'ambiente', 'efeito']);
  assert.equal(novos[1].repetir, true, 'ambiente repete por padrão');
  const b2 = new BibliotecaMusica(path.join(dir, 'musica.json'));
  assert.equal(b2.faixas.length, 3, 'salvou');
  assert.equal(b2.listar()[0].existe, false, 'arquivo inexistente aparece marcado');
  assert.equal(tipoPeloNome('Tavern Night.mp3'), 'ambiente');
});

test('biblioteca: pasta com subpastas vira grupos', () => {
  const dir = tmp('grpg-mus-');
  const raiz = path.join(dir, 'Trilhas');
  fs.mkdirSync(path.join(raiz, 'Chefes'), { recursive: true });
  fs.mkdirSync(path.join(raiz, 'Cidade', 'Taverna'), { recursive: true });
  for (const f of ['Chefes/Dragao.mp3', 'Chefes/Lich.ogg', 'Cidade/Taverna/Bardo.wav', 'tema.mp3', 'Chefes/leia-me.txt']) fs.writeFileSync(path.join(raiz, f), 'x');
  const b = new BibliotecaMusica(path.join(dir, 'musica.json'));
  b.adicionarPasta(raiz);
  const grupos = Object.fromEntries(b.faixas.map(f => [f.nome, f.grupo]));
  assert.deepEqual(grupos, { Dragao: 'Chefes', Lich: 'Chefes', Bardo: 'Cidade / Taverna', Tema: 'Trilhas' });
  assert.equal(b.listar().every(f => f.existe), true);
  assert.equal(b.adicionarPasta(raiz).length, 0, 'de novo não duplica');
});

test('biblioteca: seções corrigidas (ordem, sobreposição, lixo, duração)', () => {
  const s = normalizarSecoes([
    { nome: 'Fase 2', inicio: 30, termino: 70, acao: 'loop' },
    { id: 'a1b2', nome: 'Intro', inicio: 0, termino: 35, acao: 'next', cor: '#123456' },
    { nome: 'Ruim', inicio: 'x', termino: 3 },
    { nome: 'Depois do fim', inicio: 200, termino: 210 },
    { nome: '', inicio: 70, termino: 999, acao: 'xpto' },
  ], 120);
  assert.deepEqual(s.map(x => [x.nome, x.inicio, x.termino, x.acao]), [
    ['Intro', 0, 30, 'next'], ['Fase 2', 30, 70, 'loop'], ['Parte 3', 70, 120, 'next'],
  ]);
  assert.equal(s[0].id, 'a1b2');
  assert.match(s[1].id, /^[a-f0-9]{12}$/, 'seção sem id ganha um (e não "undefined")');
  assert.equal(s[0].cor, '#123456');
});

test('biblioteca: atualizar, seções, remover e arquivo corrompido', () => {
  const dir = tmp('grpg-mus-');
  const arq = path.join(dir, 'musica.json');
  const b = new BibliotecaMusica(arq);
  const [f] = b.adicionar(['D:\\a\\Chefe.mp3']);
  b.atualizar(f.id, { tipo: 'efeito', nome: 'Chefe final', caminho: 'C:\\Windows\\x.mp3' });
  assert.equal(b.faixa(f.id).tipo, 'efeito');
  assert.equal(b.faixa(f.id).caminho, 'D:\\a\\Chefe.mp3', 'caminho não muda por aqui');
  b.definirSecoes(f.id, [{ nome: 'A', inicio: 0, termino: 10 }, { nome: 'B', inicio: 10, termino: 20, acao: 'loop' }], 20);
  assert.equal(new BibliotecaMusica(arq).faixa(f.id).secoes[1].acao, 'loop');
  assert.throws(() => b.atualizar('nao', {}), /não encontrada/);
  assert.equal(b.remover([f.id]), 1);
  fs.writeFileSync(arq, '{quebrado');
  const b3 = new BibliotecaMusica(arq);
  assert.equal(b3.faixas.length, 0);
  assert.ok(fs.readdirSync(dir).some(n => n.startsWith('musica.json.corrompido-')), 'guardou o arquivo quebrado');
});

// ---------------------------------------------------------------- token

test('cofre: guarda cifrado quando dá, lê de volta, apaga', () => {
  const dir = tmp('grpg-cofre-');
  const c = new CofreToken(path.join(dir, 'bot.json'), { cifrar: t => Buffer.from(t.split('').reverse().join('')), decifrar: b => b.toString().split('').reverse().join('') });
  c.salvar(TOKEN);
  assert.ok(!fs.readFileSync(path.join(dir, 'bot.json'), 'utf8').includes(TOKEN), 'não fica em texto puro');
  assert.equal(c.ler(), TOKEN);
  assert.equal(new CofreToken(path.join(dir, 'bot.json')).ler(), '', 'sem como decifrar: vazio, sem erro');
  c.salvar('');
  assert.equal(c.tem(), false);
});

test('bot: ID e convite a partir do token; erros em português', () => {
  assert.equal(idDoToken(TOKEN), BOT_ID);
  assert.equal(idDoToken('abc'), '');
  assert.match(linkConvite(BOT_ID), /client_id=999999999999999999&scope=bot&permissions=3146752/);
  assert.match(explicarErro({ code: 'TokenInvalid', message: 'x' }), /Token inválido/);
  assert.match(explicarErro(new Error("Cannot find module 'discord.js'")), /INSTALAR/);
  assert.match(explicarErro(new Error('getaddrinfo ENOTFOUND discord.com')), /internet/);
});

// ---------------------------------------------------------------- bot com Discord falso

test('bot: sem as bibliotecas instaladas avisa sem quebrar', async () => {
  const f = discordFalso({ semBibliotecas: true });
  const bot = new BotDiscord({ mixer: new MixerPCM(), carregar: f.carregar });
  assert.equal(bot.bibliotecas().ok, false);
  await assert.rejects(bot.conectar(TOKEN), /INSTALAR/);
  assert.equal(bot.estado.etapa, 'erro');
});

test('bot: token inválido', async () => {
  const f = discordFalso({ tokenRuim: true });
  const bot = new BotDiscord({ mixer: new MixerPCM(), carregar: f.carregar });
  await assert.rejects(bot.conectar(TOKEN), /Token inválido/);
  assert.equal(bot.estado.etapa, 'erro');
  assert.equal(f.reg.destruidos, 1);
});

test('bot: liga, lista canais de voz, entra, toca o mixer e cala no silêncio', async () => {
  const f = discordFalso();
  const mixer = new MixerPCM();
  const bot = new BotDiscord({ mixer, carregar: f.carregar });
  await bot.conectar(TOKEN);
  assert.equal(bot.estado.etapa, 'online');
  assert.equal(bot.estado.usuario.id, BOT_ID);
  assert.deepEqual(bot.estado.servidores[0].canais.map(c => c.nome), ['Mesa de RPG', 'Sala 2'], 'só canais de voz, na ordem do Discord');
  await bot.entrar(SERVIDOR, CANAL);
  assert.equal(bot.estado.voz, 'no-canal');
  assert.equal(bot.estado.canal.nome, 'Mesa de RPG');
  assert.equal(f.reg.joins[0].selfDeaf, true);
  const player = f.reg.players[0];
  assert.equal(bot.conexao.player, player, 'player ligado à conexão');
  const r = f.reg.recursos[0];
  assert.equal(r.o.inputType, 'raw');
  assert.equal(r.bitrate, 96000, 'Opus na taxa do canal');
  assert.equal(r.fec, true, 'correção de pacotes perdidos ligada');
  await espera(20);
  assert.equal(player.pausado, true, 'sem som: calado assim que o player começa');
  mixer.empurrar('motor', tom(TAXA / 2, 9000));
  assert.equal(player.pausado, false, 'som chegou: fala');
  const pacote = r.stream.read(BYTES_PACOTE);
  assert.ok(pacote && pico(pacote) > 8000, 'o fluxo do Discord recebe o som do mixer');
  mixer._ultimoSom -= 5000;
  mixer.verificarSilencio();
  assert.equal(player.pausado, true, 'silêncio: cala de novo');
  // mudar de canal no mesmo servidor só troca (não reconecta do zero) e espera o Discord confirmar
  await bot.entrar(SERVIDOR, CANAL2);
  assert.equal(f.reg.eu.voice.channelId, CANAL2);
  assert.equal(f.reg.rejoins, 1);
  assert.equal(f.reg.joins.length, 1);
  assert.equal(bot.estado.canal.nome, 'Sala 2');
  bot.sair();
  assert.equal(player.parado, true, 'fora do canal o player para');
  assert.equal(bot.player, null);
  await bot.desconectar();
  assert.equal(bot.estado.etapa, 'desligado');
  assert.equal(f.reg.destruidos, 1);
});

test('bot: troca de canal que o Discord não confirma volta ao canal anterior com aviso', async () => {
  const f = discordFalso({ naoTroca: true });
  const bot = new BotDiscord({ mixer: new MixerPCM(), carregar: f.carregar });
  await bot.conectar(TOKEN);
  await bot.entrar(SERVIDOR, CANAL);
  bot._esperarCanalOriginal = bot._esperarCanal;
  bot._esperarCanal = (g, c) => bot._esperarCanalOriginal(g, c, 300);
  await assert.rejects(bot.entrar(SERVIDOR, CANAL2), /Não consegui mudar/);
  assert.equal(bot.estado.canal.canal, CANAL);
  assert.equal(bot.estado.voz, 'no-canal');
  await bot.desconectar();
});

test('mixer: sem ninguém lendo não acumula atraso; leitor que volta pega o áudio novo', () => {
  let t = 0;
  const m = new MixerPCM({ agora: () => t });
  for (let i = 0; i < 100; i++) { t += 43; m.empurrar('motor', tom(2048)); }     // ~4 s sem leitor
  assert.ok(m.diagnostico()[0].colchaoMs <= 300, `colchão curto sem leitor: ${m.diagnostico()[0].colchaoMs} ms`);
});

test('bot: sem permissão de falar e canal que não conecta', async () => {
  const f = discordFalso({ semFalar: true });
  const bot = new BotDiscord({ mixer: new MixerPCM(), carregar: f.carregar });
  await bot.conectar(TOKEN);
  await assert.rejects(bot.entrar(SERVIDOR, CANAL), /permissão de Conectar e Falar/);
  await assert.rejects(bot.entrar('123456789012345678', CANAL), /não está nesse servidor/);
  const g = discordFalso({ naoConecta: true });
  const bot2 = new BotDiscord({ mixer: new MixerPCM(), carregar: g.carregar });
  await bot2.conectar(TOKEN);
  await assert.rejects(bot2.entrar(SERVIDOR, CANAL), /Não consegui entrar/);
  assert.equal(bot2.estado.voz, 'fora');
  await bot.desconectar(); await bot2.desconectar();
});

test('bot: tirado do canal sem voltar fica "fora" com aviso', async () => {
  const f = discordFalso();
  const bot = new BotDiscord({ mixer: new MixerPCM(), carregar: f.carregar });
  await bot.conectar(TOKEN);
  await bot.entrar(SERVIDOR, CANAL);
  f.reg.conexoes[0]._estado('disconnected');
  assert.equal(bot.estado.voz, 'reconectando');
  await espera(300);
  assert.equal(bot.estado.voz, 'fora');
  assert.match(bot.estado.erro, /saiu do canal/);
  await bot.desconectar();
});

// ---------------------------------------------------------------- controlador da música

async function montar(opc = {}) {
  const { Controlador } = require('../src/main/controlador');
  const { fabricaOBS } = require('./apoio');
  const dir = tmp('grpg-mctl-');
  const f = discordFalso(opc);
  const ctl = new Controlador({
    pastaDados: dir, WebSocket: fabricaOBS({ gravando: false }).WSFalso, portaOverlay: 0, intervaloReconexao: 60000,
    removerArquivo: async () => {}, notificar: () => {}, carregarDiscord: f.carregar,
  });
  await ctl.iniciar();
  // motor falso: responde ok e guarda os comandos
  const motor = { pedidos: [], aberturas: 0 };
  ctl.musica.on('abrir-motor', () => { motor.aberturas++; setTimeout(() => ctl.musica.motorPronto(), 10); });
  ctl.musica.on('motor', p => { motor.pedidos.push(p); setImmediate(() => ctl.musica.responderMotor(p.id, p.cmd === 'falhar' ? { erro: 'x' } : { ok: true })); });
  return { ctl, f, motor, dir };
}

test('música: tocar abre o motor na primeira vez e manda a faixa com endereço local', async () => {
  const { ctl, motor, dir } = await montar();
  try {
    const arq = path.join(dir, 'Tema do Chefe.mp3');
    fs.writeFileSync(arq, 'ID3');
    const { faixas } = ctl.musica.adicionarArquivos([arq]);
    const id = faixas[0].id;
    await ctl.musica.tocar(id);
    assert.equal(motor.aberturas, 1);
    const p = motor.pedidos.find(x => x.cmd === 'tocarSom');
    assert.equal(p.args[0].uuid, id);
    assert.equal(p.args[0].nome, 'Tema do Chefe');
    assert.match(p.args[0].src, /^http:\/\/127\.0\.0\.1:\d+\/midia\/[a-f0-9]+\.mp3$/);
    // o endereço serve o arquivo de verdade
    const corpo = await (await fetch(p.args[0].src)).text();
    assert.equal(corpo, 'ID3');
    assert.ok(motor.pedidos.some(x => x.cmd === 'volumeGeral' && x.args[0] === 0.8), 'volume das faixas aplicado ao abrir');
    // seções salvas vão para o motor (vale com a música tocando)
    ctl.musica.salvarSecoes(id, [{ nome: 'Loop', inicio: 0, termino: 5, acao: 'loop' }, { nome: 'Fim', inicio: 5, termino: 9 }], 9);
    await espera(10);
    const s = motor.pedidos.find(x => x.cmd === 'atualizarSecoes');
    assert.equal(s.args[0], id);
    assert.equal(s.args[1][0].acao, 'loop');
    await assert.rejects(ctl.musica.comando('rodarCodigo', []), /desconhecido/);
    await ctl.musica.comando('pararTudo', []);
    await assert.rejects(ctl.musica.tocarFila([]), /Marque/);
  } finally { await ctl.parar(); }
});

test('música: bot liga, entra no canal do StreamKit e fica ignorado nos retratos', async () => {
  const { ctl, f } = await montar();
  try {
    ctl.adicionarCanal(`https://streamkit.discord.com/overlay/voice/${SERVIDOR}/${CANAL}`, 'Sábado');
    // segunda mesa, para conferir que o bot é ignorado em todas
    const cfg = JSON.parse(JSON.stringify(ctl.cfg));
    cfg.mesas.push({ nome: 'Outra' });
    ctl.salvarConfig(cfg);
    assert.throws(() => ctl.musica.salvarToken('isso-nao-e-token'), /não parece um token/);
    ctl.musica.salvarToken(TOKEN);
    assert.equal(ctl.estadoPublico().musica.temToken, true);
    assert.match(ctl.estadoPublico().musica.convite, /client_id=999999999999999999/);
    await ctl.musica.ligarBot();
    const m = ctl.estadoPublico().musica;
    assert.equal(m.bot.etapa, 'online');
    assert.equal(m.bot.voz, 'no-canal', 'entrou sozinho no canal da mesa');
    assert.equal(f.reg.joins[0].channelId, CANAL);
    assert.equal(ctl.cfg.musica.botId, BOT_ID);
    assert.ok(ctl.cfg.mesas.every(x => x.ignorados.includes(BOT_ID)), 'bot ignorado em todas as mesas');
    // StreamKit vê o bot no canal: não aparece como pessoa desconhecida
    ctl.receberStreamKit([{ src: `https://cdn.discordapp.com/avatars/${BOT_ID}/x.png`, nome: 'Bardo', falando: true }]);
    assert.equal(ctl.estadoPublico().streamkit.desconhecidos.length, 0);
    // trocar o canal da mesa: o bot vai junto
    ctl.adicionarCanal(`https://streamkit.discord.com/overlay/voice/${SERVIDOR}/${CANAL2}`, 'Sala 2');
    await espera(80);
    assert.equal(ctl.estadoPublico().musica.bot.canal.canal, CANAL2);
    // canal fixo para o bot na mesa (diferente do StreamKit)
    const c2 = JSON.parse(JSON.stringify(ctl.cfg));
    c2.mesas.find(x => x.id === c2.mesaAtiva).musica.canal = `${SERVIDOR}/${CANAL}`;
    ctl.salvarConfig(c2);
    await espera(80);
    assert.equal(ctl.estadoPublico().musica.bot.canal.canal, CANAL);
    assert.equal(ctl.musica.canalAlvo().origem, 'mesa');
    ctl.musica.sair();
    assert.equal(ctl.estadoPublico().musica.bot.voz, 'fora');
    await ctl.musica.desligarBot();
    assert.equal(ctl.estadoPublico().musica.bot.etapa, 'desligado');
  } finally { await ctl.parar(); }
});

test('música: abas do navegador entram na mistura, cada uma com volume e mudo', async () => {
  const { ctl } = await montar();
  try {
    const cfg = JSON.parse(JSON.stringify(ctl.cfg));
    cfg.musica.volumeYoutube = 50;
    cfg.musica.volume = 100;
    ctl.salvarConfig(cfg);
    ctl.musica.abaAberta('a1', 'https://www.youtube.com/watch?v=x');
    ctl.musica.abaAberta('a2', 'https://tabletopaudio.com/');
    ctl.musica.abaMudou('a1', { titulo: 'Música de taverna', tocando: true, url: 'https://www.youtube.com/watch?v=y' });
    ctl.musica.pcm('aba:a1', tom(TAXA / 2, 10000));
    ctl.musica.pcm('aba:zz', tom(TAXA / 2, 10000));           // aba que não existe é ignorada
    ctl.musica.pcm('qualquer', tom(TAXA / 2, 10000));         // fonte estranha também
    let p = ctl.musica.mixer.pacote();
    assert.ok(Math.abs(pico(p) - 5000) < 300, `aba a 50% (volume do navegador): ${pico(p)}`);
    ctl.musica.volumeAba('a1', 0.5);
    ctl.musica.pcm('aba:a1', tom(TAXA / 2, 10000));
    p = ctl.musica.mixer.pacote();
    assert.ok(Math.abs(pico(p) - 2500) < 300, `volume da aba: ${pico(p)}`);
    ctl.musica.volumeAba('a1', null, true);
    assert.equal(pico(ctl.musica.mixer.pacote()), 0, 'aba no mudo');
    const m = ctl.estadoPublico().musica;
    assert.deepEqual(m.abas.map(a => a.id), ['a1', 'a2']);
    assert.equal(m.abas[0].titulo, 'Música de taverna');
    assert.equal(m.abas[0].tocando, true);
    assert.equal(m.abaAtiva, 'a2');
    ctl.musica.abaFechou('a2');
    assert.equal(ctl.estadoPublico().musica.abaAtiva, 'a1');
    assert.ok(!ctl.musica.mixer.fontes.has('aba:a2'), 'fonte da aba fechada sai do mixer');
    assert.throws(() => ctl.musica.volumeAba('a2', 1), /não encontrada/);
    // prévia: escutar só aqui no PC, depois soltar para o Discord
    const ouvidos = [];
    ctl.musica.on('ouvir-aba', (id, v) => ouvidos.push([id, v]));
    ctl.musica.volumeAba('a1', null, null, true);
    assert.deepEqual(ouvidos, [['a1', true]], 'aba passa a tocar no PC');
    assert.equal(ctl.musica.ouvirAba('a1'), true);
    const c2 = JSON.parse(JSON.stringify(ctl.cfg));
    c2.musica.abasNovas = 'previa';
    ctl.salvarConfig(c2);
    const nova = ctl.musica.abaAberta('a9', 'https://youtube.com/');
    assert.equal(nova.mudo, true, 'aba nova em prévia: fora do Discord');
    assert.equal(nova.ouvir, true, 'e tocando no PC');
    ctl.musica.pcm('aba:a9', tom(TAXA / 2, 10000));
    assert.equal(pico(ctl.musica.mixer.pacote()), 0, 'Discord não ouve a prévia');
    ctl.musica.volumeAba('a9', null, false);
    ctl.musica.pcm('aba:a9', tom(TAXA / 2, 10000));
    assert.ok(pico(ctl.musica.mixer.pacote()) > 4000, 'liberou: Discord ouve');
  } finally { await ctl.parar(); }
});

test('navegador: barra de endereço entende link, site e busca', () => {
  const { paraEndereco, enderecoPermitido } = require('../src/core/musica/endereco');
  assert.equal(paraEndereco('https://youtu.be/abc?t=10'), 'https://youtu.be/abc?t=10');
  assert.equal(paraEndereco('youtu.be/abc'), 'https://youtu.be/abc');
  assert.equal(paraEndereco('tabletopaudio.com'), 'https://tabletopaudio.com/');
  assert.equal(paraEndereco('música de taverna'), 'https://www.youtube.com/results?search_query=m%C3%BAsica%20de%20taverna');
  assert.equal(paraEndereco('epic.boss'), 'https://epic.boss/');
  assert.equal(paraEndereco(''), 'https://www.youtube.com/');
  assert.equal(enderecoPermitido('javascript:alert(1)'), false);
  assert.equal(enderecoPermitido('file:///C:/x'), false);
  assert.equal(enderecoPermitido('https://a.com'), true);
});

test('navegador: o código da captura no preload é igual ao do motor', () => {
  const w = fs.readFileSync(path.join(__dirname, '..', 'src', 'musica', 'captura-worklet.js'), 'utf8');
  const p = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'navegador-preload.js'), 'utf8');
  const corpo = w.slice(w.indexOf('class CapturaGravadorRPG')).trim();
  const copia = p.slice(p.indexOf('// INICIO-WORKLET') + 17, p.indexOf('// FIM-WORKLET')).trim();
  assert.equal(copia, corpo);
});

test('música: motor que não responde dá erro claro; motor que reinicia rejeita pendentes', async () => {
  const { Controlador } = require('../src/main/controlador');
  const { fabricaOBS } = require('./apoio');
  const dir = tmp('grpg-mctl-');
  const ctl = new Controlador({ pastaDados: dir, WebSocket: fabricaOBS({ gravando: false }).WSFalso, portaOverlay: 0, intervaloReconexao: 60000, removerArquivo: async () => {}, notificar: () => {} });
  await ctl.iniciar();
  try {
    ctl.musica.motorPronto();
    const p = ctl.musica.comando('pararTudo', []);
    ctl.musica.motorCaiu();
    await assert.rejects(p, /reiniciou/);
    assert.equal(ctl.estadoPublico().musica.motor.pronto, false);
  } finally { await ctl.parar(); }
});
