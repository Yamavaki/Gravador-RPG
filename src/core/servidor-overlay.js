'use strict';
// Servidor local do overlay. O OBS abre http://127.0.0.1:<porta>/overlay como
// "Fonte de navegador". Só escuta no próprio PC (127.0.0.1): ninguém de fora acessa.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PASTA_OVERLAY = path.join(__dirname, '..', 'overlay');
const PASTA_MOTOR = path.join(__dirname, '..', 'musica');
// motor de áudio do bot (página escondida do app): só estes arquivos
const MOTOR = {
  '/motor/': path.join(PASTA_MOTOR, 'motor.html'),
  '/motor/app.mjs': path.join(PASTA_MOTOR, 'app.mjs'),
  '/motor/util.mjs': path.join(PASTA_MOTOR, 'util.mjs'),
  '/motor/audio.mjs': path.join(PASTA_MOTOR, 'audio.mjs'),
  '/motor/motor.mjs': path.join(PASTA_MOTOR, 'motor.mjs'),
  '/motor/estado.mjs': path.join(PASTA_MOTOR, 'estado.mjs'),
  '/motor/captura-worklet.js': path.join(PASTA_MOTOR, 'captura-worklet.js'),
  '/motor/trilha-util.js': path.join(__dirname, 'musica', 'trilha-util.js'),
};
const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.webm': 'video/webm', '.flv': 'video/x-flv',
};
const MAX_CORPO = 16 * 1024;
const ESTATICOS = { '/overlay': 'overlay.html', '/overlay.js': 'overlay.js', '/overlay.css': 'overlay.css', '/identidade.js': '../core/identidade.js' };

class ServidorOverlay {
  /** @param {object} o { porta, pastaImagens } */
  constructor(o) {
    this.porta = o.porta;
    this.pastaImagens = o.pastaImagens;
    this.clientes = new Set();
    this.doApp = new Set(); // prévias abertas dentro do próprio app (não contam como OBS)
    this.estado = { ativo: true, pessoas: [] };
    this.servidor = null;
    this.midias = new Map();      // token -> caminho do vídeo (só os que o app liberou)
    this.tokens = new Map();      // caminho -> token
    this.aoFoundry = null;        // (dados) => resposta, definido pelo app
    // "impressão digital" dos arquivos do overlay: se o app for atualizado, a página aberta
    // no OBS percebe que mudou e se recarrega sozinha (senão ficaria com o código antigo)
    const h = crypto.createHash('sha1');
    for (const f of Object.values(ESTATICOS)) { try { h.update(fs.readFileSync(path.join(PASTA_OVERLAY, f))); } catch { /* */ } }
    this.versaoOverlay = h.digest('hex').slice(0, 12);
  }

  _comVersao(estado) { return JSON.stringify({ ...estado, _v: this.versaoOverlay }); }

  get urlMotor() { return `http://127.0.0.1:${this.portaReal}/motor/`; }

  /** Libera um vídeo ou áudio (prévia, motor de música) e devolve o endereço dele. */
  urlMidia(caminho) {
    let t = this.tokens.get(caminho);
    if (!t) {
      t = crypto.randomBytes(12).toString('hex') + path.extname(caminho).toLowerCase();
      this.tokens.set(caminho, t);
      this.midias.set(t, caminho);
    }
    return `http://127.0.0.1:${this.portaReal}/midia/${t}`;
  }

