"""Teste de ponta a ponta da interface: o app real (controlador, overlay, configuração)
com um OBS falso e o StreamKit simulado, clicando na interface como uma pessoa faria.
Uso: python3 test/navegador/testar_interface.py [pasta_para_prints]"""
import json, subprocess, sys, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[2]
PRINTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None
ID1, BOT = '187691838138400768', '400000000000000001'
falhas = []

def checar(cond, msg):
    print(('  ok   ' if cond else '  FALHA ') + msg)
    if not cond:
        falhas.append(msg)

node = subprocess.Popen(['node', str(RAIZ / 'test/navegador/harness.js')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
porta = int(node.stdout.readline().split()[1])
BASE = f'http://127.0.0.1:{porta}'

def pegar(caminho):
    return json.loads(urllib.request.urlopen(BASE + caminho).read())

def streamkit(brutos):
    req = urllib.request.Request(BASE + '/teste/streamkit', data=json.dumps(brutos).encode(), method='POST')
    urllib.request.urlopen(req).read()

def mesa_ativa(c):
    return next(m for m in c['mesas'] if m['id'] == c['mesaAtiva'])

try:
    with sync_playwright() as p:
        nav = p.chromium.launch()
        pag = nav.new_page(viewport={'width': 1280, 'height': 900})
        erros = []
        pag.on('pageerror', lambda e: erros.append(str(e)))
        pag.on('console', lambda m: m.type == 'error' and erros.append(m.text))
        pag.on('dialog', lambda d: d.accept())

        def foto(nome):
            if PRINTS:
                pag.screenshot(path=str(PRINTS / f'ui-{nome}.png'), full_page=True)

        def esperar_salvar():
            pag.wait_for_timeout(700)

        pag.goto(BASE + '/#mesa')
        pag.wait_for_selector('[data-acao="addJogador"]')

        print('1. adicionar jogador, nomes e imagem')
        pag.click('[data-acao="addJogador"]')
        card = pag.locator('[data-jogador]').first
        card.locator('[data-campo$=".personagem"]').fill('Kael')
        card.locator('[data-campo$=".jogador"]').fill('Ana')
        card.locator('[data-campo$=".discordId"]').fill(ID1)
        card.locator('[data-acao="imagem"]').click()
        pag.wait_for_selector('[data-jogador] .avatar img')
        esperar_salvar()
        j = mesa_ativa(pegar('/teste/config'))['jogadores'][0]
        checar(j['personagem'] == 'Kael' and j['jogador'] == 'Ana' and j['discordId'] == ID1, 'campos salvos')
        checar(j['imagem'].endswith('.png'), f'imagem copiada para o app: {j["imagem"]}')
        ov = pegar('/teste/overlay')
        checar(ov['pessoas'][0]['nome'] == 'Kael' and ov['pessoas'][0]['imagem'].startswith('/img/'), 'overlay recebeu nome e imagem')
        larg = pag.eval_on_selector('[data-jogador] .avatar img', 'e => e.naturalWidth')
        checar(larg > 0, 'retrato aparece no cartão')
        checar('Kael' in card.locator('[data-nome-final]').inner_text(), 'mostra o nome que vai no vídeo')

        print('2. enquadramento')
        card.locator('[data-campo$=".foco.zoom"]').fill('200')
        esperar_salvar()
        checar(mesa_ativa(pegar('/teste/config'))['jogadores'][0]['foco']['zoom'] == 200, 'zoom salvo')

        print('3. nome no vídeo: padrão da mesa e exceção do jogador')
        pag.select_option('[data-campo="m.nomes.modo"]', 'jogador')
        esperar_salvar()
        checar(pegar('/teste/overlay')['pessoas'][0]['nome'] == 'Ana', 'padrão da mesa: jogador')
        card = pag.locator('[data-jogador]').first
        card.locator('[data-campo$=".nomeModo"]').select_option('personalizado')
        card = pag.locator('[data-jogador]').first
        card.locator('[data-campo$=".nomeTexto"]').fill('Narrador')
        esperar_salvar()
        checar(pegar('/teste/overlay')['pessoas'][0]['nome'] == 'Narrador', 'exceção personalizada')
        card.locator('[data-campo$=".nomeModo"]').select_option('nenhum')
        esperar_salvar()
        checar(pegar('/teste/overlay')['pessoas'][0]['nome'] == '', 'sem nome')
        card = pag.locator('[data-jogador]').first
        card.locator('[data-campo$=".nomeModo"]').select_option('padrao')
        pag.select_option('[data-campo="m.nomes.modo"]', 'personagem')
        esperar_salvar()

        print('4. StreamKit: quem fala e quem não está cadastrado')
        streamkit([
            {'src': f'https://cdn.discordapp.com/avatars/{ID1}/a.png', 'nome': 'ana', 'falando': True},
            {'src': 'https://cdn.discordapp.com/embed/avatars/1.png', 'nome': 'Visitante', 'falando': False},
            {'src': f'https://cdn.discordapp.com/avatars/{BOT}/b.png', 'nome': 'Bot de Música', 'falando': True},
        ])
        pag.wait_for_selector('#vivo-detectados .pessoa-linha')
        checar(pag.locator('#vivo-detectados .pessoa-linha').count() == 2, 'dois não cadastrados no canal')
        checar('Falando agora' in pag.locator('[data-canal]').first.inner_text(), 'Kael aparece falando')
        foto('mesa-com-jogador')
        pag.locator('#vivo-detectados [data-acao="ignorarDetectado"]').last.click()
        pag.wait_for_timeout(400)
        checar(BOT in mesa_ativa(pegar('/teste/config'))['ignorados'], 'bot ignorado')
        pag.locator('#vivo-detectados [data-acao="adicionarDetectado"]').first.click()
        pag.wait_for_timeout(400)
        js = mesa_ativa(pegar('/teste/config'))['jogadores']
        checar(len(js) == 2 and js[1]['discordNome'] == 'Visitante', 'visitante adicionado pelo nome')
        checar(pag.locator('[data-jogador]').count() == 2, 'cartão novo apareceu')
        streamkit([
            {'src': f'https://cdn.discordapp.com/avatars/{ID1}/a.png', 'nome': 'ana', 'falando': False},
            {'src': 'https://cdn.discordapp.com/embed/avatars/1.png', 'nome': 'Visitante', 'falando': True},
        ])
        pag.wait_for_timeout(300)
        ov = pegar('/teste/overlay')
        checar([x['falando'] for x in ov['pessoas']] == [False, True], 'overlay acende o visitante')

        print('5. overlay: desligar, posição, tamanho')
        pag.goto(BASE + '/#overlay')
        pag.wait_for_selector('#previa iframe')
        pag.uncheck('[data-campo="m.overlay.ativo"]')
        pag.wait_for_timeout(300)
        checar(pegar('/teste/overlay')['ativo'] is False, 'overlay desligado')
        pag.check('[data-campo="m.overlay.ativo"]')
        pag.click('.ancora:has(input[value="baixo-dir"])')
        pag.click('.segmento:has(input[value="vertical"])')
        pag.select_option('#ordem-overlay', 'invertida')
        pag.locator('[data-campo="m.overlay.tamanho"]').fill('160')
        pag.wait_for_timeout(500)
        ov = pegar('/teste/overlay')
        checar(ov['ativo'] and ov['ancora'] == 'baixo-dir' and ov['direcao'] == 'vertical' and ov['ordem'] == 'invertida' and ov['tamanho'] == 160,
               f'ponto, fila em pé, ordem e tamanho {ov.get("ancora")} {ov.get("direcao")} {ov.get("ordem")} {ov["tamanho"]}')
        checar('De baixo para cima' in pag.inner_text('#ordem-overlay'), 'texto da ordem acompanha a fila em pé')
        # arrastar na prévia move os retratos
        caixa = pag.locator('.arrastar-previa').bounding_box()
        pag.mouse.move(caixa['x'] + 300, caixa['y'] + 200)
        pag.mouse.down()
        pag.mouse.move(caixa['x'] + 250, caixa['y'] + 150, steps=6)
        pag.mouse.up()
        pag.wait_for_timeout(500)
        ov = pegar('/teste/overlay')
        esc = 1920 / caixa['width']
        checar(abs(ov['deslocX'] + 50 * esc) < 3 and abs(ov['deslocY'] + 50 * esc) < 3, f'arrastar move ({ov["deslocX"]}, {ov["deslocY"]})')
        checar(pag.input_value('[data-campo="m.overlay.deslocX"]') == str(ov['deslocX']), 'controle acompanha o arraste')
        # esticar pela bolinha (ponto embaixo à direita: a bolinha fica em cima à esquerda; puxar para fora aumenta)
        tam0 = pegar('/teste/overlay')['tamanho']
        al = pag.locator('.alca-grupo').bounding_box()
        pag.mouse.move(al['x'] + al['width'] / 2, al['y'] + al['height'] / 2)
        pag.mouse.down()
        pag.mouse.move(al['x'] - 20, al['y'] - 60, steps=6)
        pag.mouse.up()
        pag.wait_for_timeout(500)
        tam1 = pegar('/teste/overlay')['tamanho']
        checar(tam1 > tam0, f'puxar a bolinha aumenta os retratos ({tam0} → {tam1})')
        checar(pag.input_value('[data-campo="m.overlay.tamanho"]') == str(round(tam1)), 'controle de tamanho acompanha')
        cx = pag.locator('#caixa-grupo').bounding_box()
        checar(cx['width'] > 10 and cx['height'] > 10, f'caixa em volta dos retratos na prévia {cx}')
        pag.click('[data-acao="centralizarOverlay"]')
        pag.wait_for_timeout(400)
        checar(pegar('/teste/overlay')['deslocX'] == 0, 'voltar ao ponto zera o ajuste')
        pag.click('.segmento:has(input[value="falando"])')
        pag.wait_for_timeout(400)
        checar(pegar('/teste/overlay')['mostrar'] == 'falando', 'só quem fala')
        pag.click('.segmento:has(input[value="todos"])')
        checar(pag.inner_text('[data-eco="tamanho"]') == pag.input_value('[data-campo="m.overlay.tamanho"]'), 'número ao lado do controle acompanha')
        pag.click('[data-acao="copiarOverlay"]')
        pag.wait_for_timeout(200)
        checar(pegar('/teste/registro')['copiado'].endswith('/overlay'), 'copiou o endereço do overlay')
        pag.wait_for_timeout(1800)
        fundo = pag.frame_locator('#previa iframe').locator('body').evaluate('b => getComputedStyle(b).backgroundColor')
        checar(fundo in ('rgba(0, 0, 0, 0)', 'transparent'), f'prévia transparente ({fundo})')
        foto('overlay')
        pag.click('.ancora:has(input[value="baixo"])')
        pag.click('.segmento:has(input[value="horizontal"])')
        pag.locator('[data-campo="m.overlay.tamanho"]').fill('160')
        pag.select_option('#ordem-overlay', 'normal')
        pag.locator('[data-campo="m.overlay.tamanho"]').fill('110')

        print('6. conexões: canais do StreamKit')
        pag.goto(BASE + '/#conexoes')
        checar(pag.locator('[data-canal-id]').count() == 0, 'começa sem canais')
        pag.click('[data-acao="novoCanal"]')
        campo = pag.locator('[data-canal-id] [data-valida-sk]').first
        campo.fill('https://discord.com/channels/1/2')
        checar('precisa começar' in pag.locator('[data-canal-id] [data-valida-saida]').first.inner_text(), 'link errado avisa')
        campo.fill(f'https://streamkit.discord.com/overlay/voice/{ID1}/{BOT}?icon=true')
        checar(pag.locator('[data-canal-id] [data-valida-saida]').first.inner_text().strip() == '', 'link certo não reclama')
        pag.locator('[data-canal-id] input[type=text]').first.fill('Mesa de sábado')
        esperar_salvar()
        sk = mesa_ativa(pegar('/teste/config'))['streamkit']
        checar(len(sk['canais']) == 1 and sk['canais'][0]['nome'] == 'Mesa de sábado', 'canal salvo com nome')
        pag.click('[data-acao="trocarCanal"]')
        pag.wait_for_timeout(500)
        sk = mesa_ativa(pegar('/teste/config'))['streamkit']
        checar('/overlay/voice/' in sk['url'] and sk['ativo'] == sk['canais'][0]['id'], 'canal em uso é o link ativo da mesa')
        # link que chega do site do StreamKit vira um segundo canal, já em uso
        L2 = f'https://streamkit.discord.com/overlay/voice/{ID1}/298765432109876543'
        req = urllib.request.Request(BASE + '/teste/link', data=json.dumps([L2]).encode(), method='POST')
        urllib.request.urlopen(req).read()
        pag.wait_for_timeout(600)
        sk = mesa_ativa(pegar('/teste/config'))['streamkit']
        checar(len(sk['canais']) == 2 and sk['url'].startswith(L2), 'link do StreamKit virou canal novo em uso')
        checar(pag.locator('#seletor-canal option').count() == 2, 'menu mostra o seletor de canal')
        pag.select_option('#seletor-canal', sk['canais'][0]['id'])
        pag.wait_for_timeout(500)
        sk = mesa_ativa(pegar('/teste/config'))['streamkit']
        checar(sk['ativo'] == sk['canais'][0]['id'] and BOT in sk['url'], 'trocou de canal pelo menu')
        urllib.request.urlopen(urllib.request.Request(BASE + '/teste/link', data=json.dumps([L2 + '?icon=true']).encode(), method='POST')).read()
        pag.wait_for_timeout(600)
        sk = mesa_ativa(pegar('/teste/config'))['streamkit']
        checar(len(sk['canais']) == 2 and sk['ativo'] == sk['canais'][1]['id'], 'mesmo canal de novo não duplica, só ativa')
        foto('canais')
        pag.click('[data-acao="abrirStreamKit"]')
        pag.wait_for_timeout(200)
        checar(pegar('/teste/registro')['abrirSite'] == 1, 'botão abre o site do StreamKit')
        pag.fill('[data-campo="c.obs.porta"]', '4460')
        pag.press('[data-campo="c.obs.porta"]', 'Tab')
        esperar_salvar()
        checar(pegar('/teste/config')['obs']['porta'] == 4460, 'porta do OBS salva ao sair do campo')
        pag.fill('[data-campo="c.obs.porta"]', '4455')
        pag.press('[data-campo="c.obs.porta"]', 'Tab')
        pag.wait_for_timeout(1500)
        foto('conexoes')

        print('7. sessão: gravar, marcar, nomear')
        pag.goto(BASE + '/#sessao')
        pag.wait_for_selector('[data-acao="gravar"]:not([disabled])', timeout=8000)
        checar(pag.locator('#sessao-canal option').count() == 2, 'sessão ao vivo mostra o seletor de canal')
        checar(pag.locator('[data-acao="marcar"]').is_disabled(), 'marcar desligado sem gravação')
        pag.click('[data-acao="gravar"]')
        pag.wait_for_selector('.estado-rotulo.gravando')
        pag.click('[data-acao="marcar"]')
        pag.wait_for_selector('#vivo-marcadores [data-marcador]')
        checar(pag.locator('.aviso').first.inner_text().startswith('Marcado'), 'aviso de marcado')
        m = pag.locator('#vivo-marcadores [data-marcador]').first
        m.fill('Emboscada na ponte')
        m.press('Enter')
        pag.wait_for_timeout(400)
        est = pag.evaluate('window.api.estado()')
        checar(est['sessao']['marcadores'][0]['nome'] == 'Emboscada na ponte', 'marcador nomeado')
        pag.wait_for_timeout(1100)
        rel = pag.inner_text('[data-relogio]')
        checar(rel != '00:00:00', f'relógio andando {rel}')
        checar(pag.locator('#vivo-mesa-agora .pessoa-linha').count() >= 1, 'mostra quem está na mesa')
        foto('sessao-gravando')
        pag.click('[data-acao="gravar"]')
        pag.wait_for_selector('.estado-rotulo:not(.gravando)')

        print('8. atalhos')
        pag.goto(BASE + '/#gravacao')
        pag.click('[data-atalho="marcar"]')
        pag.keyboard.press('F8')
        esperar_salvar()
        checar(pegar('/teste/config')['atalhos']['marcar'] == 'F8', 'F8 salvo')
        pag.click('[data-atalho="replay"]')
        pag.keyboard.press('a')
        checar('Ctrl ou Alt' in pag.locator('.aviso').last.inner_text(), 'letra sozinha é recusada')
        pag.keyboard.press('F8')
        checar('já é o atalho' in pag.locator('.aviso').last.inner_text(), 'atalho repetido é recusado')
        pag.keyboard.press('Control+Alt+KeyR')
        esperar_salvar()
        checar(pegar('/teste/config')['atalhos']['replay'] == 'Ctrl+Alt+R', 'Ctrl+Alt+R salvo')
        checar('outro programa' in pag.inner_text('[data-atalho-status="replay"]'), 'mostra atalho ocupado')
        pag.locator('[data-campo="c.gravacao.limiteHoras"]').fill('6')
        pag.locator('[data-campo="c.gravacao.limiteHoras"]').press('Tab')
        pag.check('input[name="destino"][value="apagar"]')
        esperar_salvar()
        g = pegar('/teste/config')['gravacao']
        checar(g['limiteHoras'] == 6 and g['destino'] == 'apagar', 'limite e destino salvos')
        pag.click('[data-acao="simularLimpeza"]')
        pag.wait_for_timeout(300)
        checar('Nada sairia' in pag.inner_text('#resultado-simulacao'), 'simulação de limpeza responde')
        foto('gravacao')

        print('9. várias mesas')
        pag.goto(BASE + '/#mesa')
        pag.click('[data-acao="novaMesa"]')
        pag.wait_for_timeout(500)
        c = pegar('/teste/config')
        checar(len(c['mesas']) == 2 and len(mesa_ativa(c)['jogadores']) == 0, 'mesa nova vazia e ativa')
        pag.fill('[data-campo="m.nome"]', 'Campanha do amigo')
        pag.select_option('[data-campo="m.papel"]', 'jogador')
        esperar_salvar()
        checar('Campanha do amigo (jogador)' in pag.inner_text('#seletor-mesa'), 'menu mostra o nome e o papel')
        pag.select_option('#seletor-mesa', index=0)
        pag.wait_for_timeout(500)
        checar(pag.locator('[data-jogador]').count() == 2, 'voltou para a mesa com os jogadores')

        print('10. primeiros passos e tela estreita')
        pag.goto(BASE + '/#ajuda')
        pag.wait_for_timeout(400)
        checar(pag.locator('[data-passo="obs"].feito').count() == 1, 'passo do OBS fica verde')
        foto('ajuda')
        pag.set_viewport_size({'width': 900, 'height': 700})
        for t in ['sessao', 'mesa', 'overlay', 'conexoes', 'gravacao', 'ajuda']:
            pag.goto(BASE + '/#' + t)
            pag.wait_for_timeout(250)
            larg = pag.evaluate('document.documentElement.scrollWidth')
            checar(larg <= 900, f'{t}: sem rolagem lateral em 900 px ({larg})')

        checar(not erros, f'sem erros no console {erros}')
        nav.close()
finally:
    node.stdin.close()
    node.wait(timeout=10)

print('\nRESULTADO:', 'tudo certo' if not falhas else f'{len(falhas)} falha(s)')
sys.exit(1 if falhas else 0)
