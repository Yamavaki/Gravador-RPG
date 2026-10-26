'use strict';
// Navegador dentro do app (como o Kenku FM): várias abas, cada uma tocando o próprio som,
// que vai para o bot do Discord. Cada aba é uma WebContentsView desenhada por cima da
// área que a interface reserva para ela; só a aba escolhida aparece, mas todas tocam.

const path = require('path');
const { paraEndereco, enderecoPermitido, INICIO } = require('../core/musica/endereco');

const PARTICAO = 'persist:youtube';   // mesmo nome da 0.3.0: o login do YouTube continua salvo
const MAX_ABAS = 12;
// a captura roda na thread de áudio (AudioWorklet) quando a página deixa; nesses sites tiramos
// a política de scripts só desta sessão do app para isso funcionar
const SEM_CSP = ['youtube.com', 'youtube-nocookie.com'];

class Navegador {
  /**
   * @param {object} o
   *  electron: { WebContentsView, session, shell, app }
   *  janela: () => BrowserWindow principal
   *  musica: ControladorMusica
   *  salvarAbas: (urls) => void
   */
  constructor(o) {
    this.o = o;
    this.abas = new Map();      // id -> { id, vista }
    this.ordem = [];
    this.ativa = '';
    this.area = null;
    this._n = 0;
    this._sessaoPronta = false;
  }

  _sessao() {
    if (this._sessaoPronta) return;
    this._sessaoPronta = true;
    try {
      const ses = this.o.electron.session.fromPartition(PARTICAO);
      // o login do Google recusa navegadores que se identificam como "Electron"
      ses.setUserAgent(this.o.electron.app.userAgentFallback.replace(/\s(Electron|gravador-rpg|Gravador RPG)\/\S+/gi, ''));
      ses.webRequest.onHeadersReceived((det, cb) => {
        let host = '';
        try { host = new URL(det.url).hostname; } catch { /* */ }
        if (!SEM_CSP.some(h => host === h || host.endsWith('.' + h))) return cb({});
        const h = { ...det.responseHeaders };
        for (const k of Object.keys(h)) if (/^content-security-policy/i.test(k)) delete h[k];
        cb({ responseHeaders: h });
      });
    } catch { /* sem sessão (testes) */ }
  }

  /**
   * Abre uma aba (endereço, site ou busca no YouTube).
   * opc.previa: true = só aqui no PC (fora do Discord); false = no Discord; omitido = padrão das abas novas.
   */
  nova(texto, ativar = true, opc = {}) {
    const janela = this.o.janela();
    if (!janela) throw new Error('A janela do app não está aberta.');
    if (this.abas.size >= MAX_ABAS) throw new Error(`No máximo ${MAX_ABAS} abas. Feche alguma antes.`);
    this._sessao();
    const id = 'a' + (++this._n);
    const vista = new this.o.electron.WebContentsView({
      webPreferences: {
        partition: PARTICAO,
        preload: path.join(__dirname, 'navegador-preload.js'),
        contextIsolation: true, sandbox: true, backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
      },
    });
    const aba = { id, vista };
    this.abas.set(id, aba);
    this.ordem.push(id);
    const wc = vista.webContents;
    const url = paraEndereco(texto);
    this.o.musica.abaAberta(id, url, { previa: opc.previa, ativar });
    const nav = () => this._navegacao(aba);
    // links que abririam outra janela viram uma aba nova (Ctrl+clique ou botão do meio: aba em segundo plano)
    wc.setWindowOpenHandler(({ url: u, disposition }) => {
      if (enderecoPermitido(u)) {
        try { this.nova(u, disposition !== 'background-tab'); } catch (e) { this._aviso(e.message); }
      }
      return { action: 'deny' };
    });
    wc.on('context-menu', (ev, p) => this._menu(aba, p));
    wc.on('will-navigate', (ev, u) => { if (!enderecoPermitido(u)) ev.preventDefault(); });
    wc.on('did-start-loading', () => this.o.musica.abaMudou(id, { carregando: true }));
    wc.on('did-stop-loading', () => this.o.musica.abaMudou(id, { carregando: false, ...nav() }));
    wc.on('did-navigate', (ev, u) => { this.o.musica.abaMudou(id, { url: u, icone: '', ...nav() }); this._salvar(); });
    wc.on('did-navigate-in-page', (ev, u, principal) => { if (principal) { this.o.musica.abaMudou(id, { url: u, ...nav() }); this._salvar(); } });
    wc.on('page-title-updated', (ev, titulo) => this.o.musica.abaMudou(id, { titulo }));
    wc.on('page-favicon-updated', (ev, icones) => this.o.musica.abaMudou(id, { icone: (icones || []).find(i => /^https:/.test(i)) || '' }));
    wc.on('did-finish-load', () => wc.send('aba:ouvir', this.o.musica.ouvirAba(id)));
    wc.on('render-process-gone', () => this.fechar(id));
    janela.contentView.addChildView(vista);
    vista.setVisible(false);
    Promise.resolve(wc.loadURL(url)).catch(() => {});
    if (ativar || !this.ativa) this.ativar(id);
    this._salvar();
    return id;
  }

