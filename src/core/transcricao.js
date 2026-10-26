'use strict';
// Transcrição local (nada sai do PC): whisper.cpp rodando no processador.
// Na primeira vez baixa o programa (~5 MB, do GitHub oficial do whisper.cpp) e o modelo
// escolhido (do Hugging Face oficial). Fica tudo em <dados do app>\whisper.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn: spawnPadrao } = require('child_process');

const URL_PROGRAMA = 'https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip';
const URL_MODELOS = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
const MODELOS = {
  preciso: { arquivo: 'ggml-large-v3-turbo-q5_0.bin', nome: 'Preciso (large-v3-turbo)', mb: 547 },
  rapido: { arquivo: 'ggml-small-q5_1.bin', nome: 'Rápido (small)', mb: 181 },
};
const EXECUTAVEIS = process.platform === 'win32' ? ['whisper-cli.exe', 'main.exe'] : ['whisper-cli', 'main'];

/** Procura o executável do whisper dentro de uma pasta (o zip às vezes vem com subpasta "Release"). */
function acharExecutavel(pasta, nomes = EXECUTAVEIS, fundo = 3) {
  let itens;
  try { itens = fs.readdirSync(pasta, { withFileTypes: true }); } catch { return ''; }
  for (const n of nomes) {
    const f = itens.find(i => i.isFile() && i.name.toLowerCase() === n.toLowerCase());
    if (f) return path.join(pasta, f.name);
  }
  if (fundo <= 0) return '';
  for (const i of itens) {
    if (!i.isDirectory()) continue;
    const r = acharExecutavel(path.join(pasta, i.name), nomes, fundo - 1);
    if (r) return r;
  }
  return '';
}

/** "00:01:02,345" ou números → ms */
function lerTempo(v) {
  if (Number.isFinite(v)) return v;
  const m = String(v || '').match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  return m ? ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000 + Number(m[4].padEnd(3, '0').slice(0, 3)) : NaN;
}

/** JSON do whisper-cli (-oj) → [{ ini, fim, texto }] em ms, relativos ao começo do áudio. */
function lerJsonWhisper(json) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  const out = [];
  for (const s of (d && d.transcription) || []) {
    const ini = s.offsets ? Number(s.offsets.from) : lerTempo(s.timestamps && s.timestamps.from);
    const fim = s.offsets ? Number(s.offsets.to) : lerTempo(s.timestamps && s.timestamps.to);
    const texto = String(s.text || '').replace(/\s+/g, ' ').trim();
    // o whisper às vezes "alucina" isso em silêncio
    if (!texto || /^\[.*\]$|^\(.*\)$|^♪+$/.test(texto)) continue;
    if (!Number.isFinite(ini) || !Number.isFinite(fim) || fim <= ini) continue;
    out.push({ ini, fim, texto });
  }
  return out;
}

/**
 * Quem fala cada trecho: a pessoa (StreamKit) que mais falou durante ele.
 * segmentos e falas no mesmo relógio (ms). Devolve os segmentos com "chave".
 */
function atribuirFalantes(segmentos, falas) {
  return segmentos.map(s => {
    const soma = {};
    for (const f of falas || []) {
      const a = Math.max(s.ini, f.ini), b = Math.min(s.fim, f.fim);
      if (b > a) soma[f.chave] = (soma[f.chave] || 0) + (b - a);
    }
    let chave = '', maior = 0;
    for (const k of Object.keys(soma)) if (soma[k] > maior) { maior = soma[k]; chave = k; }
    return { ...s, chave };
  });
}

