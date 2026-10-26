// Estado do que está tocando e os comandos (vindo do Trilha Viva, sem o Foundry:
// o estado vive aqui na memória e cada mudança é entregue ao motor e ao app).
import { novoId, agora, posDoSeg, fimDaVolta, secoesOrd, temSecoes, embaralhar, clonar, aviso } from "./util.mjs";
import { duracaoReal, duracaoCache } from "./audio.mjs";

export const ESTADO_PADRAO = { camadas: {}, volumeGeral: 0.8, rev: 0 };

let estadoAtual = clonar(ESTADO_PADRAO);
let aoMudar = () => {};
export function definirAoMudar(fn) { aoMudar = fn; }

export function lerEstado() { return estadoAtual; }

/* Todas as alterações passam por esta fila para nunca se atropelarem. */
let filaEscrita = Promise.resolve();
function alterar(fn) {
  filaEscrita = filaEscrita.then(async () => {
    const e = clonar(lerEstado());
    e.camadas ??= {};
    e.volumeGeral ??= 0.8;
    const r = await fn(e);
    if (r === false) return;
    e.rev = (e.rev ?? 0) + 1;
    estadoAtual = e;
    aoMudar(e);
  }).catch(err => {
    console.error("Motor |", err);
    aviso(String(err.message ?? err));
  });
  return filaEscrita;
}

/* ------------------------------------------------------------ montagem */

/** Faixa da biblioteca (vinda do app: { uuid, src, nome, grupo, tipo, repetir, secoes }) → item da fila. */
export function itemDeSom(som) {
  return {
    id: novoId(),
    uuid: som.uuid,
    src: som.src,
    nome: som.nome,
    origem: som.grupo ?? "",
    tipo: som.tipo ?? "musica",
    secoes: clonar(som.secoes ?? [])
  };
}

export const itemAtual = c => c?.fila?.find(i => i.id === c.seg?.itemId) ?? null;
export const parando = c => c?.prox?.alvo?.tipo === "parar" && c.prox.quando === "agora";

function novaCamada(tipo, fila, modoFila) {
  return {
    id: novoId(),
    tipo,
    volume: { musica: 0.75, ambiente: 0.6, efeito: 0.8 }[tipo] ?? 0.7,
    fila,
    ordem: fila.map(i => i.id),
    modoFila,
    aleatorio: false,
    crossfade: 1.5,
    seg: null,
    prox: null,
    pausa: null,
    criado: agora()
  };
}

function segSecao(item, S, em, extra = {}) {
  return {
    id: novoId(), itemId: item.id, src: item.src, inicio: Math.round(em),
    offset: S.inicio, loopIni: S.inicio, loopFim: S.termino,
    secao: S.id, modo: S.acao === "loop" ? "secao" : "seguir", fadeIn: 0,
    ...extra
  };
}

function segInteiro(item, em, offset = 0, extra = {}) {
  return {
    id: novoId(), itemId: item.id, src: item.src, inicio: Math.round(em),
    offset, loopIni: 0, loopFim: 0, secao: null,
    modo: temSecoes(item) ? "inteira" : null, fadeIn: 0,
    ...extra
  };
}

function segInicio(item, em, extra = {}) {
  const ss = temSecoes(item) ? secoesOrd(item) : [];
  return ss.length ? segSecao(item, ss[0], em, extra) : segInteiro(item, em, 0, extra);
}

function mkProx(alvo, em, fade, seg, quando = "auto") {
  return { id: novoId(), alvo, em: Math.round(em), fade, seg, quando };
}

/* ------------------------------------------------------------ planejamento */

/** O que acontece quando o trecho atual terminar (se ninguém mandar outra coisa). */
async function planejarAuto(c) {
  const p = await planejarBase(c);
  if (p?.seg?.secao && c.livre) p.seg.modo = "seguir";
  return p;
}

