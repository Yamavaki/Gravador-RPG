'use strict';
// Anotações para tutoriais: validação, fade/corte seco e clique com o mouse; câmera 16:9.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../src/core/anotacoes');
const Cam = require('../src/core/camera');

test('anotações: valores ruins são corrigidos e a lista fica em ordem', () => {
  const l = N.normalizarLista([{ tipo: 'xyz', ini: 5000, fim: 4000, cor: 'azul' }, { tipo: 'texto', ini: 1000 }]);
  assert.equal(l[0].tipo, 'texto');
  assert.equal(l[0].texto, 'Clique aqui');
  assert.equal(l[1].tipo, 'seta');
  assert.equal(l[1].fim, 5100, 'fim antes do início vira início + 0,1 s');
  assert.equal(l[1].cor, '#F0B44C');
  assert.equal(N.normalizarLista(Array.from({ length: 200 }, () => ({}))).length, N.MAX);
});

test('anotações: fade de entrada e saída, ou corte seco', () => {
  const a = N.normalizar({ ini: 1000, fim: 3000, fade: 500 });
  assert.equal(N.alfaEm(a, 999), 0);
  assert.equal(N.alfaEm(a, 1250), 0.5);
  assert.equal(N.alfaEm(a, 2000), 1);
  assert.equal(N.alfaEm(a, 2750), 0.5);
  assert.equal(N.alfaEm(a, 3000), 0);
  const c = N.normalizar({ ini: 1000, fim: 3000, entrada: 'corte' });
  assert.equal(N.alfaEm(c, 1000), 1);
});

test('anotações: clique acha as pontas e o corpo da seta; retângulo só pela borda', () => {
  const s = N.normalizar({ tipo: 'seta', x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.1 });
  assert.equal(N.acertar(null, s, 1000, 1000, 100, 100), 'p1');
  assert.equal(N.acertar(null, s, 1000, 1000, 500, 102), 'p2');
  assert.equal(N.acertar(null, s, 1000, 1000, 300, 104), 'corpo');
  assert.equal(N.acertar(null, s, 1000, 1000, 300, 200), null);
  const r = N.normalizar({ tipo: 'retangulo', x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.6 });
  assert.equal(N.acertar(null, r, 1000, 1000, 400, 202), 'corpo');
  assert.equal(N.acertar(null, r, 1000, 1000, 400, 400), null, 'o miolo deixa clicar no que está embaixo');
});

test('câmera 16:9: tela inteira, zoom e "desliza em X s"', () => {
  const asp = 16 / 9;
  assert.deepEqual(Cam.inteira(1920, 1080, asp), { x: 0, y: 0, w: 1 });
  const ultra = Cam.inteira(2560, 1080, asp);   // gravação mais larga: caixa centralizada
  assert.ok(Math.abs(ultra.w - 0.75) < 1e-9 && Math.abs(ultra.x - 0.125) < 1e-9);
  const pts = [{ t: 0, x: 0, y: 0, w: 1, trans: 'rapido', dur: 1000 }, { t: 5000, x: 0.5, y: 0.5, w: 0.5 }];
  assert.equal(Cam.caixaEm(pts, 3500, 1920, 1080, asp).w, 1, 'parado até 1 s antes do próximo ponto');
  const meio = Cam.caixaEm(pts, 4500, 1920, 1080, asp);
  assert.ok(meio.w < 1 && meio.w > 0.5, `no meio do movimento ${meio.w}`);
  assert.ok(Math.abs(Cam.caixaEm(pts, 5000, 1920, 1080, asp).h - 0.5) < 1e-9, 'a caixa mantém 16:9');
});
