'use strict';
// Sobe o servidor do app com o motor de áudio e alguns arquivos de teste liberados.
// Imprime "PRONTO <porta> <json com as urls>".
const path = require('path');
const { ServidorOverlay } = require('../../src/core/servidor-overlay');

(async () => {
  const pasta = process.argv[2];
  const s = new ServidorOverlay({ porta: 0, pastaImagens: pasta });
  await s.iniciar();
  const urls = {};
  for (const n of process.argv.slice(3)) urls[n] = s.urlMidia(path.join(pasta, n));
  console.log('PRONTO ' + s.portaReal + ' ' + JSON.stringify(urls));
  process.stdin.on('end', () => s.parar().then(() => process.exit(0)));
  process.stdin.resume();
})();
