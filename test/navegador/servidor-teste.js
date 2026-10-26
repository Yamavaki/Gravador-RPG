'use strict';
// Sobe o servidor do overlay para os testes no navegador.
// Cada linha recebida no stdin é um JSON { mesa, presencas, conectado } → publica a vista.
const path = require('path');
const readline = require('readline');
const { ServidorOverlay } = require('../../src/core/servidor-overlay');
const { normalizarMesa } = require('../../src/core/config');
const { vistaOverlay } = require('../../src/core/pessoas');

(async () => {
  const s = new ServidorOverlay({ porta: 0, pastaImagens: path.join(__dirname, 'imgs') });
  await s.iniciar();
  console.log('PORTA ' + s.servidor.address().port);
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', linha => {
    const dados = JSON.parse(linha);
    if (dados.versao) { s.versaoOverlay = dados.versao; s.publicar(s.estado); console.log('OK'); return; }
    const { mesa, presencas, conectado } = dados;
    s.publicar(vistaOverlay(normalizarMesa(mesa), presencas || [], { conectado: !!conectado }));
    console.log('OK');
  });
  rl.on('close', () => s.parar().then(() => process.exit(0)));
})();
