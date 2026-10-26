'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cfg = require('../src/core/config');
const { resolverNome, casarPresencas, vistaOverlay, iniciais } = require('../src/core/pessoas');
const sk = require('../src/core/streamkit');
const { Sessao, lerSessao, juntarFalas, formatarTempo } = require('../src/core/sessao');
const { planejar, RegistroSegmentos, executar, GB } = require('../src/core/limpeza');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-'));
const ID1 = '187691838138400768', ID2 = '298765432109876543', ID3 = '311111111111111111';

// ------------------------------------------------------------------ config
test('config: arquivo inexistente vira padrão completo', () => {
  const a = new cfg.ArmazemConfig(path.join(tmp(), 'config.json'));
  const c = a.carregar();
  assert.equal(c.mesas.length, 1);
  assert.equal(c.mesaAtiva, c.mesas[0].id);
  assert.equal(c.gravacao.limiteHoras, 10);
  assert.equal(c.atalhos.marcar, 'F9');
  assert.equal(c.mesas[0].overlay.ativo, true);
});

test('config: valores inválidos são corrigidos, não quebram', () => {
  const c = cfg.normalizar({
    mesaAtiva: 'nao-existe',
    obs: { porta: 'abc', host: '' },
    gravacao: { limiteHoras: -5, limiteGB: 1e9, destino: 'fogueira' },
    mesas: [{ nome: '   ', overlay: { layout: 'xyz', tamanho: 9999, ativo: 'sim' }, nomes: { modo: 'apelido' },
      jogadores: [{ discordId: 'abc', imagem: '../../windows/system32/x.png', cor: 'vermelho', foco: { x: 500 } }, null] }],
  });
  const m = c.mesas[0];
  assert.equal(c.mesaAtiva, m.id);
  assert.equal(c.obs.porta, 4455);
  assert.equal(c.obs.host, '127.0.0.1');
  assert.equal(c.gravacao.limiteHoras, 1);
  assert.equal(c.gravacao.limiteGB, 4000);
  assert.equal(c.gravacao.destino, 'lixeira');
  assert.equal(m.nome, 'Minha mesa');
  assert.equal(m.overlay.ancora, 'baixo');
  assert.equal(m.overlay.direcao, 'horizontal');
  assert.equal(m.overlay.tamanho, 400);
  assert.equal(m.overlay.ativo, true);
  assert.equal(m.nomes.modo, 'personagem');
  assert.equal(m.jogadores.length, 2);
  assert.equal(m.jogadores[0].discordId, '');
  assert.equal(m.jogadores[0].imagem, '', 'caminho com pastas é recusado');
  assert.equal(m.jogadores[0].cor, '#F0B44C');
  assert.equal(m.jogadores[0].foco.x, 100);
});

test('config: arquivo corrompido é guardado e o app recomeça', () => {
  const dir = tmp();
  const arq = path.join(dir, 'config.json');
  fs.writeFileSync(arq, '{ isso não é json');
  const c = new cfg.ArmazemConfig(arq).carregar();
  assert.equal(c.mesas.length, 1);
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('config.json.corrompido-')));
});

test('config: salvar e carregar dá o mesmo resultado', () => {
  const arq = path.join(tmp(), 'sub', 'config.json');
  const a = new cfg.ArmazemConfig(arq);
  const c = a.carregar();
  c.mesas[0].jogadores.push(cfg.padraoJogador({ personagem: 'Kael', discordId: ID1, imagem: 'abc_1.png' }));
  a.salvar(c);
  const b = new cfg.ArmazemConfig(arq).carregar();
  assert.deepEqual(b, a.dados);
  assert.equal(b.mesas[0].jogadores[0].imagem, 'abc_1.png');
});

test('config: ids repetidos de mesas e jogadores são separados', () => {
  const j = cfg.padraoJogador();
  const c = cfg.normalizar({ mesas: [{ id: 'aaaaaa', jogadores: [j, { ...j }] }, { id: 'aaaaaa' }] });
  assert.notEqual(c.mesas[0].id, c.mesas[1].id);
  assert.notEqual(c.mesas[0].jogadores[0].id, c.mesas[0].jogadores[1].id);
});

// ------------------------------------------------------------------ nomes
const kael = { personagem: 'Kael', jogador: 'Ana', discordNome: 'ana_rpg', nomeModo: 'padrao', nomeTexto: '' };

