'use strict';
// Junta tudo para exportar um corte: lê a sessão, acha os pedaços de vídeo,
// prepara os retratos (imagens que a interface desenhou), monta e roda o FFmpeg.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const midia = require('./midia');
const C = require('./cortes');
const { lerSessao } = require('./sessao');
const Pausas = require('./pausas');
const Camera = require('./camera');
const Legendas = require('./legendas');
const Identidade = require('./identidade');

class Exportador {
  /** @param {object} o { ffmpegConfigurado: () => string } */
  constructor(o = {}) {
    this.o = o;
    this.ff = null;
    this.cacheInfo = new Map(); // caminho -> { chave, info }
  }

  async ffmpeg(forcar = false) {
    if (!this.ff || forcar || !this.ff.ok) this.ff = await midia.detectar(this.o.ffmpegConfigurado ? this.o.ffmpegConfigurado() : '');
    return this.ff;
  }

  /** Informações de um vídeo, guardadas enquanto o arquivo não muda. */
  async infoArquivo(caminho) {
    let st;
    try { st = fs.statSync(caminho); } catch { return { ok: false, existe: false }; }
    const chave = st.size + ':' + st.mtimeMs;
    const c = this.cacheInfo.get(caminho);
    if (c && c.chave === chave) return c.info;
    const ff = await this.ffmpeg();
    if (!ff.ok) throw new Error(ff.erro);
    const info = { ...(await midia.info(ff.bin, caminho)), existe: true };
    if (info.ok) this.cacheInfo.set(caminho, { chave, info });
    return info;
  }

  /**
   * Linha do tempo dos vídeos de um corte, em TEMPO DA GRAVAÇÃO (segundos; pausas do OBS descontadas).
   * fonte 'gravacao': os pedaços do OBS, um depois do outro.
   * fonte 'replay:<caminho>': o arquivo do replay, terminando no momento em que foi salvo.
   */
  async linha(sessao, fonte = 'gravacao') {
    const R = ms => Pausas.paraGravacao(ms, sessao.pausas) / 1000;
    if (fonte && fonte.startsWith('replay:')) {
      const caminho = fonte.slice(7);
      const rep = (sessao.replays || []).find(r => r.caminho === caminho);
      const info = await this.infoArquivo(caminho);
      if (!info.existe) return [{ caminho, duracao: 0, inicio: 0, existe: false }];
      const fim = rep ? R(rep.t - sessao.inicio) : info.duracao;
      return [{ caminho, duracao: info.duracao, inicio: Math.max(0, fim - info.duracao), existe: true, info }];
    }
    const arquivos = [];
    for (const a of sessao.arquivos) {
      const info = await this.infoArquivo(a.caminho);
      arquivos.push({ caminho: a.caminho, duracao: info.ok ? info.duracao : 0, existe: !!info.existe, info: info.ok ? info : null });
    }
    // se um arquivo sumiu, a duração dele vem do horário dos eventos (para não deslocar os seguintes)
    for (let i = 0; i < arquivos.length; i++) {
      if (arquivos[i].duracao) continue;
      const fimEstimado = sessao.arquivos[i + 1] ? sessao.arquivos[i + 1].t : sessao.fim;
      if (fimEstimado) arquivos[i].duracao = Math.max(0, R(fimEstimado - sessao.inicio) - R(sessao.arquivos[i].t - sessao.inicio));
    }
    // cada pedaço começa onde o anterior terminou; mas se o horário do evento discordar
    // em mais de 2 s (ex.: o primeiro pedaço não foi achado), vale o horário do evento
    const linha = C.linhaDosArquivos(arquivos);
    let deslocar = 0;
    linha.forEach((x, i) => {
      const peloEvento = R(sessao.arquivos[i].t - sessao.inicio);
      const pelaSoma = x.inicio + deslocar;
      if (Math.abs(peloEvento - pelaSoma) > 2) deslocar = peloEvento - x.inicio;
      x.inicio += deslocar;
    });
    return linha;
  }

  /** Grava as imagens dos retratos (vindas da interface em PNG base64) numa pasta temporária. */
  _gravarRetratos(pasta, retratos) {
    const saida = [];
    for (const r of retratos || []) {
      const item = { ...r };
      for (const tipo of ['falando', 'quieto']) {
        if (!r[tipo]) { item[tipo] = null; continue; }
        const m = String(r[tipo]).match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
        if (!m) throw new Error('Imagem de retrato inválida.');
        const arq = path.join(pasta, `r${saida.length}-${tipo}.png`);
        fs.writeFileSync(arq, Buffer.from(m[1], 'base64'));
        item[tipo] = arq;
      }
      saida.push(item);
    }
    return saida;
  }

