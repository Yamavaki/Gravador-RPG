'use strict';
// Limpeza rotativa das gravações.
// Regras de segurança:
//  - só mexe em arquivos que o próprio OBS avisou que gravou enquanto o app estava aberto
//    (o registro), nunca em outros vídeos da pasta;
//  - nunca no arquivo que está sendo gravado nem em um modificado há menos de 2 minutos;
//  - pedaço perto de um marcador fica protegido (o clipe pode precisar dele);
//  - apaga do mais antigo para o mais novo, só até voltar para dentro do limite.

const fs = require('fs');
const path = require('path');

const ANTES_MS = 2 * 60 * 1000;  // um clipe pode começar até 2 min antes do marcador (padrão)
const DEPOIS_MS = 60 * 1000;
const RECENTE_MS = 2 * 60 * 1000;
const GB = 1024 ** 3;

/**
 * Mesmo arquivo, escrito de jeitos diferentes: o OBS manda "C:/Videos/x.mp4",
 * o Windows devolve "C:\Videos\x.mp4", e maiúsculas não importam no Windows.
 */
function normalizarCaminho(c, plataforma = process.platform) {
  if (!c) return c;
  return plataforma === 'win32' ? path.win32.resolve(String(c)) : String(c);
}
function chaveCaminho(c, plataforma = process.platform) {
  const n = normalizarCaminho(c, plataforma);
  return plataforma === 'win32' ? n.toLowerCase() : n;
}
function mesmoArquivo(a, b, plataforma = process.platform) {
  return !!a && !!b && chaveCaminho(a, plataforma) === chaveCaminho(b, plataforma);
}

/**
 * @param {object} p
 *  segmentos: [{ caminho, inicio, fim, tamanho }] (ms e bytes)
 *  marcadores: [ms]  (protegem de antesMs antes até depoisMs depois)
 *  protecoes: [[iniMs, fimMs]]  trechos que não podem perder vídeo (cortes salvos)
 *  intocaveis: [caminho]  arquivos em uso (exportações na fila)
 *  limiteHoras, limiteGB, agora, gravando (caminho em gravação ou '')
 */
function planejar({ segmentos, marcadores = [], protecoes = [], intocaveis = [], antesMs = ANTES_MS, depoisMs = DEPOIS_MS,
  limiteHoras, limiteGB, agora = Date.now(), gravando = '' }) {
  const lista = [...segmentos].sort((a, b) => a.inicio - b.inicio);
  const trechos = marcadores.map(m => [m - antesMs, m + depoisMs]).concat(protecoes);
  const protegido = s => trechos.some(([a, b]) => b >= s.inicio && a <= s.fim);
  const usados = new Set(intocaveis.map(c => chaveCaminho(c)));
  const intocavel = s => mesmoArquivo(s.caminho, gravando) || usados.has(chaveCaminho(s.caminho)) || agora - s.fim < RECENTE_MS;

  let horas = lista.reduce((t, s) => t + Math.max(0, s.fim - s.inicio), 0) / 3600000;
  let bytes = lista.reduce((t, s) => t + (s.tamanho || 0), 0);
  const totalHoras = horas, totalGB = bytes / GB;
  const apagar = [];
  const protegidos = lista.filter(protegido).map(s => s.caminho);

  for (const s of lista) {
    if (horas <= limiteHoras && bytes / GB <= limiteGB) break;
    if (protegido(s) || intocavel(s)) continue;
    apagar.push(s.caminho);
    horas -= Math.max(0, s.fim - s.inicio) / 3600000;
    bytes -= s.tamanho || 0;
  }
  return {
    apagar,
    protegidos,
    totalHoras,
    totalGB,
    depoisHoras: Math.max(0, horas),
    depoisGB: Math.max(0, bytes / GB),
    acimaDoLimite: horas > limiteHoras || bytes / GB > limiteGB,
  };
}

/** Registro dos arquivos que o OBS gravou, guardado em JSON. */
class RegistroSegmentos {
  constructor(arquivo) {
    this.arquivo = arquivo;
    this.itens = [];
    try {
      const d = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
      if (Array.isArray(d)) {
        // normaliza e tira repetidos (versões antigas guardavam "C:/x" e "C:\x" separados)
        const porChave = new Map();
        for (const x of d) {
          if (!x || typeof x.caminho !== 'string' || !Number.isFinite(x.inicio)) continue;
          const k = chaveCaminho(x.caminho);
          const ja = porChave.get(k);
          if (!ja || x.inicio < ja.inicio) porChave.set(k, { caminho: normalizarCaminho(x.caminho), inicio: x.inicio });
        }
        this.itens = [...porChave.values()];
      }
    } catch { /* primeiro uso */ }
  }

  tem(caminho) { return this.itens.some(x => mesmoArquivo(x.caminho, caminho)); }

  adicionar(caminho, inicio = Date.now()) {
    if (!caminho || this.tem(caminho)) return;
    this.itens.push({ caminho: normalizarCaminho(caminho), inicio });
    this.salvar();
  }

  remover(caminho) {
    this.itens = this.itens.filter(x => !mesmoArquivo(x.caminho, caminho));
    this.salvar();
  }

  /** Lê tamanho e última modificação do disco. Some do registro o que não existe mais. */
  segmentos() {
    const vivos = [];
    for (const it of this.itens) {
      try {
        const st = fs.statSync(it.caminho);
        vivos.push({ caminho: it.caminho, inicio: it.inicio, fim: Math.max(it.inicio, st.mtimeMs), tamanho: st.size });
      } catch { /* apagado por fora */ }
    }
    if (vivos.length !== this.itens.length) {
      const ok = new Set(vivos.map(v => v.caminho));
      this.itens = this.itens.filter(x => ok.has(x.caminho));
      this.salvar();
    }
    return vivos;
  }

  salvar() {
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    const tmp = this.arquivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.itens, null, 2));
    fs.renameSync(tmp, this.arquivo);
  }
}

/** Executa um plano. remover(caminho) é injetado: Lixeira do Windows ou apagar de vez. */
async function executar(plano, registro, remover) {
  const feitos = [], falhas = [];
  for (const caminho of plano.apagar) {
    try {
      await remover(caminho);
      registro.remover(caminho);
      feitos.push(caminho);
    } catch (e) {
      falhas.push({ caminho, erro: String(e && e.message || e) });
    }
  }
  return { feitos, falhas };
}

module.exports = { planejar, RegistroSegmentos, executar, GB, normalizarCaminho, chaveCaminho, mesmoArquivo };
