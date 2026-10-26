"""Identidade visual (camadas, imagem final, fundo do vertical) e música rápida nos cortes,
com exportações de verdade pelo FFmpeg.
Uso: python3 test/navegador/testar_identidade.py [pasta_para_prints]"""
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

tmp = Path(tempfile.mkdtemp(prefix='grpg-id-'))
musica = tmp / 'Tema da taverna.wav'
subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=523:sample_rate=48000', '-t', '6', str(musica)], check=True)

try:
    with sync_playwright() as p:
        nav = p.chromium.launch()
        pag = nav.new_page(viewport={'width': 1360, 'height': 900})
        erros = []
        pag.on('pageerror', lambda e: erros.append(str(e)))
        pag.on('console', lambda m: m.type == 'error' and erros.append(m.text))
        pag.on('dialog', lambda d: d.accept())
        foto = lambda n: PRINTS and pag.screenshot(path=str(PRINTS / f'identidade-{n}.png'), full_page=True)

        print('1. tela Identidade visual: camadas de texto e imagem')
        pag.goto(B + '/#identidade')
        pag.wait_for_selector('[data-acao="idNovoTexto"]')
        checar(pag.locator('.menu a[data-tela="identidade"][aria-current="page"]').count() == 1, 'item no menu')
        pag.click('[data-acao="idNovoTexto"]')
        pag.wait_for_selector('#id-editor [data-idc="texto"]')
        pag.fill('#id-editor [data-idc="texto"]', 'discord.gg/minha-mesa')
        pag.locator('.id-camada').first.locator('[data-idc="aoVivo"]').check()
        pag.wait_for_timeout(700)
        cs = mesa()['identidade']['camadas']
        checar(len(cs) == 1 and cs[0]['tipo'] == 'texto' and cs[0]['texto'] == 'discord.gg/minha-mesa' and cs[0]['aoVivo'], f'camada de texto salva {cs}')
        pag.click('[data-acao="idNovaImagem"]')
        pag.wait_for_timeout(900)
        cs = mesa()['identidade']['camadas']
        checar(len(cs) == 2 and cs[1]['tipo'] == 'imagem' and cs[1]['imagem'], 'camada de imagem com o arquivo escolhido')
        pag.wait_for_timeout(500)
        # arrastar a imagem (escolhida) na prévia e esticar pela bolinha
        cv = pag.locator('#previa-identidade').bounding_box()
        ph = cs[1]['h']
        cx, cy = cv['x'] + ph['x'] * cv['width'], cv['y'] + ph['y'] * cv['height']
        pag.mouse.move(cx, cy)
        pag.mouse.down()
        pag.mouse.move(cx - 200, cy + 120, steps=6)
        pag.mouse.up()
        pag.wait_for_timeout(700)
        p2 = mesa()['identidade']['camadas'][1]['h']
        checar(p2['x'] < ph['x'] - 0.2 and p2['y'] > ph['y'] + 0.2, f'arrastar move a camada ({ph} → {p2})')
        w0 = p2['w']
        # usa a própria função de retângulo da interface
        canto = pag.evaluate('''async () => { const c = document.getElementById("previa-identidade"), r = c.getBoundingClientRect();
            const i = window.App.mesa().identidade.camadas[1]; const img = await window.App.IdentidadeUI.carregar(i.imagem);
            const q = window.Identidade.retangulo(c.getContext("2d"), i, c.width, c.height, "h", img); const e = r.width / c.width;
            return { x: r.x + (q.x + q.largura) * e, y: r.y + (q.y + q.altura) * e }; }''')
        pag.mouse.move(canto['x'], canto['y'])
        pag.mouse.down()
        pag.mouse.move(canto['x'] + 40, canto['y'] + 40, steps=5)
        pag.mouse.up()
        pag.wait_for_timeout(700)
        w1 = mesa()['identidade']['camadas'][1]['h']['w']
        checar(w1 > w0 * 1.2, f'puxar a bolinha aumenta a camada ({w0:.3f} → {w1:.3f})')
        pag.locator('#id-editor [data-idc="opacidade"]').fill('70')
        pag.wait_for_timeout(500)
        checar(mesa()['identidade']['camadas'][1]['opacidade'] == 70, 'opacidade')
        brilho = pag.evaluate('''() => { const c = document.getElementById("previa-identidade"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
            let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i+1] > 200 && d[i+2] > 200) n++; return n; }''')
        checar(brilho > 200, f'prévia desenha o texto branco ({brilho} px)')
        foto('1-camadas')

        print('2. imagem final padrão (horizontal)')
        pag.click('[data-acao="idFinalImagem"][data-qual="h"]')
        pag.wait_for_timeout(900)
        pag.locator('[data-campo="m.final.h.duracao"]').fill('2')
        pag.locator('[data-campo="m.final.h.fade"]').fill('0.5')
        pag.locator('[data-campo="m.final.h.cor"]').evaluate('(e) => { e.value = "#00ff00"; e.dispatchEvent(new Event("input", {bubbles: true})); e.dispatchEvent(new Event("change", {bubbles: true})); }')
        pag.locator('[data-campo="m.final.h.ajuste"]').select_option('caber')
        pag.wait_for_timeout(700)
        f = mesa()['final']['h']
        checar(f['ativo'] and f['imagem'] and f['duracao'] == 2 and f['fade'] == 0.5 and f['cor'] == '#00FF00', f'final do horizontal {f}')
        checar(not mesa()['final']['v']['ativo'], 'vertical sem final (separado)')
        pag.check('input[name="id-qual"][value="v"]')
        pag.wait_for_timeout(400)
        checar(pag.locator('#previa-identidade.v').count() == 1, 'prévia vertical')
        foto('2-final')

        print('3. ao vivo no overlay do OBS')
        url = api('estado')['overlayUrl']
        ov = nav.new_page(viewport={'width': 1280, 'height': 720})
        ov.goto(url)
        ov.wait_for_timeout(1500)
        est = json.loads(urllib.request.urlopen(url.replace('/overlay', '/estado')).read())
        checar(len(est.get('camadas', [])) == 1 and est['camadas'][0]['tipo'] == 'texto', 'overlay recebe só a camada "ao vivo"')
        px = ov.evaluate('''() => { const c = document.getElementById("camadas"); if (!c || !c.width) return 0; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
            let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; }''')
        checar(px > 500, f'overlay desenha a camada ({px} px)')
        ov.close()

        print('4. corte: painel visual e música rápida')
        sid = pegar('/teste/criar-sessao')['id']
        corte = api('salvarCorte', sid, {'nome': 'Identidade', 'ini': 3000, 'fim': 7000})
        cid = corte['id']
        pag.goto(B + f'/#corte/{sid}/{cid}')
        pag.wait_for_selector('#painel-visual [data-corte-camada]', timeout=20000)
        checar(pag.locator('[data-corte-camada]').count() == 2, 'as duas camadas "nos cortes" aparecem no corte')
        checar('Ao vivo' in pag.inner_text('#painel-visual'), 'avisa que a camada ao vivo já está na gravação horizontal')
        checar(pag.is_checked('#corte-final'), 'imagem final ligada por padrão')
        post('/teste/configurar', {'audios': [str(musica)]})
        pag.click('[data-acao="musicaCorteAdicionar"]')
        pag.wait_for_selector('#musica-curva', timeout=10000)
        k = api('sessao', sid)['cortes'][0]
        pag.wait_for_timeout(700)
        k = api('sessao', sid)['cortes'][0]
        checar(bool(k['musica']['faixa']), f'música escolhida no corte ({k["musica"]["faixa"]})')
        pag.locator('[data-mus="volume"]').fill('100')
        pag.locator('[data-mus="fadeOut"]').fill('0')
        curva = pag.locator('#musica-curva').bounding_box()
        pag.mouse.click(curva['x'] + curva['width'] * 0.3, curva['y'] + curva['height'] * 0.5)
        pag.wait_for_timeout(800)
        k = api('sessao', sid)['cortes'][0]
        checar(len(k['musica']['pontos']) == 1 and 60 < k['musica']['pontos'][0]['v'] < 140, f'clique cria um ponto de volume {k["musica"]["pontos"]}')
        pag.mouse.dblclick(curva['x'] + curva['width'] * 0.3, curva['y'] + curva['height'] * 0.5)
        pag.wait_for_timeout(800)
        checar(len(api('sessao', sid)['cortes'][0]['musica']['pontos']) <= 1, 'clique duplo apaga o ponto')
        # a camada da imagem aparece na prévia do horizontal e dá para arrastar lá também
        pag.locator('#leg-h').scroll_into_view_if_needed()
        alvo = pag.evaluate('''async () => { const c = document.getElementById("leg-h"), r = c.getBoundingClientRect();
            const i = window.App.mesa().identidade.camadas[1]; const img = await window.App.IdentidadeUI.carregar(i.imagem);
            const q = window.Identidade.retangulo(c.getContext("2d"), i, c.width, c.height, "h", img); const e = r.width / c.width;
            return { x: r.x + (q.x + q.largura / 2) * e, y: r.y + (q.y + q.altura / 2) * e }; }''')
        x0 = mesa()['identidade']['camadas'][1]['h']['x']
        pag.mouse.move(alvo['x'], alvo['y'])
        pag.mouse.down()
        pag.mouse.move(alvo['x'] + 60, alvo['y'], steps=5)
        pag.mouse.up()
        pag.wait_for_timeout(700)
        checar(mesa()['identidade']['camadas'][1]['h']['x'] > x0 + 0.03, 'arrastar a camada no editor de corte')
        # final aparece na prévia no fim do corte
        pag.evaluate('document.querySelector("video").pause()')
        pag.fill('#campo-ini', '0:03')
        pag.locator('body').click(position={'x': 5, 'y': 5})
        foto('3-corte')

        print('5. exportar YouTube com camada, final e música')
        for el in pag.locator('[data-preset]').all():
            el.uncheck()
        pag.check('[data-preset][value="youtube-1080"]')
        pag.click('[data-acao="exportarCorte"]')
        fila = esperar_fila(1)
        x = fila[-1]
        checar(x['estado'] == 'pronto', f'exportou {x["erro"]}')
        if x['estado'] == 'pronto':
            d = duracao(x['saida'])
            checar(abs(d - 5.5) < 0.2, f'4 s de corte + 1,5 s de final = {d:.2f} s')
            meio = pixel(x['saida'], 5.3, 4, 4)
            checar(meio[1] > 180 and meio[0] < 90 and meio[2] < 90, f'fundo verde da imagem final no canto {meio}')
            checar(volume(x['saida'], 4.6, 0.8) > -40, 'a música continua tocando durante a imagem final')

        print('6. tirar camada e final de um corte')
        pag.locator('[data-corte-camada]').first.uncheck()
        pag.uncheck('#corte-final')
        pag.wait_for_timeout(800)
        k = api('sessao', sid)['cortes'][0]
        checar(len(k['identidade']['ocultas']) == 1 and k['final'] is False, f'camada escondida e sem final neste corte {k["identidade"]} {k["final"]}')
        pag.check('#corte-final')
        pag.locator('[data-corte-camada]').first.check()
        pag.wait_for_timeout(800)

        print('7. vertical: tela inteira com fundo de cor, vídeo arrastado')
        pag.click('text=Editar vertical')
        pag.wait_for_selector('#previa-vertical')
        pag.wait_for_timeout(1200)
        pag.check('input[name="modo-vertical"][value="inteira"]')
        pag.wait_for_selector('#fundo-inteira:not([hidden])')
        pag.click('.segmento:has(input[name="fundo-tipo"][value="cor"])')
        pag.wait_for_selector('[data-campo="m.vertical.fundo.cor"]')
        pag.locator('[data-campo="m.vertical.fundo.cor"]').evaluate('(e) => { e.value = "#ff00ff"; e.dispatchEvent(new Event("input", {bubbles: true})); e.dispatchEvent(new Event("change", {bubbles: true})); }')
        pag.locator('[data-fundo="escala"]').fill('60')
        pag.wait_for_timeout(500)
        pag.click('.ancora:has(input[name="v-ancora"][value="topo"])')   # retratos longe do meio
        pag.wait_for_timeout(600)
        cvv = pag.locator('#previa-vertical').bounding_box()
        pag.mouse.move(cvv['x'] + cvv['width'] * 0.5, cvv['y'] + cvv['height'] * 0.5)
        pag.mouse.down()
        pag.mouse.move(cvv['x'] + cvv['width'] * 0.5, cvv['y'] + cvv['height'] * 0.3, steps=5)
        pag.mouse.up()
        pag.wait_for_timeout(700)
        fu = mesa()['vertical']['fundo']
        checar(fu['tipo'] == 'cor' and fu['cor'] == '#FF00FF' and abs(fu['escala'] - 0.6) < 0.01 and fu['y'] < 0.4, f'fundo do vertical {fu}')
        checar(pag.locator('#painel-visual').count() == 1 and pag.locator('#musica-curva').count() == 1, 'painel visual e música também no vertical')
        foto('4-vertical')
        pag.click('[data-acao="exportarVertical"][data-preset="whatsapp-vertical"]')
        fila = esperar_fila(2)
        v = fila[-1]
        checar(v['estado'] == 'pronto', f'vertical exportado {v["erro"]}')
        if v['estado'] == 'pronto':
            d = duracao(v['saida'])
            checar(abs(d - 4) < 0.2, f'vertical sem final (só o horizontal tem) = {d:.2f} s')
            fundo = pixel(v['saida'], 1, 360, 1150)
            checar(fundo[0] > 180 and fundo[2] > 180 and fundo[1] < 90, f'fundo magenta embaixo {fundo}')
            lado = pixel(v['saida'], 1, 20, int(1280 * fu['y']))
            checar(lado[0] > 180 and lado[2] > 180, f'vídeo menor deixa o fundo nos lados {lado}')

        print('8. atualização')
        pag.goto(B + '/#gravacao')
        pag.wait_for_selector('#vivo-atualizacao-tela')
        pag.click('#vivo-atualizacao-tela [data-acao="procurarAtualizacao"]')
        pag.wait_for_selector('#vivo-atualizacao [data-acao="atualizarAgora"]', timeout=5000)
        checar('9.9.9' in pag.inner_text('#vivo-atualizacao'), 'menu mostra o botão de atualizar')
        checar('tudo novo' in pag.inner_text('#vivo-atualizacao-tela'), 'mostra o que mudou')
        pag.click('#vivo-atualizacao [data-acao="atualizarAgora"]')
        pag.wait_for_timeout(500)
        checar(pegar('/teste/registro').get('atualizou') == 1, 'botão chama a atualização (com confirmação)')

        print('9. tela estreita')
        pag.set_viewport_size({'width': 900, 'height': 760})
        for rota in ['identidade', f'corte/{sid}/{cid}']:
            pag.goto(B + '/#' + rota)
            pag.wait_for_timeout(1500)
            larg = pag.evaluate('document.documentElement.scrollWidth')
            checar(larg <= 900, f'{rota.split("/")[0]}: sem rolagem lateral ({larg})')

        checar(not erros, f'sem erros no console {erros}')
        nav.close()
finally:
    node.stdin.close()
    node.wait(timeout=20)

print('\nRESULTADO:', 'tudo certo' if not falhas else f'{len(falhas)} falha(s)')
sys.exit(1 if falhas else 0)
