"""Câmera do horizontal (zoom) e anotações para tutoriais, no horizontal e no vertical.
Uso: python3 test/navegador/testar_edicao.py [pasta_para_prints]"""
import json, re, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[2]
PRINTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None
falhas = []

def checar(cond, msg):
    print(('  ok   ' if cond else '  FALHA ') + msg)
    if not cond:
        falhas.append(msg)

node = subprocess.Popen(['node', str(RAIZ / 'test/navegador/harness.js')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
porta = int(node.stdout.readline().split()[1])
B = f'http://127.0.0.1:{porta}'
pegar = lambda c: json.loads(urllib.request.urlopen(B + c).read())
def post(caminho, dados):
    urllib.request.urlopen(urllib.request.Request(B + caminho, data=json.dumps(dados).encode(), method='POST')).read()
def api(nome, *args):
    return json.loads(urllib.request.urlopen(urllib.request.Request(B + '/api/' + nome, data=json.dumps(list(args)).encode(), method='POST')).read())
mesa = lambda: (lambda c: next(m for m in c['mesas'] if m['id'] == c['mesaAtiva']))(pegar('/teste/config'))

def esperar_fila(n, limite=180):
    fim = time.time() + limite
    while time.time() < fim:
        f = pegar('/teste/fila')
        if len(f) >= n and all(x['estado'] in ('pronto', 'erro', 'cancelado') for x in f):
            return f
        time.sleep(0.5)
    return pegar('/teste/fila')

def duracao(arq):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', arq], capture_output=True, text=True)
    return float(r.stdout.strip() or 0)
def pixel(arq, t, x, y):
    r = subprocess.run(['ffmpeg', '-loglevel', 'error', '-ss', str(t), '-i', arq, '-frames:v', '1', '-vf', f'crop=2:2:{x}:{y},format=rgb24', '-f', 'rawvideo', '-'], capture_output=True)
    return list(r.stdout[:3])
def volume(arq, ss, t):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-ss', str(ss), '-t', str(t), '-i', arq, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True)
    m = re.search(r'mean_volume: (-?[\d.]+) dB', r.stderr)
    return float(m[1]) if m else -999


try:
    with sync_playwright() as p:
        nav = p.chromium.launch()
        pag = nav.new_page(viewport={'width': 1360, 'height': 900})
        erros = []
        pag.on('pageerror', lambda e: erros.append(str(e)))
        pag.on('console', lambda m: m.type == 'error' and erros.append(m.text))
        pag.on('dialog', lambda d: d.accept())
        foto = lambda n: PRINTS and pag.screenshot(path=str(PRINTS / f'edicao-{n}.png'), full_page=True)
        corte_api = lambda: api('sessao', sid)['cortes'][0]

        pag.goto(B + '/#mesa')
        pag.wait_for_selector('[data-acao="addJogador"]')
        sid = pegar('/teste/criar-sessao')['id']
        cid = api('salvarCorte', sid, {'nome': 'Tutorial', 'ini': 2000, 'fim': 8000})['id']

        print('1. câmera do horizontal: zoom aqui e tela inteira')
        pag.goto(B + f'/#corte/{sid}/{cid}')
        pag.wait_for_selector('#painel-edicao [data-acao="edZoomAqui"]', timeout=20000)
        pag.wait_for_timeout(1200)
        pag.click('[data-acao="edZoomAqui"]')
        pag.wait_for_timeout(300)
        checar(pag.is_visible('#edicao-h'), 'zoom aqui liga a edição no vídeo')
        pag.evaluate('App.Cortes.ed().player.ir(5, false)')
        pag.wait_for_timeout(800)
        pag.click('[data-acao="edTelaInteira"]')
        pag.wait_for_timeout(800)
        cam = corte_api()['horizontal']['camera']
        checar(len(cam) == 2 and cam[0]['w'] < 0.6 and cam[1]['w'] > 0.99, f'dois pontos: zoom e volta para a tela inteira {cam}')
        pag.evaluate('App.Cortes.ed().player.ir(2.001, false)')
        pag.wait_for_timeout(800)
        if pag.locator('[data-trans-h="0"]').count():
            pag.select_option('[data-trans-h="0"]', 'rapido')
            pag.wait_for_timeout(200)
            pag.select_option('[data-dur-h="0"]', '1200')
        pag.wait_for_timeout(800)
        cam = corte_api()['horizontal']['camera']
        checar(cam[0]['trans'] == 'rapido' and cam[0].get('dur') == 1200, f'transição "desliza e para" em 1,2 s {cam[0]}')
        # arrastar a caixa na visão de edição
        pag.locator('#edicao-h').scroll_into_view_if_needed()
        pag.wait_for_timeout(300)
        g = pag.evaluate('''() => { const c = document.getElementById("edicao-h"), r = c.getBoundingClientRect(), g = App.Edicao._st.geoH.caixa, e = r.width / c.width;
            return { x: r.x + (g.x + g.w / 2) * e, y: r.y + (g.y + g.h / 2) * e }; }''')
        x0 = cam[0]['x']
        pag.mouse.move(g['x'], g['y'])
        pag.mouse.down()
        pag.mouse.move(g['x'] + 80, g['y'] + 20, steps=5)
        pag.mouse.up()
        pag.wait_for_timeout(800)
        cam = corte_api()['horizontal']['camera']
        checar(cam[0]['x'] > x0 + 0.03, f'arrastar a caixa move o zoom ({x0:.3f} → {cam[0]["x"]:.3f})')
        w0 = cam[0]['w']
        pag.mouse.move(g['x'] + 80, g['y'] + 20)
        for _ in range(4):
            pag.mouse.wheel(0, -100)
        pag.wait_for_timeout(900)
        checar(corte_api()['horizontal']['camera'][0]['w'] < w0 * 0.85, 'rodinha dá mais zoom')

        print('2. anotações: seta, destaque e texto')
        def desenhar(tipo, fx1, fy1, fx2, fy2, alvo='#edicao-h'):
            pag.click(f'[data-acao="edFerramenta"][data-tipo="{tipo}"]')
            pag.wait_for_timeout(200)
            pag.locator(alvo).scroll_into_view_if_needed()
            b = pag.locator(alvo).bounding_box()
            pag.mouse.move(b['x'] + b['width'] * fx1, b['y'] + b['height'] * fy1)
            pag.mouse.down()
            pag.mouse.move(b['x'] + b['width'] * fx2, b['y'] + b['height'] * fy2, steps=5)
            pag.mouse.up()
            pag.wait_for_timeout(700)
        pag.evaluate('App.Cortes.ed().player.ir(3, false)')
        pag.wait_for_timeout(700)
        desenhar('seta', 0.2, 0.2, 0.5, 0.5)
        an = corte_api()['anotacoes']
        checar(len(an) == 1 and an[0]['tipo'] == 'seta' and abs(an[0]['ini'] - 1000) < 150 and an[0]['fim'] - an[0]['ini'] == 3000, f'seta criada no tempo atual, por 3 s {an}')
        checar(bool(an) and an[0]['x2'] > an[0]['x1'] + 0.2, 'a seta segue o arrasto')
        pag.select_option('.anot.escolhida [data-an="entrada"]', 'corte')
        pag.locator('.anot.escolhida [data-an="espessura"]').fill('14')
        pag.wait_for_timeout(700)
        a0 = corte_api()['anotacoes'][0]
        checar(a0['entrada'] == 'corte' and a0['espessura'] == 14, 'corte seco e espessura')
        desenhar('destaque', 0.55, 0.55, 0.8, 0.8)
        desenhar('texto', 0.5, 0.15, 0.5, 0.15)
        pag.keyboard.type('Clique em Iniciar')
        pag.keyboard.press('Tab')
        pag.wait_for_timeout(700)
        an = corte_api()['anotacoes']
        tipos = sorted(x['tipo'] for x in an)
        checar(tipos == ['destaque', 'seta', 'texto'], f'três anotações {tipos}')
        checar(any(x['tipo'] == 'texto' and x['texto'] == 'Clique em Iniciar' for x in an), 'texto escrito')
        pag.evaluate('App.Cortes.ed().player.ir(4.5, false)')
        pag.wait_for_timeout(600)
        pag.locator('.anot.escolhida [data-acao="edAqui"][data-campo-t="fim"]').click()
        pag.wait_for_timeout(700)
        t = [x for x in corte_api()['anotacoes'] if x['tipo'] == 'texto'][0]
        checar(abs(t['fim'] - 2500) < 150, f'"Aqui" muda o fim ({t["fim"]})')
        # mover a seta pelo corpo
        pag.locator('.anot', has_text='Seta').locator('[data-acao="edEscolher"]').click()
        pag.wait_for_timeout(500)
        s0 = [x for x in corte_api()['anotacoes'] if x['tipo'] == 'seta'][0]
        pag.locator('#edicao-h').scroll_into_view_if_needed()
        pos = pag.evaluate('''(a) => { const c = document.getElementById("edicao-h"), r = c.getBoundingClientRect(), q = App.Edicao._st.geoH.qf, e = r.width / c.width;
            const fx = (a.x1 + a.x2) / 2, fy = (a.y1 + a.y2) / 2; return { x: r.x + (q.x + fx * q.w) * e, y: r.y + (q.y + fy * q.h) * e }; }''', s0)
        pag.mouse.move(pos['x'], pos['y'])
        pag.mouse.down()
        pag.mouse.move(pos['x'] + 50, pos['y'], steps=5)
        pag.mouse.up()
        pag.wait_for_timeout(700)
        s1 = [x for x in corte_api()['anotacoes'] if x['tipo'] == 'seta'][0]
        checar(s1['x1'] > s0['x1'] + 0.02 and abs((s1['x2'] - s1['x1']) - (s0['x2'] - s0['x1'])) < 0.001, 'arrastar move a seta inteira')
        foto('1-editando')

        print('3. resultado na prévia')
        pag.click('#botao-editar-h')
        pag.wait_for_timeout(600)
        checar(not pag.is_visible('#edicao-h'), 'volta para o resultado')
        pag.evaluate('App.Cortes.ed().player.ir(3.5, false)')
        pag.wait_for_timeout(900)
        px = pag.evaluate('''() => { const c = document.getElementById("resultado-h"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
            let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n / (d.length / 4); }''')
        checar(px > 0.9, f'prévia desenha o vídeo com zoom e as anotações ({px:.2f} do quadro)')
        foto('2-resultado')

        print('4. exportar com zoom e anotações')
        for el in pag.locator('[data-preset]').all():
            el.uncheck()
        pag.check('[data-preset][value="whatsapp"]')
        pag.click('[data-acao="exportarCorte"]')
        fila = esperar_fila(1)
        x = fila[-1]
        checar(x['estado'] == 'pronto', f'exportou {x["erro"]}')
        if x['estado'] == 'pronto':
            checar(abs(duracao(x['saida']) - 6) < 0.2, 'duração do corte')

        print('5. vertical: as mesmas anotações, e desenhar no quadro da gravação')
        pag.click('text=Editar vertical')
        pag.wait_for_selector('#edicao-v')
        pag.wait_for_timeout(1200)
        checar(pag.locator('#lista-anot .anot').count() == 3, 'as anotações aparecem no vertical')
        checar(pag.locator('#trilha-camera-h').count() == 0, 'a câmera do horizontal não aparece no vertical')
        pag.evaluate('App.Cortes.ed().player.ir(3, false)')
        pag.wait_for_timeout(600)
        desenhar('retangulo', 0.3, 0.3, 0.45, 0.6, '#edicao-v')
        an = corte_api()['anotacoes']
        checar(len(an) == 4 and any(x['tipo'] == 'retangulo' for x in an), 'retângulo desenhado no vertical')
        conta = '''() => { const c = document.getElementById("previa-vertical"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
            let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 240) < 12 && Math.abs(d[i+1] - 180) < 14 && Math.abs(d[i+2] - 76) < 16) n++; return n; }'''
        pag.evaluate('App.Cortes.ed().player.ir(7.5, false)')
        pag.wait_for_timeout(700)
        sem = pag.evaluate(conta)
        pag.evaluate('App.Cortes.ed().player.ir(3, false)')
        pag.wait_for_timeout(700)
        pv = pag.evaluate(conta)
        checar(pv > sem + 30, f'anotação aparece na prévia do vertical no tempo dela ({sem} → {pv} px da cor)')
        pag.click('#lista-anot .anot:has-text("Retângulo") [data-acao="edApagar"]')
        pag.wait_for_timeout(700)
        checar(len(corte_api()['anotacoes']) == 3, 'apagar anotação')
        foto('3-vertical')

        checar(not erros, f'sem erros no console {erros}')
        nav.close()
finally:
    node.stdin.close()
    node.wait(timeout=20)

print('\nRESULTADO:', 'tudo certo' if not falhas else f'{len(falhas)} falha(s)')
sys.exit(1 if falhas else 0)
