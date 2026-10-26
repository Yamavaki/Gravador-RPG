'use strict';
// Atualizar o app nunca pode perder o que a pessoa já configurou.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfgMod = require('../src/core/config');

const L1 = 'https://streamkit.discord.com/overlay/voice/187691838138400768/298765432109876543?icon=true&online=true';
const L2 = 'https://streamkit.discord.com/overlay/voice/187691838138400768/111111111111111111?icon=true&online=true';

// config como a v0.2 gravava (versão 1, link solto, sem música)
function configV02() {
  return {
    versao: 1, mesaAtiva: 'aaaaaa',
    mesas: [{
      id: 'aaaaaa', nome: 'Sábado', papel: 'mestre',
      jogadores: [{ id: 'bbbbbb', discordId: '187691838138400768', personagem: 'Kael', jogador: 'Ana', imagem: 'bbbbbb-1.png', cor: '#AA3344' }],
      ignorados: ['400000000000000001'], nomes: { modo: 'jogador', quando: 'falando' },
      overlay: { ativo: false, layout: 'coluna-direita', tamanho: 160 },
      cameras: [{ nome: 'Mapa', x: 0.1, y: 0.2, w: 0.4 }],
      streamkit: { url: L1 },
    }],
    obs: { host: '127.0.0.1', porta: 4460, senha: 'segredo' },
    gravacao: { limiteHoras: 6, limiteGB: 80, destino: 'apagar' },
    atalhos: { marcar: 'F8', marcarNome: 'Shift+F8', replay: 'Ctrl+Alt+R', gravar: 'Ctrl+F9' },
    cortes: { pasta: 'D:/Cortes', antes: 20, depois: 10, presets: ['youtube-2k', 'vertical'] },
    foundry: { chave: '0123456789abcdef', ativo: true },
  };
}

test('atualização: config da v0.2 continua igual e o link vira o primeiro canal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-up-'));
  const arq = path.join(dir, 'config.json');
  const antigo = configV02();
  fs.writeFileSync(arq, JSON.stringify(antigo));
  const c = new cfgMod.ArmazemConfig(arq).carregar();
  const m = c.mesas[0];
  assert.equal(c.versao, cfgMod.VERSAO);
  assert.equal(m.nome, 'Sábado');
  assert.equal(m.jogadores[0].personagem, 'Kael');
  assert.equal(m.jogadores[0].imagem, 'bbbbbb-1.png');
  assert.equal(m.nomes.modo, 'jogador');
  assert.equal(m.overlay.ativo, false);
  assert.equal(m.overlay.tamanho, 160);
  assert.deepEqual(m.ignorados, ['400000000000000001']);
  assert.equal(m.cameras[0].nome, 'Mapa');
  assert.equal(c.obs.senha, 'segredo');
  assert.equal(c.obs.porta, 4460);
  assert.equal(c.gravacao.limiteHoras, 6);
  assert.equal(c.gravacao.destino, 'apagar');
  assert.equal(c.atalhos.marcar, 'F8');
  assert.equal(c.cortes.pasta, 'D:/Cortes');
  assert.deepEqual(c.cortes.presets, ['youtube-2k', 'vertical']);
  assert.equal(c.foundry.chave, '0123456789abcdef', 'a chave do Foundry não muda (o módulo continua funcionando)');
  // canais
  assert.equal(m.streamkit.url, L1);
  assert.equal(m.streamkit.canais.length, 1);
  assert.equal(m.streamkit.canais[0].nome, 'Canal principal');
  assert.equal(m.streamkit.ativo, m.streamkit.canais[0].id);
  // música com valores padrão
  assert.equal(c.musica.volume, 80);
  // cópia de segurança do arquivo antigo, intacta
  const copia = path.join(dir, `config.antes-da-v${cfgMod.VERSAO}.json`);
  assert.deepEqual(JSON.parse(fs.readFileSync(copia, 'utf8')), antigo);
  // o arquivo já foi convertido e carregar de novo dá o mesmo resultado (ids estáveis)
  const c2 = new cfgMod.ArmazemConfig(arq).carregar();
  assert.deepEqual(c2, c);
});