  /** Grava um PNG (data URL da interface) na pasta temporária. */
  _gravarPng(pasta, nome, dataUrl) {
    const m = String(dataUrl || '').match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Error('Imagem inválida (' + nome + ').');
    const arq = path.join(pasta, nome);
    fs.writeFileSync(arq, Buffer.from(m[1], 'base64'));
    return arq;
  }

  /**
   * Prepara uma exportação. Devolve { titulo, executar } para a fila.
   * pedido: { sessaoArquivo, corte, preset, retratos:[{chave, falando, quieto}], layout, pastaSaida, nomeBase }
   */
  async preparar(pedido) {
    const ff = await this.ffmpeg();
    if (!ff.ok) throw new Error(ff.erro);
    const preset = C.PRESETS[pedido.preset];
    if (!preset) throw new Error('Formato desconhecido: ' + pedido.preset);
    const sessao = lerSessao(pedido.sessaoArquivo);
    const corte = pedido.corte;
    const pausas = sessao.pausas || [];
    const R = ms => Pausas.paraGravacao(ms, pausas); // tempo da sessão → tempo da gravação (ms)
    const linha = await this.linha(sessao, corte.fonte);
    const pedacos = C.pedacosDoTrecho(linha, R(corte.ini) / 1000, R(corte.fim) / 1000);
    const primeiro = linha.find(a => a.caminho === pedacos[0].arquivo);
    const fonte = (primeiro && primeiro.info) || (await this.infoArquivo(pedacos[0].arquivo));
    const duracao = pedacos.reduce((t, x) => t + x.dur, 0);
    // onde o vídeo do corte começa de verdade (o pedido pode começar antes do vídeo existir, ex.: replay curto)
    const iniReal = ((primeiro ? primeiro.inicio : 0) + pedacos[0].ss) * 1000;

    // retratos: só no vertical ou quando pedido no horizontal
    let retratos = [];
    const querRetratos = preset.tipo === 'vertical' ? pedido.layout && pedido.layout.layout !== 'nenhum' : !!pedido.retratosHorizontal;
    if (querRetratos && preset.tipo !== 'copia') {
      // falas no mesmo relógio do vídeo
      const falas = sessao.falas.map(f => ({ chave: f.chave, ini: R(f.ini - sessao.inicio), fim: R(f.fim - sessao.inicio) }));
      let i = 0;
      for (const r of pedido.retratos || []) {
        const intervalos = C.intervalosFala(falas, r.chave, iniReal, iniReal + duracao * 1000);
        if (pedido.layout.esconderQuietos && !intervalos.length) continue;
        const soQuemFala = pedido.layout.ancora ? pedido.layout.mostrar === 'falando' : pedido.layout.layout === 'quem-fala';
        retratos.push({ ...r, intervalos, indice: i++, quieto: soQuemFala ? null : r.quieto });
      }
    }
    const vertical = corte.vertical ? { ...corte.vertical, camera: ajustarCamera(corte, iniReal, R, fonte) } : corte.vertical;
    // legendas: a interface gerou o .ass contando do início do corte; o vídeo pode começar um pouco depois
    let ass = null;
    if (pedido.legendasAss && preset.tipo !== 'copia') {
      const desloc = Pausas.paraSessao(iniReal, pausas) - corte.ini;
      ass = Legendas.deslocarAss(String(pedido.legendasAss), -desloc);
    }
    // identidade visual, fundo próprio, imagem final e música (nada disso no corte rápido)
    const recodifica = preset.tipo !== 'copia';
    const desloc = Pausas.paraSessao(iniReal, pausas) - corte.ini;
    const camadas = recodifica ? (pedido.camadas || []).slice(0, 12).filter(c => c && c.png && Number.isFinite(Number(c.x)) && Number.isFinite(Number(c.y))) : [];
    const fundo = recodifica && preset.tipo === 'vertical' && pedido.fundo ? pedido.fundo : null;
    const final = recodifica && pedido.final && pedido.final.png ? pedido.final : null;
    let musica = null;
    if (recodifica && pedido.musica && pedido.musica.arquivo) {
      if (!fs.existsSync(pedido.musica.arquivo)) throw new Error('A música escolhida para este corte não foi encontrada no PC.');
      const m = Identidade.normalizarMusica(pedido.musica);
      musica = { arquivo: pedido.musica.arquivo, inicio: m.inicio, fadeIn: m.fadeIn, fadeOut: m.fadeOut, expr: Identidade.exprCurva(m, desloc) };
    }

    fs.mkdirSync(pedido.pastaSaida, { recursive: true });
    const saida = C.caminhoLivre(pedido.pastaSaida, C.nomeArquivo(pedido.nomeBase, preset.nome), fs.existsSync);
    // reserva o nome já (duas exportações iguais na fila não brigam pelo mesmo arquivo)
    fs.writeFileSync(saida, '');
    const titulo = `${corte.nome || 'Corte'} · ${preset.nome}`;

    const executar = async (aoProgresso, aoCancelar) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gravador-rpg-'));
      try {
        const imgs = this._gravarRetratos(tmp, retratos);
        const camadasArq = camadas.map((c, i) => ({ x: Number(c.x), y: Number(c.y), arquivo: this._gravarPng(tmp, `camada${i}.png`, c.png) }));
        const fundoArq = fundo ? { y: fundo.y, escala: fundo.escala, arquivo: fundo.png ? this._gravarPng(tmp, 'fundo.png', fundo.png) : null } : null;
        const finalArq = final ? { duracao: final.duracao, fade: final.fade, arquivo: this._gravarPng(tmp, 'final.png', final.png) } : null;
        if (ass) fs.writeFileSync(path.join(tmp, 'legendas.ass'), ass, 'utf8');
        const cmd = C.montarComando({
          preset, pedacos, fonte, audio: corte.audio, vertical,
          retratos: imgs,
          layout: { ...(pedido.layout || {}), quantidade: Math.max(1, imgs.length) },
          encoder: ff, opcaoFiltroArquivo: ff.opcaoFiltroArquivo, bitrateKbps: pedido.bitrateKbps || null,
          fpsFixo: pedido.fpsFixo || null, sempreAudio: true,
          saida, arquivoFiltros: path.join(tmp, 'filtros.txt'), arquivoLista: path.join(tmp, 'lista.txt'),
          legendas: ass ? 'legendas.ass' : null,
          camadas: camadasArq, fundo: fundoArq, final: finalArq, musica,
          pastaFontes: process.platform === 'win32' ? path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts') : null,
        });
        if (cmd.filtros) fs.writeFileSync(path.join(tmp, 'filtros.txt'), cmd.filtros);
        if (cmd.lista) fs.writeFileSync(path.join(tmp, 'lista.txt'), cmd.lista);
        const job = midia.executar(ff.bin, cmd.args, cmd.duracao, aoProgresso, { cwd: tmp });
        if (aoCancelar) aoCancelar(job.cancelar);
        await job.promessa;
        return { saida, avisos: cmd.avisos };
      } catch (e) {
        try { fs.unlinkSync(saida); } catch { /* */ }
        throw e;
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    };
    return {
      titulo, preset: preset.id, saida, executar, fps: fonte.fps,
      arquivos: pedacos.map(x => x.arquivo),
      descartar: () => apagarSeVazio(saida),
    };
  }

