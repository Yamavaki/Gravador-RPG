import { agora, posDoSeg, LIMITE_BUFFER, aviso } from "./util.mjs";
import { contexto, saidaDe, carregar, duracao, aguardarContexto } from "./audio.mjs";

/* ------------------------------------------------------------------ vozes */

/** Voz com o áudio inteiro na memória: loops e emendas exatas na amostra. */
class VozBuffer {
  constructor(ctx, buf, saida) {
    this.ctx = ctx;
    this.duracao = buf.duration;
    this.ganho = ctx.createGain();
    this.ganho.connect(saida);
    this.no = ctx.createBufferSource();
    this.no.buffer = buf;
    this.no.connect(this.ganho);
    this.no.onended = () => this._limpar();
  }
  iniciar(quando, offset, loopIni, loopFim) {
    const n = this.no;
    const fim = loopFim > 0 ? Math.min(loopFim, this.duracao) : this.duracao;
    n.loop = true;
    n.loopStart = Math.max(0, Math.min(loopIni ?? 0, fim - 0.01));
    n.loopEnd = fim;
    n.start(quando, Math.max(0, Math.min(offset, this.duracao - 0.001)));
    this.iniciado = true;
  }
  pararEm(quando) {
    if (this.parado) return;
    this.parado = true;
    try {
      if (this.iniciado) this.no.stop(Math.max(0, quando));
      else this._limpar();
    } catch { this._limpar(); }
  }
  descartar() { this.pararEm(0); }
  _limpar() {
    try { this.no.disconnect(); this.ganho.disconnect(); } catch { /* já desligado */ }
  }
}

/** Voz para arquivos longos (mais de 10 min): toca em streaming, só repete a faixa inteira. */
class VozStream {
  constructor(ctx, src, saida, duracao) {
    this.ctx = ctx;
    this.duracao = duracao;
    this.el = new Audio();
    this.el.crossOrigin = "anonymous";
    this.el.preload = "auto";
    this.el.loop = true;
    this.el.src = src;
    this.ganho = ctx.createGain();
    this.ganho.connect(saida);
    this.no = ctx.createMediaElementSource(this.el);
    this.no.connect(this.ganho);
  }
  iniciar(quando, offset) {
    const atraso = Math.max(0, quando - this.ctx.currentTime);
    this._t1 = setTimeout(() => {
      try { this.el.currentTime = offset; } catch { /* ainda carregando */ }
      this.el.play().catch(e => console.warn("Motor |", e));
    }, atraso * 1000);
  }
  pararEm(quando) {
    if (this.parado) return;
    this.parado = true;
    const atraso = Math.max(0, quando - this.ctx.currentTime);
    setTimeout(() => {
      clearTimeout(this._t1);
      this.el.pause();
      this.el.removeAttribute("src");
      try { this.el.load(); } catch { /* ok */ }
      try { this.no.disconnect(); this.ganho.disconnect(); } catch { /* ok */ }
    }, atraso * 1000 + 30);
  }
  descartar() { this.pararEm(0); }
}

/** Voz silenciosa (arquivo que não carregou): mantém os tempos funcionando. */
class VozMuda {
  constructor(ctx, d) { this.ctx = ctx; this.duracao = d || 1; this.ganho = ctx.createGain(); }
  iniciar() {}
  pararEm() {}
  descartar() {}
}

function fadeOut(voz, inicio, dur) {
  const g = voz.ganho.gain;
  const v = g.value;
  g.cancelScheduledValues(inicio);
  g.setValueAtTime(v, inicio);
  g.linearRampToValueAtTime(0, inicio + dur);
  voz.pararEm(inicio + dur + 0.05);
}

/* ------------------------------------------------------------------ motor */

/**
 * Toca o estado (camadas, segmentos, próximo trecho) no tempo certo.
 * Veio do Trilha Viva: lá cada jogador tinha um motor; aqui só há um, no PC do bot.
 */
export class Motor {
  constructor() {
    this.vivos = new Map();
    this.estado = { camadas: {} };
    this.aoPromover = null;
    this._ctxs = new Set();
    this._volLocal = {};
  }

  definirEstado(estado) {
    this.estado = estado ?? { camadas: {} };
    this._volLocal = {};
    const ids = new Set([...Object.keys(this.estado.camadas ?? {}), ...this.vivos.keys()]);
    for (const id of ids) this._enfileirar(id);
  }