test('atualização: abrir de novo não sobrescreve a cópia de segurança', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-up-'));
  const arq = path.join(dir, 'config.json');
  fs.writeFileSync(arq, JSON.stringify(configV02()));
  new cfgMod.ArmazemConfig(arq).carregar();
  const copia = path.join(dir, `config.antes-da-v${cfgMod.VERSAO}.json`);
  const t = fs.statSync(copia).mtimeMs;
  const a = new cfgMod.ArmazemConfig(arq);
  a.carregar();
  a.salvar();
  assert.equal(fs.statSync(copia).mtimeMs, t);
  assert.equal(JSON.parse(fs.readFileSync(copia, 'utf8')).versao, 1);
});

test('canais: o ativo manda; link solto entra na lista; ids repetidos e lixo são corrigidos', () => {
  const sk = cfgMod.normalizarStreamKit({
    url: L1, ativo: 'cccccc',
    canais: [{ id: 'cccccc', nome: 'Sábado', url: L2 }, { id: 'cccccc', nome: '', url: L1 }, null, 'x'],
  });
  assert.equal(sk.canais.length, 2);
  assert.notEqual(sk.canais[0].id, sk.canais[1].id);
  assert.equal(sk.canais[1].nome, 'Canal 2');
  assert.equal(sk.url, L2, 'link do canal ativo');
  const solto = cfgMod.normalizarStreamKit({ url: L2, canais: [{ id: 'dddddd', nome: 'Um', url: L1 }] });
  assert.equal(solto.canais.length, 2);
  assert.equal(solto.url, L2);
  const existente = cfgMod.normalizarStreamKit({ url: L1, canais: [{ id: 'dddddd', nome: 'Um', url: L1 }] });
  assert.equal(existente.canais.length, 1);
  assert.equal(existente.ativo, 'dddddd');
  assert.deepEqual(cfgMod.normalizarStreamKit(undefined), { url: '', ativo: '', canais: [] });
  const sem = cfgMod.normalizarStreamKit({ ativo: 'zzzzzz', canais: [{ id: 'dddddd', nome: 'Um', url: L1 }] });
  assert.equal(sem.url, '', 'ativo que não existe: nenhum canal em uso');
});

test('controlador: trocar e adicionar canal (até no meio da gravação)', async () => {
  const { Controlador } = require('../src/main/controlador');
  const { fabricaOBS } = require('./apoio');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-up-'));
  const f = fabricaOBS({ gravando: false });
  const ctl = new Controlador({ pastaDados: dir, WebSocket: f.WSFalso, portaOverlay: 0, intervaloReconexao: 60000, removerArquivo: async () => {}, notificar: () => {} });
  await ctl.iniciar();
  try {
    const urls = [];
    ctl.on('streamkit-url', u => urls.push(u));
    const a = ctl.adicionarCanal(L1, 'Sábado');
    assert.equal(a.novo, true);
    const b = ctl.adicionarCanal(L2.replace('?icon=true&online=true', ''));
    assert.equal(b.novo, true);
    assert.equal(ctl.mesa.streamkit.canais.length, 2);
    assert.equal(ctl.mesa.streamkit.canais[1].nome, 'Canal 2');
    assert.match(ctl.urlStreamKit(), /111111111111111111/);
    const c = ctl.adicionarCanal(L1.replace('&online=true', ''));
    assert.equal(c.novo, false, 'mesmo servidor/canal não duplica');
    assert.equal(c.canalId, a.canalId);
    ctl.receberStreamKit([{ src: 'https://cdn.discordapp.com/avatars/187691838138400768/a.png', nome: 'Ana', falando: true }]);
    ctl.trocarCanal(b.canalId);
    assert.match(ctl.urlStreamKit(), /111111111111111111/);
    assert.equal(ctl.sk.presencas.length, 0, 'leitura recomeça no canal novo');
    assert.equal(urls.length, 4);
    assert.throws(() => ctl.trocarCanal('nao-existe'), /não encontrado/);
    assert.throws(() => ctl.adicionarCanal('https://discord.com/x'), /streamkit/);
  } finally { await ctl.parar(); }
});

test('package.json: nome do app não muda (é ele que decide a pasta das configurações)', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.name, 'gravador-rpg');
  assert.equal(pkg.productName, 'Gravador RPG');
});