test('nomes: cada modo da mesa', () => {
  assert.equal(resolverNome(kael, { modo: 'personagem' }), 'Kael');
  assert.equal(resolverNome(kael, { modo: 'jogador' }), 'Ana');
  assert.equal(resolverNome(kael, { modo: 'discord' }), 'ana_rpg');
  assert.equal(resolverNome(kael, { modo: 'personagem-jogador' }), 'Kael (Ana)');
  assert.equal(resolverNome(kael, { modo: 'nenhum' }), '');
});

test('nomes: exceção por jogador vence o padrão da mesa', () => {
  assert.equal(resolverNome({ ...kael, nomeModo: 'jogador' }, { modo: 'personagem' }), 'Ana');
  assert.equal(resolverNome({ ...kael, nomeModo: 'nenhum' }, { modo: 'personagem' }), '');
  assert.equal(resolverNome({ ...kael, nomeModo: 'personalizado', nomeTexto: 'Narrador' }, { modo: 'nenhum' }), 'Narrador');
});

test('nomes: campo vazio cai para o próximo que existir', () => {
  assert.equal(resolverNome({ ...kael, personagem: '' }, { modo: 'personagem' }), 'Ana');
  assert.equal(resolverNome({ ...kael, personagem: '', jogador: '' }, { modo: 'personagem' }), 'ana_rpg');
  assert.equal(resolverNome({ personagem: '', jogador: '', discordNome: '' }, { modo: 'personagem' }, 'AoVivo'), 'AoVivo');
  assert.equal(resolverNome({ ...kael, jogador: '' }, { modo: 'personagem-jogador' }), 'Kael');
  assert.equal(resolverNome({ ...kael, nomeModo: 'personalizado', nomeTexto: '  ' }, { modo: 'jogador' }), 'Ana');
});

test('iniciais', () => {
  assert.equal(iniciais('Kael'), 'K');
  assert.equal(iniciais('Mira da Silva'), 'MS');
  assert.equal(iniciais(''), '?');
});

// ------------------------------------------------------------------ casar + overlay
function mesaTeste() {
  const m = cfg.normalizarMesa({});
  m.jogadores = [
    cfg.normalizarJogador({ personagem: 'Kael', jogador: 'Ana', discordId: ID1, imagem: 'kael.png' }),
    cfg.normalizarJogador({ personagem: 'Iris', jogador: 'Beto', discordNome: 'Beto#Gamer' }),
    cfg.normalizarJogador({ personagem: 'Bram', jogador: 'Caio', discordId: ID3 }),
  ];
  return m;
}

test('casar: por ID primeiro, depois por nome (sem diferenciar maiúsculas)', () => {
  const m = mesaTeste();
  const pres = [
    { discordId: ID1, nome: 'qualquer', falando: true },
    { discordId: ID2, nome: 'beto#gamer', falando: false },
    { discordId: '999999999999999999', nome: 'Visitante', falando: false },
  ];
  const { porJogador, desconhecidos } = casarPresencas(m, pres);
  assert.equal(porJogador.get(m.jogadores[0].id).discordId, ID1);
  assert.equal(porJogador.get(m.jogadores[1].id).discordId, ID2);
  assert.equal(porJogador.has(m.jogadores[2].id), false);
  assert.deepEqual(desconhecidos.map(d => d.nome), ['Visitante']);
});

test('casar: ignorados (ex.: o bot de música) somem', () => {
  const m = mesaTeste();
  m.ignorados = ['999999999999999999'];
  const { desconhecidos } = casarPresencas(m, [{ discordId: '999999999999999999', nome: 'Bot', falando: true }]);
  assert.equal(desconhecidos.length, 0);
});

test('overlay: sem StreamKit todos aparecem, ninguém falando', () => {
  const v = vistaOverlay(mesaTeste(), [], { conectado: false });
  assert.equal(v.pessoas.length, 3);
  assert.ok(v.pessoas.every(p => p.presente && !p.falando));
  assert.equal(v.pessoas[0].imagem, '/img/kael.png');
  assert.equal(v.pessoas[1].imagem, '');
});

test('overlay: com StreamKit, ausentes somem e quem fala acende', () => {
  const v = vistaOverlay(mesaTeste(), [{ discordId: ID1, nome: 'x', falando: true }], { conectado: true });
  assert.deepEqual(v.pessoas.map(p => p.nome), ['Kael']);
  assert.equal(v.pessoas[0].falando, true);
});

