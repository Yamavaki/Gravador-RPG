'use strict';
// Sugestão de momentos: acha trechos da sessão que provavelmente valem um corte, mesmo
// sem marcador. Junta duas pistas:
//  - volume (picos de som: risadas, gritos, comemoração), medido pelo FFmpeg (ebur128);
//  - quem está falando (várias pessoas falando ao mesmo tempo = agito na mesa), do StreamKit.

const { spawn } = require('child_process');

/**
 * Volume (loudness "momentâneo", LUFS) de cada segundo de um arquivo, numa faixa de áudio.
 * Devolve um Float32Array (NaN onde não houve medida). aoProgresso(segundos lidos).
 */
function volumePorSegundo(bin, arquivo, faixa = 0, aoProgresso = null) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-nostdin', '-i', arquivo, '-map', `0:a:${faixa}?`, '-vn',
      '-af', 'aresample=16000,ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.M:file=-', '-f', 'null', '-'];
    const proc = spawn(bin, args, { windowsHide: true });
    const valores = [];
    let resto = '', tAtual = 0, erro = '', ultimoAviso = 0;
    proc.stdout.on('data', d => {
      const linhas = (resto + d).split('\n');
      resto = linhas.pop();
      for (const l of linhas) {
        const pt = l.match(/pts_time:([\d.]+)/);
        if (pt) { tAtual = Number(pt[1]); continue; }
        const m = l.match(/lavfi\.r128\.M=(-?[\d.]+|-inf)/);
        if (m) {
          const v = m[1] === '-inf' ? -120 : Number(m[1]);
          const s = Math.floor(tAtual);
          while (valores.length <= s) valores.push(NaN);
          if (!(valores[s] >= v)) valores[s] = v;          // o mais alto do segundo
          if (aoProgresso && s - ultimoAviso >= 30) { ultimoAviso = s; aoProgresso(s); }
        }
      }
    });
    proc.stderr.on('data', d => { erro = (erro + d).slice(-4000); });
    proc.on('error', e => reject(new Error('Não foi possível rodar o FFmpeg: ' + e.message)));
    proc.on('close', codigo => {
      if (codigo !== 0 && !valores.length) return reject(new Error('O FFmpeg não conseguiu ler o áudio: ' + (erro.trim().split('\n').pop() || codigo)));
      resolve(Float32Array.from(valores));
    });
  });
}

function mediana(arr) {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  return a[Math.floor(a.length / 2)];
}

/**
 * Sugestões a partir das pistas, tudo em tempo da SESSÃO.
 * o: {
 *   duracaoMs,                         // tamanho da sessão
 *   volume: Float32Array por segundo (NaN = sem medida), já em tempo da sessão
 *   falas: [{ chave, ini, fim }] (ms)  // quem falou quando
 *   marcadores: [{ rel }] (ms)         // já marcados: não sugere em cima deles
 *   nomes: { chave: 'Kael' }           // para explicar quem estava falando
 *   maximo, distancia (s), perto (s)
 * }
 * Devolve [{ t, ini, fim, nota, motivos: [..], quem: [..] }] ordenado pelo tempo.
 */
function sugerir(o) {
  const S = Math.max(1, Math.ceil((o.duracaoMs || 0) / 1000));
  const vol = o.volume || new Float32Array(0);
  // volume: quanto cada segundo está acima do normal da sessão (em "desvios")
  const validos = Array.from(vol).filter(v => Number.isFinite(v) && v > -70);
  const med = mediana(validos);
  const desvio = Number.isFinite(med) ? Math.max(1.5, 1.4826 * mediana(validos.map(v => Math.abs(v - med)))) : 1;
  const alto = new Float32Array(S);
  for (let s = 0; s < S; s++) {
    // pico sustentado: o MENOR dos 2 segundos em volta (um estalo isolado não conta)
    const a = vol[s], b = vol[s + 1];
    const v = Number.isFinite(a) && Number.isFinite(b) ? Math.min(a, b) : NaN;
    alto[s] = Number.isFinite(v) && Number.isFinite(med) ? Math.max(0, (v - med) / desvio) : 0;
  }
  // falas: quantas pessoas diferentes falando em cada segundo
  const quem = Array.from({ length: S }, () => new Set());
  for (const f of o.falas || []) {
    const a = Math.max(0, Math.floor(f.ini / 1000)), b = Math.min(S - 1, Math.floor(f.fim / 1000));
    for (let s = a; s <= b; s++) quem[s].add(f.chave);
  }
  const nota = new Float32Array(S);
  for (let s = 0; s < S; s++) {
    // janela de 4 s: o agito dura um pouco
    let pessoas = 0, pico = 0;
    const juntos = new Set();
    for (let k = Math.max(0, s - 2); k <= Math.min(S - 1, s + 1); k++) {
      pessoas = Math.max(pessoas, quem[k].size);
      pico = Math.max(pico, alto[k]);
      quem[k].forEach(c => juntos.add(c));
    }
    nota[s] = pico + 0.9 * Math.max(0, pessoas - 1) + (pessoas >= 3 ? 1 : 0) + 0.25 * Math.max(0, juntos.size - 2);
  }
  const limiar = o.limiar || 2.6;
  const distancia = (o.distancia || 60);
  const perto = (o.perto || 25);
  const marcados = (o.marcadores || []).map(m => m.rel / 1000);
  const horas = S / 3600;
  const maximo = o.maximo || Math.max(3, Math.min(30, Math.ceil(horas * 8)));
  const candidatos = [];
  for (let s = 1; s < S - 1; s++) {
    if (nota[s] < limiar || nota[s] < nota[s - 1] || nota[s] < nota[s + 1]) continue;
    candidatos.push(s);
  }
  candidatos.sort((a, b) => nota[b] - nota[a]);
  const escolhidos = [];
  for (const s of candidatos) {
    if (escolhidos.length >= maximo) break;
    if (escolhidos.some(e => Math.abs(e - s) < distancia)) continue;
    if (marcados.some(m => Math.abs(m - s) < perto)) continue;
    escolhidos.push(s);
  }
  return escolhidos.sort((a, b) => a - b).map(s => {
    let pico = 0, pessoas = 0;
    const juntos = new Set();
    for (let k = Math.max(0, s - 2); k <= Math.min(S - 1, s + 1); k++) {
      pico = Math.max(pico, alto[k]);
      pessoas = Math.max(pessoas, quem[k].size);
      quem[k].forEach(c => juntos.add(c));
    }
    const motivos = [];
    if (pico >= 2) motivos.push(pico >= 4 ? 'Volume bem alto (risadas, gritos?)' : 'Volume alto');
    if (pessoas >= 2) motivos.push(`${pessoas} pessoas falando ao mesmo tempo`);
    if (!motivos.length) motivos.push('Mesa agitada');
    const nomes = [...juntos].map(c => (o.nomes && o.nomes[c]) || '').filter(Boolean);
    return { t: s * 1000, nota: Math.round(nota[s] * 10) / 10, motivos, quem: nomes };
  });
}

module.exports = { volumePorSegundo, sugerir, mediana };
