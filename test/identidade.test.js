'use strict';
// Identidade visual: validação, posição das camadas e a curva de volume da música.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../src/core/identidade');
const cfg = require('../src/core/config');

test('identidade: config velha ganha camadas, final e fundo padrão; valores ruins são corrigidos', () => {
  const m = cfg.normalizar({ mesas: [{ nome: 'X', identidade: { camadas: [{ tipo: 'texto', texto: 'oi', opacidade: 500, h: { x: 'a' } }, { tipo: 'imagem', imagem: '../../segredo.txt' }] } }] }).mesas[0];
  assert.equal(m.identidade.camadas.length, 2);
  assert.equal(m.identidade.camadas[0].opacidade, 100);
  assert.equal(m.identidade.camadas[0].h.x, I.POS_PADRAO.h.x);
  assert.equal(m.identidade.camadas[1].imagem, '', 'nome de imagem com pasta é recusado');
  assert.deepEqual(m.final.h, { ativo: false, imagem: '', duracao: 4, fade: 1, cor: '#000000', ajuste: 'caber' });
  assert.equal(m.vertical.fundo.tipo, 'desfoque');
  const muitas = I.normalizarIdentidade({ camadas: Array.from({ length: 30 }, () => ({})) });
  assert.equal(muitas.camadas.length, I.MAX_CAMADAS);
});

test('identidade: retângulo da camada segue o centro e a largura, mantendo a proporção', () => {
  const c = I.normalizarCamada({ tipo: 'imagem', imagem: 'a.png', h: { x: 0.5, y: 0.5, w: 0.25 } });
  const r = I.retangulo({}, c, 1920, 1080, 'h', { naturalWidth: 400, naturalHeight: 200 });
  assert.deepEqual([r.x, r.y, r.largura, r.altura], [720, 420, 480, 240]);
});

test('música: a expressão do FFmpeg dá o mesmo volume que a prévia', () => {
  const m = I.normalizarMusica({ faixa: 'f1', volume: 80, fadeIn: 0, fadeOut: 0, pontos: [{ t: 1000, v: 100 }, { t: 3000, v: 20 }, { t: 5000, v: 150 }] });
  const desloc = 250;
  const e = I.exprCurva(m, desloc);
  const avaliar = t => Function('t', `const lt = (a, b) => (a < b ? 1 : 0), se = (c, a, b) => (c ? a : b); return ${e.replace(/\bif\(/g, 'se(')};`)(t);
  for (const ms of [0, 800, 1000, 2000, 2999, 3000, 4100, 6000]) {
    const esperado = I.ganhoEm(m, ms, 0);
    const obtido = avaliar((ms - desloc) / 1000);
    assert.ok(Math.abs(esperado - obtido) < 0.002, `${ms} ms: ${esperado} × ${obtido}`);
  }
  assert.equal(I.exprCurva(I.normalizarMusica({ volume: 50 }), 0), '0.5');
  // fades da prévia
  const f = I.normalizarMusica({ volume: 100, fadeIn: 2, fadeOut: 1 });
  assert.equal(I.ganhoEm(f, 1000, 10000), 0.5);
  assert.equal(I.ganhoEm(f, 9500, 10000), 0.5);
});
