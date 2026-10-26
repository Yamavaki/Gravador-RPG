// Liga o motor (Trilha Viva adaptado) ao app: comandos chegam pela "ponte"
// (preload do Electron, ou um falso nos testes), o estado e o áudio voltam por ela.
import { motor } from "./motor.mjs";
import { Trilha, lerEstado, definirAoMudar } from "./estado.mjs";
import { contexto, capturar, ouvirNoPC, definirProtecao, duracoesConhecidas } from "./audio.mjs";
import { definirAviso } from "./util.mjs";

const ponte = window.ponte;
if (!ponte) throw new Error("Motor aberto fora do app.");

definirAviso(texto => ponte.aviso(String(texto)));
definirProtecao(() => motor.srcsEmUso());
motor.aoPromover = (id, proxId) => Trilha.promover(id, proxId);
motor.aoTocar = () => publicar();
definirAoMudar(e => { motor.definirEstado(e); publicar(); });

const ctx = contexto();
let modoCaptura = "";
const captura = capturar(pcm => ponte.pcm(pcm)).then(m => { modoCaptura = m; });
ctx.resume().catch(() => {});

let tPub = null;
function publicar() {
  if (tPub) return;
  tPub = setTimeout(() => {
    tPub = null;
    const e = lerEstado();
    const usados = motor.srcsEmUso();
    const dur = duracoesConhecidas();
    const duracoes = {};
    for (const src of usados) if (dur[src] != null) duracoes[src] = dur[src];
    for (const c of Object.values(e.camadas ?? {})) for (const i of c.fila ?? []) if (dur[i.src] != null) duracoes[i.src] = dur[i.src];
    const tocando = [...motor.vivos.values()].filter(v => v.atual).map(v => v.id);
    ponte.estado({ estado: e, duracoes, tocando, agora: Date.now(), audio: ctx.state, captura: modoCaptura });
  }, 40);
}

// Só estes comandos podem vir de fora.
const COMANDOS = [
  "tocarSom", "tocarFila", "pararCamada", "pararTudo", "pausar", "retomar", "volume", "volumeGeral",
  "irParaSecao", "irParaSecaoPorNome", "cancelarPendente", "mudarModo", "definirCrossfade", "irPara",
  "repetirSecao", "tocarDireto", "reordenar", "removerItem", "adicionarSons", "modoFila", "aleatorio",
  "tocarItem", "pular", "atualizarSecoes", "atualizarTipo",
];

ponte.aoComando(async pedido => {
  const { id, cmd, args } = pedido || {};
  try {
    if (cmd === "ouvirNoPC") ouvirNoPC(!!args?.[0]);
    else if (cmd === "estado") publicar();
    else if (COMANDOS.includes(cmd)) await Trilha[cmd](...(Array.isArray(args) ? args : []));
    else throw new Error("Comando desconhecido: " + cmd);
    ponte.responder?.(id, { ok: true });
  } catch (e) {
    ponte.responder?.(id, { erro: String(e?.message ?? e) });
  }
});

// se a placa de som sumir e voltar (fone desconectado), o contexto pode parar: tenta retomar
setInterval(() => { if (ctx.state === "suspended") ctx.resume().catch(() => {}); }, 2000);

captura.finally(() => { ponte.pronto(); publicar(); });