test('overlay: ausentes ficam quando ocultarAusentes desligado', () => {
  const m = mesaTeste();
  m.overlay.ocultarAusentes = false;
  const v = vistaOverlay(m, [{ discordId: ID1, nome: 'x', falando: false }], { conectado: true });
  assert.equal(v.pessoas.length, 3);
  assert.deepEqual(v.pessoas.map(p => p.presente), [true, false, false]);
});

test('overlay: nome só de quem fala', () => {
  const m = mesaTeste();
  m.nomes.quando = 'falando';
  m.overlay.ocultarAusentes = false;
  const v = vistaOverlay(m, [{ discordId: ID1, nome: 'x', falando: true }], { conectado: true });
  assert.deepEqual(v.pessoas.map(p => p.nome), ['Kael', '', '']);
});

test('overlay: desligado continua mandando ativo=false', () => {
  const m = mesaTeste();
  m.overlay.ativo = false;
  assert.equal(vistaOverlay(m, []).ativo, false);
});

// ------------------------------------------------------------------ streamkit
test('streamkit: link válido ganha icon e online', () => {
  const r = sk.validarUrl(`https://streamkit.discord.com/overlay/voice/${ID1}/${ID2}?icon=false&text_size=14`);
  assert.equal(r.ok, true);
  const u = new URL(r.url);
  assert.equal(u.searchParams.get('icon'), 'true');
  assert.equal(u.searchParams.get('online'), 'true');
  assert.equal(u.searchParams.get('text_size'), '14');
  assert.equal(r.servidor, ID1);
});

test('streamkit: links errados dão mensagem clara', () => {
  assert.match(sk.validarUrl('').erro, /link/);
  assert.match(sk.validarUrl('https://discord.com/channels/1/2').erro, /streamkit/);
  assert.match(sk.validarUrl(`https://streamkit.discord.com/overlay/chat/${ID1}/${ID2}`).erro, /Voice Widget/);
  assert.equal(sk.validarUrl(`http://streamkit.discord.com/overlay/voice/${ID1}/${ID2}`).ok, false);
});

test('streamkit: interpretar pega id da imagem ou do reactid, e quem fala', () => {
  const r = sk.interpretar([
    { src: `https://cdn.discordapp.com/avatars/${ID1}/abc.png`, nome: 'Ana', falando: true },
    { reactid: `.0.0.$${ID2}`, src: 'https://cdn.discordapp.com/embed/avatars/2.png', nome: 'Beto', falando: false },
    { src: 'https://cdn.discordapp.com/embed/avatars/1.png', nome: 'SemFoto', falando: false },
    { src: `https://cdn.discordapp.com/avatars/${ID1}/abc.png`, nome: 'Ana', falando: true },
    { src: '', nome: '' },
    null,
  ]);
  assert.deepEqual(r, [
    { discordId: ID1, nome: 'Ana', falando: true },
    { discordId: ID2, nome: 'Beto', falando: false },
    { discordId: '', nome: 'SemFoto', falando: false },
  ]);
  assert.deepEqual(sk.interpretar('lixo'), []);
});

// ------------------------------------------------------------------ sessão
test('sessão: registra falas, marcadores e lê de volta juntando pausas curtas', () => {
  const dir = tmp();
  const t0 = 1_700_000_000_000;
  const s = new Sessao(dir, { inicio: t0, mesa: { id: 'm', nome: 'Nauren' } });
  s.estado([{ chave: ID1, falando: true }], t0 + 1000);
  s.estado([{ chave: ID1, falando: false }], t0 + 2000);
  s.estado([{ chave: ID1, falando: true }], t0 + 2200);   // pausa de 200 ms: mesma fala
  s.estado([{ chave: ID1, falando: true }, { chave: ID2, falando: true }], t0 + 3000);
  s.estado([], t0 + 4000);
  s.estado([{ chave: ID2, falando: true }], t0 + 5000);
  s.estado([], t0 + 5050);                                // 50 ms: ruído
  const m = s.marcar('Crítico do Kael', 'atalho', t0 + 3_725_000);
  assert.equal(m.tempo, '01:02:05');
  s.arquivoGravacao('D:/rec/a.mp4', t0);
  s.renomearMarcador(m.t, 'Crítico!');
  s.encerrar(t0 + 10_000);
  s.marcar('depois do fim');                              // ignorado
  const lido = lerSessao(s.arquivo);
  assert.equal(lido.inicio, t0);
  assert.deepEqual(lido.falas, [
    { chave: ID1, ini: t0 + 1000, fim: t0 + 4000 },
    { chave: ID2, ini: t0 + 3000, fim: t0 + 4000 },
  ]);
  assert.equal(lido.marcadores.length, 1);
  assert.equal(lido.marcadores[0].nome, 'Crítico!');
  assert.equal(lido.arquivos[0].caminho, 'D:/rec/a.mp4');
});

