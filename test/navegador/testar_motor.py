"""Motor de áudio do bot (Trilha Viva adaptado) num Chromium de verdade: toca arquivos,
seções com loop de chefe, troca no fim da volta, camadas, crossfade, parar.
Confere o PCM que sairia para o Discord (frequência do tom de cada arquivo)."""
import json, math, struct, subprocess, sys, tempfile, wave
from pathlib import Path
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[2]
falhas = []

def checar(cond, msg):
    print(('  ok   ' if cond else '  FALHA ') + msg)
    if not cond:
        falhas.append(msg)

def wav(caminho, segundos, freq, taxa=44100, amp=0.5, canais=2):
    with wave.open(str(caminho), 'wb') as w:
        w.setnchannels(canais); w.setsampwidth(2); w.setframerate(taxa)
        quadros = bytearray()
        for i in range(int(segundos * taxa)):
            v = int(amp * 32767 * math.sin(2 * math.pi * freq * i / taxa))
            quadros += struct.pack('<h', v) * canais
        w.writeframes(bytes(quadros))

pasta = Path(tempfile.mkdtemp(prefix='grpg-motor-'))
# música com 3 seções de tons diferentes: 0-2 s 300 Hz, 2-5 s 500 Hz (loop), 5-8 s 700 Hz
with wave.open(str(pasta / 'chefe.wav'), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(48000)
    q = bytearray()
    for i in range(8 * 48000):
        t = i / 48000
        f = 300 if t < 2 else 500 if t < 5 else 700
        q += struct.pack('<h', int(0.5 * 32767 * math.sin(2 * math.pi * f * t))) * 2
    w.writeframes(bytes(q))
wav(pasta / 'outra.wav', 6, 1100)
wav(pasta / 'chuva.wav', 3, 200, amp=0.2, canais=1)
# arquivo longo (mais de 10 min): toca em streaming
with wave.open(str(pasta / 'longa.wav'), 'wb') as w:
    w.setnchannels(1); w.setsampwidth(1); w.setframerate(8000)
    um = bytes(int(128 + 60 * math.sin(2 * math.pi * 400 * i / 8000)) for i in range(8000))
    for _ in range(610): w.writeframes(um)

node = subprocess.Popen(['node', str(RAIZ / 'test/navegador/motor-servidor.js'), str(pasta), 'chefe.wav', 'outra.wav', 'chuva.wav', 'longa.wav'],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
_, porta, urls = node.stdout.readline().split(' ', 2)
urls = json.loads(urls)

PONTE = """
window.__pcm = []; window.__estado = null; window.__avisos = []; window.__resp = {}; window.__pronto = false;
window.ponte = {
  aoComando(cb) { window.__cmdCb = cb; },
  responder(id, r) { window.__resp[id] = r; },
  estado(e) { window.__estado = e; },
  aviso(t) { window.__avisos.push(t); },
  pronto() { window.__pronto = true; },
  pcm(buf) {
    // guarda só um resumo de cada pedaço: hora, volume e frequência (cruzamentos por zero)
    let cruz = 0, soma = 0;
    for (let i = 2; i < buf.length; i += 2) { if ((buf[i] >= 0) !== (buf[i - 2] >= 0)) cruz++; soma += buf[i] * buf[i]; }
    const n = buf.length / 2;
    window.__pcm.push({ t: performance.now(), freq: cruz / 2 / (n / 48000), cruz, rms: Math.sqrt(soma / n) / 32768, n });
  },
};
let __id = 0;
window.__cmd = (cmd, ...args) => new Promise(res => {
  const id = ++__id;
  window.__cmdCb({ id, cmd, args });
  const t = setInterval(() => { if (window.__resp[id]) { clearInterval(t); res(window.__resp[id]); } }, 10);
});
"""

def faixa(nome, **extra):
    return dict({'uuid': nome, 'src': urls[nome], 'nome': nome, 'tipo': 'musica', 'secoes': []}, **extra)

SECOES = [
    {'id': 'intro', 'nome': 'Intro', 'inicio': 0, 'termino': 2, 'acao': 'next', 'cor': '#6f9be0'},
    {'id': 'fase1', 'nome': 'Fase 1', 'inicio': 2, 'termino': 5, 'acao': 'loop', 'cor': '#d9b44a'},
    {'id': 'final', 'nome': 'Final', 'inicio': 5, 'termino': 8, 'acao': 'next', 'cor': '#e0866a'},
]

try:
    with sync_playwright() as p:
        nav = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pag = nav.new_page()
        erros = []
        pag.on('pageerror', lambda e: erros.append(str(e)))
        pag.add_init_script(PONTE)
        pag.goto(f'http://127.0.0.1:{porta}/motor/')
        pag.wait_for_function('window.__pronto', timeout=10000)
        checar(True, 'motor abriu e avisou que está pronto')
        cmd = lambda *a: pag.evaluate('([c, ...a]) => window.__cmd(c, ...a)', list(a))

        def freq_recente(seg=0.5):
            return pag.evaluate('''(seg) => {
              const agora = performance.now();
              const r = window.__pcm.filter(x => agora - x.t < seg * 1000 && x.rms > 0.02);
              if (!r.length) return 0;
              // soma os pedaços (cada um tem só 20 ms: contar cruzamentos num só erra uns 25 Hz)
              const c = r.reduce((s, x) => s + x.cruz, 0), n = r.reduce((s, x) => s + x.n, 0);
              return c / 2 / (n / 48000);
            }''', seg)
        def som_recente(seg=0.5):
            return pag.evaluate('(seg) => { const a = performance.now(); return window.__pcm.filter(x => a - x.t < seg * 1000).reduce((m, x) => Math.max(m, x.rms), 0); }', seg)
        def camadas():
            return list((pag.evaluate('window.__estado') or {}).get('estado', {}).get('camadas', {}).values())
        def perto(f, alvo, tol=0.08):
            return abs(f - alvo) <= alvo * tol

        print('1. tocar música com seções: intro → loop da fase 1')
        r = cmd('tocarSom', faixa('chefe.wav', secoes=SECOES, repetir=True))
        checar(r.get('ok'), f'comando aceito {r}')
        pag.wait_for_timeout(1300)
        f = freq_recente()
        checar(perto(f, 300), f'começa na intro (300 Hz): {f:.0f}')
        cs = camadas()
        checar(len(cs) == 1 and cs[0]['seg']['secao'] == 'intro', 'estado: uma camada, na intro')
        pag.wait_for_timeout(2200)
        checar(perto(freq_recente(), 500), f'entrou na fase 1 (500 Hz): {freq_recente():.0f}')
        pag.wait_for_timeout(3600)   # passa do fim da fase 1 (5 s): tem que ter voltado ao início dela
        f = freq_recente()
        checar(perto(f, 500), f'fase 1 repete em loop em vez de seguir: {f:.0f}')
        cs = camadas()
        checar(cs[0]['seg']['secao'] == 'fase1' and cs[0]['seg']['modo'] == 'secao', 'estado: fase 1 em loop')
        dur = (pag.evaluate('window.__estado') or {}).get('duracoes', {})
        checar(any(abs(v - 8) < 0.05 for v in dur.values()), f'duração informada para a barra de progresso {dur}')

        print('2. trocar no fim da volta para o final')
        cid = cs[0]['id']
        cmd('irParaSecao', cid, 'final', 'volta')
        pag.wait_for_timeout(300)
        cs = camadas()
        checar(cs[0]['prox'] and cs[0]['prox']['quando'] == 'volta', 'pedido na fila, esperando a volta acabar')
        pag.wait_for_timeout(3600)
        f = freq_recente()
        checar(perto(f, 700), f'entrou no final (700 Hz): {f:.0f}')

        print('3. camada de ambiente por cima')
        cmd('tocarSom', faixa('chuva.wav', tipo='ambiente', repetir=True))
        pag.wait_for_timeout(800)
        cs = camadas()
        checar(len(cs) == 2 and sorted(c['tipo'] for c in cs) == ['ambiente', 'musica'], 'duas camadas: música + ambiente')

        print('4. outra música entra com crossfade e substitui a primeira')
        cmd('pararCamada', [c for c in cs if c['tipo'] == 'ambiente'][0]['id'], 0.2)
        cmd('tocarSom', faixa('outra.wav'))
        pag.wait_for_timeout(2600)
        f = freq_recente()
        checar(perto(f, 1100), f'nova música tocando (1100 Hz): {f:.0f}')
        cs = camadas()
        checar(len(cs) == 1 and cs[0]['fila'][0]['uuid'] == 'outra.wav', 'só a nova ficou')

        print('5. pausar, retomar, volume')
        cid = cs[0]['id']
        cmd('pausar', cid)
        pag.wait_for_timeout(900)
        checar(som_recente(0.4) < 0.01, f'pausado: silêncio ({som_recente(0.4):.3f})')
        cmd('retomar', cid)
        pag.wait_for_timeout(900)
        checar(som_recente(0.4) > 0.05, 'retomou')
        cmd('volume', cid, 0.3)
        pag.wait_for_timeout(700)
        v = som_recente(0.3)
        checar(0.01 < v < 0.12, f'volume baixou ({v:.3f})')

        print('6. fila com próxima faixa e pular')
        cmd('pararTudo')
        pag.wait_for_timeout(1600)
        checar(som_recente(0.3) < 0.01, 'parar tudo: silêncio')
        cmd('tocarFila', [faixa('outra.wav'), faixa('chefe.wav')])
        pag.wait_for_timeout(1200)
        checar(perto(freq_recente(), 1100), 'fila começa pela primeira')
        cs = camadas()
        cmd('pular', cs[0]['id'], 1)
        pag.wait_for_timeout(2400)   # 0,4 s + crossfade de 1,5 s
        f = freq_recente(0.3)
        cs = camadas()
        segunda = cs[0]['fila'][1]['id'] if len(cs[0]['fila']) > 1 else None
        checar(cs[0]['seg']['itemId'] == segunda and (perto(f, 300) or perto(f, 500)), f'pulou para a segunda (300/500 Hz): {f:.0f}')

        print('7. arquivo longo toca em streaming')
        cmd('pararTudo')
        pag.wait_for_timeout(1300)
        cmd('tocarSom', faixa('longa.wav'))
        pag.wait_for_timeout(2500)
        f = freq_recente()
        checar(perto(f, 400, 0.12), f'arquivo de 10 min tocando (400 Hz): {f:.0f}')

        print('8. seções editadas com a música tocando valem na hora')
        cmd('pararTudo')
        pag.wait_for_timeout(1300)
        cmd('tocarSom', faixa('chefe.wav'))
        pag.wait_for_timeout(600)
        cmd('atualizarSecoes', 'chefe.wav', SECOES)
        pag.wait_for_timeout(500)
        cs = camadas()
        checar(cs[0]['fila'][0]['secoes'][1]['nome'] == 'Fase 1', 'seções novas chegaram na faixa tocando')

        r = cmd('naoExiste')
        checar('desconhecido' in r.get('erro', ''), 'comando estranho é recusado')
        cap = (pag.evaluate('window.__estado') or {}).get('captura')
        checar(cap == 'worklet', f'captura pela thread de áudio (AudioWorklet): {cap}')
        checar(not erros, f'sem erros na página {erros}')
        checar(not pag.evaluate('window.__avisos'), f'sem avisos {pag.evaluate("window.__avisos")}')
        nav.close()
finally:
    node.stdin.close()
    node.wait(timeout=10)

print('\nRESULTADO:', 'tudo certo' if not falhas else f'{len(falhas)} falha(s)')
sys.exit(1 if falhas else 0)
