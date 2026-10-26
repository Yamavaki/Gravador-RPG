'use strict';
// Monta os comandos do FFmpeg para cada corte: presets, pedaços de gravação,
// áudio por faixa, vídeo vertical com câmera, retratos redesenhados.
// Só monta texto: quem roda é o midia.js. Assim dá para testar cada detalhe.

const path = require('path');
const Camera = require('./camera');
const Layout = require('./layout-retratos');

const PRESETS = {
  'youtube-2k': { id: 'youtube-2k', nome: 'YouTube 2K', tipo: 'horizontal', largura: 2560, altura: 1440, qualidade: 19, audioKbps: 192, fpsMax: 60 },
  'youtube-1080': { id: 'youtube-1080', nome: 'YouTube 1080p', tipo: 'horizontal', largura: 1920, altura: 1080, qualidade: 20, audioKbps: 192, fpsMax: 60 },
  whatsapp: { id: 'whatsapp', nome: 'WhatsApp', tipo: 'horizontal', largura: 1280, altura: 720, alvoMB: 16, audioKbps: 96, fpsMax: 30 },
  vertical: { id: 'vertical', nome: 'TikTok / Reels / Shorts', tipo: 'vertical', largura: 1080, altura: 1920, qualidade: 20, audioKbps: 160, fpsMax: 60 },
  'whatsapp-vertical': { id: 'whatsapp-vertical', nome: 'WhatsApp vertical', tipo: 'vertical', largura: 720, altura: 1280, alvoMB: 16, audioKbps: 96, fpsMax: 30 },
  rapido: { id: 'rapido', nome: 'Corte rápido (original)', tipo: 'copia' },
};

// ---------------------------------------------------------------- tempo e pedaços

/**
 * Arquivos da gravação em ordem, com a duração lida de cada um.
 * Cada arquivo começa onde o anterior terminou (o OBS divide sem perder quadros).
 * Entrada: [{ caminho, duracao (s), existe }] — saída com inicio (s desde o começo da sessão).
 */
function linhaDosArquivos(arquivos) {
  let t = 0;
  return arquivos.map(a => {
    const r = { ...a, inicio: t };
    t += Math.max(0, a.duracao || 0);
    return r;
  });
}

/** Quais pedaços de quais arquivos formam o trecho [ini, fim] (segundos da sessão). */
function pedacosDoTrecho(linha, ini, fim) {
  const pedacos = [];
  for (const a of linha) {
    const aFim = a.inicio + a.duracao;
    const de = Math.max(ini, a.inicio), ate = Math.min(fim, aFim);
    if (ate - de > 0.01) {
      if (a.existe === false) {
        const e = new Error('Parte deste trecho já foi apagada pela limpeza automática.');
        e.codigo = 'APAGADO';
        throw e;
      }
      pedacos.push({ arquivo: a.caminho, ss: de - a.inicio, dur: ate - de });
    }
  }
  if (!pedacos.length) {
    const e = new Error('Não há gravação neste trecho.');
    e.codigo = 'SEM_VIDEO';
    throw e;
  }
  return pedacos;
}

