'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Controlador } = require('../src/main/controlador');
const { lerSessao } = require('../src/core/sessao');
const { padraoJogador, mesaAtiva } = require('../src/core/config');
const { fabricaOBS } = require('./apoio');

const ID1 = '187691838138400768', ID2 = '298765432109876543', BOT = '400000000000000001';
const esperar = ms => new Promise(r => setTimeout(r, ms));
async function ate(cond, ms = 1500) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (cond()) return; await esperar(5); }
  throw new Error('condição não aconteceu a tempo');
}

async function novo(t, opcoesOBS = {}, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-ctl-'));
  const f = fabricaOBS({ gravando: false, ...opcoesOBS });
  const removidos = [], avisos = [];
  const c = new Controlador({
    pastaDados: dir, WebSocket: f.WSFalso, portaOverlay: 0, intervaloReconexao: 60000,
    removerArquivo: async (cam, destino) => { removidos.push({ cam, destino }); fs.unlinkSync(cam); },
    notificar: (t, x) => avisos.push(t + ' | ' + x),
    ...extra,
  });
  t.after(() => c.parar());
  await c.iniciar();
  await ate(() => c.obsInfo.conectado && c.obsInfo.versao);
  return { c, f, dir, removidos, avisos };
}

function comJogadores(c) {
  const cfg = JSON.parse(JSON.stringify(c.cfg));
  const m = mesaAtiva(cfg);
  m.nome = 'Nauren';
  m.jogadores = [
    padraoJogador({ personagem: 'Kael', jogador: 'Ana', discordId: ID1 }),
    padraoJogador({ personagem: 'Iris', jogador: 'Beto', discordNome: 'beto' }),
  ];
  return c.salvarConfig(cfg);
}

test('controlador: conecta, publica overlay e estado para a interface', async t => {
  const { c } = await novo(t);
  comJogadores(c);
  const est = c.estadoPublico();
  assert.equal(est.obs.conectado, true);
  assert.equal(est.obs.versao, '31.0.0');
  assert.match(est.overlayUrl, /^http:\/\/127\.0\.0\.1:\d+\/overlay$/);
  assert.equal(c.servidor.estado.pessoas.length, 2);
  assert.equal(est.streamkit.configurado, false);
  await c.parar();
});

test('controlador: StreamKit acende quem fala e lista desconhecidos', async t => {
  const { c } = await novo(t);
  comJogadores(c);
  c.receberStreamKit([
    { src: `https://cdn.discordapp.com/avatars/${ID1}/a.png`, nome: 'ana', falando: true },
    { src: 'https://cdn.discordapp.com/embed/avatars/1.png', nome: 'Beto', falando: false },
    { src: `https://cdn.discordapp.com/avatars/${BOT}/b.png`, nome: 'Bot de Música', falando: true },
  ]);
  const v = c.servidor.estado;
  assert.deepEqual(v.pessoas.map(p => [p.nome, p.falando]), [['Kael', true], ['Iris', false]]);
  let est = c.estadoPublico();
  assert.equal(est.streamkit.conectado, true);
  assert.deepEqual(est.streamkit.desconhecidos.map(d => d.nome), ['Bot de Música']);
  c.ignorarDetectado(BOT);
  est = c.estadoPublico();
  assert.equal(est.streamkit.desconhecidos.length, 0);
  c.adicionarDetectado('', 'Visitante');
  assert.equal(c.mesa.jogadores.at(-1).jogador, 'Visitante');
  await c.parar();
});

