'use strict';
// Testes dos cortes: a parte de contas roda sempre; as exportações de verdade
// rodam com o FFmpeg (se ele estiver instalado nesta máquina).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const Camera = require('../src/core/camera');
const Layout = require('../src/core/layout-retratos');
const C = require('../src/core/cortes');
const midia = require('../src/core/midia');

// ------------------------------------------------------------------ câmera
// avalia uma expressão do FFmpeg em JavaScript (só o que usamos: if, lt, clip, between, eq)
function avaliar(expr, vars) {
  const js = expr.replace(/\bif\(/g, '__if(').replace(/\blt\(/g, '__lt(').replace(/\bclip\(/g, '__clip(').replace(/\bin\b/g, '__in');
  vars = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k === 'in' ? '__in' : k, v]));
  // eslint-disable-next-line no-new-func
  return Function('__if', '__lt', '__clip', ...Object.keys(vars), 'return ' + js)(
    (c, a, b) => (c ? a : b), (a, b) => (a < b ? 1 : 0), (x, a, b) => Math.min(b, Math.max(a, x)), ...Object.values(vars));
}

test('câmera: caixa sempre dentro do vídeo e no formato 9:16', () => {
  const W = 1920, H = 1080;
  const wMax = Camera.larguraMaxima(W, H);
  assert.ok(Math.abs(wMax - 0.31640625) < 1e-9);
  const c = Camera.limitar({ x: 0.9, y: 0.9, w: 2 }, W, H);
  assert.ok(c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9);
  assert.ok(Math.abs((c.w * W) / (c.h * H) - 9 / 16) < 1e-9);
  const z = Camera.limitar({ x: 0, y: 0, w: 0.0001 }, W, H);
  assert.ok(Math.abs(z.w - wMax / 6) < 1e-9, 'zoom máximo 6x');
});

test('câmera: normalizar ordena, junta repetidos e cria ponto padrão', () => {
  const p = Camera.normalizar([{ t: 5000, x: 0.1, y: 0, w: 0.2 }, { t: 0, x: 0.2, y: 0, w: 0.3, trans: 'xyz' }, { t: 5000, x: 0.5, y: 0, w: 0.2 }], 1920, 1080);
  assert.deepEqual(p.map(k => k.t), [0, 5000]);
  assert.equal(p[0].trans, 'suave');
  assert.equal(p[1].x, 0.5);
  const v = Camera.normalizar([], 1920, 1080);
  assert.equal(v.length, 1);
  assert.ok(Math.abs(v[0].x - (1 - v[0].w) / 2) < 1e-9, 'padrão: centralizado');
});

test('câmera: transições suave, rápida e corte seco', () => {
  const W = 1920, H = 1080;
  const pontos = [
    { t: 0, x: 0, y: 0, w: 0.3, trans: 'suave' },
    { t: 2000, x: 0.5, y: 0, w: 0.3, trans: 'rapido' },
    { t: 4000, x: 0.1, y: 0, w: 0.3, trans: 'corte' },
    { t: 6000, x: 0.6, y: 0, w: 0.3 },
  ];
  assert.ok(Math.abs(Camera.caixaEm(pontos, 1000, W, H).x - 0.25) < 1e-9, 'suave: metade no meio');
  assert.equal(Camera.caixaEm(pontos, 3000, W, H).x, 0.5, 'rápida: parada antes do último 0,6 s');
  assert.ok(Camera.caixaEm(pontos, 3700, W, H).x < 0.5 && Camera.caixaEm(pontos, 3700, W, H).x > 0.1);
  assert.equal(Camera.caixaEm(pontos, 5999, W, H).x, 0.1, 'corte: fica parada');
  assert.equal(Camera.caixaEm(pontos, 6000, W, H).x, 0.6, 'corte: pula no ponto');
  assert.equal(Camera.caixaEm(pontos, 99999, W, H).x, 0.6);
});