async function planejarBase(c) {
  const seg = c.seg;
  if (!seg || c.pausa) return null;
  const item = itemAtual(c);
  const dur = await duracaoReal(seg.src);
  if (!(dur > 0)) return null;
  const T = fimDaVolta(seg, agora() + 400, dur);
  const secoes = temSecoes(item) ? secoesOrd(item) : [];

  if (seg.secao) {
    const idx = secoes.findIndex(s => s.id === seg.secao);
    const S = secoes[idx];
    if (!S) return proxFaixa(c, item, T, true);
    if (seg.modo === "secao") return null;
    if (seg.modo === "inteira") {
      const de = S.termino < dur - 0.05 ? S.termino : 0;
      return mkProx({ tipo: "continuar" }, T, 0, segInteiro(item, T, de, { modo: "inteira" }));
    }
    if (S.acao === "stop") return mkProx({ tipo: "parar" }, T - 20, 0.02, null);
    const N = secoes[idx + 1];
    if (N) return mkProx({ tipo: "secao", secaoId: N.id }, T, 0, segSecao(item, N, T));
    return proxFaixa(c, item, T, true);
  }
  if (seg.modo === "inteira") return null;
  return proxFaixa(c, item, T, false);
}

function proxFaixa(c, item, T, eraSecao) {
  const modo = c.modoFila ?? "uma";
  if (modo === "atual" || (modo === "fila" && c.fila.length === 1)) {
    if (!eraSecao || !item) return null;
    return mkProx({ tipo: "faixa", itemId: item.id }, T, 0, segInicio(item, T));
  }
  const ordem = ordemValida(c);
  let p = ordem.indexOf(item?.id) + 1;
  if (p >= ordem.length) {
    if (modo === "fila" && ordem.length) p = 0;
    else return mkProx({ tipo: "parar" }, T - 20, 0.02, null);
  }
  const seguinte = c.fila.find(i => i.id === ordem[p]);
  if (!seguinte) return mkProx({ tipo: "parar" }, T - 20, 0.02, null);
  const cf = Math.max(0, c.crossfade ?? 0);
  const em = Math.max(agora() + 400, T - cf * 1000);
  return mkProx({ tipo: "faixa", itemId: seguinte.id }, em, cf, segInicio(seguinte, em));
}

function ordemValida(c) {
  const ids = new Set(c.fila.map(i => i.id));
  const ordem = (c.ordem?.length ? c.ordem : c.fila.map(i => i.id)).filter(id => ids.has(id));
  for (const i of c.fila) if (!ordem.includes(i.id)) ordem.push(i.id);
  return ordem;
}

/** Replaneja só se não houver um pedido do Mestre na fila nem uma troca prestes a acontecer. */
async function replanejarSeguro(c) {
  if (!c.seg || c.pausa) return;
  if (c.prox && (c.prox.quando !== "auto" || c.prox.em - agora() < 1500)) return;
  c.prox = await planejarAuto(c);
}

/**
 * As seções da música que está tocando mudaram: passa a valer na hora,
 * a partir do ponto exato em que está (sem corte nem pulo).
 */
async function reancorar(c, item) {
  if (!c.seg) return;
  const dur = await duracaoReal(c.seg.src);
  const ss = temSecoes(item) ? secoesOrd(item) : [];
  const modoPara = (S, mesma) => (S.acao === "loop" && !c.livre) ? "secao" : (mesma && c.seg.modo === "secao" ? "secao" : "seguir");
  if (c.pausa) {
    const pos = c.pausa.pos;
    if (!ss.length) { c.seg = segInteiro(item, agora(), pos, { modo: null }); return; }
    const S = ss.find(s => pos >= s.inicio && pos < s.termino) ?? ss.at(-1);
    c.seg = segSecao(item, S, agora(), { offset: pos, modo: modoPara(S, c.seg.secao === S.id) });
    return;
  }
  const em = agora() + 500;
  if (c.prox && c.prox.em < em + 300) return;
  if (c.prox && c.prox.quando !== "auto") return;
  if (!c.seg.secao && c.seg.modo === "inteira" && ss.length) { await replanejarSeguro(c); return; }
  const { pos } = posDoSeg(c.seg, (em - c.seg.inicio) / 1000, dur);
  let novo;
  if (!ss.length) {
    if (!c.seg.secao) { await replanejarSeguro(c); return; }
    novo = segInteiro(item, em, pos, { modo: null });
  } else {
    const S = ss.find(s => pos >= s.inicio && pos < s.termino) ?? ss.at(-1);
    const modo = modoPara(S, c.seg.secao === S.id);
    if (c.seg.secao === S.id && Math.abs(c.seg.loopIni - S.inicio) < 0.001 && Math.abs(c.seg.loopFim - S.termino) < 0.001) {
      c.seg.modo = modo;
      c.prox = await planejarAuto(c);
      return;
    }
    novo = segSecao(item, S, em, { offset: pos, modo });
  }
  c.prox = mkProx({ tipo: "modo" }, em, 0, novo, "auto");
}

