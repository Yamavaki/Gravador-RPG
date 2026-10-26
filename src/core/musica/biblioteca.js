'use strict';
// Biblioteca de músicas do PC: as faixas que a pessoa adicionou, com grupo (pasta),
// tipo (música, ambiente, efeito), repetição e seções (loops de chefe).
// Fica em musica.json na pasta de dados do app, separado da configuração.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { nomeDoArquivo, CORES_SECAO } = require('./trilha-util');

const EXTENSOES = ['.mp3', '.ogg', '.oga', '.opus', '.wav', '.flac', '.m4a', '.aac', '.webm'];
const TIPOS = ['musica', 'ambiente', 'efeito'];
const ACOES = ['loop', 'next', 'stop'];
const MAX_FAIXAS = 5000;
const MAX_SECOES = 40;

const novoId = () => crypto.randomBytes(6).toString('hex');
const texto = (v, padrao, max) => (typeof v === 'string' ? v.slice(0, max).trim() : padrao);
const ehAudio = c => EXTENSOES.includes(path.extname(String(c)).toLowerCase());

function normalizarSecoes(lista, dur) {
  if (!Array.isArray(lista)) return [];
  const out = [];
  const ids = new Set();
  for (const s of lista.slice(0, MAX_SECOES)) {
    if (!s || typeof s !== 'object') continue;
    const inicio = Number(s.inicio), termino = Number(s.termino);
    if (!Number.isFinite(inicio) || !Number.isFinite(termino) || inicio < 0 || termino - inicio < 0.05) continue;
    if (dur > 0 && inicio >= dur) continue;
    let id = typeof s.id === 'string' && /^[A-Za-z0-9]{4,32}$/.test(s.id) ? s.id : novoId();
    if (ids.has(id)) id = novoId();
    ids.add(id);
    out.push({
      id,
      nome: texto(s.nome, '', 40) || 'Parte ' + (out.length + 1),
      inicio: Math.round(inicio * 1000) / 1000,
      termino: Math.round((dur > 0 ? Math.min(termino, dur) : termino) * 1000) / 1000,
      acao: ACOES.includes(s.acao) ? s.acao : 'next',
      cor: typeof s.cor === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.cor) ? s.cor : CORES_SECAO[out.length % CORES_SECAO.length],
    });
  }
  out.sort((a, b) => a.inicio - b.inicio);
  // seções não se sobrepõem: cada uma termina onde a próxima começa (no máximo)
  for (let i = 0; i < out.length - 1; i++) out[i].termino = Math.min(out[i].termino, out[i + 1].inicio);
  return out.filter(s => s.termino - s.inicio >= 0.05);
}

function normalizarFaixa(f) {
  if (!f || typeof f !== 'object' || typeof f.caminho !== 'string' || !f.caminho || !ehAudio(f.caminho)) return null;
  const duracao = Number(f.duracao) > 0 ? Number(f.duracao) : 0;
  return {
    id: /^[a-f0-9]{6,32}$/.test(f.id) ? f.id : novoId(),
    nome: texto(f.nome, '', 120) || nomeDoArquivo(f.caminho),
    caminho: f.caminho,
    grupo: texto(f.grupo, '', 80),
    tipo: TIPOS.includes(f.tipo) ? f.tipo : 'musica',
    repetir: typeof f.repetir === 'boolean' ? f.repetir : f.tipo === 'ambiente',
    duracao,
    secoes: normalizarSecoes(f.secoes, duracao),
  };
}

class BibliotecaMusica {
  constructor(arquivo) {
    this.arquivo = arquivo;
    this.faixas = [];
    this.carregar();
  }

  carregar() {
    let bruto = null;
    try { bruto = JSON.parse(fs.readFileSync(this.arquivo, 'utf8')); } catch (e) {
      if (e.code !== 'ENOENT' && fs.existsSync(this.arquivo)) {
        try { fs.copyFileSync(this.arquivo, this.arquivo + '.corrompido-' + Date.now()); } catch { /* sem cópia */ }
      }
    }
    const lista = bruto && Array.isArray(bruto.faixas) ? bruto.faixas : [];
    const ids = new Set();
    this.faixas = [];
    for (const f of lista.slice(0, MAX_FAIXAS)) {
      const n = normalizarFaixa(f);
      if (!n) continue;
      if (ids.has(n.id)) n.id = novoId();
      ids.add(n.id);
      this.faixas.push(n);
    }
    return this.faixas;
  }

