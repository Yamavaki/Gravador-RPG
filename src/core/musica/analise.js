/* Análise da música para o editor de seções (vindo do Trilha Viva):
   forma de onda, batidas e pontos de mudança para sugerir cortes.
   Recebe qualquer objeto com sampleRate, length, duration, numberOfChannels e
   getChannelData(i) (um AudioBuffer no navegador; um falso nos testes). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.AnaliseMusica = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /*
   * Análise da música para o editor de seções:
   *  - forma de onda (volume ao longo do tempo)
   *  - tempo (batidas) para os cortes "grudarem" no ritmo
   *  - pontos de mudança (onde a música muda de intensidade/timbre) para sugerir cortes
   */
  function analisar(buf) {
    const sr = buf.sampleRate, n = buf.length, dur = buf.duration;
    const c0 = buf.getChannelData(0);
    const c1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    const am = c1 ? (i => (c0[i] + c1[i]) * 0.5) : (i => c0[i]);

    // Forma de onda: volume médio em 2000 fatias
    const NB = 2000;
    const onda = new Float32Array(NB);
    let maxO = 0;
    for (let b = 0; b < NB; b++) {
      const s0 = Math.floor(b * n / NB), s1 = Math.floor((b + 1) * n / NB);
      let e = 0, k = 0;
      for (let i = s0; i < s1; i += 4) { const v = am(i); e += v * v; k++; }
      onda[b] = k ? Math.sqrt(e / k) : 0;
      if (onda[b] > maxO) maxO = onda[b];
    }
    if (maxO > 0) for (let b = 0; b < NB; b++) onda[b] /= maxO;

    // Envelope de ataques (para achar o tempo)
    const hop = 512, frame = 1024;
    const nf = Math.max(0, Math.floor((n - frame) / hop) + 1);
    const comp = new Float32Array(nf);
    for (let f = 0; f < nf; f++) {
      const i0 = f * hop;
      let e = 0;
      for (let i = i0; i < i0 + frame; i += 2) { const v = am(i); e += v * v; }
      comp[f] = Math.log1p(1000 * Math.sqrt(e / (frame / 2)));
    }
    const ataques = new Float32Array(nf);
    for (let f = 1; f < nf; f++) ataques[f] = Math.max(0, comp[f] - comp[f - 1]);
    const batidas = acharTempo(ataques, hop, frame, sr);

    // Blocos finos de 0,1 s: volume (dB) e "brilho" (cruzamentos por zero)
    const F = 0.1;
    const nf2 = Math.floor(dur / F);
    const fe = new Float64Array(nf2), fz = new Float64Array(nf2), fk = new Float64Array(nf2);
    for (let b = 0; b < nf2; b++) {
      const s0 = Math.floor(b * F * sr), s1 = Math.min(n, Math.floor((b + 1) * F * sr));
      let e = 0, z = 0, k = 0, ant = am(s0);
      for (let i = s0; i < s1; i += 2) {
        const v = am(i);
        e += v * v;
        if ((v >= 0) !== (ant >= 0)) z++;
        ant = v;
        k++;
      }
      fe[b] = e; fz[b] = z; fk[b] = k;
    }
    // Blocos de meio segundo (5 finos)
    const B = 0.5;
    const nbB = Math.floor(nf2 / 5);
    const db = new Float32Array(nbB), zc = new Float32Array(nbB);
    for (let b = 0; b < nbB; b++) {
      let e = 0, z = 0, k = 0;
      for (let j = b * 5; j < b * 5 + 5; j++) { e += fe[j]; z += fz[j]; k += fk[j]; }
      db[b] = 10 * Math.log10(e / Math.max(k, 1) + 1e-10);
      zc[b] = z / Math.max(k, 1);
    }
    const fdb = new Float32Array(nf2), fzc = new Float32Array(nf2);
    for (let b = 0; b < nf2; b++) { fdb[b] = 10 * Math.log10(fe[b] / Math.max(fk[b], 1) + 1e-10); fzc[b] = fz[b] / Math.max(fk[b], 1); }

    // Duas escalas: mudanças longas (8 s) e curtas (3 s, para introduções rápidas)
    const longa = picosDe(novidade(db, zc, 16), B, dur, 8);
    const curta = picosDe(novidade(db, zc, 6), B, dur, 2).map(p => ({ t: p.t, v: p.v * 0.9 }));
    const fina = novidade(fdb, fzc, 10);
    const picos = [];
    for (const p of [...longa, ...curta].sort((a, b) => b.v - a.v)) {
      // posição exata: maior mudança na escala fina, até 1,2 s em volta
      const b0 = Math.max(0, Math.round((p.t - 1.2) / F)), b1 = Math.min(nf2 - 1, Math.round((p.t + 1.2) / F));
      let melhor = Math.round(p.t / F), mv = -1;
      for (let b = b0; b <= b1; b++) if (fina[b] > mv) { mv = fina[b]; melhor = b; }
      const t = melhor * F;
      if (picos.every(q => Math.abs(q.t - t) >= 2.5)) picos.push({ t, v: p.v });
    }

    return { dur, onda, batidas, picos };
  }

  function acharTempo(o, hop, frame, sr) {
    const hopS = hop / sr;
    const N = Math.min(o.length, Math.round(120 / hopS));
    if (N < 300) return null;
    let m = 0;
    for (let i = 0; i < N; i++) m += o[i];
    m /= N;
    let z = 0;
    for (let i = 0; i < N; i++) z += (o[i] - m) ** 2;
    z /= N;
    if (!(z > 0)) return null;
    const lagMin = Math.max(2, Math.floor(60 / 190 / hopS));
    const lagMax = Math.ceil(60 / 60 / hopS);
    const ac = new Float64Array(lagMax + 2);
    for (let L = lagMin - 1; L <= lagMax + 1; L++) {
      let s = 0;
      for (let i = 0; i + L < N; i++) s += (o[i] - m) * (o[i + L] - m);
      ac[L] = s / (N - L) / z;
    }
    let melhor = -Infinity, bl = lagMin;
    for (let L = lagMin; L <= lagMax; L++) {
      const bpm = 60 / (L * hopS);
      const peso = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
      const sc = ac[L] * peso;
      if (sc > melhor) { melhor = sc; bl = L; }
    }
    if (!(ac[bl] > 0.06)) return null;
    const y0 = ac[bl - 1], y1 = ac[bl], y2 = ac[bl + 1];
    const den = y0 - 2 * y1 + y2;
    const d = den < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den)) : 0;
    const per = bl + d;
    let fase = 0, melhorS = -1;
    for (let ph = 0; ph < Math.ceil(per); ph++) {
      let s = 0;
      for (let k = ph; k < o.length; k += per) s += o[Math.round(k)] ?? 0;
      if (s > melhorS) { melhorS = s; fase = ph; }
    }
    const periodo = per * hopS;
    const faseT = ((fase * hop + frame / 2 - hop / 2) / sr) % periodo;
    return { periodo, fase: faseT, bpm: 60 / periodo };
  }

  function novidade(db, zc, W) {
    const nb = db.length;
    const nov = new Float32Array(nb);
    if (nb < 2 * W + 2) return nov;
    const desvio = a => {
      let m = 0;
      for (const x of a) m += x;
      m /= a.length;
      let v = 0;
      for (const x of a) v += (x - m) ** 2;
      return Math.sqrt(v / a.length) || 1;
    };
    const sd = desvio(db), sz = desvio(zc);
    const acum = a => { const p = new Float64Array(a.length + 1); for (let i = 0; i < a.length; i++) p[i + 1] = p[i] + a[i]; return p; };
    const pd = acum(db), pz = acum(zc);
    const media = (p, a, b) => (p[b] - p[a]) / (b - a);
    for (let b = W; b <= nb - W; b++) {
      nov[b] = Math.abs(media(pd, b - W, b) - media(pd, b, b + W)) / sd
        + 0.6 * Math.abs(media(pz, b - W, b) - media(pz, b, b + W)) / sz;
    }
    return nov;
  }

  function picosDe(nov, B, dur, R = 4) {
    const cand = [];
    for (let b = 1; b < nov.length - 1; b++) {
      const v = nov[b];
      if (v <= 0.35) continue;
      let maximo = true;
      for (let j = Math.max(0, b - R); j <= Math.min(nov.length - 1, b + R); j++) if (nov[j] > v) { maximo = false; break; }
      if (maximo) cand.push({ t: b * B, v });
    }
    cand.sort((a, b) => b.v - a.v);
    const sel = [];
    for (const c of cand) {
      if (c.t < 3 || c.t > dur - 3) continue;
      if (sel.every(s => Math.abs(s.t - c.t) >= 3)) sel.push(c);
    }
    return sel;
  }

  /** Cortes sugeridos para uma música qualquer. */
  function sugerirCortes(an, dur, alvo = 50, maximo = 6) {
    const n = Math.max(1, Math.min(maximo, Math.round(dur / alvo)));
    const maxV = an.picos[0]?.v ?? 0;
    const escolhidos = [];
    for (const p of an.picos) {
      if (p.v < 0.35 * maxV || escolhidos.length >= n) continue;
      if (escolhidos.every(t => Math.abs(t - p.t) >= Math.min(10, dur / 6))) escolhidos.push(p.t);
    }
    let cortes = escolhidos;
    if (!cortes.length) {
      const k = Math.max(1, Math.min(maximo, Math.round(dur / Math.max(alvo, 30))));
      cortes = Array.from({ length: k }, (_, i) => dur * (i + 1) / (k + 1));
    }
    return cortes.sort((a, b) => a - b);
  }

  /** Quatro cortes para Introdução · Fase 1 · Transição · Fase final · Encerramento. */
  function cortesChefe(an, dur) {
    const pk = an.picos;
    const entre = (a, b) => pk.filter(p => p.t >= a && p.t <= b);
    const primeiro = (lista, reserva) => (lista.length ? lista[0].t : reserva);
    const c1 = primeiro(entre(dur * 0.04, dur * 0.25), dur * 0.08);
    const c4 = primeiro(entre(Math.max(dur * 0.75, c1 + 20), dur * 0.97), dur * 0.9);
    const c2 = primeiro(entre(Math.max(dur * 0.35, c1 + 10), Math.min(dur * 0.7, c4 - 15)), (c1 + c4) / 2 - Math.min(8, (c4 - c1) / 6));
    const c3 = primeiro(entre(c2 + 4, Math.min(c2 + 25, c4 - 8)), Math.min(c2 + 12, (c2 + c4) / 2));
    const cortes = [c1, c2, c3, c4];
    const minGap = Math.min(3, dur / 12);
    for (let i = 0; i < cortes.length; i++) {
      const min = (i ? cortes[i - 1] : 0) + minGap;
      cortes[i] = Math.max(cortes[i], min);
    }
    for (let i = cortes.length - 1; i >= 0; i--) {
      const max = (i < cortes.length - 1 ? cortes[i + 1] : dur) - minGap;
      cortes[i] = Math.min(cortes[i], max);
    }
    return cortes;
  }

  function grudarBatida(an, t) {
    const b = an?.batidas;
    if (!b) return t;
    const k = Math.round((t - b.fase) / b.periodo);
    const x = b.fase + k * b.periodo;
    return x > 0 ? x : t;
  }

  /** Ajusta para o ponto mais silencioso em ±5 ms (evita estalo na emenda). */
  function grudarZero(buf, t) {
    const sr = buf.sampleRate;
    const c0 = buf.getChannelData(0);
    const c1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    const i0 = Math.round(t * sr);
    let melhor = i0, mv = Infinity;
    for (let i = Math.max(1, i0 - 240); i <= Math.min(buf.length - 2, i0 + 240); i++) {
      const v = Math.abs(c0[i]) + (c1 ? Math.abs(c1[i]) : 0);
      if (v < mv) { mv = v; melhor = i; }
    }
    return melhor / sr;
  }

  return { analisar: analisar, novidade: novidade, picosDe: picosDe, sugerirCortes: sugerirCortes, cortesChefe: cortesChefe, grudarBatida: grudarBatida, grudarZero: grudarZero };
});