test('câmera: a expressão do FFmpeg dá o mesmo resultado que a prévia', () => {
  const W = 1920, H = 1080, fps = 30;
  const pontos = [
    { t: 500, x: 0.1, y: 0, w: 0.31, trans: 'suave' },
    { t: 2500, x: 0.4, y: 0.3, w: 0.12, trans: 'rapido' },
    { t: 5000, x: 0.2, y: 0.1, w: 0.2, trans: 'corte' },
    { t: 7000, x: 0.6, y: 0, w: 0.31 },
  ];
  const e = Camera.expressoesPerspective(pontos, W, H, fps);
  for (let quadro = 0; quadro < 9 * fps; quadro += 7) {
    const cx = Camera.caixaEm(pontos, (quadro / fps) * 1000, W, H);
    const v = k => avaliar(e[k], { in: quadro });
    assert.ok(Math.abs(v('x0') - cx.x * W) < 0.6, `x0 no quadro ${quadro}`);
    assert.ok(Math.abs(v('y0') - cx.y * H) < 0.6, `y0 no quadro ${quadro}`);
    assert.ok(Math.abs(v('x3') - (cx.x + cx.w) * W) < 0.6, `x3 no quadro ${quadro}`);
    assert.ok(Math.abs(v('y3') - (cx.y + cx.h) * H) < 0.6, `y3 no quadro ${quadro}`);
  }
});

// ------------------------------------------------------------------ retratos
test('layout: retratos centralizados, dentro do quadro e diminuem se não couberem', () => {
  const r = Layout.posicoes({ W: 1080, H: 1920, layout: 'faixa-baixo', tamanho: 150, margem: 60, comNome: true, quantidade: 4 });
  const xs = r.centros.map(c => c.x);
  assert.ok(Math.abs((xs[0] + xs[3]) / 2 - 540) < 1, 'centralizado');
  const m = r.medidas;
  for (const c of r.centros) {
    const k = Layout.cantoAdesivo(c, m);
    assert.ok(k.x + m.largura * 0.2 >= 0 && c.y + m.tam / 2 < 1920 - 60 + 1, 'dentro');
  }
  const muitos = Layout.posicoes({ W: 1080, H: 1920, layout: 'faixa-baixo', tamanho: 200, margem: 40, comNome: false, quantidade: 8 });
  assert.ok(muitos.tamanho < 200, 'diminuiu');
  const larg = muitos.centros[7].x - muitos.centros[0].x + muitos.medidas.tam * 1.35;
  assert.ok(larg <= 1080 - 80 + 1, 'coube');
  const qf = Layout.posicoes({ W: 1080, H: 1920, layout: 'quem-fala', tamanho: 150, margem: 60, comNome: true, quantidade: 4 });
  assert.equal(qf.centros.length, 1);
  assert.equal(qf.tamanho, 240);
});

test('layout livre: 9 pontos, fila em pé, ordem invertida, deslocamento e espaço', () => {
  const base = { W: 1920, H: 1080, tamanho: 100, margem: 30, comNome: false, quantidade: 3, espaco: 20 };
  const bd = Layout.posicoes({ ...base, ancora: 'baixo-dir', direcao: 'vertical', ordem: 'invertida' });
  const xs = bd.centros.map(c => Math.round(c.x)), ys = bd.centros.map(c => Math.round(c.y));
  assert.ok(xs.every(x => x === xs[0]) && xs[0] > 1920 - 30 - 135, `coluna encostada à direita ${xs}`);
  assert.ok(ys[0] > ys[1] && ys[1] > ys[2], `de baixo para cima ${ys}`);
  assert.ok(Math.abs(bd.grupo.y + bd.grupo.altura - (1080 - 30)) < 1, 'encosta embaixo');
  assert.equal(Math.round(ys[0] - ys[1]), 120, 'passo = tamanho + espaço (20%)');
  const te = Layout.posicoes({ ...base, ancora: 'topo-esq', direcao: 'horizontal', deslocX: 50, deslocY: 20 });
  assert.equal(Math.round(te.grupo.x), 80);
  assert.equal(Math.round(te.grupo.y), 50);
  assert.ok(te.centros[0].x < te.centros[1].x, 'da esquerda para a direita');
  const c = Layout.posicoes({ ...base, ancora: 'centro', direcao: 'horizontal' });
  assert.ok(Math.abs(c.grupo.x + c.grupo.largura / 2 - 960) < 1 && Math.abs(c.grupo.y + c.grupo.altura / 2 - 540) < 1, 'centro');
  const fora = Layout.posicoes({ ...base, ancora: 'baixo', deslocY: 5000 });
  assert.ok(fora.grupo.y + fora.grupo.altura <= 1080 + 0.01, 'deslocamento não tira da tela');
  const sf = Layout.posicoes({ ...base, ancora: 'meio-esq', direcao: 'vertical', mostrar: 'falando' });
  assert.equal(sf.centros.length, 1, 'só quem fala: um lugar');
  assert.equal(sf.tamanho, 100, 'sem aumentar sozinho no formato novo');
  assert.deepEqual(Layout.deLayout('coluna-direita'), { ancora: 'meio-dir', direcao: 'vertical', mostrar: 'todos' });
});

