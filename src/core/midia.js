'use strict';
// Tudo o que fala com o FFmpeg: achar o programa, ver se a placa NVIDIA está
// disponível, ler informações de um vídeo e rodar uma exportação com progresso.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

/** Onde procurar o FFmpeg, em ordem: o configurado, o que vem com o app, o do sistema. */
function candidatosFFmpeg(configurado) {
  const lista = [];
  if (configurado) lista.push(configurado);
  try {
    // pacote ffmpeg-static (instalado pelo INSTALAR.bat)
    const p = require('ffmpeg-static');
    if (p) lista.push(String(p).replace('app.asar', 'app.asar.unpacked'));
  } catch { /* não instalado */ }
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA || '';
    lista.push(
      'ffmpeg.exe',
      path.join(la, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
      'C:\\ffmpeg\\bin\\ffmpeg.exe',
      'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    );
  } else {
    lista.push('ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg');
  }
  return [...new Set(lista)];
}

function rodar(bin, args, { tempoLimite = 20000 } = {}) {
  return new Promise(resolve => {
    execFile(bin, args, { timeout: tempoLimite, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (erro, stdout, stderr) => {
      resolve({ ok: !erro, codigo: erro ? erro.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/** Acha um FFmpeg que funcione e descobre quais codificadores ele tem. */
async function detectar(configurado = '') {
  for (const bin of candidatosFFmpeg(configurado)) {
    if (path.isAbsolute(bin) && !fs.existsSync(bin)) continue;
    const v = await rodar(bin, ['-hide_banner', '-version'], { tempoLimite: 8000 });
    if (!v.ok) continue;
    const versao = (v.stdout.match(/ffmpeg version (\S+)/) || [])[1] || '?';
    const enc = await rodar(bin, ['-hide_banner', '-encoders'], { tempoLimite: 8000 });
    const tem = n => new RegExp(`\\s${n}\\s`).test(enc.stdout);
    // listar o codificador não basta: precisa de placa NVIDIA e driver; testa de verdade
    let nvenc = false;
    if (tem('h264_nvenc')) {
      const t = await rodar(bin, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.2',
        '-c:v', 'h264_nvenc', '-f', 'null', '-'], { tempoLimite: 15000 });
      nvenc = t.ok;
    }
    // como passar o arquivo de filtros: "-/filter_complex" (FFmpeg 7+) ou "-filter_complex_script" (antigos).
    // testa de verdade em vez de confiar no número da versão (builds "N-xxxx" não têm número)
    let opcaoFiltroArquivo = '-filter_complex_script';
    const tmp = path.join(require('os').tmpdir(), `grpg-filtro-${process.pid}-${Date.now()}.txt`);
    try {
      fs.writeFileSync(tmp, 'color=c=black:s=16x16:d=0.1[v]');
      const t = await rodar(bin, ['-hide_banner', '-loglevel', 'error', '-/filter_complex', tmp, '-map', '[v]', '-f', 'null', '-'], { tempoLimite: 8000 });
      if (t.ok) opcaoFiltroArquivo = '-/filter_complex';
    } catch { /* fica com a antiga */ } finally { try { fs.unlinkSync(tmp); } catch { /* */ } }
    return { ok: true, bin, versao, nvenc, libx264: tem('libx264'), opcaoFiltroArquivo };
  }
  return { ok: false, erro: 'FFmpeg não encontrado. Rode o INSTALAR.bat de novo ou informe o caminho do ffmpeg.exe em Gravação e atalhos.' };
}

/** Lê duração, tamanho, fps e quantas faixas de áudio um vídeo tem (sem ffprobe). */
async function info(bin, arquivo) {
  const r = await rodar(bin, ['-hide_banner', '-i', arquivo], { tempoLimite: 15000 });
  return lerInfo(r.stderr);
}

function lerInfo(texto) {
  const dur = texto.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const video = texto.match(/Stream #\d+:\d+[^\n]*Video:[^\n]*/);
  let largura = 0, altura = 0, fps = 0;
  if (video) {
    const tam = video[0].match(/,\s*(\d{2,5})x(\d{2,5})[\s,[]/);
    if (tam) { largura = +tam[1]; altura = +tam[2]; }
    const f = video[0].match(/([\d.]+)\s*fps/);
    if (f) fps = +f[1];
    if (!fps) { const tbr = video[0].match(/([\d.]+)\s*tbr/); if (tbr) fps = +tbr[1]; }
  }
  const audios = (texto.match(/Stream #\d+:\d+[^\n]*Audio:/g) || []).length;
  return {
    ok: !!dur,
    duracao: dur ? (+dur[1]) * 3600 + (+dur[2]) * 60 + parseFloat(dur[3]) : 0,
    largura, altura,
    fps: fps > 0 && fps < 241 ? fps : 30,
    audios,
  };
}

/** Converte a saída de -progress do FFmpeg em segundos já feitos. */
function lerProgresso(bloco) {
  const m = bloco.match(/out_time_(?:us|ms)=(\d+)/);
  if (m) return Number(m[1]) / 1e6;
  const t = bloco.match(/out_time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (t) return (+t[1]) * 3600 + (+t[2]) * 60 + parseFloat(t[3]);
  return null;
}

/**
 * Roda o FFmpeg com progresso. Devolve { promessa, cancelar }.
 * aoProgresso(fração 0..1)
 */
function executar(bin, args, duracaoTotal, aoProgresso, opcoes = {}) {
  const proc = spawn(bin, ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', ...args], { windowsHide: true, cwd: opcoes.cwd || undefined });
  let erroTexto = '';
  let cancelado = false;
  proc.stderr.on('data', d => { erroTexto = (erroTexto + d).slice(-8000); });
  proc.stdout.on('data', d => {
    const s = lerProgresso(String(d));
    if (s != null && duracaoTotal > 0 && aoProgresso) aoProgresso(Math.max(0, Math.min(1, s / duracaoTotal)));
  });
  const promessa = new Promise((resolve, reject) => {
    proc.on('error', e => reject(new Error('Não foi possível rodar o FFmpeg: ' + e.message)));
    proc.on('close', codigo => {
      if (cancelado) return reject(Object.assign(new Error('Cancelado.'), { cancelado: true }));
      if (codigo === 0) { if (aoProgresso) aoProgresso(1); return resolve(); }
      const linhas = erroTexto.trim().split('\n').map(l => l.trim()).filter(Boolean);
      const importantes = linhas.filter(l => /error|invalid|no such|not found|failed|unable|cannot|could not/i.test(l));
      reject(new Error('O FFmpeg falhou: ' + ((importantes.length ? importantes : linhas).slice(-3).join(' | ') || 'código ' + codigo)));
    });
  });
  return {
    promessa,
    cancelar: () => { cancelado = true; try { proc.kill(); } catch { /* já terminou */ } },
  };
}

module.exports = { candidatosFFmpeg, detectar, info, lerInfo, lerProgresso, executar, rodar };