function substituirMusicas(e, em, cf) {
  let houve = false;
  for (const c of Object.values(e.camadas)) {
    if (c.tipo !== "musica") continue;
    if (c.pausa || !c.seg) { delete e.camadas[c.id]; continue; }
    if (parando(c)) continue;
    c.prox = mkProx({ tipo: "parar" }, em, cf, null, "agora");
    houve = true;
  }
  return houve;
}

function pararCamada(e, c, fade) {
  if (c.pausa || !c.seg) { delete e.camadas[c.id]; return; }
  c.prox = mkProx({ tipo: "parar" }, agora() + 350, fade, null, "agora");
}

/* ------------------------------------------------------------ informação ao vivo */

export function infoCamada(c, t = agora()) {
  let seg = c?.seg;
  if (!seg) return { item: null, dur: 0, pos: 0, volta: 1, secoes: [], S: null, seg: null };
  if (c.prox?.seg && !c.pausa && t >= c.prox.em) seg = c.prox.seg;
  const item = c.fila.find(i => i.id === seg.itemId) ?? null;
  const dur = duracaoCache(seg.src) ?? 0;
  let pos, volta;
  if (c.pausa) { pos = c.pausa.pos; volta = 1; }
  else ({ pos, volta } = posDoSeg(seg, (t - seg.inicio) / 1000, dur));
  const secoes = temSecoes(item) ? secoesOrd(item) : [];
  const S = seg.secao
    ? secoes.find(s => s.id === seg.secao) ?? null
    : secoes.find(s => pos >= s.inicio && pos < s.termino) ?? null;
  return { item, dur, pos, volta, secoes, S, seg };
}

export function camadaMusica(e = lerEstado()) {
  return Object.values(e.camadas ?? {})
    .filter(c => c.tipo === "musica" && c.seg && !parando(c))
    .sort((a, b) => b.criado - a.criado)[0] ?? null;
}

/* ------------------------------------------------------------ comandos do Mestre */

