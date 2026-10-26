'use strict';
// Um "whisper-cli" de mentira para os testes: confere os argumentos e escreve o JSON como o de verdade.
const fs = require('fs');
const path = require('path');
const { MODELOS } = require('../src/core/transcricao');

const SCRIPT = `#!/usr/bin/env node
const a = process.argv.slice(2);
const val = k => a[a.indexOf(k) + 1];
if (process.env.HOME_ARGS) require('fs').writeFileSync(process.env.HOME_ARGS, JSON.stringify(a));
process.stderr.write('whisper_print_progress_callback: progress = 50%\\n');
const json = { transcription: [
  { timestamps: { from: '00:00:00,000', to: '00:00:01,000' }, offsets: { from: 0, to: 1000 }, text: ' [Música]' },
  { timestamps: { from: '00:00:01,000', to: '00:00:04,000' }, offsets: { from: 1000, to: 4000 }, text: ' Rolei   vinte natural!' },
  { timestamps: { from: '00:00:05,000', to: '00:00:07,500' }, offsets: { from: 5000, to: 7500 }, text: ' O dragão caiu.' },
] };
require('fs').writeFileSync(val('-of') + '.json', JSON.stringify(json));
process.stderr.write('progress = 100%\\n');
`;

function instalarWhisperFalso(pasta) {
  const dir = path.join(pasta, 'programa', 'Release');
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
  fs.writeFileSync(bin, SCRIPT, { mode: 0o755 });
  fs.mkdirSync(path.join(pasta, 'modelos'), { recursive: true });
  fs.writeFileSync(path.join(pasta, 'modelos', MODELOS.preciso.arquivo), 'modelo');
  return bin;
}

module.exports = { instalarWhisperFalso };