  salvar() {
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    const tmp = this.arquivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ versao: 1, faixas: this.faixas }, null, 1), 'utf8');
    fs.renameSync(tmp, this.arquivo);
  }

  faixa(id) { return this.faixas.find(f => f.id === id) || null; }

  /** Lista para a interface: com "existe" (o arquivo pode ter sido movido/apagado). */
  listar() {
    return this.faixas.map(f => ({ ...f, existe: fs.existsSync(f.caminho) }));
  }

  /** Adiciona arquivos de áudio (ignora repetidos e o que não for áudio). Devolve os novos. */
  adicionar(caminhos, grupo = '') {
    const ja = new Set(this.faixas.map(f => chave(f.caminho)));
    const novos = [];
    for (const c of caminhos) {
      if (!ehAudio(c) || ja.has(chave(c))) continue;
      if (this.faixas.length >= MAX_FAIXAS) break;
      const f = normalizarFaixa({ caminho: c, grupo, tipo: tipoPeloNome(c) });
      if (!f) continue;
      ja.add(chave(c));
      this.faixas.push(f);
      novos.push(f);
    }
    if (novos.length) this.salvar();
    return novos;
  }

  /** Adiciona uma pasta inteira (até 3 níveis). Cada subpasta vira um grupo. */
  adicionarPasta(pasta) {
    const raiz = path.basename(pasta);
    const porGrupo = new Map();
    const andar = (dir, nivel) => {
      let itens = [];
      try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      itens.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
      for (const it of itens) {
        const c = path.join(dir, it.name);
        if (it.isDirectory() && nivel < 3 && !it.name.startsWith('.')) andar(c, nivel + 1);
        else if (it.isFile() && ehAudio(it.name)) {
          const rel = path.relative(pasta, dir);
          const g = rel ? rel.split(path.sep).join(' / ') : raiz;
          if (!porGrupo.has(g)) porGrupo.set(g, []);
          porGrupo.get(g).push(c);
        }
      }
    };
    andar(pasta, 0);
    const novos = [];
    for (const [g, cs] of porGrupo) novos.push(...this.adicionar(cs, g));
    return novos;
  }

  /** Muda campos simples de uma faixa (nome, grupo, tipo, repetir, duracao). */
  atualizar(id, campos) {
    const i = this.faixas.findIndex(f => f.id === id);
    if (i < 0) throw new Error('Faixa não encontrada.');
    const permitidos = {};
    for (const k of ['nome', 'grupo', 'tipo', 'repetir', 'duracao']) if (campos && k in campos) permitidos[k] = campos[k];
    const n = normalizarFaixa({ ...this.faixas[i], ...permitidos });
    this.faixas[i] = n;
    this.salvar();
    return n;
  }

  definirSecoes(id, secoes, duracao) {
    const f = this.faixa(id);
    if (!f) throw new Error('Faixa não encontrada.');
    if (Number(duracao) > 0) f.duracao = Number(duracao);
    f.secoes = normalizarSecoes(secoes, f.duracao);
    this.salvar();
    return f;
  }

  remover(ids) {
    const fora = new Set(Array.isArray(ids) ? ids : [ids]);
    const antes = this.faixas.length;
    this.faixas = this.faixas.filter(f => !fora.has(f.id));
    if (this.faixas.length !== antes) this.salvar();
    return antes - this.faixas.length;
  }
}

// no Windows, C:\Musica\a.mp3 e c:/musica/A.mp3 são o mesmo arquivo
function chave(c) {
  const n = path.win32.normalize(String(c)).replace(/\//g, '\\');
  return process.platform === 'win32' || /^[a-z]:\\/i.test(n) ? n.toLowerCase() : path.resolve(String(c));
}

function tipoPeloNome(c) {
  const n = path.basename(c).toLowerCase().replace(/\.[^.]+$/, '');
  const tem = re => new RegExp('(^|[^a-z0-9])(' + re + ')([^a-z0-9]|$)').test(n);
  if (tem('amb|ambient|ambiente|ambience|atmosfera|chuva|rain|floresta|forest|taverna|tavern|vento|wind')) return 'ambiente';
  if (tem('sfx|efeito|effect|fx|hit|golpe|explosao|explosion|porta|door')) return 'efeito';
  return 'musica';
}

module.exports = { BibliotecaMusica, normalizarFaixa, normalizarSecoes, EXTENSOES, TIPOS, ehAudio, tipoPeloNome };