export const Trilha = {
  alterar,

  async tocarSom(som) {
    const item = itemDeSom(som);
    await duracaoReal(item.src).catch(() => {});
    return alterar(async e => {
      const ja = Object.values(e.camadas).find(c => itemAtual(c)?.uuid === som.uuid && !parando(c));
      if (ja) { pararCamada(e, ja, 1); return; }
      const em = agora() + 400;
      const c = novaCamada(item.tipo, [item], som.repetir ? "atual" : "uma");
      let fadeIn = item.tipo === "efeito" ? 0 : 0.6;
      if (item.tipo === "musica" && substituirMusicas(e, em, 1.5)) fadeIn = 1.5;
      c.seg = segInicio(item, em, { fadeIn });
      c.prox = await planejarAuto(c);
      e.camadas[c.id] = c;
    });
  },

  async tocarFila(sons, modo = "fila", aleatorio = false) {
    if (!sons.length) return;
    let itens = sons.map(itemDeSom);
    if (aleatorio) itens = embaralhar(itens);
    await duracaoReal(itens[0].src).catch(() => {});
    return alterar(async e => {
      const em = agora() + 400;
      const tipo = itens.every(i => i.tipo === itens[0].tipo) ? itens[0].tipo : "musica";
      const c = novaCamada(tipo, itens, ["fila", "uma"].includes(modo) ? modo : "fila");
      c.aleatorio = !!aleatorio;
      const fadeIn = tipo === "musica" && substituirMusicas(e, em, 1.5) ? 1.5 : 0.6;
      c.seg = segInicio(itens[0], em, { fadeIn });
      c.prox = await planejarAuto(c);
      e.camadas[c.id] = c;
    });
  },

  pararCamada(id, fade = 1) {
    return alterar(e => {
      const c = e.camadas[id];
      if (!c) return false;
      pararCamada(e, c, fade);
    });
  },

  pararTudo() {
    return alterar(e => {
      const cs = Object.values(e.camadas);
      if (!cs.length) return false;
      for (const c of cs) pararCamada(e, c, 1.2);
    });
  },

  pausar(id) {
    return alterar(async e => {
      const c = e.camadas[id];
      if (!c?.seg || c.pausa) return false;
      const dur = await duracaoReal(c.seg.src);
      const seg = c.prox?.seg && agora() >= c.prox.em ? c.prox.seg : c.seg;
      c.seg = seg;
      c.pausa = { pos: posDoSeg(seg, (agora() - seg.inicio) / 1000, dur).pos, em: agora() };
      c.prox = null;
    });
  },

  retomar(id) {
    return alterar(async e => {
      const c = e.camadas[id];
      if (!c?.seg || !c.pausa) return false;
      c.seg = { ...c.seg, id: novoId(), inicio: Math.round(agora() + 400), offset: c.pausa.pos, fadeIn: 0.4 };
      c.pausa = null;
      c.prox = await planejarAuto(c);
    });
  },

  volume(id, valor) {
    return alterar(e => {
      const c = e.camadas[id];
      if (!c) return false;
      c.volume = Math.max(0, Math.min(1, valor));
    });
  },

  volumeGeral(valor) {
    return alterar(e => { e.volumeGeral = Math.max(0, Math.min(1, valor)); });
  },

  /** Troca de seção: "volta" = no fim da volta atual; "agora" = na hora, com crossfade. */
  irParaSecao(id, secaoId, quando = "volta") {
    return alterar(async e => {
      const c = e.camadas[id];
      if (!c?.seg) return false;
      const item = itemAtual(c);
      const S = secoesOrd(item).find(s => s.id === secaoId);
      if (!S) return false;
      const dur = await duracaoReal(c.seg.src);
      if (c.pausa) {
        c.seg = segSecao(item, S, agora() + 400, { fadeIn: 0.4 });
        c.pausa = null;
        c.prox = await planejarAuto(c);
        return;
      }
      if (quando === "agora") {
        const em = agora() + 400;
        const cf = Math.max(0.05, c.crossfade ?? 1.5);
        c.prox = mkProx({ tipo: "secao", secaoId }, em, cf, segSecao(item, S, em), "agora");
      } else {
        const em = fimDaVolta(c.seg, agora() + 400, dur);
        const L = c.seg.loopFim > 0 ? c.seg.loopFim : dur;
        const emenda = Math.abs(S.inicio - L) < 0.02 ? 0 : 0.03;
        c.prox = mkProx({ tipo: "secao", secaoId }, em, emenda, segSecao(item, S, em), "volta");
      }
    });
  },

  irParaSecaoPorNome(nome, quando = "volta") {
    const alvo = String(nome).trim().toLowerCase();
    for (const c of Object.values(lerEstado().camadas ?? {})) {
      const S = secoesOrd(itemAtual(c)).find(s => s.nome.trim().toLowerCase() === alvo);
      if (S) return this.irParaSecao(c.id, S.id, quando);
    }
    aviso(`Nenhuma música tocando tem a seção "${nome}".`);
  },

  cancelarPendente(id) {
    return alterar(async e => {
      const c = e.camadas[id];
      if (!c?.prox || c.prox.quando === "auto") return false;
      c.prox = await planejarAuto(c);
    });
  },

  /** "secao" = repetir esta seção · "seguir" = seguir a música · "inteira" = repetir a música inteira */
  mudarModo(id, modo) {
    return alterar(async e => {
      const c = e.camadas[id];
      if (!c?.seg || c.pausa) return false;
      const item = itemAtual(c);
      if (!c.seg.secao) {
        if (modo === "inteira" || !temSecoes(item)) return false;
        const dur = await duracaoReal(c.seg.src);
        const em = agora() + 400;
        const { pos } = posDoSeg(c.seg, (em - c.seg.inicio) / 1000, dur);
        const ss = secoesOrd(item);
        const S = ss.find(s => pos >= s.inicio && pos < s.termino) ?? ss.at(-1);
        c.prox = mkProx({ tipo: "modo" }, em, 0, segSecao(item, S, em, { offset: pos, modo }), "auto");
        return;
      }
      c.seg.modo = modo;
      if (!c.prox || c.prox.quando === "auto") c.prox = await planejarAuto(c);
    });
  },

  definirCrossfade(id, seg) {
    return alterar(async e => {
      const c = e.camadas[id];
      if (!c) return false;
      c.crossfade = Math.max(0, Math.min(10, seg));
      await replanejarSeguro(c);
    });
  },

  /** Pular para um ponto da música (clique na linha do tempo). Todos ouvem a partir dali. */
  irPara(id, tempo) {
    return alterar(async e => {
      const c = e.camadas[id];
      if (!c?.seg) return false;
      const item = itemAtual(c);
      const dur = await duracaoReal(c.seg.src);
      const t = Math.max(0, Math.min(dur - 0.05, Number(tempo) || 0));
      const em = agora() + 400;
      const ss = temSecoes(item) ? secoesOrd(item) : [];
      let novo;
      if (ss.length && c.seg.modo !== "inteira") {
        const S = ss.find(s => t >= s.inicio && t < s.termino) ?? ss.at(-1);
        const modo = c.seg.secao === S.id ? c.seg.modo : (c.livre || S.acao !== "loop" ? "seguir" : "secao");
        novo = segSecao(item, S, em, { offset: t, modo });
      } else {
        novo = segInteiro(item, em, t, { modo: c.seg.modo });
      }
      if (c.pausa) { c.seg = novo; c.pausa = { pos: t, em: agora() }; return; }
      c.prox = mkProx({ tipo: "ir" }, em, 0.25, novo, "agora");
    });
  },

  /**
   * Botão de repetir de uma seção.
   * Na seção atual: liga/desliga o loop na hora, sem cortar nada.
   * Em outra seção: no fim da volta atual, vai para ela e fica repetindo (clicar de novo desiste).
   */
  repetirSecao(id, secaoId) {
    return alterar(async e => {
      const c = e.camadas[id];
      if (!c?.seg) return false;
      const item = itemAtual(c);
      const ss = secoesOrd(item);
      const S = ss.find(s => s.id === secaoId);
      if (!S) return false;
      const dur = await duracaoReal(c.seg.src);
      if (c.pausa) {
        c.seg = segSecao(item, S, agora() + 400, { modo: "secao" });
        c.pausa = { pos: S.inicio, em: agora() };
        return;
      }
      if (c.seg.secao === secaoId && c.seg.modo !== "inteira") {
        c.seg.modo = c.seg.modo === "secao" ? "seguir" : "secao";
        c.prox = await planejarAuto(c);
        return;
      }
      if (c.prox?.seg?.secao === secaoId && c.prox.quando === "volta" && c.prox.seg.modo === "secao") {
        c.prox = await planejarAuto(c);
        return;
      }
      let em, L;
      if (!c.seg.secao) {
        // Tocando a música inteira: entra no fim do trecho em que está agora.
        const t = agora() + 400;
        const { pos } = posDoSeg(c.seg, (t - c.seg.inicio) / 1000, dur);
        const atual = ss.find(s => pos >= s.inicio && pos < s.termino) ?? ss.at(-1);
        let resto = atual.termino - pos;
        em = t + Math.max(0.3, resto) * 1000;
        L = atual.termino;
      } else {
        em = fimDaVolta(c.seg, agora() + 400, dur);
        L = c.seg.loopFim > 0 ? c.seg.loopFim : dur;
      }
      const emenda = Math.abs(S.inicio - L) < 0.02 ? 0 : 0.03;
      c.prox = mkProx({ tipo: "secao", secaoId }, em, emenda, segSecao(item, S, em, { modo: "secao" }), "volta");
    });
  },

  /** Tocar direto: ignora os loops salvos e segue a música até o fim. */
  tocarDireto(id, ligado = true) {
    return alterar(async e => {
      const c = e.camadas[id];
      if (!c?.seg) return false;
      c.livre = !!ligado;
      if (ligado && c.seg.secao && c.seg.modo === "secao") c.seg.modo = "seguir";
      if (!c.pausa) c.prox = await planejarAuto(c);
    });
  },

  /* ---- fila ---- */

  reordenar(id, ids) {
    return alterar(async e => {
      const c = e.camadas[id];
      if (!c) return false;
      const pos = new Map(ids.map((x, i) => [x, i]));
      c.fila.sort((a, b) => (pos.get(a.id) ?? 999) - (pos.get(b.id) ?? 999));
      if (!c.aleatorio) c.ordem = c.fila.map(i => i.id);
      await replanejarSeguro(c);
    });
  },

  removerItem(id, itemId) {
    return alterar(async e => {
      const c = e.camadas[id];
      if (!c) return false;
      const resto = c.fila.filter(i => i.id !== itemId);
      if (!resto.length) { pararCamada(e, c, 1); return; }
      c.fila = resto;
      c.ordem = ordemValida(c);
      await replanejarSeguro(c);
    });
  },

  adicionarSons(id, sons) {
    return alterar(async e => {
      const c = e.camadas[id];
      if (!c || !sons.length) return false;
      const novos = sons.map(itemDeSom);
      c.fila.push(...novos);
      const ordem = ordemValida(c).filter(x => !novos.some(n => n.id === x));
      c.ordem = c.aleatorio ? [...ordem, ...embaralhar(novos.map(n => n.id))] : c.fila.map(i => i.id);
      if (c.modoFila === "uma" && c.fila.length > 1 && c.prox?.alvo?.tipo === "parar" && c.prox.quando === "auto") c.prox = null;
      await replanejarSeguro(c);
    });
  },

  modoFila(id, modo) {
    return alterar(async e => {
      const c = e.camadas[id];
      if (!c) return false;
      c.modoFila = modo;
      if (c.prox?.quando === "auto") c.prox = null;
      await replanejarSeguro(c);
    });
  },

  aleatorio(id, ligado) {
    return alterar(async e => {
      const c = e.camadas[id];
      if (!c) return false;
      c.aleatorio = !!ligado;
      const atual = c.seg?.itemId;
      const ids = c.fila.map(i => i.id);
      c.ordem = ligado ? [atual, ...embaralhar(ids.filter(x => x !== atual))].filter(Boolean) : ids;
      if (c.prox?.quando === "auto") c.prox = null;
      await replanejarSeguro(c);
    });
  },

  tocarItem(id, itemId) {
    return alterar(e => {
      const c = e.camadas[id];
      const alvo = c?.fila.find(i => i.id === itemId);
      if (!alvo) return false;
      const em = agora() + 400;
      if (c.pausa) { c.seg = segInicio(alvo, em, { fadeIn: 0.4 }); c.pausa = null; c.prox = null; return planejarAuto(c).then(p => { c.prox = p; }); }
      c.prox = mkProx({ tipo: "faixa", itemId }, em, Math.max(0.05, c.crossfade ?? 1.5), segInicio(alvo, em), "agora");
    });
  },

  pular(id, direcao) {
    const c = lerEstado().camadas?.[id];
    if (!c) return;
    const ordem = ordemValida(c);
    let p = ordem.indexOf(c.seg?.itemId) + direcao;
    if (p < 0) p = c.modoFila === "fila" ? ordem.length - 1 : 0;
    if (p >= ordem.length) p = 0;
    return this.tocarItem(id, ordem[p]);
  },

  /* ---- manutenção ---- */

  atualizarSecoes(uuid, secoes) {
    return alterar(async e => {
      let mudou = false;
      for (const c of Object.values(e.camadas)) {
        for (const item of c.fila) {
          if (item.uuid !== uuid) continue;
          item.secoes = clonar(secoes);
          mudou = true;
          if (c.seg?.itemId === item.id) await reancorar(c, item);
        }
      }
      if (!mudou) return false;
    });
  },

  atualizarTipo(uuid, tipo) {
    return alterar(e => {
      let mudou = false;
      for (const c of Object.values(e.camadas)) for (const item of c.fila) if (item.uuid === uuid) { item.tipo = tipo; mudou = true; }
      if (!mudou) return false;
    });
  },

  /** Chamado pelo motor do Mestre ativo quando um trecho termina. */
  promover(id, proxId) {
    return alterar(async e => {
      const c = e.camadas[id];
      if (!c || c.prox?.id !== proxId) return false;
      if (!c.prox.seg) { delete e.camadas[id]; return; }
      c.seg = c.prox.seg;
      c.prox = null;
      c.prox = await planejarAuto(c);
    });
  }
};