  /**
   * Áudio de um corte (faixa 1, mono, 16 kHz) num .wav, para a transcrição.
   * Devolve { inicio } = em que ponto da SESSÃO (ms) o áudio começa.
   */
  async extrairAudio(sessaoArquivo, corte, destino) {
    const ff = await this.ffmpeg();
    if (!ff.ok) throw new Error(ff.erro);
    const sessao = lerSessao(sessaoArquivo);
    const pausas = sessao.pausas || [];
    const R = ms => Pausas.paraGravacao(ms, pausas);
    const linha = await this.linha(sessao, corte.fonte);
    const pedacos = C.pedacosDoTrecho(linha, R(corte.ini) / 1000, R(corte.fim) / 1000);
    if (!pedacos.length) throw new Error('O vídeo deste trecho não foi encontrado.');
    const primeiro = linha.find(a => a.caminho === pedacos[0].arquivo);
    const iniReal = ((primeiro ? primeiro.inicio : 0) + pedacos[0].ss) * 1000;
    const args = [];
    pedacos.forEach(x => args.push('-ss', x.ss.toFixed(3), '-t', x.dur.toFixed(3), '-i', x.arquivo));
    const ent = pedacos.map((_, i) => `[${i}:a:0]`).join('');
    args.push('-filter_complex', `${ent}concat=n=${pedacos.length}:v=0:a=1,aresample=16000,aformat=sample_fmts=s16:sample_rates=16000:channel_layouts=mono[a]`,
      '-map', '[a]', '-c:a', 'pcm_s16le', destino);
    const dur = pedacos.reduce((t, x) => t + x.dur, 0);
    await midia.executar(ff.bin, args, dur, null).promessa;
    return { inicio: Pausas.paraSessao(iniReal, pausas), duracao: dur * 1000 };
  }

