// Captura do áudio para o bot (roda na thread de áudio, não trava quando a página está ocupada).
// Junta blocos de 20 ms em PCM 16 bits estéreo intercalado e manda para a página.
// Pedaços totalmente silenciosos não são enviados. (Uma cópia deste código vai em youtube-preload.js.)
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