/** Intervalos de fala (segundos relativos ao corte), com 0,3 s de "segurar" e juntados. */
function intervalosFala(falas, chave, iniMs, fimMs, segurarMs = 300) {
  const lista = falas.filter(f => f.chave === chave && f.fim + segurarMs > iniMs && f.ini < fimMs)
    .map(f => [Math.max(0, (f.ini - iniMs) / 1000), Math.min((fimMs - iniMs) / 1000, (f.fim + segurarMs - iniMs) / 1000)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const juntos = [];
  for (const [a, b] of lista) {
    const u = juntos[juntos.length - 1];
    if (u && a <= u[1] + 0.05) u[1] = Math.max(u[1], b);
    else juntos.push([a, b]);
  }
  return juntos;
}

function n3(v) { return (Math.round(v * 1000) / 1000).toString(); }
function exprIntervalos(lista) {
  if (!lista.length) return '0';
  return lista.map(([a, b]) => `between(t,${n3(a)},${n3(b)})`).join('+');
}

/** Bitrate de vídeo (kbps) para caber no tamanho-alvo. */
function bitrateParaTamanho(alvoMB, duracaoS, audioKbps) {
  const totalKbps = (alvoMB * 8 * 1024 * 0.94) / Math.max(1, duracaoS);
  return Math.max(150, Math.floor(totalKbps - audioKbps));
}

// ---------------------------------------------------------------- comando

/**
 * @param {object} o
 *  pedacos: [{arquivo, ss, dur}]
 *  fonte: {largura, altura, fps, audios}
 *  preset: um de PRESETS
 *  audio: {modo:'faixa1'|'mix', volumes:{'1':100,'2':100,...}}
 *  vertical: {modo:'camera'|'inteira', camera:[pontos]}
 *  retratos: [{falando:arquivoPng, quieto:arquivoPng|null, intervalos:[[a,b]], indice}] + layout
 *  layout: {layout, tamanho, margem, comNome, quantidade}
 *  encoder: {nvenc, libx264}
 *  ffmpegVersaoMaior: número (para o jeito de passar o script de filtros)
 *  saida, arquivoFiltros
 *  bitrateKbps (opcional, força bitrate: usado no compilado)
 * @returns {{ args: string[], filtros: string|null, duracao: number, avisos: string[] }}
 */
function b2n(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }

function montarComando(o) {
  const p = o.preset;
  const duracao = o.pedacos.reduce((s, x) => s + x.dur, 0);
  const avisos = [];
  const args = [];

  if (p.tipo === 'copia') {
    if (o.pedacos.length === 1) {
      const x = o.pedacos[0];
      args.push('-ss', n3(x.ss), '-i', x.arquivo, '-t', n3(x.dur), '-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', o.saida);
      return { args, filtros: null, lista: null, duracao, avisos };
    }
    const lista = o.pedacos.map(x => `file '${x.arquivo.replace(/\\/g, '/').replace(/'/g, "'\\''")}'\ninpoint ${n3(x.ss)}\noutpoint ${n3(x.ss + x.dur)}`).join('\n') + '\n';
    args.push('-f', 'concat', '-safe', '0', '-i', o.arquivoLista, '-map', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-movflags', '+faststart', o.saida);
    return { args, filtros: null, lista, duracao, avisos };
  }

  // entradas: cada pedaço com corte exato (-ss antes do -i + recodificação = preciso)
  for (const x of o.pedacos) args.push('-ss', n3(x.ss), '-t', n3(x.dur), '-i', x.arquivo);
  const retratos = o.retratos || [];
  const imagens = [];
  for (const r of retratos) {
    for (const tipo of ['falando', 'quieto']) {
      if (!r[tipo]) continue;
      imagens.push({ r, tipo, entrada: o.pedacos.length + imagens.length });
      args.push('-loop', '1', '-t', n3(duracao), '-i', r[tipo]);
    }
  }

  const fps = o.fpsFixo || Math.min(p.fpsMax || 60, Math.round(o.fonte.fps || 30)) || 30;
  const K = Math.max(0, o.fonte.audios | 0);
  let proxEntrada = o.pedacos.length + imagens.length;
  // imagem final: entra com fade por cima do fim do corte e fica na tela; o vídeo é esticado no fim
  const fin = o.final && o.final.arquivo ? o.final : null;
  const fadeFim = fin ? Math.max(0, Math.min(Number(fin.fade) || 0, duracao)) : 0;
  const extra = fin ? Math.max(0, (Number(fin.duracao) || 0) - fadeFim) : 0;
  const total = duracao + extra;            // duração do arquivo final
  const t0Fim = duracao - fadeFim;
  // camadas da identidade visual (PNG já no tamanho final, com a opacidade aplicada)
  const camadas = (o.camadas || []).filter(c => c && c.arquivo).map(c => {
    const e = { ...c, entrada: proxEntrada++ };
    args.push('-loop', '1', '-framerate', String(fps), '-t', n3(duracao), '-i', c.arquivo);
    return e;
  });
  // fundo próprio do vertical "tela inteira" (cor ou imagem, PNG do tamanho do quadro)
  const inteira = p.tipo === 'vertical' && (o.vertical || {}).modo === 'inteira';
  const fundo = inteira && o.fundo ? o.fundo : null;
  let entFundo = -1;
  if (fundo && fundo.arquivo) { entFundo = proxEntrada++; args.push('-loop', '1', '-framerate', String(fps), '-t', n3(duracao), '-i', fundo.arquivo); }
  // anotações (tutoriais): PNGs no tamanho do vídeo ORIGINAL, desenhados antes da câmera
  const anotacoes = (o.anotacoes || []).filter(a => a && a.arquivo && b2n(a.b) > b2n(a.a)).map(a => {
    const e = { ...a, entrada: proxEntrada++ };
    args.push('-loop', '1', '-framerate', String(fps), '-t', n3(duracao), '-i', a.arquivo);
    return e;
  });
  let entFinal = -1;
  if (fin) { entFinal = proxEntrada++; args.push('-loop', '1', '-framerate', String(fps), '-t', n3(total), '-i', fin.arquivo); }
  let entMusica = -1;
  const mus = o.musica && o.musica.arquivo ? o.musica : null;
  if (mus) {
    entMusica = proxEntrada++;
    args.push('-stream_loop', '-1', '-ss', n3(Math.max(0, Number(mus.inicio) || 0)), '-t', n3(total), '-i', mus.arquivo);
  }
  const f = [];
  const n = o.pedacos.length;

  // junta os pedaços
  if (n > 1) {
    const ent = o.pedacos.map((_, i) => `[${i}:v:0]` + Array.from({ length: K }, (__, k) => `[${i}:a:${k}]`).join('')).join('');
    f.push(`${ent}concat=n=${n}:v=1:a=${K}[vc]` + Array.from({ length: K }, (_, k) => `[ac${k}]`).join(''));
  }
  const vEntrada = n > 1 ? '[vc]' : '[0:v:0]';
  const aEntrada = k => (n > 1 ? `[ac${k}]` : `[0:a:${k}]`);

  // anotações por cima do vídeo original (acompanham o zoom da câmera)
  let vFonte = vEntrada;
  anotacoes.forEach((a, i) => {
    const ini = Math.max(0, b2n(a.a)), fim = Math.min(duracao, b2n(a.b));
    if (fim <= ini) return;
    const fd = Math.min(b2n(a.fade), (fim - ini) / 2);
    const fades = fd > 0.01 ? `,fade=t=in:st=${n3(ini)}:d=${n3(fd)}:alpha=1,fade=t=out:st=${n3(fim - fd)}:d=${n3(fd)}:alpha=1` : '';
    f.push(`[${a.entrada}:v]format=rgba${fades}[an${i}]`);
    f.push(`${vFonte}[an${i}]overlay=x=${Math.round(a.x)}:y=${Math.round(a.y)}:enable='between(t,${n3(ini)},${n3(fim)})':format=auto[va${i}]`);
    vFonte = `[va${i}]`;
  });
  // vídeo
  const W = p.largura, H = p.altura;
  if (inteira) {
    const fu = fundo || { y: 0.5, escala: 1 };
    const larg = Math.max(2, Math.round((W * (Number(fu.escala) || 1)) / 2) * 2);
    const yc = Math.round((Number.isFinite(Number(fu.y)) ? Number(fu.y) : 0.5) * H);
    if (entFundo >= 0) {
      f.push(`${vFonte}fps=${fps},scale=${larg}:-2[frente]`);
      f.push(`[${entFundo}:v]scale=${W}:${H},setsar=1[fundo]`);
    } else {
      f.push(`${vFonte}fps=${fps},split[vf1][vf2]`);
      f.push(`[vf1]scale=-2:${H},crop=${W}:${H},boxblur=20:2,eq=brightness=-0.08[fundo]`);
      f.push(`[vf2]scale=${larg}:-2[frente]`);
    }
    f.push(`[fundo][frente]overlay=x=(W-w)/2:y=${yc}-h/2:shortest=1,setsar=1[v0]`);
  } else if (p.tipo === 'vertical') {
    const e = Camera.expressoesPerspective((o.vertical || {}).camera, o.fonte.largura, o.fonte.altura, fps);
    const q = s => `'${s}'`;
    f.push(`${vFonte}fps=${fps},perspective=x0=${q(e.x0)}:y0=${q(e.y0)}:x1=${q(e.x1)}:y1=${q(e.y1)}:x2=${q(e.x2)}:y2=${q(e.y2)}:x3=${q(e.x3)}:y3=${q(e.y3)}:sense=source:eval=frame:interpolation=linear,scale=${W}:${H}:flags=bicubic,setsar=1[v0]`);
  } else if (o.cameraH && o.cameraH.length) {
    // horizontal com câmera (zoom em partes da tela): mesma conta do vertical, com caixa 16:9
    const e = Camera.expressoesPerspective(o.cameraH, o.fonte.largura, o.fonte.altura, fps, W / H);
    const q = s => `'${s}'`;
    f.push(`${vFonte}fps=${fps},perspective=x0=${q(e.x0)}:y0=${q(e.y0)}:x1=${q(e.x1)}:y1=${q(e.y1)}:x2=${q(e.x2)}:y2=${q(e.y2)}:x3=${q(e.x3)}:y3=${q(e.y3)}:sense=source:eval=frame:interpolation=linear,scale=${W}:${H}:flags=bicubic,setsar=1[v0]`);
  } else {
    f.push(`${vFonte}fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=bicubic,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1[v0]`);
  }

  let atual = '[v0]';
  // identidade visual (logo, textos): por baixo dos retratos e das legendas
  camadas.forEach((c, i) => {
    f.push(`${atual}[${c.entrada}:v]overlay=x=${Math.round(c.x)}:y=${Math.round(c.y)}:format=auto:eof_action=pass[vc${i}]`);
    atual = `[vc${i}]`;
  });
  // retratos por cima
  if (imagens.length) {
    const lay = Layout.posicoes({ ...o.layout, W, H });
    // os adesivos vêm desenhados no tamanho pedido (×1,6 no "só quem fala" do vertical); se o
    // layout encolheu para caber todo mundo, as imagens encolhem junto
    const tamDesenhado = !o.layout.ancora && o.layout.layout === 'quem-fala' ? o.layout.tamanho * 1.6 : o.layout.tamanho;
    const soQuemFala = o.layout.ancora ? o.layout.mostrar === 'falando' : o.layout.layout === 'quem-fala';
    const fator = lay.medidas.tam / Layout.medidas(tamDesenhado, o.layout.comNome).tam;
    imagens.forEach((img, i) => {
      const centro = soQuemFala ? lay.centros[0] : lay.centros[img.r.indice] || lay.centros[0];
      const canto = Layout.cantoAdesivo(centro, lay.medidas);
      const fala = exprIntervalos(img.r.intervalos);
      const enable = img.tipo === 'falando' ? fala : `eq(${fala},0)`;
      const saida = i === imagens.length - 1 ? '[vr]' : `[vr${i}]`;
      let entrada = `[${img.entrada}:v]`;
      if (Math.abs(fator - 1) > 0.002) {
        f.push(`${entrada}scale=iw*${fator.toFixed(4)}:ih*${fator.toFixed(4)}[ad${i}]`);
        entrada = `[ad${i}]`;
      }
      f.push(`${atual}${entrada}overlay=x=${canto.x}:y=${canto.y}:enable='${enable}':format=auto${saida}`);
      atual = saida;
    });
  }
  // legendas queimadas no vídeo (arquivo .ass na pasta de trabalho do FFmpeg)
  if (o.legendas) {
    const fontes = o.pastaFontes ? `:fontsdir=${o.pastaFontes.replace(/\\/g, '/').replace(/:/g, '\\:')}` : '';
    f.push(`${atual}subtitles=filename=${o.legendas}${fontes}[vleg]`);
    atual = '[vleg]';
  }
  if (fin) {
    if (extra > 0) { f.push(`${atual}tpad=stop_mode=clone:stop_duration=${n3(extra)}[vt]`); atual = '[vt]'; }
    if (fadeFim > 0) {
      f.push(`[${entFinal}:v]format=rgba,fade=t=in:st=${n3(t0Fim)}:d=${n3(fadeFim)}:alpha=1[vfi]`);
      f.push(`${atual}[vfi]overlay=0:0:format=auto[vfim]`);
    } else {
      f.push(`${atual}[${entFinal}:v]overlay=0:0:format=auto:enable='gte(t,${n3(t0Fim)})'[vfim]`);
    }
    atual = '[vfim]';
  }
  f.push(`${atual}format=yuv420p[vout]`);

  // áudio
  let temAudio = K > 0;
  const usadasAudio = new Set();
  if (temAudio) {
    const a = o.audio || { modo: 'faixa1', volumes: {} };
    const vol = k => Math.max(0, Math.min(200, Number((a.volumes || {})[String(k + 1)] ?? 100))) / 100;
    if (a.modo === 'mix' && K > 1) {
      const usadas = [];
      for (let k = 1; k < K; k++) if (vol(k) > 0) usadas.push(k);
      if (!usadas.length) { avisos.push('Todas as faixas estão no zero: o corte fica sem som.'); temAudio = false; }
      else {
        usadas.forEach(k => { usadasAudio.add(k); f.push(`${aEntrada(k)}volume=${vol(k).toFixed(2)}[am${k}]`); });
        f.push(usadas.map(k => `[am${k}]`).join('') + `amix=inputs=${usadas.length}:normalize=0:duration=first,aresample=48000[abase]`);
      }
    } else {
      if (a.modo === 'mix' && K < 2) avisos.push('Este vídeo só tem uma faixa de áudio: usei ela.');
      usadasAudio.add(0);
      f.push(`${aEntrada(0)}volume=${vol(0).toFixed(2)},aresample=48000[abase]`);
    }
  }
  // ao juntar pedaços, toda saída do concat precisa ir para algum lugar
  if (n > 1) for (let k = 0; k < K; k++) if (!usadasAudio.has(k)) f.push(`${aEntrada(k)}anullsink`);

  // sem som (todas as faixas no zero ou vídeo mudo): põe silêncio, para todo arquivo ter áudio
  // (redes sociais e o compilado esperam sempre uma faixa)
  if (!temAudio && (o.sempreAudio || mus)) {
    const ent = proxEntrada++;
    args.push('-f', 'lavfi', '-t', n3(duracao), '-i', 'anullsrc=r=48000:cl=stereo');
    f.push(`[${ent}:a]anull[abase]`);
    temAudio = true;
  }
  if (temAudio) {
    let a = '[abase]';
    // imagem final: o som do corte some junto com o fade e fica em silêncio até o fim
    if (fin && (fadeFim > 0 || extra > 0)) {
      const partes = [];
      if (fadeFim > 0) partes.push(`afade=t=out:st=${n3(t0Fim)}:d=${n3(fadeFim)}`);
      if (extra > 0) partes.push(`apad=pad_dur=${n3(extra)}`);
      f.push(`${a}${partes.join(',')}[afim]`);
      a = '[afim]';
    }
    if (mus) {
      const fi = Math.min(Number(mus.fadeIn) || 0, total), fo = Math.min(Number(mus.fadeOut) || 0, total);
      const cadeia = [`aresample=48000`, `aformat=sample_fmts=fltp:channel_layouts=stereo`, `volume=eval=frame:volume='${mus.expr || '1'}'`];
      if (fi > 0) cadeia.push(`afade=t=in:st=0:d=${n3(fi)}`);
      if (fo > 0) cadeia.push(`afade=t=out:st=${n3(Math.max(0, total - fo))}:d=${n3(fo)}`);
      f.push(`[${entMusica}:a]${cadeia.join(',')}[mus]`);
      f.push(`${a}aformat=sample_fmts=fltp:channel_layouts=stereo[acl]`);
      f.push(`[acl][mus]amix=inputs=2:normalize=0:duration=first,aresample=48000[aout]`);
    } else {
      f.push(`${a}anull[aout]`);
    }
  }

  args.push('-filter_complex_script_marcador');
  args.push('-map', '[vout]');
  if (temAudio) args.push('-map', '[aout]');

  // codificação
  const nv = o.encoder && o.encoder.nvenc;
  let kbps = o.bitrateKbps || null;
  if (!kbps && p.alvoMB) {
    kbps = bitrateParaTamanho(p.alvoMB, total, p.audioKbps);
    if (kbps < 500) avisos.push(`Corte longo para caber em ${p.alvoMB} MB: a qualidade fica baixa. Encurte o corte ou use outro formato.`);
  }
  if (nv) {
    args.push('-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-profile:v', 'high');
    if (kbps) args.push('-rc', 'vbr', '-b:v', kbps + 'k', '-maxrate', Math.round(kbps * 1.5) + 'k', '-bufsize', Math.round(kbps * 2) + 'k');
    else args.push('-rc', 'vbr', '-cq', String(p.qualidade), '-b:v', '0');
  } else {
    args.push('-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high');
    if (kbps) args.push('-b:v', kbps + 'k', '-maxrate', Math.round(kbps * 1.5) + 'k', '-bufsize', Math.round(kbps * 2) + 'k');
    else args.push('-crf', String(p.qualidade));
  }
  args.push('-g', String(fps * 2), '-pix_fmt', 'yuv420p');
  if (temAudio) args.push('-c:a', 'aac', '-b:a', p.audioKbps + 'k', '-ar', '48000', '-ac', '2');
  else args.push('-an');
  args.push('-t', n3(total), '-movflags', '+faststart', o.saida);

  // o script de filtros vai num arquivo (evita o limite de tamanho da linha de comando do Windows)
  const i = args.indexOf('-filter_complex_script_marcador');
  const nome = o.opcaoFiltroArquivo || ((o.ffmpegVersaoMaior || 6) >= 7 ? '-/filter_complex' : '-filter_complex_script');
  const opcao = [nome, o.arquivoFiltros];
  args.splice(i, 1, ...opcao);
  return { args, filtros: f.join(';\n'), lista: null, duracao: total, avisos };
}

/** Nome de arquivo seguro para o Windows. */
function nomeArquivo(...partes) {
  const s = partes.filter(Boolean).join(' - ')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return (s || 'corte').slice(0, 150);
}

/** Primeiro nome livre na pasta: "nome.mp4", "nome (2).mp4"... */
function caminhoLivre(pasta, base, existe) {
  let c = path.join(pasta, base + '.mp4');
  let i = 2;
  while (existe(c)) c = path.join(pasta, `${base} (${i++}).mp4`);
  return c;
}

module.exports = {
  PRESETS, linhaDosArquivos, pedacosDoTrecho, intervalosFala, exprIntervalos, bitrateParaTamanho,
  montarComando, nomeArquivo, caminhoLivre,
};