  /**
   * Compilado: vários cortes, um depois do outro, num arquivo só.
   * Cada corte é exportado com as mesmas opções e depois os arquivos são juntados sem recodificar.
   */
  async prepararCompilado(pedidos, { preset, pastaSaida, nomeBase }) {
    if (!pedidos.length) throw new Error('Escolha pelo menos um corte.');
    const p = C.PRESETS[preset];
    if (!p || p.tipo === 'copia') throw new Error('O compilado precisa de um formato que recodifica (não o corte rápido).');
    const ff = await this.ffmpeg();
    if (!ff.ok) throw new Error(ff.erro);
    const total = pedidos.reduce((s, x) => s + (x.corte.fim - x.corte.ini) / 1000, 0);
    const bitrateKbps = p.alvoMB ? C.bitrateParaTamanho(p.alvoMB, total, p.audioKbps) : null;
    fs.mkdirSync(pastaSaida, { recursive: true });
    const saida = C.caminhoLivre(pastaSaida, C.nomeArquivo(nomeBase || 'Melhores momentos', p.nome), fs.existsSync);
    fs.writeFileSync(saida, '');
    const avisos = [];
    if (bitrateKbps && bitrateKbps < 500) avisos.push(`Compilado longo para caber em ${p.alvoMB} MB: a qualidade fica baixa.`);

    // todas as partes com o mesmo fps (juntar sem recodificar exige vídeos idênticos)
    let maiorFps = 0;
    const arquivos = [];
    for (const ped of pedidos) {
      try {
        const s = lerSessao(ped.sessaoArquivo);
        const l = await this.linha(s, ped.corte.fonte);
        const info = (l.find(x => x.info) || {}).info;
        if (info) maiorFps = Math.max(maiorFps, Math.round(info.fps));
        l.forEach(x => arquivos.push(x.caminho));
      } catch { /* a parte com problema avisa ao exportar */ }
    }
    const fpsFixo = Math.min(p.fpsMax || 60, maiorFps || 30);

    const executar = async (aoProgresso, aoCancelar) => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gravador-rpg-comp-'));
      let feito = 0;
      let cancelado = false;
      let cancelarAtual = null;
      // cancelar vale para a parte que está rodando e impede as próximas
      if (aoCancelar) aoCancelar(() => { cancelado = true; if (cancelarAtual) cancelarAtual(); });
      const erroCancelado = () => Object.assign(new Error('Cancelado.'), { cancelado: true });
      try {
        const partes = [];
        for (let i = 0; i < pedidos.length; i++) {
          if (cancelado) throw erroCancelado();
          const ped = pedidos[i];
          const dur = (ped.corte.fim - ped.corte.ini) / 1000;
          // mesmo bitrate em todas as partes quando há tamanho-alvo (o total cabe no limite)
          const prep = await this.preparar({ ...ped, preset, pastaSaida: tmp, nomeBase: 'parte-' + i, bitrateKbps, fpsFixo });
          const r = await prep.executar(f => aoProgresso((feito + f * dur) / total * 0.97), c => { cancelarAtual = c; });
          partes.push(r.saida);
          feito += dur;
        }
        if (cancelado) throw erroCancelado();
        const lista = path.join(tmp, 'juntar.txt');
        fs.writeFileSync(lista, partes.map(x => `file '${x.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n') + '\n');
        const job = midia.executar(ff.bin, ['-f', 'concat', '-safe', '0', '-i', lista, '-c', 'copy', '-movflags', '+faststart', saida], total, f => aoProgresso(0.97 + f * 0.03));
        cancelarAtual = job.cancelar;
        await job.promessa;
        return { saida, avisos };
      } catch (e) {
        try { fs.unlinkSync(saida); } catch { /* */ }
        throw e;
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    };
    return {
      titulo: `${nomeBase || 'Melhores momentos'} · ${p.nome} (${pedidos.length} cortes)`, preset: p.id, saida, executar, avisos,
      arquivos, descartar: () => apagarSeVazio(saida),
    };
  }
}

function apagarSeVazio(c) {
  try { if (fs.statSync(c).size === 0) fs.unlinkSync(c); } catch { /* já não existe */ }
}

/**
 * Pontos da câmera no relógio do vídeo exportado: os pontos são guardados em tempo da sessão
 * desde o início do corte; o vídeo pode começar depois (replay curto) e pular pausas.
 */
function ajustarCamera(corte, iniRealMs, R, fonte) {
  const pts = (corte.vertical && corte.vertical.camera) || [];
  if (!pts.length) return pts;
  const W = fonte.largura || 1920, H = fonte.altura || 1080;
  const conv = pts.map(p => ({ ...p, t: R(corte.ini + p.t) - iniRealMs }));
  if (conv[0].t >= 0) return conv;
  // a câmera no instante 0 do vídeo: a mesma que estaria na tela naquele momento
  const desloc = -conv[0].t;
  const b0 = Camera.caixaEm(conv.map(p => ({ ...p, t: p.t + desloc })), desloc, W, H);
  const antes = conv.filter(p => p.t < 0).pop();
  return [{ t: 0, x: b0.x, y: b0.y, w: b0.w, trans: antes.trans }].concat(conv.filter(p => p.t > 0));
}

/** Id curto e aleatório para cortes. */
function novoIdCorte() { return crypto.randomBytes(5).toString('hex'); }

module.exports = { Exportador, novoIdCorte };