test('sessão: arquivo cortado por queda de energia ainda é lido', () => {
  const dir = tmp();
  const s = new Sessao(dir, { inicio: 1000 });
  s.estado([{ chave: 'a', falando: true }], 2000);
  s.pulso(9000);
  fs.appendFileSync(s.arquivo, '{"tipo":"fala-fim","t":30');  // linha pela metade
  const lido = lerSessao(s.arquivo);
  assert.equal(lido.falas.length, 1);
  assert.equal(lido.falas[0].ini, 2000);
  assert.equal(lido.falas[0].fim, 9000);
  assert.equal(lido.fim, 9000);
});

test('sessão: duas sessões no mesmo segundo não se sobrescrevem', () => {
  const dir = tmp();
  const a = new Sessao(dir, { inicio: 5000 });
  const b = new Sessao(dir, { inicio: 5000 });
  assert.notEqual(a.dir, b.dir);
});

test('juntarFalas e formatarTempo', () => {
  assert.deepEqual(juntarFalas([{ chave: 'a', ini: 0, fim: 100 }]), []);
  assert.equal(formatarTempo(0), '00:00:00');
  assert.equal(formatarTempo(36_610_000), '10:10:10');
});

// ------------------------------------------------------------------ limpeza
const H = 3600000, MIN = 60000;
function pedacos(n, inicio = 0, tamanhoGB = 1) {
  return Array.from({ length: n }, (_, i) => ({
    caminho: `p${i}.mp4`, inicio: inicio + i * 30 * MIN, fim: inicio + (i + 1) * 30 * MIN, tamanho: tamanhoGB * GB,
  }));
}

test('limpeza: dentro do limite não apaga nada', () => {
  const p = planejar({ segmentos: pedacos(4), limiteHoras: 10, limiteGB: 40, agora: 100 * H });
  assert.deepEqual(p.apagar, []);
  assert.equal(p.totalHoras, 2);
});

test('limpeza: acima do limite apaga do mais antigo até caber', () => {
  const p = planejar({ segmentos: pedacos(24), limiteHoras: 10, limiteGB: 1000, agora: 100 * H });
  assert.deepEqual(p.apagar, ['p0.mp4', 'p1.mp4', 'p2.mp4', 'p3.mp4']);
  assert.equal(p.depoisHoras, 10);
  assert.equal(p.acimaDoLimite, false);
});

test('limpeza: limite de GB também vale', () => {
  const p = planejar({ segmentos: pedacos(6, 0, 10), limiteHoras: 100, limiteGB: 35, agora: 100 * H });
  assert.deepEqual(p.apagar, ['p0.mp4', 'p1.mp4', 'p2.mp4']);
});

test('limpeza: marcador protege o pedaço e o vizinho de antes', () => {
  // marcador 1 min dentro do pedaço 2: o clipe pode começar no pedaço 1
  const p = planejar({ segmentos: pedacos(24), marcadores: [60 * MIN + MIN], limiteHoras: 10, limiteGB: 1000, agora: 100 * H });
  assert.ok(!p.apagar.includes('p1.mp4'));
  assert.ok(!p.apagar.includes('p2.mp4'));
  assert.deepEqual(p.apagar, ['p0.mp4', 'p3.mp4', 'p4.mp4', 'p5.mp4']);
  assert.ok(p.protegidos.includes('p1.mp4') && p.protegidos.includes('p2.mp4'));
});

test('limpeza: nunca apaga o que está gravando nem o recém-modificado', () => {
  const seg = pedacos(3);
  const agora = seg[2].fim + 10_000;
  const p = planejar({ segmentos: seg, limiteHoras: 0.1, limiteGB: 0.1, agora, gravando: 'p0.mp4' });
  assert.deepEqual(p.apagar, ['p1.mp4']);
  assert.equal(p.acimaDoLimite, true);
});

