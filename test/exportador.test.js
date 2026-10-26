'use strict';
// Exportação de ponta a ponta: sessão de verdade (arquivo de linha do tempo),
// vídeos divididos em pedaços, fila, retratos e compilado. Precisa do FFmpeg.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const midia = require('../src/core/midia');
const { Exportador } = require('../src/core/exportador');
const { Fila } = require('../src/core/fila');
const { Sessao } = require('../src/core/sessao');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-exp-'));
/** Espera a fila terminar a tarefa (pronta ou com erro) e devolve ela. */
function terminar(fila) {
  return new Promise(res => fila.on('mudou', l => {
    const t = l.find(x => ['pronto', 'erro', 'cancelado'].includes(x.estado));
    if (t) res(t);
  }));
}
let ff, sessao, exp;
const PNG = c => 'data:image/png;base64,' + execFileSync(ff.bin, ['-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${c}:s=200x240`, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', '-']).toString('base64');

function video(nome, seg, cor) {
  const s = path.join(tmp, nome);
  execFileSync(ff.bin, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${cor}:s=1280x720:r=30`, '-f', 'lavfi', '-i', 'sine=f=440:sample_rate=48000',
    '-f', 'lavfi', '-i', 'sine=f=660:sample_rate=48000', '-t', String(seg), '-map', '0:v', '-map', '1:a', '-map', '2:a',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', s]);
  return s;
}

test('preparar sessão com dois pedaços', async t => {
  ff = await midia.detectar();
  if (!ff.ok) return t.skip('sem FFmpeg');
  const a = video('rec-1.mp4', 5, 'red');
  const b = video('rec-2.mp4', 5, 'blue');
  const rep = video('replay.mp4', 3, 'green');
  const t0 = 1_700_000_000_000;
  const s = new Sessao(path.join(tmp, 'sessoes'), { inicio: t0, mesa: { id: 'm', nome: 'Nauren' } });
  s.arquivoGravacao(a, t0);
  s.estado([{ chave: 'kael', falando: true }], t0 + 4000);
  s.estado([{ chave: 'kael', falando: false }], t0 + 6000);
  s.marcar('Crítico', 'atalho', t0 + 5000);
  s.arquivoGravacao(b, t0 + 5000);
  s.replay(rep, t0 + 9000);
  s.encerrar(t0 + 10000);
  sessao = s.arquivo;
  exp = new Exportador();
});

test('linha da sessão usa a duração real de cada pedaço; replay termina quando foi salvo', async t => {
  if (!sessao) return t.skip('sem FFmpeg');
  const { lerSessao } = require('../src/core/sessao');
  const s = lerSessao(sessao);
  const l = await exp.linha(s);
  assert.equal(l.length, 2);
  assert.ok(Math.abs(l[1].inicio - 5) < 0.1);
  const r = await exp.linha(s, 'replay:' + path.join(tmp, 'replay.mp4'));
  assert.ok(Math.abs(r[0].inicio - 6) < 0.1, `replay começa em ~6 s (${r[0].inicio})`);
});

test('fila exporta um corte que atravessa os dois pedaços, com retrato', async t => {
  if (!sessao) return t.skip('sem FFmpeg');
  const fila = new Fila();
  const prep = await exp.preparar({
    sessaoArquivo: sessao,
    corte: { id: 'c1', nome: 'Crítico', ini: 3500, fim: 7000, fonte: 'gravacao', audio: { modo: 'faixa1' }, vertical: { modo: 'camera', camera: [] } },
    preset: 'vertical',
    retratos: [{ chave: 'kael', falando: PNG('yellow'), quieto: PNG('gray') }, { chave: 'calado', falando: PNG('cyan'), quieto: PNG('gray') }],
    layout: { layout: 'faixa-baixo', tamanho: 150, margem: 60, comNome: true, esconderQuietos: true },
    pastaSaida: path.join(tmp, 'saida'), nomeBase: '25-10 Nauren - Crítico',
  });
  assert.ok(fs.existsSync(prep.saida), 'nome reservado na hora');
  const pronto = terminar(fila);
  const estados = [];
  fila.on('mudou', l => estados.push(l[0].estado));
  fila.adicionar(prep);
  const tarefa = await pronto;
  assert.equal(tarefa.estado, 'pronto');
  assert.ok(estados.includes('rodando'));
  const info = await midia.info(ff.bin, tarefa.saida);
  assert.equal(info.largura, 1080);
  assert.ok(Math.abs(info.duracao - 3.5) < 0.15, `duração ${info.duracao}`);
  assert.match(path.basename(tarefa.saida), /^25-10 Nauren - Crítico - TikTok/);
  // "calado" não falou no corte: com esconderQuietos, só o Kael aparece (centralizado)
  const pix = execFileSync(ff.bin, ['-loglevel', 'error', '-ss', '1', '-i', tarefa.saida, '-frames:v', '1', '-vf', 'crop=2:2:540:1700,format=rgb24', '-f', 'rawvideo', '-']);
  assert.ok(pix[0] > 200 && pix[1] > 200 && pix[2] < 80, `Kael amarelo no centro ${[...pix.slice(0, 3)]}`);
});

test('dois pedidos iguais não sobrescrevem o mesmo arquivo', async t => {
  if (!sessao) return t.skip('sem FFmpeg');
  const ped = { sessaoArquivo: sessao, corte: { nome: 'X', ini: 0, fim: 1000, fonte: 'gravacao' }, preset: 'rapido', pastaSaida: path.join(tmp, 'saida'), nomeBase: 'igual' };
  const a = await exp.preparar(ped);
  const b = await exp.preparar(ped);
  assert.notEqual(a.saida, b.saida);
});

test('corte do replay e trecho apagado', async t => {
  if (!sessao) return t.skip('sem FFmpeg');
  const fila = new Fila();
  const prep = await exp.preparar({ sessaoArquivo: sessao, corte: { nome: 'Replay', ini: 6500, fim: 8500, fonte: 'replay:' + path.join(tmp, 'replay.mp4') }, preset: 'youtube-1080', pastaSaida: path.join(tmp, 'saida'), nomeBase: 'rep' });
  const fim = terminar(fila);
  fila.adicionar(prep);
  const tarefa = await fim;
  assert.equal(tarefa.erro, '');
  const info = await midia.info(ff.bin, tarefa.saida);
  assert.ok(Math.abs(info.duracao - 2) < 0.15);
  fs.renameSync(path.join(tmp, 'rec-2.mp4'), path.join(tmp, 'rec-2-movido.mp4'));
  exp.cacheInfo.clear();
  try {
    await assert.rejects(exp.preparar({ sessaoArquivo: sessao, corte: { nome: 'X', ini: 6000, fim: 8000, fonte: 'gravacao' }, preset: 'youtube-1080', pastaSaida: tmp, nomeBase: 'x' }), /apagada/);
  } finally {
    fs.renameSync(path.join(tmp, 'rec-2-movido.mp4'), path.join(tmp, 'rec-2.mp4'));
    exp.cacheInfo.clear();
  }
});

test('compilado com tamanho-alvo junta os cortes e cabe no limite', async t => {
  if (!sessao) return t.skip('sem FFmpeg');
  const base = { sessaoArquivo: sessao, retratos: [], layout: { layout: 'nenhum' } };
  const pedidos = [
    { ...base, corte: { nome: 'A', ini: 1000, fim: 3000, fonte: 'gravacao', vertical: { modo: 'inteira' } } },
    { ...base, corte: { nome: 'B', ini: 6000, fim: 9000, fonte: 'gravacao', vertical: { modo: 'camera', camera: [{ t: 0, x: 0.1, y: 0, w: 0.2 }] } } },
  ];
  const prep = await exp.prepararCompilado(pedidos, { preset: 'whatsapp-vertical', pastaSaida: path.join(tmp, 'saida'), nomeBase: 'Melhores' });
  const fila = new Fila();
  const progresso = [];
  fila.on('mudou', l => progresso.push(l[0].progresso));
  const fim = terminar(fila);
  fila.adicionar(prep);
  const tarefa = await fim;
  assert.equal(tarefa.erro, '');
  const info = await midia.info(ff.bin, tarefa.saida);
  assert.equal(info.altura, 1280);
  assert.ok(Math.abs(info.duracao - 5) < 0.3, `duração ${info.duracao}`);
  assert.ok(fs.statSync(tarefa.saida).size < 16 * 1024 * 1024);
  for (let i = 1; i < progresso.length; i++) assert.ok(progresso[i] >= progresso[i - 1] - 1e-9, 'progresso só aumenta');
});

test('fila: cancelar a que está rodando e a que espera', async t => {
  if (!sessao) return t.skip('sem FFmpeg');
  const fila = new Fila();
  const lenta = {
    titulo: 'lenta',
    executar: async (prog, aoCancelar) => {
      const job = midia.executar(ff.bin, ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720', '-t', '300', '-c:v', 'libx264', path.join(tmp, 'lenta.mp4')], 300, prog);
      aoCancelar(job.cancelar);
      await job.promessa;
      return { saida: 'x' };
    },
  };
  const a = fila.adicionar(lenta);
  const b = fila.adicionar({ titulo: 'b', executar: async () => ({ saida: 'b' }) });
  assert.equal(fila.cancelar(b), true);
  await new Promise(r => setTimeout(r, 400));
  fila.cancelar(a);
  await new Promise(r => setTimeout(r, 600));
  assert.deepEqual(fila.lista().map(x => x.estado), ['cancelado', 'cancelado']);
  fila.limparConcluidas();
  assert.equal(fila.lista().length, 0);
});

test('fila: erro de uma não trava as próximas', async () => {
  const fila = new Fila();
  fila.adicionar({ titulo: 'ruim', executar: async () => { throw new Error('quebrou'); } });
  fila.adicionar({ titulo: 'boa', executar: async () => ({ saida: 'ok.mp4' }) });
  await new Promise(res => fila.on('pronta', res));
  const l = fila.lista();
  assert.equal(l[0].estado, 'erro');
  assert.equal(l[0].erro, 'quebrou');
  assert.equal(l[1].estado, 'pronto');
});

test('replay curto: corte pedido antes do vídeo começa onde o vídeo existe, com retratos no lugar', async t => {
  if (!sessao) return t.skip('sem FFmpeg');
  const { lerSessao } = require('../src/core/sessao');
  // replay de 3 s salvo aos 9 s da sessão (vídeo de 6 s a 9 s). Kael fala de 4 s a 6 s.
  const prep = await exp.preparar({
    sessaoArquivo: sessao,
    corte: { nome: 'R', ini: 0, fim: 9000, fonte: 'replay:' + path.join(tmp, 'replay.mp4'), vertical: { modo: 'camera', camera: [{ t: 0, x: 0, y: 0, w: 0.3 }, { t: 9000, x: 0.6, y: 0, w: 0.3 }] } },
    preset: 'vertical',
    retratos: [{ chave: 'kael', falando: PNG('yellow'), quieto: PNG('gray') }],
    layout: { layout: 'faixa-baixo', tamanho: 150, margem: 60, comNome: false, esconderQuietos: false },
    pastaSaida: path.join(tmp, 'saida'), nomeBase: 'replay-curto',
  });
  const fila = new Fila();
  const fim = terminar(fila);
  fila.adicionar(prep);
  const tarefa = await fim;
  assert.equal(tarefa.erro, '');
  const info = await midia.info(ff.bin, tarefa.saida);
  assert.ok(Math.abs(info.duracao - 3) < 0.15, `só o que existe: ${info.duracao}`);
  // Kael parou de falar aos 6 s (+0,3 s): no vídeo do replay (que começa aos 6 s) ele já está quieto no segundo 1
  const pix = execFileSync(ff.bin, ['-loglevel', 'error', '-ss', '1', '-i', tarefa.saida, '-frames:v', '1', '-vf', 'crop=2:2:540:1720,format=rgb24', '-f', 'rawvideo', '-']);
  assert.ok(Math.abs(pix[0] - pix[1]) < 30 && pix[0] < 180, `quieto (cinza) no segundo 1: ${[...pix.slice(0, 3)]}`);
  assert.ok(lerSessao(sessao).replays.length === 1);
});

test('pausa do OBS: o corte depois da pausa pega o trecho certo do vídeo', async t => {
  if (!sessao) return t.skip('sem FFmpeg');
  // sessão nova: vídeo vermelho 0-4 s, pausa de 10 s, depois azul 4-8 s (num arquivo só)
  const v = path.join(tmp, 'pausado.mp4');
  execFileSync(ff.bin, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30:d=4', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=4',
    '-filter_complex', '[0][1]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', v]);
  const t0 = 1_800_000_000_000;
  const s = new Sessao(path.join(tmp, 'sessoes'), { inicio: t0 });
  s.arquivoGravacao(v, t0);
  s.pausa(t0 + 4000);
  s.retoma(t0 + 14000);
  s.encerrar(t0 + 18000);
  // corte aos 15 s da sessão = 5 s do vídeo: tem que ser azul
  const prep = await exp.preparar({ sessaoArquivo: s.arquivo, corte: { nome: 'P', ini: 15000, fim: 16000, fonte: 'gravacao' }, preset: 'youtube-1080', pastaSaida: path.join(tmp, 'saida'), nomeBase: 'pausa' });
  const fila = new Fila();
  const fim = terminar(fila);
  fila.adicionar(prep);
  const tarefa = await fim;
  assert.equal(tarefa.erro, '');
  const pix = execFileSync(ff.bin, ['-loglevel', 'error', '-ss', '0.3', '-i', tarefa.saida, '-frames:v', '1', '-vf', 'crop=2:2:960:540,format=rgb24', '-f', 'rawvideo', '-']);
  assert.ok(pix[2] > 200 && pix[0] < 60, `azul: ${[...pix.slice(0, 3)]}`);
  const info = await midia.info(ff.bin, tarefa.saida);
  assert.equal(info.audios, 1, 'vídeo mudo ganha faixa de silêncio');
});

test('compilado: cancelar no meio não continua as próximas partes', async t => {
  if (!sessao) return t.skip('sem FFmpeg');
  const base = { sessaoArquivo: sessao, retratos: [], layout: { layout: 'nenhum' } };
  const pedidos = [1, 2, 3].map(i => ({ ...base, corte: { nome: 'C' + i, ini: 0, fim: 9000, fonte: 'gravacao' } }));
  const prep = await exp.prepararCompilado(pedidos, { preset: 'youtube-2k', pastaSaida: path.join(tmp, 'saida'), nomeBase: 'cancelar' });
  const fila = new Fila();
  const fim = terminar(fila);
  const id = fila.adicionar(prep);
  // espera a primeira parte andar e cancela
  await new Promise(r => { const iv = setInterval(() => { if (fila.lista()[0].progresso > 0.05) { clearInterval(iv); r(); } }, 50); });
  fila.cancelar(id);
  const tarefa = await fim;
  assert.equal(tarefa.estado, 'cancelado');
  assert.ok(!fs.existsSync(prep.saida), 'arquivo reservado foi apagado');
});

test('fila: cancelar antes de começar apaga o arquivo vazio reservado', async t => {
  if (!sessao) return t.skip('sem FFmpeg');
  const fila = new Fila();
  fila.adicionar({ titulo: 'ocupa', executar: () => new Promise(r => setTimeout(() => r({ saida: '' }), 300)) });
  const prep = await exp.preparar({ sessaoArquivo: sessao, corte: { nome: 'V', ini: 0, fim: 1000, fonte: 'gravacao' }, preset: 'youtube-1080', pastaSaida: path.join(tmp, 'saida'), nomeBase: 'vazio' });
  assert.ok(fs.existsSync(prep.saida));
  const id = fila.adicionar(prep);
  assert.deepEqual(fila.arquivosEmUso().map(x => path.basename(x)), ['rec-1.mp4'], 'vídeo de origem em uso');
  fila.cancelar(id);
  assert.ok(!fs.existsSync(prep.saida));
});

test('legendas: o .ass gerado é queimado no vídeo, no lugar e na hora certos', async t => {
  if (!sessao) return t.skip('sem FFmpeg');
  const Leg = require('../src/core/legendas');
  const estilo = Leg.normalizarEstilo({ fonte: 'Arial', tamanho: 120, palavras: 0, destaque: false, corPersonagem: false, corTexto: '#FF0000', contorno: 0, sombra: 0, fundo: true, corFundo: '#00FF00', opacidadeFundo: 100 });
  // corte começa em 1 s da sessão; legenda de 1,5 s a 2,5 s (tempo da sessão)
  const ass = Leg.gerarAss({
    W: 1920, H: 1080, estilo, pos: { x: 0.5, y: 0.25, w: 0.8 }, k: 1,
    segmentos: [{ ini: 1500, fim: 2500, texto: 'Crítico!', chave: 'kael' }], inicio: 1000, duracao: 3000,
    medir: (txt, px) => txt.length * px * 0.6,
  });
  assert.match(ass, /Dialogue: 0,0:00:00\.50,0:00:01\.50/);
  const fila = new Fila();
  const prep = await exp.preparar({
    sessaoArquivo: sessao, corte: { nome: 'Leg', ini: 1000, fim: 4000, fonte: 'gravacao', audio: { modo: 'faixa1' } },
    preset: 'youtube-1080', legendasAss: ass, pastaSaida: path.join(tmp, 'saida'), nomeBase: 'legenda',
  });
  const fim = terminar(fila);
  fila.adicionar(prep);
  const tarefa = await fim;
  assert.equal(tarefa.erro, '', tarefa.erro);
  const pixel = s => execFileSync(ff.bin, ['-loglevel', 'error', '-ss', String(s), '-i', tarefa.saida, '-frames:v', '1', '-vf', 'crop=2:2:960:270,format=rgb24', '-f', 'rawvideo', '-']);
  const durante = pixel(1.0), depois = pixel(2.3);
  // durante a legenda: caixa verde (ou texto vermelho) no centro do terço de cima; depois: o vídeo vermelho de fundo
  assert.ok(durante[1] > 150 || (durante[0] > 150 && durante[1] < 100), `legenda aparece ${[...durante]}`);
  assert.ok(!(depois[1] > 150), `legenda some depois ${[...depois]}`);
});

// ---------------------------------------------------------------- 0.5: identidade visual, final, fundo, música
function pngDataUrl(cor, w, h) {
  const arq = path.join(tmp, `png-${cor.replace('#', '')}-${w}x${h}.png`);
  execFileSync(ff.bin, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${cor}:s=${w}x${h}`, '-frames:v', '1', arq]);
  return 'data:image/png;base64,' + fs.readFileSync(arq).toString('base64');
}
function volumeMedio(arquivo, ss, t) {
  const r = require('child_process').spawnSync(ff.bin, ['-hide_banner', '-ss', String(ss), '-t', String(t), '-i', arquivo, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = r.stderr.match(/mean_volume: (-?[\d.]+) dB/);
  return m ? Number(m[1]) : -999;
}

test('identidade: camada, imagem final com fade e música com volume por pontos', async t => {
  if (!sessao) return t.skip('sem FFmpeg');
  const wav = path.join(tmp, 'musica.wav');
  execFileSync(ff.bin, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=1000:sample_rate=48000', '-t', '2', wav]);
  const fila = new Fila();
  const prep = await exp.preparar({
    sessaoArquivo: sessao, corte: { nome: 'Id', ini: 1000, fim: 4000, fonte: 'gravacao', audio: { modo: 'faixa1', volumes: { 1: 0 } } },
    preset: 'youtube-1080', pastaSaida: path.join(tmp, 'saida'), nomeBase: 'identidade',
    camadas: [{ png: pngDataUrl('#0000FF', 200, 200), x: 100, y: 100 }],
    final: { png: pngDataUrl('#00FF00', 1920, 1080), duracao: 2, fade: 0.5 },
    // música (curta, repete) alta no começo e muda (0%) a partir de 2 s do corte
    musica: { arquivo: wav, volume: 100, fadeIn: 0, fadeOut: 0, pontos: [{ t: 0, v: 100 }, { t: 1800, v: 100 }, { t: 2000, v: 0 }] },
  });
  const fim = terminar(fila);
  fila.adicionar(prep);
  const tarefa = await fim;
  assert.equal(tarefa.erro, '', tarefa.erro);
  const dur = Number(execFileSync(ff.ffprobe || ff.bin.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tarefa.saida]).toString());
  assert.ok(Math.abs(dur - 4.5) < 0.15, `3 s de corte + 1,5 s de final = ${dur}`);
  const pixel = (s, x, y) => [...execFileSync(ff.bin, ['-loglevel', 'error', '-ss', String(s), '-i', tarefa.saida, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y},format=rgb24`, '-f', 'rawvideo', '-'])];
  const logo = pixel(1, 200, 200);
  assert.ok(logo[2] > 180 && logo[0] < 80, `camada azul no canto ${logo}`);
  const meio = pixel(4.2, 960, 540);
  assert.ok(meio[1] > 180 && meio[0] < 80, `imagem final verde no fim ${meio}`);
  const antes = pixel(1.5, 960, 540);
  assert.ok(!(antes[1] > 180 && antes[0] < 80), `final ainda não apareceu em 1,5 s ${antes}`);
  const comMusica = volumeMedio(tarefa.saida, 0.5, 1), semMusica = volumeMedio(tarefa.saida, 2.5, 1.5);
  assert.ok(comMusica > -30, `música toca no começo (${comMusica} dB)`);
  assert.ok(semMusica < comMusica - 20, `ponto em 0% cala a música (${semMusica} dB)`);
});

test('identidade: vertical tela inteira com fundo próprio, vídeo menor e mais para cima', async t => {
  if (!sessao) return t.skip('sem FFmpeg');
  const fila = new Fila();
  const prep = await exp.preparar({
    sessaoArquivo: sessao, corte: { nome: 'Fundo', ini: 1000, fim: 3000, fonte: 'gravacao', audio: { modo: 'faixa1' }, vertical: { modo: 'inteira', camera: [] } },
    preset: 'whatsapp-vertical', pastaSaida: path.join(tmp, 'saida'), nomeBase: 'fundo', layout: { layout: 'nenhum' },
    fundo: { png: pngDataUrl('#FF00FF', 720, 1280), y: 0.3, escala: 0.5 },
  });
  const fim = terminar(fila);
  fila.adicionar(prep);
  const tarefa = await fim;
  assert.equal(tarefa.erro, '', tarefa.erro);
  const pixel = (x, y) => [...execFileSync(ff.bin, ['-loglevel', 'error', '-ss', '1', '-i', tarefa.saida, '-frames:v', '1', '-vf', `crop=2:2:${x}:${y},format=rgb24`, '-f', 'rawvideo', '-'])];
  const fundo = pixel(360, 1000), video = pixel(360, 384), lado = pixel(40, 384);
  assert.ok(fundo[0] > 180 && fundo[2] > 180 && fundo[1] < 80, `fundo magenta embaixo ${fundo}`);
  assert.ok(!(video[0] > 180 && video[2] > 180 && video[1] < 80), `vídeo no lugar (30% da altura) ${video}`);
  assert.ok(lado[0] > 180 && lado[2] > 180, `vídeo com metade da largura deixa o fundo nos lados ${lado}`);
});