test('controlador: gravação abre sessão, marca, registra pedaços e fecha', async t => {
  const { c, f, avisos } = await novo(t);
  comJogadores(c);
  assert.equal((await c.marcar('cedo')).ok, false, 'sem gravação não marca');
  await c.alternarGravacao();
  await ate(() => c.sessao);
  c.receberStreamKit([{ src: `https://cdn.discordapp.com/avatars/${ID1}/a.png`, nome: 'ana', falando: true }]);
  await esperar(250); // uma fala de verdade, não ruído
  const r = await c.marcar('Crítico do Kael');
  assert.equal(r.ok, true);
  assert.equal(r.noArquivo, true);
  assert.ok(f.pedidos.some(p => p.requestType === 'CreateRecordChapter' && p.requestData.chapterName === 'Crítico do Kael'));
  assert.equal(avisos.length, 1);
  f.socket().evento('RecordFileChanged', { newOutputPath: 'D:/Gravacoes/sessao-2.mp4' });
  await ate(() => c.obsInfo.arquivo === 'D:/Gravacoes/sessao-2.mp4');
  c.receberStreamKit([{ src: `https://cdn.discordapp.com/avatars/${ID1}/a.png`, nome: 'ana', falando: false }]);
  const pasta = c.sessao.dir;
  assert.equal(c.estadoPublico().sessao.marcadores[0].nome, 'Crítico do Kael');
  await c.alternarGravacao();
  await ate(() => !c.sessao);
  const s = lerSessao(path.join(pasta, 'linha-do-tempo.jsonl'));
  assert.equal(s.mesa.nome, 'Nauren');
  assert.equal(s.marcadores[0].nome, 'Crítico do Kael');
  assert.equal(s.falas.length, 1);
  assert.equal(s.falas[0].chave, c.mesa.jogadores[0].id, 'fala guardada pelo id do jogador');
  assert.deepEqual(s.arquivos.map(a => a.caminho), ['D:/Gravacoes/sessao.mp4', 'D:/Gravacoes/sessao-2.mp4']);
  await c.parar();
});

test('controlador: app aberto com o OBS já gravando abre sessão sozinho', async t => {
  const { c } = await novo(t, { gravando: true });
  await ate(() => c.sessao);
  assert.ok(Date.now() - c.sessao.inicio >= 590000, 'início puxado para trás pela duração');
  await c.parar();
});

test('controlador: capítulo sem suporte avisa mas marca na linha do tempo', async t => {
  const { c } = await novo(t, { recusar: new Set(['CreateRecordChapter']) });
  await c.alternarGravacao();
  await ate(() => c.sessao);
  const r = await c.marcar('');
  assert.equal(r.ok, true);
  assert.equal(r.noArquivo, false);
  await c.parar();
});

test('controlador: replay desligado no OBS dá instrução clara', async t => {
  const { c } = await novo(t, { recusar: new Set(['SaveReplayBuffer']) });
  const r = await c.salvarReplay();
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /Buffer de replay/);
  await c.parar();
});

test('controlador: mudar link do StreamKit e atalhos avisa o main', async t => {
  const { c } = await novo(t);
  const eventos = [];
  c.on('streamkit-url', u => eventos.push(['sk', u]));
  c.on('atalhos', a => eventos.push(['at', a.marcar]));
  const cfg = JSON.parse(JSON.stringify(c.cfg));
  mesaAtiva(cfg).streamkit.url = `https://streamkit.discord.com/overlay/voice/${ID1}/${ID2}`;
  cfg.atalhos.marcar = 'F8';
  c.salvarConfig(cfg);
  assert.equal(eventos.length, 2);
  assert.match(eventos.find(e => e[0] === 'sk')[1], /icon=true/);
  assert.deepEqual(eventos.find(e => e[0] === 'at'), ['at', 'F8']);
  await c.parar();
});

test('controlador: imagem é copiada para a pasta do app e validada', async t => {
  const { c, dir } = await novo(t);
  const origem = path.join(dir, 'kael.PNG');
  fs.writeFileSync(origem, 'png');
  const nome = c.importarImagem(origem, 'abc123');
  assert.match(nome, /^abc123-\d+\.png$/);
  assert.ok(fs.existsSync(path.join(c.pastaImagens, nome)));
  fs.writeFileSync(path.join(dir, 'virus.exe'), 'x');
  assert.throws(() => c.importarImagem(path.join(dir, 'virus.exe'), 'a'), /Formato/);
  await c.parar();
});

