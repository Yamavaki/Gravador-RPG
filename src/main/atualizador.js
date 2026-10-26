'use strict';
// Atualização automática pelo GitHub (repositório público Yamavaki/Gravador-RPG).
// As versões publicadas ficam no ramo "estavel" (o "main" pode ter coisa em andamento).
// O app lê o package.json desse ramo, compara com a própria versão, baixa o código do ramo
// (zip que o GitHub gera sozinho), confere e, ao aplicar, um
// pequeno .cmd espera o app fechar, copia os arquivos por cima (sem tocar em node_modules
// nem nas configurações, que ficam em %APPDATA%) e abre o app de novo pelo ABRIR.bat.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { spawn: spawnPadrao } = require('child_process');
const { baixarArquivo } = require('../core/transcricao');

const DONO = 'Yamavaki';
const REPO = 'Gravador-RPG';
const RAMO = 'estavel';
const TAG = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

function partes(v) {
  const m = TAG.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
/** a > b ? 1 : a < b ? -1 : 0 (versões "0.5.1" ou "v0.5.1") */
function comparar(a, b) {
  const x = partes(a), y = partes(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
/** Maior tag de versão da lista da API do GitHub ([{ name }]). */
function maiorTag(tags) {
  let melhor = null;
  for (const t of tags || []) {
    const nome = t && typeof t.name === 'string' ? t.name : '';
    if (!partes(nome)) continue;
    if (!melhor || comparar(nome, melhor) > 0) melhor = nome;
  }
  return melhor;
}
/** Só a parte do NOVIDADES.md sobre as versões mais novas que a atual. */
function novidadesDesde(md, atual) {
  const linhas = String(md || '').split(/\r?\n/);
  const out = [];
  let dentro = false;
  for (const l of linhas) {
    const m = /^##\s*v?(\d+\.\d+\.\d+)/.exec(l);
    if (m) dentro = comparar(m[1], atual) > 0;
    if (dentro) out.push(l);
  }
  return out.join('\n').trim().slice(0, 4000);
}

class Atualizador extends EventEmitter {
  /**
   * @param {object} o
   *  versaoAtual, pastaDados (onde baixar), pastaApp (raiz do app), fetch?, spawn?, plataforma?, extrair?(zip, destino)
   */
  constructor(o) {
    super();
    this.o = o;
    this.fetch = o.fetch || ((...a) => globalThis.fetch(...a));
    this.spawn = o.spawn || spawnPadrao;
    this.plataforma = o.plataforma || process.platform;
    this.estado = { atual: o.versaoAtual, verificando: false, disponivel: null, notas: '', erro: '', baixando: false, progresso: 0, pronta: false, verificadoEm: 0 };
    this._preparada = null;
  }

  publico() { return { ...this.estado, pagina: `https://github.com/${DONO}/${REPO}` }; }
  _mudar(c) { Object.assign(this.estado, c); this.emit('mudou', this.publico()); }

  async _texto(url) {
    const r = await this.fetch(url, { headers: { 'User-Agent': 'gravador-rpg', 'Cache-Control': 'no-cache' } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`);
    return r.text();
  }

  /** Procura versão nova. Não lança erro (guarda em estado.erro). */
  async verificar() {
    if (this.estado.verificando) return this.publico();
    this._mudar({ verificando: true, erro: '' });
    try {
      const bruto = `https://raw.githubusercontent.com/${DONO}/${REPO}/${RAMO}/`;
      const pkgTxt = await this._texto(bruto + 'package.json');
      let versao = null;
      try { versao = pkgTxt ? JSON.parse(pkgTxt).version : null; } catch { /* */ }
      const nova = versao && partes(versao) && comparar(versao, this.o.versaoAtual) > 0 ? versao : null;
      let notas = '';
      if (nova) {
        try { notas = novidadesDesde(await this._texto(bruto + 'NOVIDADES.md'), this.o.versaoAtual); } catch { /* sem novidades: tudo bem */ }
      }
      this._mudar({ verificando: false, disponivel: nova, notas, verificadoEm: Date.now() });
    } catch (e) {
      this._mudar({ verificando: false, erro: 'Não consegui procurar atualizações (' + e.message + ').', verificadoEm: Date.now() });
    }
    return this.publico();
  }

  async _extrair(zip, destino) {
    if (this.o.extrair) return this.o.extrair(zip, destino);
    fs.mkdirSync(destino, { recursive: true });
    const tar = this.plataforma === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'unzip';
    const args = this.plataforma === 'win32' ? ['-xf', zip, '-C', destino] : ['-q', '-o', zip, '-d', destino];
    await new Promise((ok, erro) => {
      const p = this.spawn(tar, args, { windowsHide: true });
      p.on('error', erro);
      p.on('close', c => (c === 0 ? ok() : erro(new Error('não consegui abrir o arquivo baixado (' + c + ')'))));
    });
  }

  /** Baixa e confere a versão nova. Devolve a pasta com os arquivos novos. */
  async preparar() {
    if (!this.estado.disponivel) await this.verificar();
    const tag = this.estado.disponivel;
    if (!tag) throw new Error('Não há versão nova para instalar.');
    if (this._preparada && this._preparada.tag === tag && fs.existsSync(this._preparada.pasta)) return this._preparada.pasta;
    const base = path.join(this.o.pastaDados, 'atualizacao');
    fs.rmSync(base, { recursive: true, force: true });
    fs.mkdirSync(base, { recursive: true });
    const zip = path.join(base, `${REPO}-${tag}.zip`);
    this._mudar({ baixando: true, progresso: 0, erro: '' });
    try {
      await baixarArquivo(`https://codeload.github.com/${DONO}/${REPO}/zip/refs/heads/${RAMO}`, zip,
        f => this._mudar({ progresso: f }), this.fetch);
      const destino = path.join(base, 'arquivos');
      await this._extrair(zip, destino);
      // o zip do GitHub tem uma pasta só por dentro ("Gravador-RPG-estavel")
      const dentro = fs.readdirSync(destino).map(n => path.join(destino, n)).filter(p => fs.statSync(p).isDirectory());
      const raiz = dentro.length === 1 ? dentro[0] : destino;
      let pkg;
      try { pkg = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')); } catch { throw new Error('o arquivo baixado não é do Gravador RPG'); }
      if (pkg.name !== 'gravador-rpg') throw new Error('o arquivo baixado não é do Gravador RPG');
      // (se publicaram outra versão no meio do caminho, qualquer uma mais nova que a atual serve)
      if (comparar(pkg.version, this.o.versaoAtual) <= 0) throw new Error('o arquivo baixado não é uma versão mais nova');
      for (const f of ['src/main/main.js', 'ABRIR.bat']) if (!fs.existsSync(path.join(raiz, f))) throw new Error('o arquivo baixado está incompleto');
      try { fs.unlinkSync(zip); } catch { /* */ }
      this._preparada = { tag, pasta: raiz };
      this._mudar({ baixando: false, progresso: 1, pronta: true });
      return raiz;
    } catch (e) {
      this._mudar({ baixando: false, erro: 'A atualização não baixou: ' + e.message });
      throw new Error('A atualização não baixou: ' + e.message);
    }
  }

  /**
   * Script que espera o app (pid) fechar, copia a versão nova por cima e abre o app de novo.
   * Só no Windows (é onde o app roda); devolve o caminho do .cmd.
   */
  scriptAplicar(origem, pid) {
    const app = this.o.pastaApp;
    const log = path.join(this.o.pastaDados, 'atualizacao', 'atualizacao.log');
    const q = s => '"' + String(s).replace(/"/g, '') + '"';
    const cmd = [
      '@echo off',
      'chcp 65001 >nul',
      'title Gravador RPG - atualizando',
      'echo Atualizando o Gravador RPG... (esta janela fecha sozinha)',
      ':espera',
      `tasklist /FI "PID eq ${Number(pid)}" 2>nul | find "${Number(pid)}" >nul && (timeout /t 1 /nobreak >nul & goto espera)`,
      // copia tudo menos node_modules (dependências) e a pasta dist (programa empacotado)
      `robocopy ${q(origem)} ${q(app)} /E /XD node_modules dist .git /R:3 /W:2 /NFL /NDL /NJH /NJS /NP > ${q(log)}`,
      'if errorlevel 8 (',
      '  echo.',
      '  echo Nao consegui copiar os arquivos novos. Veja o arquivo:',
      `  echo ${log}`,
      '  pause',
      '  exit /b 1',
      ')',
      `cd /d ${q(app)}`,
      'call ABRIR.bat',
      'exit /b 0',
    ].join('\r\n') + '\r\n';
    const arq = path.join(this.o.pastaDados, 'atualizacao', 'aplicar.cmd');
    fs.writeFileSync(arq, cmd);
    return arq;
  }

  /** Dispara o script (o app deve fechar logo depois). */
  aplicar(origem, pid) {
    if (this.plataforma !== 'win32') throw new Error('A atualização automática é só no Windows.');
    const arq = this.scriptAplicar(origem, pid);
    // "detached" no Windows abre o .cmd numa janelinha própria, que continua depois do app fechar
    const p = this.spawn('cmd.exe', ['/c', arq], { detached: true, stdio: 'ignore', windowsHide: false, cwd: this.o.pastaApp });
    if (p && p.unref) p.unref();
    return arq;
  }
}

module.exports = { Atualizador, comparar, maiorTag, novidadesDesde, DONO, REPO, RAMO };
