'use strict';
// Roda dentro de cada aba do navegador do app (YouTube ou outro site). Liga o áudio da página a uma captura
// que manda o som (PCM 48 kHz estéreo) para o bot do Discord, em vez de tocar nas caixas
// de som (a não ser que a pessoa ligue "ouvir aqui também").
// Nada é baixado: o vídeo toca normalmente na página, só o som é desviado.
const { ipcRenderer } = require('electron');

// cópia de src/musica/captura-worklet.js (um teste confere que as duas são iguais)
const CODIGO_WORKLET = `// INICIO-WORKLET
class CapturaGravadorRPG extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Int16Array(960 * 2);
    this.i = 0;
    this.som = false;
  }
  process(entradas) {
    const ent = entradas[0];
    if (ent && ent.length) {
      const l = ent[0], r = ent[1] || ent[0];
      for (let k = 0; k < l.length; k++) {
        let a = l[k], b = r[k];
        a = a > 1 ? 1 : a < -1 ? -1 : a;
        b = b > 1 ? 1 : b < -1 ? -1 : b;
        const x = (a * 32767) | 0, y = (b * 32767) | 0;
        this.buf[this.i++] = x;
        this.buf[this.i++] = y;
        if (x || y) this.som = true;
        if (this.i === this.buf.length) {
          if (this.som) this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
          this.buf = new Int16Array(960 * 2);
          this.i = 0;
          this.som = false;
        }
      }
    }
    return true;
  }
}
registerProcessor('captura-gravador-rpg', CapturaGravadorRPG);
// FIM-WORKLET`;

let ctx = null;
let entrada = null;
let local = null;
let ouvir = false;
let pronto = null;
const ligados = new WeakSet();
let ultimoTocando = null;

function enviar(int16) { ipcRenderer.send('aba:pcm', int16); }

function preparar() {
  if (pronto) return pronto;
  ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
  entrada = ctx.createGain();
  local = ctx.createGain();
  local.gain.value = ouvir ? 1 : 0;
  entrada.connect(local);
  local.connect(ctx.destination);
  const mudo = ctx.createGain();
  mudo.gain.value = 0;
  mudo.connect(ctx.destination);
  pronto = (async () => {
    try {
      // thread de áudio: o YouTube ocupado não faz o som do bot picotar
      const url = URL.createObjectURL(new Blob([CODIGO_WORKLET], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(url);
      const no = new AudioWorkletNode(ctx, 'captura-gravador-rpg', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      no.port.onmessage = ev => enviar(new Int16Array(ev.data));
      entrada.connect(no);
      no.connect(mudo);
      return 'worklet';
    } catch (e) {
      console.warn('Gravador RPG: sem AudioWorklet nesta página, usando ScriptProcessor', e);
    }
    const proc = ctx.createScriptProcessor(4096, 2, 2);
    entrada.connect(proc);
    proc.connect(mudo);
    proc.onaudioprocess = ev => {
      const e = ev.inputBuffer;
      const l = e.getChannelData(0);
      const r = e.numberOfChannels > 1 ? e.getChannelData(1) : l;
      const out = new Int16Array(l.length * 2);
      let algo = false;
      for (let i = 0; i < l.length; i++) {
        const a = Math.max(-1, Math.min(1, l[i])), b = Math.max(-1, Math.min(1, r[i]));
        const x = (a * 32767) | 0, y = (b * 32767) | 0;
        out[i * 2] = x;
        out[i * 2 + 1] = y;
        if (x || y) algo = true;
      }
      if (algo) enviar(out);
    };
    return 'script';
  })();
  return pronto;
}

function ligar(el) {
  if (!el || ligados.has(el) || !(el instanceof HTMLMediaElement)) return;
  ligados.add(el);
  try {
    preparar();
    ctx.createMediaElementSource(el).connect(entrada);
  } catch (e) {
    console.warn('Gravador RPG: não consegui ligar o áudio deste vídeo', e);
  }
}

// liga o vídeo no instante em que ele começa a tocar (antes de sair som nas caixas)
document.addEventListener('play', ev => { ligar(ev.target); if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }, true);

function varrer() {
  const midias = document.querySelectorAll('video, audio');
  for (const el of midias) ligar(el);
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  const tocando = [...midias].some(el => !el.paused && !el.ended && el.readyState > 2 && !el.muted);
  if (tocando !== ultimoTocando) { ultimoTocando = tocando; ipcRenderer.send('aba:estado', { tocando }); }
}

ipcRenderer.on('aba:ouvir', (_e, ligado) => {
  ouvir = !!ligado;
  if (local) local.gain.setTargetAtTime(ouvir ? 1 : 0, ctx.currentTime, 0.05);
});

window.addEventListener('DOMContentLoaded', () => {
  varrer();
  setInterval(varrer, 700);
});
