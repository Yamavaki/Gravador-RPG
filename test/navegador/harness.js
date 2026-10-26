'use strict';
// Roda o app inteiro (controlador + overlay + interface) sem o Electron,
// com um OBS falso, para testar a interface num navegador.
// Imprime "PRONTO <porta-da-interface>" quando está de pé.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Controlador } = require('../../src/main/controlador');
const { criarAcoes, executarAcao } = require('../../src/main/acoes');
const { fabricaOBS } = require('../apoio');
const { discordFalso } = require('../discord-falso');
const { instalarWhisperFalso } = require('../whisper-falso');
const { Transcricao } = require('../../src/core/transcricao');
const { Atualizador } = require('../../src/main/atualizador');

const UI = path.join(__dirname, '..', '..', 'src', 'ui');
const CORE = path.join(__dirname, '..', '..', 'src', 'core');
const { execFileSync } = require('child_process');
const { Sessao } = require('../../src/core/sessao');
const IMGS = path.join(__dirname, 'imgs');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

(async () => {
  const dados = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-ui-'));
  const obsFalso = fabricaOBS({ gravando: false });
  instalarWhisperFalso(path.join(dados, 'whisper'));
  const ctl = new Controlador({
    pastaDados: dados, pastaCortes: path.join(dados, 'cortes'), WebSocket: obsFalso.WSFalso, portaOverlay: 0, intervaloReconexao: 60000,
    removerArquivo: async c => fs.unlinkSync(c), notificar: () => {},
    carregarDiscord: discordFalso().carregar,
    transcricao: new Transcricao({ pasta: path.join(dados, 'whisper') }),
    // GitHub de mentira: sempre há a versão 9.9.9
    atualizador: new Atualizador({
      versaoAtual: require('../../package.json').version, pastaDados: dados, pastaApp: dados,
      fetch: async url => ({
        ok: true, status: 200,
        json: async () => [{ name: 'v9.9.9' }],
        text: async () => '## 9.9.9\n- tudo novo',
        headers: { get: () => null },
      }),
    }),
  });
  const registro = { abrirSite: 0, copiado: '', youtube: 0, audios: [], pastaAudio: null, externos: [] };
  let imgs = ['retrato-alto.png', 'dragao.png'], ii = 0;
  const acoes = criarAcoes({
    ctl,
    statusAtalhos: () => ({ marcar: 'ok', marcarNome: 'ok', replay: 'ocupado', gravar: 'ok' }),
    escolherArquivoImagem: async () => path.join(IMGS, imgs[ii++ % imgs.length]),
    marcarComNome: async () => ctl.marcar('', 'atalho-nome', { capitulo: false }),
    fecharMarcador: () => {},
    abrirSiteStreamKit: () => { registro.abrirSite++; },
    recarregarStreamKit: () => {},
    mostrarStreamKit: () => {},
    abrirCaminho: () => '',
    mostrarNaPasta: c => { registro.mostrado = c; return true; },
    escolherPasta: async () => path.join(dados, 'outra-pasta'),
    escolherExecutavel: async () => null,
    abrirExterno: u => { registro.externos.push(u); },
    copiar: t => { registro.copiado = t; return true; },
    navegador: () => navFalso,
    escolherAudios: async () => registro.audios,
    escolherPastaAudio: async () => registro.pastaAudio,
    aplicarAtualizacao: async () => { registro.atualizou = (registro.atualizou || 0) + 1; return { ok: true, mensagem: 'Atualizando…' }; },
  });
  // navegador falso: mesma interface do src/main/navegador.js, sem páginas de verdade
  const { paraEndereco, INICIO } = require('../../src/core/musica/endereco');
  let nAba = 0;
  const navFalso = {
    ordem: [],
    nova(t) { const id = 'a' + (++nAba); this.ordem.push(id); ctl.musica.abaAberta(id, paraEndereco(t)); registro.abasAbertas = (registro.abasAbertas || 0) + 1; return id; },
    fechar(id) { this.ordem = this.ordem.filter(x => x !== id); ctl.musica.abaFechou(id); },
    ativar(id) { ctl.musica.ativarAba(id); },
    ir(id, t) { const url = paraEndereco(t); ctl.musica.abaMudou(id || ctl.musica.abaAtiva, { url, titulo: 'Página ' + url }); return id; },
    acao(id, a) { registro.navAcao = a; return id; },
    definirArea(area) { registro.areaNav = area; },
    restaurar(urls) { if (this.ordem.length) return; (urls && urls.length ? urls : [INICIO]).forEach(u => this.nova(u)); },
  };
  // ponte com o motor de áudio de verdade, aberto pelo teste noutra página
  const doMotor = new Set();
  ctl.musica.on('motor', p => { for (const r of doMotor) r.write(`data: ${JSON.stringify(p)}\n\n`); });
  const ouvintes = new Set();
  ctl.on('estado', e => {
    const msg = `data: ${JSON.stringify({ ...e, atalhos: acoes.estado().atalhos })}\n\n`;
    for (const r of ouvintes) r.write(msg);
  });

  const corpo = req => new Promise(r => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => r(b ? JSON.parse(b) : [])); });
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/api/eventos') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      ouvintes.add(res);
      req.on('close', () => ouvintes.delete(res));
      return;
    }
    if (u.pathname.startsWith('/api/') && req.method === 'POST') {
      const r = await executarAcao(acoes, u.pathname.slice(5), await corpo(req));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(r));
    }
    // ganchos de teste: simular StreamKit e eventos do OBS
    const CORS = { 'Access-Control-Allow-Origin': '*' };
    if (u.pathname === '/teste/motor/eventos') {
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      res.write(': ok\n\n');
      doMotor.add(res);
      req.on('close', () => doMotor.delete(res));
      return;
    }
    if (u.pathname.startsWith('/teste/motor/')) {
      const dados = await corpo(req);
      const qual = u.pathname.slice(13);
      if (qual === 'pronto') ctl.musica.motorPronto();
      else if (qual === 'estado') ctl.musica.motorEstado(dados);
      else if (qual === 'resposta') ctl.musica.responderMotor(dados.id, dados.r);
      else if (qual === 'aviso') ctl.musica.motorAviso(dados.texto);
      res.writeHead(200, CORS);
      return res.end('{}');
    }
    if (u.pathname === '/teste/aba') {
      const [id, campos] = await corpo(req);
      ctl.musica.abaMudou(id, campos);
      return res.end('{}');
    }
    if (u.pathname === '/teste/configurar') {
      Object.assign(registro, await corpo(req));
      return res.end('{}');
    }
    if (u.pathname === '/teste/musica') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(ctl.musica.publico())); }
    if (u.pathname === '/teste/link') {
      const link = (await corpo(req))[0];
      for (const r of ouvintes) r.write(`event: link\ndata: ${JSON.stringify(link)}\n\n`);
      return res.end('{}');
    }
    if (u.pathname === '/teste/streamkit') { ctl.receberStreamKit(await corpo(req)); return res.end('{}'); }
    if (u.pathname === '/teste/registro') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(registro)); }
    if (u.pathname === '/teste/overlay') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(ctl.servidor.estado)); }
    if (u.pathname === '/teste/config') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(ctl.cfg)); }
    if (u.pathname === '/teste/fila') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(ctl.fila.lista())); }
    if (u.pathname === '/teste/criar-sessao') {
      // sessão de 20 s em dois pedaços, com falas dos jogadores da mesa
      const bin = (await ctl.exportador.ffmpeg()).bin;
      const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'grpg-ui-video-'));
      const video = (nome, cor) => {
        const v = path.join(pasta, nome);
        execFileSync(bin, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30,drawbox=c=${cor}@0.7:t=fill:w=240:h=240`,
          '-f', 'lavfi', '-i', 'sine=f=440:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=f=660:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=f=880:sample_rate=48000',
          '-t', '10', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:a',
          // VP9/Opus: o Chromium dos testes não toca H.264 (o Electron do app toca os dois)
          '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '800k', '-g', '15', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', v]);
        return v;
      };
      const a = video('rec-1.mp4', 'red'), b = video('rec-2.mp4', 'blue');
      const mesa = ctl.mesa;
      const t0 = Date.now() - 30000;
      const s = new Sessao(ctl.pastaSessoes, { inicio: t0, mesa: { id: mesa.id, nome: mesa.nome }, jogadores: mesa.jogadores.map(j => ({ id: j.id, personagem: j.personagem, jogador: j.jogador, imagem: j.imagem })) });
      s.arquivoGravacao(a, t0);
      const [j1, j2] = mesa.jogadores;
      if (j1) { s.estado([{ chave: j1.id, falando: true }], t0 + 2000); s.estado([{ chave: j1.id, falando: false }], t0 + 6000); }
      if (j2) { s.estado([{ chave: j2.id, falando: true }], t0 + 11000); s.estado([{ chave: j2.id, falando: false }], t0 + 14000); }
      s.marcar('Crítico do Kael', 'atalho', t0 + 9000);
      s.marcar('Combate: Emboscada', 'foundry', t0 + 15000);
      s.arquivoGravacao(b, t0 + 10000);
      s.encerrar(t0 + 20000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ id: path.basename(s.dir) }));
    }
    if (u.pathname.startsWith('/core/')) {
      const rel = u.pathname.slice(6);
      if (!['camera.js', 'layout-retratos.js', 'pausas.js', 'legendas.js', 'identidade.js', 'musica/trilha-util.js', 'musica/analise.js'].includes(rel)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return res.end(fs.readFileSync(path.join(CORE, rel)));
    }
    const arq = path.join(UI, path.normalize(u.pathname === '/' ? '/index.html' : u.pathname));
    if (!arq.startsWith(UI) || !TIPOS[path.extname(arq)]) { res.writeHead(404); return res.end(); }
    fs.readFile(arq, (e, d) => {
      if (e) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] });
      res.end(d);
    });
  });
  await ctl.iniciar();
  srv.listen(0, '127.0.0.1', () => console.log('PRONTO ' + srv.address().port));
  process.stdin.on('end', async () => { await ctl.parar(); process.exit(0); });
  process.stdin.resume();
})();
