"""Teste de ponta a ponta das telas de cortes, com exportações de verdade pelo FFmpeg.
Uso: python3 test/navegador/testar_cortes.py [pasta_para_prints]"""
import json, subprocess, sys, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[2]
PRINTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None
falhas = []

def checar(cond, msg):
    print(('  ok   ' if cond else '  FALHA ') + msg)
    if not cond:
        falhas.append(msg)

def info(arquivo):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', arquivo], capture_output=True, text=True)
    import re
    d = re.search(r'Duration: (\d+):(\d+):([\d.]+)', r.stderr)
    t = re.search(r'Video:[^\n]*?, (\d{3,5})x(\d{3,5})', r.stderr)
    return {'dur': int(d[1]) * 3600 + int(d[2]) * 60 + float(d[3]) if d else 0,
            'w': int(t[1]) if t else 0, 'h': int(t[2]) if t else 0,
            'audios': len(re.findall(r'Stream #\d+:\d+[^\n]*Audio:', r.stderr))}

node = subprocess.Popen(['node', str(RAIZ / 'test/navegador/harness.js')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
porta = int(node.stdout.readline().split()[1])
B = f'http://127.0.0.1:{porta}'
pegar = lambda c: json.loads(urllib.request.urlopen(B + c).read())

def quadro_cinza(arquivo, t):
    r = subprocess.run(['ffmpeg', '-loglevel', 'error', '-ss', str(t), '-i', arquivo, '-frames:v', '1', '-vf', 'scale=320:180,format=gray',
                        '-f', 'rawvideo', '-'], capture_output=True)
    return r.stdout

def esperar_fila(n, limite=120):
    fim = time.time() + limite
    while time.time() < fim:
        f = pegar('/teste/fila')
        if len(f) >= n and all(x['estado'] in ('pronto', 'erro', 'cancelado') for x in f):
            return f
        time.sleep(0.5)
    return pegar('/teste/fila')

try:
    with sync_playwright() as p:
        nav = p.chromium.launch()
        pag = nav.new_page(viewport={'width': 1360, 'height': 900})
        erros = []
        pag.on('pageerror', lambda e: erros.append(str(e)))
        pag.on('console', lambda m: m.type == 'error' and erros.append(m.text))
        respostas = iter(['Mapa inteiro'])
        pag.on('dialog', lambda d: d.accept(next(respostas, '')) if d.type == 'prompt' else d.accept())
        foto = lambda n: PRINTS and pag.screenshot(path=str(PRINTS / f'cortes-{n}.png'), full_page=True)
        api = lambda nome, *args: pag.evaluate('([n, a]) => window.api[n](...a)', [nome, list(args)])

        print('1. preparar mesa e sessão')
        pag.goto(B + '/#mesa')
        pag.wait_for_selector('[data-acao="addJogador"]')
        for nome, cor in [('Kael', '#7A5BC2'), ('Iris', '#3F7F6B')]:
            pag.click('[data-acao="addJogador"]')
            c = pag.locator('[data-jogador]').last
            c.locator('[data-campo$=".personagem"]').fill(nome)
            c.locator('[data-campo$=".cor"]').evaluate('(e, v) => { e.value = v; e.dispatchEvent(new Event("input", {bubbles: true})); }', cor)
            c.locator('[data-acao="imagem"]').click()
            pag.wait_for_timeout(500)
        pag.wait_for_timeout(800)
        sid = pegar('/teste/criar-sessao')['id']

        print('2. Momentos: sessão, marcadores e criar corte')
        pag.goto(B + '/#momentos')
        pag.wait_for_selector('[data-acao="corteDoMarcador"]', timeout=20000)
        checar(pag.locator('.sessao-cartao').count() == 1, 'uma sessão listada')
        checar('Combate: Emboscada' in pag.inner_text('.corpo-sessao') and 'Foundry' in pag.inner_text('.corpo-sessao'), 'marcador do Foundry aparece')
        foto('1-momentos')
        pag.locator('[data-acao="corteDoMarcador"]').first.click()
        pag.wait_for_selector('#linha-tempo .lt-regua', timeout=20000)
        checar('#corte/' in pag.url, 'abriu o editor de corte')
        checar(pag.locator('.lt-trilha').count() == 2, 'trilhas de fala dos dois jogadores')

        print('3. ajustar início, fim, nome e áudio')
        pag.fill('#campo-ini', '0:05')
        pag.press('#campo-ini', 'Tab')
        pag.fill('#campo-fim', '0:13')
        pag.press('#campo-fim', 'Tab')
        pag.fill('#nome-corte', 'Crítico e emboscada')
        checar(pag.inner_text('#duracao-corte') == '0:08.0', f'duração mostrada {pag.inner_text("#duracao-corte")}')
        pag.check('input[name="modo-audio"][value="mix"]')
        pag.locator('[data-volume="3"]').fill('0')
        pag.fill('#campo-fim', 'abc')
        pag.press('#campo-fim', 'Tab')
        checar('formato' in pag.locator('.aviso').last.inner_text(), 'tempo inválido avisa')
        pag.wait_for_timeout(900)
        s = api('sessao', sid)
        k = s['cortes'][0]
        checar(k['ini'] == 5000 and k['fim'] == 13000, f'início e fim salvos {k["ini"]} {k["fim"]}')
        checar(k['nome'] == 'Crítico e emboscada' and k['audio']['modo'] == 'mix' and k['audio']['volumes']['3'] == 0, 'nome e áudio salvos')
        cid = k['id']

        print('4. player e atalhos de teclado')
        pag.locator('.lt-regua').click(position={'x': 10, 'y': 20})
        pag.wait_for_timeout(600)
        pag.locator('body').press('ArrowRight')
        pag.locator('body').press('Shift+ArrowRight')
        pag.wait_for_timeout(500)
        t = pag.evaluate('document.querySelector("video").currentTime')
        checar(t > 0.5, f'setas andam no vídeo ({t:.2f} s)')
        pag.click('[data-acao="ouvirCorte"]')
        pag.wait_for_timeout(1200)
        tocando = pag.evaluate('!document.querySelector("video").paused')
        checar(tocando, 'Ver o corte toca o vídeo')
        pag.click('[data-acao="tocar"]')
        foto('2-editor-corte')

        print('5. exportar YouTube 1080p e WhatsApp')
        for k2 in ['youtube-1080', 'whatsapp']:
            pag.check(f'[data-preset][value="{k2}"]')
        pag.click('[data-acao="exportarCorte"]')
        fila = esperar_fila(2)
        checar([x['estado'] for x in fila] == ['pronto', 'pronto'], f'duas exportações prontas {[x["erro"] for x in fila]}')
        for x in fila:
            i = info(x['saida'])
            checar(abs(i['dur'] - 8) < 0.3, f'{Path(x["saida"]).name}: {i["w"]}x{i["h"]}, {i["dur"]:.2f} s')
        checar(pegar('/teste/config')['cortes']['presets'] == ['youtube-1080', 'whatsapp'], 'formatos escolhidos ficam lembrados')
        pag.wait_for_selector('#vivo-fila [data-acao="mostrarArquivo"]')
        pag.locator('#vivo-fila [data-acao="mostrarArquivo"]').first.click()
        pag.wait_for_timeout(300)
        checar(pegar('/teste/registro').get('mostrado', '').endswith('.mp4'), 'mostrar na pasta')

        print('5b. legendas: gerar, corrigir, mover com o mouse, exportar')
        pag.wait_for_selector('#painel-legendas [data-acao="legGerar"]')
        pag.click('#painel-legendas [data-acao="legGerar"]')
        pag.wait_for_selector('.leg-seg', timeout=30000)
        pag.wait_for_timeout(500)
        checar(pag.locator('.leg-seg').count() == 2, f'transcrição virou {pag.locator(".leg-seg").count()} trechos (ruído [Música] fora)')
        checar(pag.is_checked('#leg-ativo'), 'legendas ligadas no corte')
        jog = {j['personagem']: j['id'] for j in pegar('/teste/config')['mesas'][0]['jogadores']}
        k = api('sessao', sid)['cortes'][0]['legendas']
        checar(k['ativo'] and len(k['segmentos']) == 2 and k['segmentos'][1]['chave'] == jog['Iris'], f'quem fala vem do StreamKit {[x["chave"] for x in k["segmentos"]]}')
        checar(abs(k['segmentos'][0]['ini'] - 6000) < 100, f'tempo do trecho em tempo da sessão ({k["segmentos"][0]["ini"]})')
        pag.locator('.leg-seg textarea').first.fill('Rolei VINTE natural!')
        pag.locator('.leg-seg [data-leg-quem]').first.select_option(label='Kael')
        pag.click('.leg-detalhes:has(#leg-de) summary')
        pag.fill('#leg-de', 'dragão')
        pag.fill('#leg-para', 'Dragão Vermelho')
        pag.click('[data-acao="legTrocar"]')
        pag.wait_for_timeout(900)
        k = api('sessao', sid)['cortes'][0]['legendas']['segmentos']
        checar(k[0]['texto'] == 'Rolei VINTE natural!' and k[0]['chave'] == jog['Kael'], f'texto e quem fala corrigidos {k[0]}')
        checar(k[1]['texto'] == 'O Dragão Vermelho caiu.', f'trocar palavra em tudo ({k[1]["texto"]})')
        pag.click('[data-acao="legAdicionar"]')
        pag.wait_for_timeout(300)
        checar(pag.locator('.leg-seg').count() == 3, 'legenda à mão')
        pag.keyboard.type('Escrita à mão')
        pag.wait_for_timeout(800)
        k = api('sessao', sid)['cortes'][0]['legendas']['segmentos']
        checar(any(x['texto'] == 'Escrita à mão' for x in k), 'legenda à mão salva')
        alvo = [x for x in pag.locator('.leg-seg').all() if x.locator('textarea').input_value() == 'Escrita à mão'][0]
        alvo.locator('[data-acao="legApagar"]').click()
        pag.wait_for_timeout(800)
        checar(len(api('sessao', sid)['cortes'][0]['legendas']['segmentos']) == 2, 'apagar trecho')
        # mover e esticar na prévia
        pag.evaluate('document.querySelector("video").pause(); window.scrollTo(0, 0); document.querySelector("main") && (document.querySelector("main").scrollTop = 0)')
        pag.locator('#leg-h').scroll_into_view_if_needed()
        pag.wait_for_timeout(200)
        caixa = pag.evaluate('''() => { const c = document.getElementById("leg-h"), r = c.getBoundingClientRect(), b = App.EditorLegendas._st.caixa;
            const e = r.width / c.width; return b && { x: r.x + b.cx * e, y: r.y + b.cy * e, dx: r.x + (b.x + b.largura) * e, dy: r.y + (b.y + b.altura) * e }; }''')
        checar(bool(caixa), 'caixa da legenda na prévia')
        leg0 = pegar('/teste/config')['mesas'][0]['legendas']
        pag.mouse.move(caixa['x'], caixa['y'])
        pag.mouse.down()
        pag.mouse.move(caixa['x'] + 40, caixa['y'] - 80, steps=6)
        pag.mouse.up()
        pag.wait_for_timeout(700)
        leg1 = pegar('/teste/config')['mesas'][0]['legendas']
        checar(leg1['h']['y'] < leg0['h']['y'] - 0.05 and leg1['h']['x'] > 0.5, f'arrastar move a legenda ({leg1["h"]})')
        pag.click('#leg-aparencia summary')
        pag.click('[data-acao="legCentralizar"]')
        pag.wait_for_timeout(600)
        pag.locator('#leg-h').scroll_into_view_if_needed()
        pag.wait_for_timeout(200)
        checar(pegar('/teste/config')['mesas'][0]['legendas']['h']['x'] == 0.5, 'centralizar a legenda')
        caixa = pag.evaluate('''() => { const c = document.getElementById("leg-h"), r = c.getBoundingClientRect(), b = App.EditorLegendas._st.caixa;
            const e = r.width / c.width; return { dx: r.x + (b.x + b.largura) * e, dy: r.y + (b.y + b.altura) * e }; }''')
        pag.mouse.move(caixa['dx'], caixa['dy'])
        pag.mouse.down()
        pag.mouse.move(caixa['dx'] + 30, caixa['dy'] + 40, steps=6)
        pag.mouse.up()
        pag.wait_for_timeout(700)
        tam = pegar('/teste/config')['mesas'][0]['legendas']['estilo']['tamanho']
        checar(tam > leg0['estilo']['tamanho'], f'puxar o canto aumenta a letra ({leg0["estilo"]["tamanho"]} → {tam})')
        pag.locator('[data-campo="m.legendas.estilo.fonte"]').select_option('Impact')
        pag.check('[data-campo="m.legendas.estilo.fundo"]')
        pag.wait_for_timeout(600)
        est = pegar('/teste/config')['mesas'][0]['legendas']['estilo']
        checar(est['fonte'] == 'Impact' and est['fundo'] is True, 'fonte e caixa atrás do texto')
        checar(pag.is_visible('#leg-com-fundo') and not pag.is_visible('#leg-com-contorno'), 'opções da caixa aparecem no lugar do contorno')
        pag.uncheck('[data-campo="m.legendas.estilo.fundo"]')
        pag.wait_for_timeout(400)
        pixels = pag.evaluate('''() => { const c = document.getElementById("leg-h"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
            let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; }''')
        checar(pixels > 500, f'prévia desenha a legenda por cima do vídeo ({pixels} px)')
        foto('2b-legendas')
        for k2 in ['youtube-1080', 'whatsapp']:
            pag.uncheck(f'[data-preset][value="{k2}"]')
        pag.check('[data-preset][value="whatsapp"]')
        pag.click('[data-acao="exportarCorte"]')
        fila = esperar_fila(3)
        checar(fila[-1]['estado'] == 'pronto', f'exportou com legenda {fila[-1]["erro"]}')
        sem, com = quadro_cinza(fila[1]['saida'], 2.0), quadro_cinza(fila[-1]['saida'], 2.0)
        if len(sem) == len(com) == 320 * 180:
            dif = lambda a, b: sum(abs(sem[i] - com[i]) for i in range(a * 320, b * 320))
            topo, legenda = dif(0, 60), dif(60, 180)
            checar(legenda > 20 * topo + 20000, f'a legenda foi queimada no vídeo (diferença {legenda} embaixo, {topo} em cima)')
        else:
            checar(False, 'quadros dos vídeos exportados')
        checar(pegar('/teste/config')['cortes']['presets'] == ['whatsapp'], 'formato lembrado')
        pag.uncheck('[data-preset][value="whatsapp"]')
        for k2 in ['youtube-1080', 'whatsapp']:
            pag.check(f'[data-preset][value="{k2}"]')
        pag.wait_for_timeout(500)

        print('6. editor vertical: câmera, pontos, zoom, câmera salva')
        pag.click('text=Editar vertical')
        pag.wait_for_selector('#caixa-camera')
        pag.wait_for_timeout(1500)
        caixa = pag.locator('#caixa-camera').bounding_box()
        quadro = pag.locator('#quadro-fonte').bounding_box()
        pag.mouse.move(caixa['x'] + caixa['width'] / 2, caixa['y'] + caixa['height'] / 2)
        pag.mouse.down()
        pag.mouse.move(caixa['x'] + caixa['width'] / 2 - quadro['width'] * 0.2, caixa['y'] + caixa['height'] / 2, steps=5)
        pag.mouse.up()
        pag.wait_for_timeout(700)
        cam = api('sessao', sid)['cortes'][0]['vertical']['camera']
        checar(len(cam) == 1 and cam[0]['x'] < 0.2, f'arrastar atualiza o ponto do início (x={cam[0]["x"]:.2f})')
        trilha = pag.locator('#trilha-pontos').bounding_box()
        pag.mouse.click(trilha['x'] + trilha['width'] * 0.5, trilha['y'] + 10)
        pag.wait_for_timeout(600)
        pag.locator('body').press('k')
        pag.wait_for_timeout(300)
        pag.mouse.move(quadro['x'] + quadro['width'] * 0.15, quadro['y'] + quadro['height'] * 0.5)
        for _ in range(6):
            pag.mouse.wheel(0, -100)
        pag.wait_for_timeout(900)
        cam = api('sessao', sid)['cortes'][0]['vertical']['camera']
        checar(len(cam) == 2, f'novo ponto no meio ({len(cam)} pontos)')
        checar(cam[1]['w'] < cam[0]['w'] * 0.8, f'rodinha deu zoom ({cam[1]["w"]:.3f} < {cam[0]["w"]:.3f})')
        pag.select_option('[data-trans]', 'rapido') if pag.locator('[data-trans]').count() else None
        pag.mouse.click(trilha['x'] + 3, trilha['y'] + 10)
        pag.wait_for_timeout(500)
        if pag.locator('[data-trans]').count():
            pag.select_option('[data-trans]', 'rapido')
        pag.wait_for_timeout(800)
        cam = api('sessao', sid)['cortes'][0]['vertical']['camera']
        checar(cam[0]['trans'] == 'rapido', 'transição do primeiro ponto: rápida')
        pag.click('[data-acao="salvarCamera"]')
        pag.wait_for_timeout(800)
        mesa = [m for m in pegar('/teste/config')['mesas']][0]
        checar(len(mesa['cameras']) == 1 and mesa['cameras'][0]['nome'] == 'Mapa inteiro', 'câmera salva na mesa')
        brilho = pag.evaluate('''() => { const c = document.getElementById("previa-vertical").getContext("2d");
            const d = c.getImageData(0, 0, c.canvas.width, c.canvas.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i+1] + d[i+2]; return s; }''')
        checar(brilho > 0, 'prévia desenha o vídeo')
        checar(pag.evaluate('document.getElementById("video").muted') is False, 'editor vertical com som')
        pag.click('[data-acao="somVertical"]')
        checar(pag.evaluate('document.getElementById("video").muted') is True, 'botão tira o som da prévia')
        pag.click('[data-acao="somVertical"]')
        # retratos: ponto da tela, fila em pé, e editar com o mouse na prévia
        pag.click('.ancora:has(input[name="v-ancora"][value="topo-dir"])')
        pag.click('.segmento:has(input[name="v-direcao"][value="vertical"])')
        pag.wait_for_timeout(700)
        v = [m for m in pegar('/teste/config')['mesas']][0]['vertical']
        checar(v['ancora'] == 'topo-dir' and v['direcao'] == 'vertical', f'ponto e fila do vertical {v["ancora"]} {v["direcao"]}')
        checar('De baixo para cima' in pag.inner_text('#ordem-vertical'), 'ordem acompanha a fila em pé')
        g = pag.evaluate('''() => { const c = document.getElementById("previa-vertical"); const r = c.getBoundingClientRect();
            return { esc: r.width / c.width, x: r.x, y: r.y }; }''')
        grupo = pag.evaluate('window.App && null')
        caixa = pag.locator('#previa-vertical').bounding_box()
        # o grupo fica no canto de cima à direita: arrasta do meio dele para a esquerda e para baixo
        alvo_x = caixa['x'] + caixa['width'] - 40 * g['esc'] - 10
        alvo_y = caixa['y'] + 120 * g['esc']
        d0 = (v['deslocX'], v['deslocY'])
        pag.mouse.move(alvo_x, alvo_y)
        pag.mouse.down()
        pag.mouse.move(alvo_x - 30, alvo_y + 40, steps=5)
        pag.mouse.up()
        pag.wait_for_timeout(700)
        v = [m for m in pegar('/teste/config')['mesas']][0]['vertical']
        checar(v['deslocX'] < d0[0] and v['deslocY'] > d0[1], f'arrastar move os retratos ({v["deslocX"]}, {v["deslocY"]})')
        pag.click('[data-acao="centralizarVertical"]')
        pag.wait_for_timeout(500)
        checar([m for m in pegar('/teste/config')['mesas']][0]['vertical']['deslocX'] == 0, 'voltar ao ponto')
        pag.click('.ancora:has(input[name="v-ancora"][value="baixo"])')
        pag.click('.segmento:has(input[name="v-direcao"][value="horizontal"])')
        pag.click('.segmento:has(input[name="v-mostrar"][value="falando"])')
        pag.wait_for_timeout(700)
        checar(pag.locator('#painel-legendas .leg-seg').count() == 2, 'legendas também no editor vertical')
        foto('3-vertical')

        print('7. exportar vertical com retratos')
        pag.click('[data-acao="exportarVertical"][data-preset="vertical"]')
        fila = esperar_fila(4)
        v = fila[-1]
        checar(v['estado'] == 'pronto', f'vertical pronto {v["erro"]}')
        i = info(v['saida'])
        checar(i['w'] == 1080 and i['h'] == 1920 and abs(i['dur'] - 8) < 0.3, f'vertical {i["w"]}x{i["h"]} {i["dur"]:.2f} s')

        print('8. compilado de dois cortes')
        pag.goto(B + '/#momentos')
        pag.wait_for_selector('[data-acao="corteInteiro"]', timeout=20000)
        pag.click('[data-acao="corteInteiro"]')
        pag.wait_for_selector('#linha-tempo .lt-regua', timeout=20000)
        pag.fill('#campo-fim', '0:04')
        pag.press('#campo-fim', 'Tab')
        pag.wait_for_timeout(900)
        pag.goto(B + '/#momentos')
        pag.wait_for_selector('[data-compilado]', timeout=20000)
        for cb in pag.locator('[data-compilado]').all():
            cb.check()
        checar(pag.locator('.lista-compilado li').count() == 2, 'dois cortes no compilado')
        pag.locator('[data-acao="moverCompilado"][data-dir="1"]').first.click()
        pag.select_option('#preset-compilado', 'whatsapp-vertical')
        pag.click('[data-acao="montarCompilado"]')
        fila = esperar_fila(5, 180)
        comp = fila[-1]
        checar(comp['estado'] == 'pronto', f'compilado pronto {comp["erro"]}')
        i = info(comp['saida'])
        checar(i['w'] == 720 and abs(i['dur'] - 12) < 0.5, f'compilado {i["w"]}x{i["h"]} {i["dur"]:.2f} s')
        foto('4-compilado')

        print('9. excluir corte')
        antes = pag.locator('[data-acao="excluirCorte"]').count()
        pag.locator('[data-acao="excluirCorte"]').last.click()
        pag.wait_for_timeout(800)
        checar(pag.locator('[data-acao="excluirCorte"]').count() == antes - 1, 'corte excluído')

        print('10. tela estreita')
        pag.set_viewport_size({'width': 900, 'height': 760})
        for rota in ['momentos', f'corte/{sid}/{cid}', f'vertical/{sid}/{cid}']:
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