  srcsEmUso() {
    const s = new Set();
    for (const v of this.vivos.values()) {
      if (v.atual) s.add(v.atual.seg.src);
      if (v.agendado?.seg) s.add(v.agendado.seg.src);
    }
    for (const c of Object.values(this.estado?.camadas ?? {})) {
      if (c.seg) s.add(c.seg.src);
      if (c.prox?.seg) s.add(c.prox.seg.src);
    }
    return s;
  }

  /** Prévia de volume enquanto o Mestre arrasta o controle (antes de salvar). */
  volumeLocal(id, valor) {
    if (id) this._volLocal[id] = valor; else this._volLocal.geral = valor;
    for (const v of this.vivos.values()) {
      const c = this.estado?.camadas?.[v.id];
      if (c) this._aplicarVolume(v, c);
    }
  }

  _alvoVolume(c) {
    const vol = this._volLocal[c.id] ?? c.volume ?? 0.7;
    const geral = this._volLocal.geral ?? this.estado?.volumeGeral ?? 0.8;
    return vol * vol * geral * geral;
  }

  _aplicarVolume(v, c) {
    if (!v.saida) return;
    v.saida.gain.setTargetAtTime(this._alvoVolume(c), v.ctx.currentTime, 0.05);
  }

  _vivo(id) {
    let v = this.vivos.get(id);
    if (!v) {
      v = { id, cadeia: Promise.resolve(), atual: null, agendado: null, saida: null, ctx: null };
      this.vivos.set(id, v);
    }
    return v;
  }

  _enfileirar(id) {
    const v = this._vivo(id);
    v.cadeia = v.cadeia.then(() => this._sync(v)).catch(e => console.error("Motor |", e));
  }

  async _sync(v) {
    let c = this.estado?.camadas?.[v.id];
    if (!c || c.pausa || !c.seg) {
      this._silenciar(v, c?.pausa ? 0.25 : 0.6);
      if (!c && this.vivos.get(v.id) === v) this.vivos.delete(v.id);
      return;
    }
    this._aplicarVolume(v, c);

    const seg = c.seg;
    if (v.atual?.seg.id !== seg.id) {
      if (v.agendado?.seg && v.agendado.seg.id === seg.id && v.agendado.inicio !== undefined) {
        // O Mestre já passou para o próximo trecho: acompanha agora.
        this._promoverLocal(v, v.agendado, false);
      } else if (c.prox?.seg && v.atual && c.prox.seg.id === v.atual.seg.id) {
        // Já trocamos aqui e o estado ainda não chegou: tudo certo.
        return;
      } else {
        await this._iniciar(v, c, seg);
        c = this.estado?.camadas?.[v.id];
        if (!c || c.pausa || c.seg?.id !== v.atual?.seg.id) return;
      }
    }

    const prox = c.prox;
    if (!prox || (prox.seg && prox.seg.id === v.atual?.seg.id)) {
      if (v.agendado) this._cancelar(v);
      return;
    }
    if (v.agendado?.proxId === prox.id) return;
    if (v.agendado) this._cancelar(v);
    if (!v.atual) return;
    await this._agendar(v, c, prox);
  }

  async _criarVoz(v, c, src) {
    const ctx = contexto();
    this._vigiar(ctx);
    if (!v.saida || v.ctx !== ctx) {
      v.ctx = ctx;
      v.saida = ctx.createGain();
      v.saida.gain.value = this._alvoVolume(c);
      v.saida.connect(saidaDe());
    }
    let voz;
    let d = 0;
    try {
      d = await duracao(src);
      if (d > LIMITE_BUFFER) voz = new VozStream(ctx, src, v.saida, d);
      else voz = new VozBuffer(ctx, await carregar(src), v.saida);
    } catch (err) {
      console.error("Motor |", src, err);
      aviso(`Não consegui tocar a faixa (${err.message ?? err}).`);
      voz = new VozMuda(ctx, d);
    }
    await aguardarContexto(ctx);
    return voz;
  }

