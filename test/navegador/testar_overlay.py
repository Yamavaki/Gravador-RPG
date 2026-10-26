"""Testa o overlay de verdade num navegador (Chromium headless, o mesmo motor do OBS).
Uso: python3 test/navegador/testar_overlay.py [pasta_para_prints]"""
import json, subprocess, sys, time, os
from pathlib import Path
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[2]
PRINTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None
ID1, ID2, ID3 = '187691838138400768', '298765432109876543', '311111111111111111'

MESA = {
    'nomes': {'modo': 'personagem', 'quando': 'sempre'},
    'overlay': {'layout': 'faixa-baixo', 'tamanho': 120, 'efeito': 'brilho', 'apagarSilenciosos': True, 'ocultarAusentes': True},
    'jogadores': [
        {'id': 'aaaaaa01', 'personagem': 'Kael', 'jogador': 'Ana', 'discordId': ID1, 'imagem': 'retrato-alto.png', 'cor': '#7A5BC2', 'foco': {'x': 50, 'y': 20, 'zoom': 140}},
        {'id': 'aaaaaa02', 'personagem': 'Iris', 'jogador': 'Beto', 'discordId': ID2, 'cor': '#3F7F6B'},
        {'id': 'aaaaaa03', 'personagem': 'Dragão Ancião', 'jogador': 'Gustavo', 'discordId': ID3, 'imagem': 'dragao.png', 'cor': '#B4472F',
         'nomeModo': 'personalizado', 'nomeTexto': 'Narrador'},
        {'id': 'aaaaaa04', 'personagem': 'Fantasma', 'jogador': 'Sem arquivo', 'imagem': 'nao-existe.png', 'cor': '#4A5A7A'},
    ],
}
falhas = []

def checar(cond, msg):
    print(('  ok   ' if cond else '  FALHA ') + msg)
    if not cond:
        falhas.append(msg)

