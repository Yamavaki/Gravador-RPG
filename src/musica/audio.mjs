// Contexto de áudio único a 48 kHz. Tudo o que toca passa pelo "mestre", que vai:
//  - para a captura (vira PCM e segue para o bot do Discord);
//  - para as caixas de som do PC só se a pessoa ligar "ouvir aqui também".
import { LIMITE_BUFFER } from "./util.mjs";

const buffers = new Map();   // src -> { promessa, buf, usado }
const duracoes = new Map();  // src -> segundos
const pendDur = new Map();   // src -> Promise<number>
let protecao = () => new Set();

let ctx = null;
let mestre = null;
let monitor = null;

export function contexto() {
  if (!ctx) {
    ctx = new AudioContext({ sampleRate: 48000, latencyHint: "playback" });
    mestre = ctx.createGain();
    monitor = ctx.createGain();
    monitor.gain.value = 0;
    mestre.connect(monitor);
    monitor.connect(ctx.destination);
  }
  return ctx;
}

export const saidaDe = () => { contexto(); return mestre; };

export function ouvirNoPC(ligado) {
  contexto();
  monitor.gain.setTargetAtTime(ligado ? 1 : 0, ctx.currentTime, 0.05);
}

/**
 * Captura o que sai do mestre em pedaços de PCM 16 bits estéreo intercalado (20 ms).
 * Usa um AudioWorklet (thread de áudio: não perde pedaços se a página travar um instante).
 * Se não der, cai para o ScriptProcessor antigo.
 */
export async function capturar(enviar) {
  contexto();
  const mudo = ctx.createGain();
  mudo.gain.value = 0;
  mudo.connect(ctx.destination);
  try {
    await ctx.audioWorklet.addModule("/motor/captura-worklet.js");
    const no = new AudioWorkletNode(ctx, "captura-gravador-rpg", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    no.port.onmessage = ev => enviar(new Int16Array(ev.data));
    mestre.connect(no);
    no.connect(mudo);
    return "worklet";
  } catch (e) {
    console.warn("Motor | sem AudioWorklet, usando ScriptProcessor", e);
  }
  const proc = ctx.createScriptProcessor(4096, 2, 2);
  mestre.connect(proc);
  proc.connect(mudo);
  proc.onaudioprocess = ev => {
    const e = ev.inputBuffer;
    const l = e.getChannelData(0);
    const r = e.numberOfChannels > 1 ? e.getChannelData(1) : l;
    const out = new Int16Array(l.length * 2);
    let algo = false;
    for (let i = 0; i < l.length; i++) {
      let a = l[i], b = r[i];
      a = a > 1 ? 1 : a < -1 ? -1 : a;
      b = b > 1 ? 1 : b < -1 ? -1 : b;
      const x = (a * 32767) | 0, y = (b * 32767) | 0;
      out[i * 2] = x;
      out[i * 2 + 1] = y;
      if (x || y) algo = true;
    }
    if (algo) enviar(out);
  };
  return "script";
}

export function aguardarContexto(c) {
  if (c.state === "running") return Promise.resolve();
  return new Promise(res => {
    const h = () => {
      if (c.state !== "running") return;
      c.removeEventListener("statechange", h);
      res();
    };
    c.addEventListener("statechange", h);
    c.resume?.().catch(() => {});
  });
}

export function definirProtecao(fn) { protecao = fn; }

export function carregar(src) {
  let r = buffers.get(src);
  if (!r) {
    r = { usado: Date.now(), buf: null };
    r.promessa = (async () => {
      const resp = await fetch(src);
      if (!resp.ok) throw new Error(`não consegui abrir o arquivo (erro ${resp.status})`);
      const dados = await resp.arrayBuffer();
      const buf = await contexto().decodeAudioData(dados);
      r.buf = buf;
      duracoes.set(src, buf.duration);
      limparCache();
      return buf;
    })();
    r.promessa.catch(() => buffers.delete(src));
    buffers.set(src, r);
  }
  r.usado = Date.now();
  return r.promessa;
}

/** Mantém no máximo ~20 min de áudio decodificado que não esteja em uso. */
function limparCache() {
  const protegidos = protecao();
  const livres = [...buffers.entries()].filter(([src, r]) => r.buf && !protegidos.has(src)).sort((a, b) => a[1].usado - b[1].usado);
  let total = livres.reduce((s, [, r]) => s + r.buf.duration, 0);
  while (total > 1200 && livres.length) {
    const [src, r] = livres.shift();
    total -= r.buf.duration;
    buffers.delete(src);
  }
}

export const duracaoCache = src => duracoes.get(src);
export const duracoesConhecidas = () => Object.fromEntries(duracoes);

export function duracao(src) {
  if (duracoes.has(src)) return Promise.resolve(duracoes.get(src));
  if (!pendDur.has(src)) {
    const p = new Promise(res => {
      const el = new Audio();
      el.preload = "metadata";
      let feito = false;
      const fim = v => {
        if (feito) return;
        feito = true;
        clearTimeout(t);
        el.removeAttribute("src");
        try { el.load(); } catch { /* ok */ }
        res(v);
      };
      el.addEventListener("loadedmetadata", () => fim(Number.isFinite(el.duration) ? el.duration : NaN));
      el.addEventListener("error", () => fim(NaN));
      const t = setTimeout(() => fim(NaN), 10000);
      el.src = src;
    }).then(async d => {
      if (!(d > 0)) {
        try { d = (await carregar(src)).duration; } catch { d = 0; }
      }
      if (!duracoes.has(src)) duracoes.set(src, d);
      pendDur.delete(src);
      return duracoes.get(src);
    });
    pendDur.set(src, p);
  }
  return pendDur.get(src);
}

/** Duração exata (a do áudio decodificado) para arquivos tocados por buffer. */
export async function duracaoReal(src) {
  const d = await duracao(src);
  if (d > 0 && d <= LIMITE_BUFFER) {
    try { return (await carregar(src)).duration; } catch { return d; }
  }
  return d;
}