test('falas: intervalos relativos ao corte, segurando 0,3 s e juntando', () => {
  const falas = [
    { chave: 'a', ini: 10000, fim: 11000 }, { chave: 'a', ini: 11200, fim: 12000 },
    { chave: 'b', ini: 9000, fim: 10500 }, { chave: 'a', ini: 30000, fim: 31000 },
  ];
  assert.deepEqual(C.intervalosFala(falas, 'a', 9500, 20000), [[0.5, 2.8]]);
  assert.deepEqual(C.intervalosFala(falas, 'b', 9500, 20000), [[0, 1.3]]);
  assert.equal(C.exprIntervalos([[0, 1.3], [2, 3]]), 'between(t,0,1.3)+between(t,2,3)');
  assert.equal(C.exprIntervalos([]), '0');
});

// ------------------------------------------------------------------ pedaços
test('pedaços: trecho que atravessa dois arquivos e trecho apagado', () => {
  const linha = C.linhaDosArquivos([{ caminho: 'a.mp4', duracao: 1800 }, { caminho: 'b.mp4', duracao: 1800 }, { caminho: 'c.mp4', duracao: 600, existe: false }]);
  assert.deepEqual(C.pedacosDoTrecho(linha, 1790, 1805), [{ arquivo: 'a.mp4', ss: 1790, dur: 10 }, { arquivo: 'b.mp4', ss: 0, dur: 5 }]);
  assert.deepEqual(C.pedacosDoTrecho(linha, 100, 130), [{ arquivo: 'a.mp4', ss: 100, dur: 30 }]);
  assert.throws(() => C.pedacosDoTrecho(linha, 3650, 3700), /apagada/);
  assert.throws(() => C.pedacosDoTrecho(linha, 9000, 9100), /Não há gravação/);
});

test('tamanho-alvo: bitrate cabe no WhatsApp', () => {
  const kbps = C.bitrateParaTamanho(16, 60, 96);
  const mb = ((kbps + 96) * 60) / 8 / 1024;
  assert.ok(mb <= 16 && mb > 14, `${mb.toFixed(2)} MB`);
  assert.equal(C.bitrateParaTamanho(16, 100000, 96), 150, 'mínimo');
});

test('nome de arquivo seguro e caminho livre', () => {
  assert.equal(C.nomeArquivo('25/10 Sessão', 'Crítico: "Kael"?', 'YouTube 2K'), '2510 Sessão - Crítico Kael - YouTube 2K');
  assert.equal(C.nomeArquivo('', '...'), 'corte');
  const vistos = new Set([path.join('p', 'x.mp4'), path.join('p', 'x (2).mp4')]);
  assert.equal(C.caminhoLivre('p', 'x', c => vistos.has(c)), path.join('p', 'x (3).mp4'));
});