  _aviso(t) { if (this.o.avisar) this.o.avisar(t); }

  /** Menu do botão direito dentro da página (link, texto, navegação). */
  _menu(aba, p) {
    const { Menu, clipboard } = this.o.electron;
    if (!Menu) return;
    const wc = aba.vista.webContents;
    const itens = [];
    const abrir = (previa, ativar) => () => { try { this.nova(p.linkURL, ativar, { previa }); } catch (e) { this._aviso(e.message); } };
    if (p.linkURL && enderecoPermitido(p.linkURL)) {
      itens.push(
        { label: 'Abrir link em nova aba', click: abrir(undefined, true) },
        { label: 'Abrir em nova aba só para mim (prévia, fora do Discord)', click: abrir(true, true) },
        { label: 'Abrir em nova aba no Discord (todo mundo ouve)', click: abrir(false, true) },
        { label: 'Abrir em segundo plano', click: abrir(undefined, false) },
        { type: 'separator' },
        { label: 'Copiar endereço do link', click: () => clipboard && clipboard.writeText(p.linkURL) },
        { type: 'separator' },
      );
    }
    if (p.isEditable) {
      const f = p.editFlags || {};
      itens.push({ label: 'Recortar', enabled: !!f.canCut, click: () => wc.cut() }, { label: 'Copiar', enabled: !!f.canCopy, click: () => wc.copy() },
        { label: 'Colar', enabled: !!f.canPaste, click: () => wc.paste() }, { type: 'separator' });
    } else if (p.selectionText && p.selectionText.trim()) {
      const t = p.selectionText.trim().slice(0, 100);
      itens.push({ label: 'Copiar', click: () => wc.copy() },
        { label: `Procurar "${t.length > 30 ? t.slice(0, 30) + '…' : t}" no YouTube em nova aba`, click: () => { try { this.nova(t, true); } catch (e) { this._aviso(e.message); } } },
        { type: 'separator' });
    }
    const h = wc.navigationHistory;
    itens.push(
      { label: 'Voltar', enabled: !!(h && h.canGoBack()), click: () => h.goBack() },
      { label: 'Avançar', enabled: !!(h && h.canGoForward()), click: () => h.goForward() },
      { label: 'Recarregar', click: () => wc.reload() },
      { label: 'Duplicar esta aba', click: () => { try { this.nova(wc.getURL(), true); } catch (e) { this._aviso(e.message); } } },
    );
    Menu.buildFromTemplate(itens).popup({ window: this.o.janela() || undefined });
  }