test('limpeza: registro só conhece o que o OBS avisou e esquece o que sumiu', async () => {
  const dir = tmp();
  const a = path.join(dir, 'a.mp4'), b = path.join(dir, 'b.mp4'), outro = path.join(dir, 'ferias.mp4');
  for (const f of [a, b, outro]) fs.writeFileSync(f, 'x'.repeat(10));
  const reg = new RegistroSegmentos(path.join(dir, 'reg.json'));
  reg.adicionar(a, 1000);
  reg.adicionar(b, 2000);
  reg.adicionar(a, 5000);                       // repetido: ignorado
  assert.equal(reg.segmentos().length, 2);
  fs.unlinkSync(b);
  assert.deepEqual(reg.segmentos().map(s => s.caminho), [a]);
  const reg2 = new RegistroSegmentos(path.join(dir, 'reg.json'));
  assert.equal(reg2.itens.length, 1);
  const r = await executar({ apagar: [a] }, reg2, async c => fs.unlinkSync(c));
  assert.deepEqual(r.feitos, [a]);
  assert.ok(fs.existsSync(outro), 'arquivo fora do registro nunca é tocado');
  const r2 = await executar({ apagar: ['nao-existe.mp4'] }, reg2, async c => fs.unlinkSync(c));
  assert.equal(r2.falhas.length, 1);
});

test('limpeza: mesmo arquivo com / e \\ (OBS x Windows) conta uma vez só', () => {
  const { normalizarCaminho, chaveCaminho, mesmoArquivo } = require('../src/core/limpeza');
  assert.equal(normalizarCaminho('C:/Users/G/Videos/a.mkv', 'win32'), 'C:\\Users\\G\\Videos\\a.mkv');
  assert.ok(mesmoArquivo('C:/Users/G/Videos/a.mkv', 'c:\\users\\g\\videos\\A.MKV', 'win32'));
  assert.ok(!mesmoArquivo('C:/a.mkv', 'C:/b.mkv', 'win32'));
  assert.equal(chaveCaminho('/home/x/A.mp4', 'linux'), '/home/x/A.mp4', 'fora do Windows maiúsculas importam');
});

test('limpeza: cortes salvos e arquivos em exportação ficam protegidos', () => {
  const seg = pedacos(24);
  const p = planejar({ segmentos: seg, protecoes: [[2 * H + 10 * MIN, 2 * H + 20 * MIN]], intocaveis: ['p0.mp4'], limiteHoras: 10, limiteGB: 1000, agora: 100 * H, antesMs: 0, depoisMs: 0 });
  assert.ok(!p.apagar.includes('p0.mp4'), 'em exportação');
  assert.ok(!p.apagar.includes('p4.mp4'), 'dentro de um corte salvo');
  assert.deepEqual(p.apagar, ['p1.mp4', 'p2.mp4', 'p3.mp4', 'p5.mp4']);
  const m = planejar({ segmentos: seg, marcadores: [5 * H], antesMs: 5 * 60000 + 2 * 3600000, depoisMs: 0, limiteHoras: 10, limiteGB: 1000, agora: 100 * H });
  assert.ok(!m.apagar.includes('p6.mp4') && !m.apagar.includes('p9.mp4'), 'antes maior protege mais pedaços para trás');
});

test('pausas: sessão ↔ gravação, e a sessão registra pausa e retomada', () => {
  const P = require('../src/core/pausas');
  const pausas = [[10000, 15000], [30000, 32000]];
  assert.equal(P.paraGravacao(5000, pausas), 5000);
  assert.equal(P.paraGravacao(12000, pausas), 10000, 'dentro da pausa: começo dela');
  assert.equal(P.paraGravacao(20000, pausas), 15000);
  assert.equal(P.paraGravacao(40000, pausas), 33000);
  for (const ms of [0, 5000, 15000, 20000, 32000, 40000]) assert.equal(P.paraSessao(P.paraGravacao(ms, pausas), pausas), ms, `ida e volta ${ms}`);
  const dir = tmp();
  const s = new Sessao(dir, { inicio: 1000 });
  s.pausa(11000); s.pausa(12000); s.retoma(16000); s.pausa(20000);
  s.encerrar(25000);
  assert.deepEqual(lerSessao(s.arquivo).pausas, [[10000, 15000], [19000, 24000]]);
});