  async _iniciar(v, c, seg) {
    const voz = await this._criarVoz(v, c, seg.src);
    const cAgora = this.estado?.camadas?.[v.id];
    if (!cAgora || cAgora.pausa || cAgora.seg?.id !== seg.id) { voz.descartar(); return; }
    const ctx = voz.ctx;
    const now = ctx.currentTime;
    const e = (agora() - seg.inicio) / 1000;
    const ancora = now - e;
    const inicio = Math.max(now + 0.03, ancora);
    const { pos } = posDoSeg(seg, inicio - ancora, voz.duracao);
    const fadeIn = e < 1 ? (seg.fadeIn ?? 0) : 0.4;
    if (fadeIn > 0) {
      const g = voz.ganho.gain;
      g.setValueAtTime(0, inicio);
      g.linearRampToValueAtTime(1, inicio + fadeIn);
    }
    voz.iniciar(inicio, pos, seg.loopIni, seg.loopFim);
    if (v.agendado) this._cancelar(v);
    if (v.atual) fadeOut(v.atual.voz, now, 0.3);
    v.atual = { seg, voz, ancora };
    this._avisar();
  }

  async _agendar(v, c, prox) {
    const base = v.atual;
    const reg = { proxId: prox.id, seg: prox.seg, cancelado: false, voz: null, base };
    v.agendado = reg;
    if (prox.seg) {
      const voz = await this._criarVoz(v, c, prox.seg.src);
      if (reg.cancelado || v.agendado !== reg || v.atual !== base) { voz.descartar(); return; }
      reg.voz = voz;
    }
    const ctx = base.voz.ctx;
    const T = base.ancora + (prox.em - base.seg.inicio) / 1000;
    const now = ctx.currentTime;
    const inicio = Math.max(now + 0.03, T);
    const fade = Math.max(0, prox.fade ?? 0);

    const gb = base.voz.ganho.gain;
    gb.cancelScheduledValues(inicio);
    if (fade > 0) {
      gb.setValueAtTime(1, inicio);
      gb.linearRampToValueAtTime(0, inicio + fade);
    } else {
      gb.setValueAtTime(0, inicio);
    }

    if (reg.voz) {
      if (fade > 0) {
        const gn = reg.voz.ganho.gain;
        gn.setValueAtTime(0, inicio);
        gn.linearRampToValueAtTime(1, inicio + fade);
      }
      const { pos } = posDoSeg(prox.seg, inicio - T, reg.voz.duracao);
      reg.voz.iniciar(inicio, pos, prox.seg.loopIni, prox.seg.loopFim);
    }
    reg.T = T;
    reg.inicio = inicio;
    reg.fade = fade;
    reg.timer = setTimeout(() => this._promoverLocal(v, reg, true), Math.max(0, (inicio - ctx.currentTime) * 1000));
  }

  _cancelar(v) {
    const r = v.agendado;
    if (!r) return;
    v.agendado = null;
    r.cancelado = true;
    clearTimeout(r.timer);
    if (r.voz) r.voz.descartar();
    if (r.inicio !== undefined && r.base?.voz) {
      const g = r.base.voz.ganho.gain;
      const now = r.base.voz.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(1, now);
    }
  }

  _promoverLocal(v, reg, peloRelogio) {
    if (v.agendado !== reg) return;
    clearTimeout(reg.timer);
    v.agendado = null;
    if (v.atual) v.atual.voz.pararEm(reg.inicio + reg.fade + 0.05);
    v.atual = reg.voz ? { seg: reg.seg, voz: reg.voz, ancora: reg.T } : null;
    if (peloRelogio) this.aoPromover?.(v.id, reg.proxId);
    this._avisar();
  }

  _silenciar(v, fade) {
    this._cancelar(v);
    if (v.atual) {
      fadeOut(v.atual.voz, v.atual.voz.ctx.currentTime, fade);
      v.atual = null;
      this._avisar();
    }
  }

  /** Se o navegador suspender o áudio e depois voltar, recomeça tudo no tempo certo. */
  _vigiar(ctx) {
    if (this._ctxs.has(ctx)) return;
    this._ctxs.add(ctx);
    let anterior = ctx.state;
    ctx.addEventListener("statechange", () => {
      const voltou = anterior !== "running" && ctx.state === "running";
      anterior = ctx.state;
      if (!voltou) return;
      for (const v of this.vivos.values()) {
        if (v.ctx !== ctx || !v.atual) continue;
        this._cancelar(v);
        v.atual.voz.pararEm(0);
        v.atual = null;
      }
      this.definirEstado(this.estado);
    });
  }

  _avisar() {
    clearTimeout(this._tAviso);
    this._tAviso = setTimeout(() => this.aoTocar?.(), 30);
  }
}

export const motor = new Motor();