  fechar(id) {
    const aba = this.abas.get(id);
    if (!aba) return;
    this.abas.delete(id);
    this.ordem = this.ordem.filter(x => x !== id);
    const janela = this.o.janela();
    try { if (janela) janela.contentView.removeChildView(aba.vista); } catch { /* */ }
    try { aba.vista.webContents.close(); } catch { /* */ }
    this.o.musica.abaFechou(id);
    if (this.ativa === id) {
      this.ativa = '';
      const outra = this.ordem[this.ordem.length - 1];
      if (outra) this.ativar(outra);
    }
    this._salvar();
  }

  ativar(id) {
    if (!this.abas.has(id)) throw new Error('Aba não encontrada.');
    this.ativa = id;
    this.o.musica.ativarAba(id);
    this.posicionar();
  }

  /** Barra de endereço: vai para o link (ou busca) na aba. */
  ir(id, texto) {
    const aba = this.abas.get(id || this.ativa);
    if (!aba) return this.nova(texto, true);
    const url = paraEndereco(texto);
    Promise.resolve(aba.vista.webContents.loadURL(url)).catch(() => {});
    this.o.musica.abaMudou(aba.id, { url });
    return aba.id;
  }

  acao(id, acao) {
    const aba = this.abas.get(id || this.ativa);
    if (!aba) return null;
    const wc = aba.vista.webContents;
    const h = wc.navigationHistory;
    if (acao === 'voltar' && h && h.canGoBack()) h.goBack();
    else if (acao === 'avancar' && h && h.canGoForward()) h.goForward();
    else if (acao === 'recarregar') wc.reload();
    else if (acao === 'inicio') Promise.resolve(wc.loadURL(INICIO)).catch(() => {});
    return aba.id;
  }

  _navegacao(aba) {
    const h = aba.vista.webContents.navigationHistory;
    return h ? { voltar: h.canGoBack(), avancar: h.canGoForward() } : {};
  }

  /** A interface diz onde fica a área das abas (null = tela do navegador fechada). */
  definirArea(area) {
    this.area = area && [area.x, area.y, area.largura, area.altura].every(Number.isFinite) ? area : null;
    this.posicionar();
  }

  posicionar() {
    const r = n => Math.max(0, Math.round(n));
    for (const [id, aba] of this.abas) {
      const ver = !!this.area && id === this.ativa;
      if (ver) aba.vista.setBounds({ x: r(this.area.x), y: r(this.area.y), width: r(this.area.largura), height: r(this.area.altura) });
      aba.vista.setVisible(ver);
    }
  }

  /** De qual aba veio uma mensagem (só as abas podem mandar som e estado). */
  abaDe(webContents) {
    for (const [id, aba] of this.abas) if (aba.vista.webContents === webContents) return id;
    return '';
  }

  /** Liga/desliga o som da aba nas caixas de som deste PC (o Discord não muda). */
  ouvirAba(id, ligado) {
    const aba = this.abas.get(id);
    if (aba) aba.vista.webContents.send('aba:ouvir', !!ligado);
  }

  /** Reabre as abas da última vez (não tocam sozinhas: só carregam a página). */
  restaurar(urls) {
    if (this.abas.size) return;
    const lista = (urls || []).filter(enderecoPermitido).slice(0, MAX_ABAS);
    if (!lista.length) { this.nova(INICIO, true); return; }
    lista.forEach((u, i) => this.nova(u, i === 0));
  }

  _salvar() {
    clearTimeout(this._tSalvar);
    this._tSalvar = setTimeout(() => {
      const urls = this.ordem.map(id => {
        const a = this.o.musica.abas.get(id);
        return a && a.url;
      }).filter(enderecoPermitido);
      this.o.salvarAbas(urls);
    }, 1500);
  }

  fecharTudo() {
    clearTimeout(this._tSalvar);
    for (const id of [...this.ordem]) {
      const aba = this.abas.get(id);
      try { aba.vista.webContents.close(); } catch { /* */ }
    }
    this.abas.clear();
    this.ordem = [];
  }
}

module.exports = { Navegador, PARTICAO, MAX_ABAS };
