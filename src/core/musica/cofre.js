'use strict';
// Guarda o token do bot fora da config, cifrado com a proteção do Windows quando
// disponível (o main.js passa as funções do safeStorage do Electron).
const fs = require('fs');
const path = require('path');

class CofreToken {
  /** @param {string} arquivo  @param {{cifrar?:(t:string)=>Buffer, decifrar?:(b:Buffer)=>string}} o */
  constructor(arquivo, o = {}) {
    this.arquivo = arquivo;
    this.cifrar = o.cifrar || null;
    this.decifrar = o.decifrar || null;
    this._cache = null;   // evita ler e decifrar o arquivo a cada atualização da tela
  }

  salvar(token) {
    token = String(token || '').trim();
    if (!token) return this.apagar();
    this._cache = token;
    const dados = this.cifrar
      ? { cifrado: true, token: this.cifrar(token).toString('base64') }
      : { cifrado: false, token };
    fs.mkdirSync(path.dirname(this.arquivo), { recursive: true });
    const tmp = this.arquivo + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(dados), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, this.arquivo);
  }

  ler() {
    if (this._cache != null) return this._cache;
    this._cache = this._lerArquivo();
    return this._cache;
  }

  _lerArquivo() {
    try {
      const d = JSON.parse(fs.readFileSync(this.arquivo, 'utf8'));
      if (!d || typeof d.token !== 'string') return '';
      if (!d.cifrado) return d.token;
      return this.decifrar ? this.decifrar(Buffer.from(d.token, 'base64')) : '';
    } catch { return ''; }
  }

  tem() { return !!this.ler(); }

  apagar() {
    this._cache = '';
    try { fs.unlinkSync(this.arquivo); } catch { /* não havia */ }
  }
}

module.exports = { CofreToken };