test('controlador: limpeza respeita limite e marcadores, usando a Lixeira por padrão', async t => {
  let relogio = Date.now();
  const { c, dir, removidos } = await novo(t, {}, { agora: () => relogio });
  const H = 3600000;
  const base = relogio - 30 * H;
  for (let i = 0; i < 24; i++) {
    const cam = path.join(dir, `p${i}.mp4`);
    fs.writeFileSync(cam, 'x');
    const fim = new Date(base + (i + 1) * H / 2);
    fs.utimesSync(cam, fim, fim);
    c.registro.adicionar(cam, base + i * H / 2);
  }
  c.marcadoresAbs.push({ t: base + 0.5 * H + 60000, nome: 'importante' });   // dentro do p1
  const plano = c.simularLimpeza();
  assert.ok(Math.abs(plano.totalHoras - 12) < 0.001);
  const r = await c.limpar();
  assert.deepEqual(r.feitos.map(x => path.basename(x)), ['p2.mp4', 'p3.mp4', 'p4.mp4', 'p5.mp4']);
  assert.ok(removidos.every(x => x.destino === 'lixeira'));
  assert.ok(fs.existsSync(path.join(dir, 'p0.mp4')) && fs.existsSync(path.join(dir, 'p1.mp4')), 'p0/p1 protegidos pelo marcador');
  assert.equal(c.estadoPublico().disco.acimaDoLimite, false);
  await c.parar();
});

test('controlador: StreamKit some → overlay volta a mostrar todos', async t => {
  let relogio = Date.now();
  const { c } = await novo(t, {}, { agora: () => relogio });
  comJogadores(c);
  c.receberStreamKit([{ src: `https://cdn.discordapp.com/avatars/${ID1}/a.png`, nome: 'ana', falando: false }]);
  assert.equal(c.servidor.estado.pessoas.length, 1);
  relogio += 10000;
  c._tique();
  assert.equal(c.sk.conectado, false);
  assert.equal(c.servidor.estado.pessoas.length, 2);
  await c.parar();
});

test('controlador: OBS não diz o primeiro arquivo; o app acha na pasta de gravação', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-obs-'));
  fs.writeFileSync(path.join(pasta, 'antigo.mp4'), 'velho');
  const antigo = new Date(Date.now() - 3600000);
  fs.utimesSync(path.join(pasta, 'antigo.mp4'), antigo, antigo);
  const arquivo = path.join(pasta, '2026-10-25 20-00-00.mp4');
  const { c } = await novo(t, { caminhoNoInicio: false, pasta, arquivo });
  await c.alternarGravacao();
  await ate(() => c.sessao);
  fs.writeFileSync(arquivo, 'gravando');              // o OBS cria o arquivo logo depois
  await ate(() => c.sessao && c.sessao.arquivos.length, 6000);
  assert.equal(c.sessao.arquivos[0].caminho, arquivo, 'achou o arquivo novo, não o antigo');
  assert.equal(c.obsInfo.arquivo, arquivo);
  const sessao = c.sessao;
  await c.alternarGravacao();
  await ate(() => !c.sessao);
  assert.equal(sessao.arquivos.length, 1, 'o fim não duplica o arquivo');
  assert.deepEqual(c.registro.itens.map(i => i.caminho), [arquivo]);
});

test('controlador: sem achar na pasta, o arquivo do fim entra como o da sessão inteira', async t => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-obs-'));
  const { c } = await novo(t, { caminhoNoInicio: false, pasta, arquivo: path.join(pasta, 'x.mp4') });
  await c.alternarGravacao();
  await ate(() => c.sessao);
  const s = c.sessao;
  await c.alternarGravacao();
  await ate(() => !c.sessao);
  assert.deepEqual(s.arquivos.map(a => a.caminho), [path.join(pasta, 'x.mp4')]);
  assert.equal(s.arquivos[0].t, s.inicio);
});

test('controlador: reconectar depois que o OBS parou de gravar fecha a sessão', async t => {
  const { c, f } = await novo(t);
  await c.alternarGravacao();
  await ate(() => c.sessao);
  const antiga = c.sessao;
  f.obs.gravando = false;                    // parou enquanto a conexão estava caída
  f.socket().onclose({ code: 1006 });
  await c.obs.iniciar(c.cfg.obs);
  await ate(() => !c.sessao);
  assert.equal(antiga.encerrada, true);
});
