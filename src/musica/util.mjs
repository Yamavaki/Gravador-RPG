// Utilidades do Trilha Viva (a parte comum vem de trilha-util.js, carregado antes).
const U = globalThis.TrilhaUtil;
export const { LIMITE_BUFFER, CORES_SECAO, posDoSeg, fimDaVolta, secoesOrd, temSecoes, embaralhar } = U;

export function novoId() {
  const a = new Uint8Array(6);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
}

// Um computador só: o relógio é o do próprio PC.
export const agora = () => Date.now();

export const clonar = o => (o == null ? o : JSON.parse(JSON.stringify(o)));

let avisar = () => {};
export function definirAviso(fn) { avisar = fn; }
export function aviso(texto) { avisar(texto); }