test('comando: corte rápido de um e de vários arquivos', () => {
  const um = C.montarComando({ preset: C.PRESETS.rapido, pedacos: [{ arquivo: 'a.mp4', ss: 10, dur: 5 }], saida: 'o.mp4' });
  assert.deepEqual(um.args.slice(0, 6), ['-ss', '10', '-i', 'a.mp4', '-t', '5']);
  assert.ok(um.args.includes('copy'));
  const dois = C.montarComando({ preset: C.PRESETS.rapido, pedacos: [{ arquivo: "C:\\Rec\\it's.mp4", ss: 1790, dur: 10 }, { arquivo: 'b.mp4', ss: 0, dur: 5 }], saida: 'o.mp4', arquivoLista: 'l.txt' });
  assert.match(dois.lista, /file 'C:\/Rec\/it'\\''s\.mp4'\ninpoint 1790\noutpoint 1800/);
});

test('comando: escolhe NVENC quando existe e o jeito certo de passar os filtros', () => {
  const base = {
    preset: C.PRESETS['youtube-1080'], pedacos: [{ arquivo: 'a.mp4', ss: 0, dur: 10 }],
    fonte: { largura: 1920, altura: 1080, fps: 60, audios: 4 }, saida: 'o.mp4', arquivoFiltros: 'f.txt',
  };
  const nv = C.montarComando({ ...base, encoder: { nvenc: true }, ffmpegVersaoMaior: 7 });
  assert.ok(nv.args.includes('h264_nvenc'));
  assert.ok(nv.args.includes('-/filter_complex'));
  const cpu = C.montarComando({ ...base, encoder: { nvenc: false }, ffmpegVersaoMaior: 6 });
  assert.ok(cpu.args.includes('libx264') && cpu.args.includes('-filter_complex_script'));
  const mix = C.montarComando({ ...base, audio: { modo: 'mix', volumes: { 2: 100, 3: 0, 4: 40 } } });
  assert.match(mix.filtros, /\[0:a:1\]volume=1\.00\[am1\]/);
  assert.match(mix.filtros, /\[0:a:3\]volume=0\.40\[am3\]/);
  assert.doesNotMatch(mix.filtros, /0:a:2/, 'faixa no zero fica de fora');
  assert.match(mix.filtros, /amix=inputs=2/);
  const zap = C.montarComando({ ...base, preset: C.PRESETS.whatsapp, fonte: { ...base.fonte, audios: 1 }, audio: { modo: 'mix' } });
  assert.ok(zap.avisos.some(a => /uma faixa/.test(a)));
  assert.match(zap.filtros, /fps=30/, 'WhatsApp limita a 30 fps');
});

// ------------------------------------------------------------------ exportações de verdade
let ff = null;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-cortes-'));
function gerar(nome, segundos, cor, freqs) {
  const saida = path.join(tmp, nome);
  const args = ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=30,drawbox=c=${cor}@0.6:t=fill:w=200:h=200`];
  freqs.forEach(f => args.push('-f', 'lavfi', '-i', `sine=frequency=${f}:sample_rate=48000`));
  args.push('-t', String(segundos), '-map', '0:v');
  freqs.forEach((_, i) => args.push('-map', `${i + 1}:a`));
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', saida);
  execFileSync(ff.bin, args);
  return saida;
}
function sprite(nome, cor) {
  const s = path.join(tmp, nome);
  execFileSync(ff.bin, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${cor}:s=200x240`, '-frames:v', '1', s]);
  return s;
}
async function exportar(o, nome) {
  const saida = path.join(tmp, nome);
  const arquivoFiltros = saida + '.filtros.txt';
  const arquivoLista = saida + '.lista.txt';
  const r = C.montarComando({ ...o, saida, arquivoFiltros, arquivoLista, encoder: { nvenc: false }, ffmpegVersaoMaior: Number(ff.versao.split('.')[0]) || 6 });
  if (r.filtros) fs.writeFileSync(arquivoFiltros, r.filtros);
  if (r.lista) fs.writeFileSync(arquivoLista, r.lista);
  const progresso = [];
  await midia.executar(ff.bin, r.args, r.duracao, p => progresso.push(p)).promessa;
  return { saida, info: await midia.info(ff.bin, saida), progresso, avisos: r.avisos };
}

test('FFmpeg: detectar e ler informações', async t => {
  ff = await midia.detectar();
  if (!ff.ok) return t.skip('FFmpeg não instalado aqui');
  assert.ok(ff.libx264);
  const a = gerar('a.mp4', 4, 'red', [440, 550, 660, 770]);
  gerar('b.mp4', 4, 'blue', [440, 550, 660, 770]);
  const i = await midia.info(ff.bin, a);
  assert.equal(i.largura, 1920);
  assert.equal(i.altura, 1080);
  assert.equal(i.audios, 4);
  assert.ok(Math.abs(i.duracao - 4) < 0.1);
  assert.equal(i.fps, 30);
  const nada = await midia.info(ff.bin, path.join(tmp, 'nao-existe.mp4'));
  assert.equal(nada.ok, false);
});