def main():
    node = subprocess.Popen(['node', str(RAIZ / 'test/navegador/servidor-teste.js')], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, text=True, bufsize=1)
    porta = int(node.stdout.readline().split()[1])

    def publicar(mesa, presencas=None, conectado=False):
        node.stdin.write(json.dumps({'mesa': mesa, 'presencas': presencas or [], 'conectado': conectado}) + '\n')
        node.stdin.flush()
        assert node.stdout.readline().strip() == 'OK'

    def mesa(**ov):
        m = json.loads(json.dumps(MESA))
        for k, v in ov.items():
            if k.startswith('nomes_'):
                m['nomes'][k[6:]] = v
            else:
                m['overlay'][k] = v
        return m

    try:
        with sync_playwright() as p:
            nav = p.chromium.launch()
            pag = nav.new_page(viewport={'width': 1920, 'height': 1080})
            erros = []
            pag.on('pageerror', lambda e: erros.append(str(e)))
            pag.on('console', lambda m: m.type == 'error' and not 'nao-existe' in m.text and not '404' in m.text and erros.append(m.text))

            def foto(nome):
                if PRINTS:
                    pag.add_style_tag(content='html{background:#2b3a33 !important}')
                    pag.screenshot(path=str(PRINTS / f'overlay-{nome}.png'))

            def esperar_pessoas(n):
                pag.wait_for_function(f'document.querySelectorAll(".pessoa").length === {n}', timeout=4000)

            print('1. sem StreamKit: todos aparecem, ninguém falando')
            publicar(mesa())
            pag.goto(f'http://127.0.0.1:{porta}/overlay')
            esperar_pessoas(4)
            pag.wait_for_timeout(400)
            nomes = pag.eval_on_selector_all('.nome', 'els => els.map(e => e.textContent)')
            checar(nomes == ['Kael', 'Iris', 'Narrador', 'Fantasma'], f'nomes {nomes}')
            checar(pag.locator('.falando').count() == 0, 'ninguém falando')
            larg = pag.eval_on_selector_all('img', 'els => els.map(e => e.hidden ? 0 : e.naturalWidth)')
            checar(larg[0] > 0 and larg[2] > 0, f'imagens carregadas {larg}')
            checar(larg[1] == 0 and larg[3] == 0, 'sem imagem ou imagem quebrada mostram as iniciais')
            ini = pag.eval_on_selector_all('.iniciais', 'els => els.map(e => e.textContent)')
            checar(ini[1] == 'I' and ini[2] == 'DA', f'iniciais {ini}')
            caixa = pag.locator('#palco').bounding_box()
            checar(caixa['y'] + caixa['height'] <= 1080 - 30 and caixa['y'] > 700, f'faixa embaixo {caixa}')
            foto('1-faixa-sem-streamkit')

            print('2. com StreamKit: ausente some, Kael falando acende')
            publicar(mesa(), [{'discordId': ID1, 'nome': 'ana', 'falando': True}, {'discordId': ID2, 'nome': 'beto', 'falando': False},
                              {'discordId': ID3, 'nome': 'gus', 'falando': False}], True)
            esperar_pessoas(3)
            pag.wait_for_timeout(300)
            checar(pag.locator('.pessoa.falando').count() == 1, 'um falando')
            checar(pag.locator('.pessoa.falando .nome').text_content() == 'Kael', 'é o Kael')
            op = pag.eval_on_selector_all('.pessoa', 'els => els.map(e => getComputedStyle(e).opacity)')
            checar(op[0] == '1' and float(op[1]) < 0.7, f'quem não fala fica apagado {op}')
            foto('2-faixa-kael-falando')

            print('3. segurar: parar de falar não apaga na hora (evita piscar)')
            publicar(mesa(), [{'discordId': ID1, 'nome': 'ana', 'falando': False}, {'discordId': ID2, 'nome': 'beto', 'falando': False},
                              {'discordId': ID3, 'nome': 'gus', 'falando': False}], True)
            pag.wait_for_timeout(80)
            checar(pag.locator('.pessoa.falando').count() == 1, 'ainda aceso logo depois')
            pag.wait_for_timeout(500)
            checar(pag.locator('.pessoa.falando').count() == 0, 'apaga depois de 300 ms')

            print('4. nomes: jogador, personagem + jogador, nenhum, só quem fala')
            pres = [{'discordId': ID1, 'nome': 'ana', 'falando': False}, {'discordId': ID2, 'nome': 'beto', 'falando': True}]
            publicar(mesa(nomes_modo='jogador'), pres, True)
            pag.wait_for_timeout(250)
            checar(pag.eval_on_selector_all('.nome', 'els => els.map(e => e.textContent)') == ['Ana', 'Beto'], 'modo jogador')
            publicar(mesa(nomes_modo='personagem-jogador'), pres, True)
            pag.wait_for_timeout(250)
            checar(pag.eval_on_selector_all('.nome', 'els => els.map(e => e.textContent)') == ['Kael (Ana)', 'Iris (Beto)'], 'personagem + jogador')
            publicar(mesa(nomes_modo='nenhum'), pres, True)
            pag.wait_for_timeout(250)
            vis = pag.eval_on_selector_all('.nome', 'els => els.map(e => getComputedStyle(e).display)')
            checar(vis == ['none', 'none'], f'nenhum nome visível {vis}')
            publicar(mesa(nomes_quando='falando'), pres, True)
            pag.wait_for_timeout(250)
            checar(pag.eval_on_selector_all('.nome', 'els => els.map(e => e.textContent)') == ['', 'Iris'], 'só de quem fala')

            print('5. layouts')
            todos = [{'discordId': i, 'nome': 'x', 'falando': i == ID3} for i in (ID1, ID2, ID3)]
            for lay in ['faixa-cima', 'coluna-direita', 'coluna-esquerda']:
                publicar(mesa(layout=lay, efeito='aumentar', forma='arredondado'), todos, True)
                pag.wait_for_timeout(350)
                cx = pag.locator('#palco').bounding_box()
                if lay == 'faixa-cima':
                    checar(cx['y'] < 60, f'{lay} no topo')
                elif lay == 'coluna-direita':
                    checar(cx['x'] > 1600, f'{lay} à direita x={cx["x"]:.0f}')
                else:
                    checar(cx['x'] < 80, f'{lay} à esquerda x={cx["x"]:.0f}')
                foto(f'3-{lay}')
            publicar(mesa(layout='quem-fala', tamanho=140), todos, True)
            pag.wait_for_timeout(1800)  # quem falou há pouco ainda fica 1,5 s neste layout
            checar(pag.locator('.pessoa').count() == 1, 'só quem fala: um retrato')
            checar(pag.locator('.pessoa .nome').text_content() == 'Narrador', 'é o narrador')
            foto('4-quem-fala')

            print('6. overlay desligado não aparece')
            publicar(mesa(ativo=False), todos, True)
            pag.wait_for_timeout(250)
            checar(not pag.locator('#palco').is_visible(), 'escondido')

            print('6a. posição livre: ponto, fila em pé, ordem, deslocamento')
            livre = mesa(ancora='baixo-dir', direcao='vertical', ordem='invertida', deslocX=-40, deslocY=-20, espaco=30, margem=30)
            publicar(livre, todos, True)
            pag.wait_for_timeout(500)
            cx = pag.eval_on_selector_all('.pessoa .retrato', 'els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })')
            checar(all(abs(c[0] - cx[0][0]) <= 1 for c in cx), f'em pé, mesma coluna {cx}')
            checar(cx[0][0] > 1920 - 30 - 40 - 140 and cx[0][0] < 1920 - 30, f'encostado à direita, com o ajuste de 40 px {cx[0]}')
            checar(cx[0][1] > cx[-1][1], f'primeiro embaixo (de baixo para cima) {cx}')
            caixa = pag.locator('.palco').bounding_box()
            checar(abs(caixa['y'] + caixa['height'] - (1080 - 30 - 20)) < 3, f'embaixo, subido 20 px pelo ajuste {caixa}')
            publicar(mesa(ancora='meio-esq', direcao='horizontal', mostrar='falando', tamanho=150), [{'discordId': ID1, 'nome': 'ana', 'falando': True}], True)
            pag.wait_for_timeout(500)
            checar(pag.locator('.pessoa').count() == 1, 'só quem fala mostra só quem fala')
            caixa = pag.locator('.palco').bounding_box()
            checar(caixa['x'] < 60 and abs(caixa['y'] + caixa['height'] / 2 - 540) < 4, f'no meio à esquerda {caixa}')
            foto('6a-posicao-livre')

            print('6b. nomes compridos cabem (letra menor ou duas linhas), sem "…"')
            longa = mesa(layout='coluna-esquerda', ocultarAusentes=False)
            longa['jogadores'][0]['personagem'] = 'Marcinho'
            longa['jogadores'][1]['personagem'] = 'Bartholomeu Ironfist'
            longa['jogadores'][2]['nomeModo'] = 'personalizado'
            longa['jogadores'][2]['nomeTexto'] = 'Lady Seraphina Valerius da Torre Alta'
            publicar(longa, [], True)
            pag.wait_for_timeout(500)
            info = pag.eval_on_selector_all('.nome', '''els => els.filter(e => e.textContent).map(e => ({ t: e.textContent,
                cabe: e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1, duas: e.classList.contains('duas-linhas'),
                fonte: parseFloat(getComputedStyle(e).fontSize) }))''')
            checar(all(i['cabe'] for i in info[:2]), f'nomes médios cabem inteiros {info[:2]}')
            seraphina = [i for i in info if i['t'].startswith('Lady')][0]
            checar(seraphina['duas'], f'nome enorme vai para duas linhas {seraphina}')
            foto('6-nomes-compridos')

            print('6c. app atualizado: a página do OBS se recarrega sozinha')
            pag.evaluate('window.__antiga = true')
            node.stdin.write(json.dumps({'versao': 'nova-versao'}) + '\n'); node.stdin.flush()
            assert node.stdout.readline().strip() == 'OK'
            pag.wait_for_timeout(1500)
            checar(pag.evaluate('window.__antiga') is None, 'recarregou com o código novo')
            pag.wait_for_selector('.palco', state='attached')

            print('7. reconecta sozinho se o app reiniciar a página do servidor')
            publicar(mesa(), todos, True)
            pag.reload()
            esperar_pessoas(3)
            checar(True, 'recarregou e recebeu o estado')

            print('8. demo (prévia do app) sem jogadores')
            vazio = json.loads(json.dumps(MESA)); vazio['jogadores'] = []
            publicar(vazio)
            pag.goto(f'http://127.0.0.1:{porta}/overlay?demo=1')
            esperar_pessoas(4)
            pag.wait_for_timeout(1800)
            checar(pag.locator('.pessoa.falando').count() == 1, 'alguém falando na demo')
            foto('5-demo')

            checar(not erros, f'sem erros de JavaScript {erros}')
            nav.close()
    finally:
        node.stdin.close()
        node.wait(timeout=5)

    print('\nRESULTADO:', 'tudo certo' if not falhas else f'{len(falhas)} falha(s)')
    sys.exit(1 if falhas else 0)

main()