  iniciar() {
    return new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => this._tratar(req, res));
      s.on('error', e => {
        if (e.code === 'EADDRINUSE') reject(new Error(`A porta ${this.porta} já está em uso. Troque a porta do overlay em Gravação.`));
        else reject(e);
      });
      s.listen(this.porta, '127.0.0.1', () => { this.servidor = s; resolve(); });
    });
  }

  parar() {
    for (const c of this.clientes) { try { c.end(); } catch { /* */ } }
    this.clientes.clear();
    this.doApp.clear();
    return new Promise(r => (this.servidor ? this.servidor.close(() => r()) : r()));
  }

  get portaReal() {
    const a = this.servidor && this.servidor.address();
    return a ? a.port : this.porta;
  }

  get url() { return `http://127.0.0.1:${this.portaReal}/overlay`; }

  /** Quantas fontes de navegador (o OBS) estão com o overlay aberto agora. */
  get abertosNoOBS() { return this.clientes.size - this.doApp.size; }

  publicar(estado) {
    this.estado = estado;
    const msg = `data: ${this._comVersao(estado)}\n\n`;
    for (const c of this.clientes) {
      try { c.write(msg); } catch { this.clientes.delete(c); }
    }
  }

  _tratar(req, res) {
    // só atende pedidos endereçados ao próprio PC (impede "DNS rebinding" de sites da internet)
    const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) { res.writeHead(403); return res.end(); }
    let caminho, origem = '';
    try {
      const u = new URL(req.url, 'http://x');
      caminho = decodeURIComponent(u.pathname);
      origem = u.searchParams.get('origem') || '';
    } catch { return this._404(res); }

    if (caminho === '/foundry') return this._foundry(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

    if (caminho === '/') { res.writeHead(302, { Location: '/overlay' }); return res.end(); }
    if (ESTATICOS[caminho]) return this._arquivo(res, path.join(PASTA_OVERLAY, ESTATICOS[caminho]));
    if (MOTOR[caminho]) return this._arquivo(res, MOTOR[caminho]);
    if (caminho === '/estado') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(this._comVersao(this.estado));
    }
    if (caminho === '/eventos') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write('retry: 1500\n\n');
      res.write(`data: ${this._comVersao(this.estado)}\n\n`);
      this.clientes.add(res);
      if (origem === 'app') this.doApp.add(res);
      const vivo = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* */ } }, 15000);
      req.on('close', () => { clearInterval(vivo); this.clientes.delete(res); this.doApp.delete(res); });
      return;
    }
    if (caminho.startsWith('/img/')) {
      const nome = caminho.slice(5);
      // só nomes simples de arquivo, sem pastas: impede ler qualquer coisa fora da pasta de imagens
      if (!/^[A-Za-z0-9._-]{1,120}$/.test(nome) || nome.startsWith('.')) return this._404(res);
      // CORS: a interface desenha estas imagens num canvas para montar os retratos dos cortes
      return this._arquivo(res, path.join(this.pastaImagens, nome), true, { 'Access-Control-Allow-Origin': '*' });
    }
    if (caminho.startsWith('/midia/')) {
      const arq = this.midias.get(caminho.slice(7));
      if (!arq) return this._404(res);
      return this._video(req, res, arq);
    }
    return this._404(res);
  }

  /** Vídeo com suporte a "Range" (o player precisa para pular para qualquer ponto). */
  _video(req, res, arquivo) {
    let st;
    try { st = fs.statSync(arquivo); } catch { return this._404(res); }
    const tipo = TIPOS[path.extname(arquivo).toLowerCase()] || 'application/octet-stream';
    const base = { 'Content-Type': tipo, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (!m) {
      res.writeHead(200, { ...base, 'Content-Length': st.size });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(arquivo).on('error', () => res.destroy()).pipe(res);
    }
    let ini = m[1] === '' ? Math.max(0, st.size - Number(m[2])) : Number(m[1]);
    let fim = m[1] !== '' && m[2] !== '' ? Number(m[2]) : st.size - 1;
    fim = Math.min(fim, st.size - 1);
    if (!(ini <= fim) || ini >= st.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${ini}-${fim}/${st.size}`, 'Content-Length': fim - ini + 1 });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(arquivo, { start: ini, end: fim }).on('error', () => res.destroy()).pipe(res);
  }

  /** Módulo do Foundry manda eventos aqui. Precisa da chave que o app mostra. */
  _foundry(req, res) {
    const cors = {
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      // o Chrome pede isto quando um site da internet (ex.: Forge) fala com o próprio PC
      'Access-Control-Allow-Private-Network': 'true',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method !== 'POST') { res.writeHead(405, cors); return res.end(); }
    let corpo = '';
    let grande = false;
    req.on('data', d => {
      corpo += d;
      if (corpo.length > MAX_CORPO) { grande = true; req.destroy(); }
    });
    req.on('end', async () => {
      if (grande) return;
      let dados;
      try { dados = JSON.parse(corpo); } catch { dados = null; }
      let r;
      try {
        r = dados && this.aoFoundry ? await this.aoFoundry(dados) : { ok: false, mensagem: 'Pedido inválido.' };
      } catch (e) {
        r = { ok: false, mensagem: e.message };
      }
      res.writeHead(r.status || 200, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
      delete r.status;
      res.end(JSON.stringify(r));
    });
  }

  _arquivo(res, arquivo, cache = false, extra = {}) {
    const tipo = TIPOS[path.extname(arquivo).toLowerCase()];
    if (!tipo || tipo.startsWith('video/') || tipo.startsWith('audio/')) return this._404(res);
    fs.readFile(arquivo, (e, dados) => {
      if (e) return this._404(res);
      res.writeHead(200, { 'Content-Type': tipo, 'Cache-Control': cache ? 'max-age=3600' : 'no-store', ...extra });
      res.end(dados);
    });
  }

  _404(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('não encontrado');
  }
}

module.exports = { ServidorOverlay };