/** Baixa um arquivo grande com progresso (segue redirecionamentos), gravando em .parcial. */
async function baixarArquivo(url, destino, aoProgresso, fetchFn = globalThis.fetch) {
  const r = await fetchFn(url, { redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`Não consegui baixar (${r.status || 'sem resposta'}).`);
  const total = Number(r.headers.get('content-length')) || 0;
  const parcial = destino + '.parcial';
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const saida = fs.createWriteStream(parcial);
  let lido = 0, ultimo = 0;
  try {
    for await (const pedaco of r.body) {
      lido += pedaco.length;
      if (!saida.write(pedaco)) await new Promise(ok => saida.once('drain', ok));
      const agora = Date.now();
      if (aoProgresso && agora - ultimo > 250) { ultimo = agora; aoProgresso(total ? lido / total : 0, lido, total); }
    }
    await new Promise((ok, erro) => saida.end(e => (e ? erro(e) : ok())));
  } catch (e) {
    saida.destroy();
    try { fs.unlinkSync(parcial); } catch { /* */ }
    throw e;
  }
  if (total && lido < total) { try { fs.unlinkSync(parcial); } catch { /* */ } throw new Error('O download parou no meio. Tente de novo.'); }
  fs.renameSync(parcial, destino);
}

function rodar(spawn, bin, args, opcoes, aoLinha) {
  return new Promise((resolve, reject) => {
    let proc;
    try { proc = spawn(bin, args, { windowsHide: true, ...opcoes }); } catch (e) { reject(e); return; }
    let erro = '';
    const ler = d => {
      const t = String(d);
      erro = (erro + t).slice(-4000);
      if (aoLinha) t.split(/\r?\n|\r/).forEach(l => l && aoLinha(l));
    };
    if (proc.stdout) proc.stdout.on('data', ler);
    if (proc.stderr) proc.stderr.on('data', ler);
    proc.on('error', reject);
    proc.on('close', codigo => (codigo === 0 ? resolve(erro) : reject(new Error(erro.trim().split('\n').slice(-3).join(' ') || 'código ' + codigo))));
  });
}

class Transcricao {
  /**
   * @param {object} o  pasta (onde ficam programa e modelos), fetch?, spawn?, extrair?(zip, pasta)
   */
  constructor(o) {
    this.o = o;
    this.pasta = o.pasta;
    this.spawn = o.spawn || spawnPadrao;
    this._preparando = null;
  }

  _pastaPrograma() { return path.join(this.pasta, 'programa'); }
  _caminhoModelo(modelo) { return path.join(this.pasta, 'modelos', (MODELOS[modelo] || MODELOS.preciso).arquivo); }

  /** O que já está baixado. */
  estado() {
    const modelos = {};
    for (const k of Object.keys(MODELOS)) modelos[k] = fs.existsSync(this._caminhoModelo(k));
    return { programa: !!acharExecutavel(this._pastaPrograma()), modelos, pasta: this.pasta };
  }

  async _extrair(zip, destino) {
    if (this.o.extrair) return this.o.extrair(zip, destino);
    fs.mkdirSync(destino, { recursive: true });
    // o Windows 10/11 já vem com o tar (que abre .zip)
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'unzip';
    const args = process.platform === 'win32' ? ['-xf', zip, '-C', destino] : ['-o', zip, '-d', destino];
    await rodar(this.spawn, tar, args, {});
  }

  /**
   * Baixa o que faltar. aoProgresso({ etapa: 'programa'|'modelo', fracao, mb, totalMb }).
   */
  preparar(modelo, aoProgresso) {
    if (this._preparando) return this._preparando;
    this._preparando = this._preparar(modelo, aoProgresso).finally(() => { this._preparando = null; });
    return this._preparando;
  }

  async _preparar(modelo, aoProgresso) {
    const avisar = (etapa) => (fracao, lido, total) => aoProgresso && aoProgresso({ etapa, fracao, mb: Math.round(lido / 1e6), totalMb: Math.round(total / 1e6) });
    if (!acharExecutavel(this._pastaPrograma())) {
      const zip = path.join(this.pasta, 'whisper-bin-x64.zip');
      try {
        await baixarArquivo(URL_PROGRAMA, zip, avisar('programa'), this.o.fetch);
      } catch (e) {
        throw new Error('Não consegui baixar o programa de transcrição (' + e.message + '). Confira a internet ou o antivírus.');
      }
      await this._extrair(zip, this._pastaPrograma());
      try { fs.unlinkSync(zip); } catch { /* */ }
      if (!acharExecutavel(this._pastaPrograma())) throw new Error('O programa de transcrição baixado não tem o whisper-cli.exe. Talvez o antivírus tenha apagado.');
    }
    const arq = this._caminhoModelo(modelo);
    if (!fs.existsSync(arq)) {
      try {
        await baixarArquivo(URL_MODELOS + path.basename(arq), arq, avisar('modelo'), this.o.fetch);
      } catch (e) {
        throw new Error('Não consegui baixar o modelo de transcrição (' + e.message + ').');
      }
    }
    return this.estado();
  }

  /**
   * Transcreve um .wav (16 kHz mono). Devolve [{ ini, fim, texto }] em ms desde o começo do áudio.
   * aoProgresso(fração 0..1)
   */
  async transcrever(wav, { modelo = 'preciso', idioma = 'pt', aoProgresso = null, dica = '' } = {}) {
    const bin = acharExecutavel(this._pastaPrograma());
    if (!bin) throw new Error('O programa de transcrição ainda não foi baixado.');
    const arqModelo = this._caminhoModelo(modelo);
    if (!fs.existsSync(arqModelo)) throw new Error('O modelo de transcrição ainda não foi baixado.');
    const base = wav.replace(/\.wav$/i, '');
    const threads = Math.max(1, Math.min(8, (os.cpus() || []).length - 1));
    const args = ['-m', arqModelo, '-f', wav, '-l', /^(pt|en|es|auto)$/.test(idioma) ? idioma : 'pt',
      '-oj', '-of', base, '-t', String(threads), '-pp', '-mc', '64'];
    // nomes dos personagens ajudam o modelo a escrever certo
    if (dica) args.push('--prompt', String(dica).slice(0, 400));
    try { fs.unlinkSync(base + '.json'); } catch { /* */ }
    await rodar(this.spawn, bin, args, { cwd: path.dirname(bin) }, l => {
      const m = l.match(/progress\s*=\s*(\d+)%/);
      if (m && aoProgresso) aoProgresso(Math.min(1, Number(m[1]) / 100));
    }).catch(e => { throw new Error('A transcrição falhou: ' + e.message); });
    let json;
    try { json = fs.readFileSync(base + '.json', 'utf8'); } catch { throw new Error('A transcrição não gerou resultado.'); }
    return lerJsonWhisper(json);
  }
}

module.exports = { Transcricao, MODELOS, URL_PROGRAMA, URL_MODELOS, acharExecutavel, lerJsonWhisper, lerTempo, atribuirFalantes, baixarArquivo };