const FONTE = { largura: 1920, altura: 1080, fps: 30, audios: 4 };
const pedacosDois = () => [{ arquivo: path.join(tmp, 'a.mp4'), ss: 2.5, dur: 1.5 }, { arquivo: path.join(tmp, 'b.mp4'), ss: 0, dur: 2 }];

test('FFmpeg: YouTube 1080p juntando dois arquivos, com mix de faixas', async t => {
  if (!ff || !ff.ok) return t.skip('sem FFmpeg');
  const r = await exportar({ preset: C.PRESETS['youtube-1080'], pedacos: pedacosDois(), fonte: FONTE, audio: { modo: 'mix', volumes: { 2: 100, 3: 50, 4: 0 } } }, 'yt.mp4');
  assert.equal(r.info.largura, 1920);
  assert.equal(r.info.audios, 1, 'uma faixa de áudio final');
  assert.ok(Math.abs(r.info.duracao - 3.5) < 0.15, `duração ${r.info.duracao}`);
  assert.equal(r.progresso.at(-1), 1);
});

test('FFmpeg: YouTube 2K aumenta para 2560×1440', async t => {
  if (!ff || !ff.ok) return t.skip('sem FFmpeg');
  const r = await exportar({ preset: C.PRESETS['youtube-2k'], pedacos: [{ arquivo: path.join(tmp, 'a.mp4'), ss: 0, dur: 1 }], fonte: FONTE }, 'yt2k.mp4');
  assert.equal(r.info.largura, 2560);
  assert.equal(r.info.altura, 1440);
});

test('FFmpeg: WhatsApp cabe no tamanho-alvo', async t => {
  if (!ff || !ff.ok) return t.skip('sem FFmpeg');
  const preset = { ...C.PRESETS.whatsapp, alvoMB: 1 };
  const r = await exportar({ preset, pedacos: pedacosDois(), fonte: FONTE }, 'zap.mp4');
  const mb = fs.statSync(r.saida).size / 1024 / 1024;
  assert.ok(mb <= 1.1, `${mb.toFixed(2)} MB`);
  assert.equal(r.info.largura, 1280);
  assert.ok(r.info.fps <= 30);
});

test('FFmpeg: vertical com câmera animada e retratos', async t => {
  if (!ff || !ff.ok) return t.skip('sem FFmpeg');
  const retratos = [
    { indice: 0, falando: sprite('k-f.png', 'yellow'), quieto: sprite('k-q.png', 'gray'), intervalos: [[0, 1]] },
    { indice: 1, falando: sprite('i-f.png', 'cyan'), quieto: null, intervalos: [[2, 3]] },
  ];
  const r = await exportar({
    preset: C.PRESETS.vertical, pedacos: pedacosDois(), fonte: FONTE,
    vertical: { modo: 'camera', camera: [{ t: 0, x: 0, y: 0, w: 0.31 }, { t: 2000, x: 0.5, y: 0.2, w: 0.1, trans: 'rapido' }] },
    retratos, layout: { layout: 'faixa-baixo', tamanho: 150, margem: 60, comNome: true, quantidade: 2 },
  }, 'vert.mp4');
  assert.equal(r.info.largura, 1080);
  assert.equal(r.info.altura, 1920);
  assert.ok(Math.abs(r.info.duracao - 3.5) < 0.15);
  // confere a cor do retrato: amarelo no começo (Kael falando), cinza depois
  const cor = async (seg, x, y) => {
    const buf = execFileSync(ff.bin, ['-loglevel', 'error', '-ss', String(seg), '-i', r.saida, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y},format=rgb24`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    return [...buf];
  };
  const lay = Layout.posicoes({ W: 1080, H: 1920, layout: 'faixa-baixo', tamanho: 150, margem: 60, comNome: true, quantidade: 2 });
  const k = Layout.cantoAdesivo(lay.centros[0], lay.medidas);
  const [r1, g1, b1] = await cor(0.5, k.x + 100, k.y + 100);
  assert.ok(r1 > 200 && g1 > 200 && b1 < 80, `amarelo enquanto fala: ${[r1, g1, b1]}`);
  const [r2, g2, b2] = await cor(2.0, k.x + 100, k.y + 100);
  assert.ok(Math.abs(r2 - g2) < 30 && Math.abs(g2 - b2) < 30 && r2 > 90 && r2 < 170, `cinza quieto: ${[r2, g2, b2]}`);
  const i = Layout.cantoAdesivo(lay.centros[1], lay.medidas);
  const [r3, g3, b3] = await cor(2.5, i.x + 100, i.y + 100);
  assert.ok(r3 < 80 && g3 > 200 && b3 > 200, `ciano falando: ${[r3, g3, b3]}`);
});

test('FFmpeg: vertical tela inteira com fundo desfocado e WhatsApp vertical', async t => {
  if (!ff || !ff.ok) return t.skip('sem FFmpeg');
  const r = await exportar({ preset: C.PRESETS['whatsapp-vertical'], pedacos: pedacosDois(), fonte: FONTE, vertical: { modo: 'inteira' } }, 'vert-inteira.mp4');
  assert.equal(r.info.largura, 720);
  assert.equal(r.info.altura, 1280);
});

test('FFmpeg: corte rápido sem recodificar mantém as 4 faixas', async t => {
  if (!ff || !ff.ok) return t.skip('sem FFmpeg');
  const r = await exportar({ preset: C.PRESETS.rapido, pedacos: pedacosDois() }, 'rapido.mp4');
  assert.equal(r.info.audios, 4);
  assert.ok(r.info.duracao > 3 && r.info.duracao < 4.6, `duração ${r.info.duracao}`);
});

test('FFmpeg: cancelar para a exportação', async t => {
  if (!ff || !ff.ok) return t.skip('sem FFmpeg');
  const saida = path.join(tmp, 'cancelado.mp4');
  const job = midia.executar(ff.bin, ['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-t', '600', '-c:v', 'libx264', saida], 600);
  setTimeout(() => job.cancelar(), 300);
  await assert.rejects(job.promessa, e => e.cancelado === true);
});

test('FFmpeg: erro do FFmpeg vira mensagem legível', async t => {
  if (!ff || !ff.ok) return t.skip('sem FFmpeg');
  const job = midia.executar(ff.bin, ['-i', path.join(tmp, 'nao-existe.mp4'), path.join(tmp, 'x.mp4')], 1);
  await assert.rejects(job.promessa, /O FFmpeg falhou/);
});

test('edição com o mouse: a alça fica no canto oposto ao ponto e esticar segue o mouse', () => {
  const g = { x: 100, y: 200, largura: 300, altura: 100 };
  assert.deepEqual(Layout.alcaDoGrupo(g, 'baixo-dir'), { x: 100, y: 200 });
  assert.deepEqual(Layout.alcaDoGrupo(g, 'topo-esq'), { x: 400, y: 300 });
  assert.equal(Layout.fatorEsticar('topo-esq', g, 150, 0), 1.5, 'puxar para a direita cresce');
  assert.equal(Layout.fatorEsticar('baixo-dir', g, -150, 0), 1.5, 'ancorado à direita: puxar para a esquerda cresce');
  assert.equal(Layout.fatorEsticar('centro', g, 75, 0), 1.5, 'no centro cresce dos dois lados');
  assert.equal(Layout.fatorEsticar('topo-esq', g, 0, -50), 0.5, 'puxar para dentro diminui');
});

test('vertical: config antiga vira posição livre (nenhum = desligado, só quem fala = 1,6x)', () => {
  const cfg = require('../src/core/config');
  assert.equal(cfg.normalizarMesa({ vertical: { layout: 'nenhum' } }).vertical.ativo, false);
  const qf = cfg.normalizarMesa({ vertical: { layout: 'quem-fala', tamanho: 150 } }).vertical;
  assert.equal(qf.mostrar, 'falando');
  assert.equal(qf.tamanho, 240);
  const fc = cfg.normalizarMesa({ vertical: { layout: 'faixa-cima', tamanho: 120, margem: 50 } }).vertical;
  assert.deepEqual([fc.ativo, fc.ancora, fc.direcao, fc.tamanho, fc.margem], [true, 'topo', 'horizontal', 120, 50]);
});
