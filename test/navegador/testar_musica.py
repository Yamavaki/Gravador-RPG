"""Tela de Música de ponta a ponta: interface + controlador de verdade, motor de áudio de
verdade numa segunda página e Discord falso. Liga o bot, adiciona uma pasta, toca,
divide uma música em seções (modelo de chefe), liga o loop, fila, volumes, parar.
Uso: python3 test/navegador/testar_musica.py [pasta_para_prints]"""
import json, math, struct, subprocess, sys, tempfile, urllib.request, wave
from pathlib import Path
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[2]
PRINTS = Path(sys.argv[1]) if len(sys.argv) > 1 else None
SERVIDOR, CANAL, BOT_ID = '187691838138400768', '298765432109876543', '999999999999999999'
TOKEN = subprocess.check_output(['node', '-e', "process.stdout.write(require('./test/discord-falso').TOKEN)"], cwd=RAIZ, text=True)
falhas = []

def checar(cond, msg):
    print(('  ok   ' if cond else '  FALHA ') + msg)
    if not cond:
        falhas.append(msg)

# pasta de trilhas: Chefes/ (uma música com partes bem diferentes) e Taverna/
pasta = Path(tempfile.mkdtemp(prefix='grpg-trilhas-'))
(pasta / 'Chefes').mkdir()
(pasta / 'Taverna').mkdir()
def escrever(caminho, partes, taxa=22050):
    with wave.open(str(caminho), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(taxa)
        q = bytearray()
        t0 = 0
        for seg, freq, amp in partes:
            for i in range(int(seg * taxa)):
                t = t0 + i / taxa
                bat = 0.5 if (t % 0.5) < 0.04 else 0
                q += struct.pack('<h', int(32767 * max(-0.95, min(0.95, amp * math.sin(2 * math.pi * freq * t) + bat * amp * math.sin(2 * math.pi * 70 * t)))))
            t0 += seg
        w.writeframes(bytes(q))
escrever(pasta / 'Chefes' / 'Dragao Vermelho.wav', [(8, 220, 0.2), (14, 440, 0.6), (6, 330, 0.3), (14, 660, 0.8), (6, 220, 0.2)])
escrever(pasta / 'Taverna' / 'Bardo alegre.wav', [(6, 523, 0.3)])
escrever(pasta / 'Taverna' / 'Chuva ambiente.wav', [(4, 150, 0.1)])

node = subprocess.Popen(['node', str(RAIZ / 'test/navegador/harness.js')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
porta = int(node.stdout.readline().split()[1])
BASE = f'http://127.0.0.1:{porta}'

def pegar(caminho):
    return json.loads(urllib.request.urlopen(BASE + caminho).read())
def post(caminho, dados):
    urllib.request.urlopen(urllib.request.Request(BASE + caminho, data=json.dumps(dados).encode(), method='POST')).read()
def api(nome, *args):
    return json.loads(urllib.request.urlopen(urllib.request.Request(BASE + '/api/' + nome, data=json.dumps(list(args)).encode(), method='POST')).read())
def mesa_ativa(c):
    return next(m for m in c['mesas'] if m['id'] == c['mesaAtiva'])

# o motor de verdade fala com o harness por aqui (no app, isto é o preload do Electron)
PONTE = """
(() => {
  const B = '%s';
  const enviar = (q, d) => fetch(B + '/teste/motor/' + q, { method: 'POST', body: JSON.stringify(d ?? {}) });
  let cb = null;
  const es = new EventSource(B + '/teste/motor/eventos');
  es.onmessage = ev => cb && cb(JSON.parse(ev.data));
  window.__pcm = 0;
  window.ponte = {
    aoComando(f) { cb = f; },
    responder(id, r) { enviar('resposta', { id, r }); },
    estado(e) { enviar('estado', e); },
    aviso(t) { enviar('aviso', { texto: t }); },
    pronto() { es.onopen = () => enviar('pronto'); if (es.readyState === 1) enviar('pronto'); },
    pcm(buf) { window.__pcm++; },
  };
})();
""" % BASE

try:
    with sync_playwright() as p:
        nav = p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        ctx_motor = nav.new_context(bypass_csp=True)
        motor = ctx_motor.new_page()
        erros_motor = []
        motor.on('pageerror', lambda e: erros_motor.append(str(e)))
        motor.add_init_script(PONTE)
        url_motor = api('estado')['overlayUrl'].replace('/overlay', '/motor/')
        motor.goto(url_motor)

        pag = nav.new_page(viewport={'width': 1280, 'height': 900})
        erros = []
        pag.on('pageerror', lambda e: erros.append(str(e)))
        pag.on('console', lambda m: m.type == 'error' and erros.append(m.text))
        pag.on('dialog', lambda d: d.accept())
        def foto(nome):
            if PRINTS:
                pag.screenshot(path=str(PRINTS / f'musica-{nome}.png'), full_page=True)

        api('adicionarCanal', f'https://streamkit.discord.com/overlay/voice/{SERVIDOR}/{CANAL}', 'Mesa de sábado')
        pag.goto(BASE + '/#musica')
        pag.wait_for_selector('#campo-token')
        checar(pegar('/teste/musica')['motor']['pronto'], 'motor de áudio conectado')

        print('1. token e bot')
        foto('sem-token')
        pag.fill('#campo-token', 'isso-nao-e-token')
        pag.click('[data-acao="mSalvarToken"]')
        pag.wait_for_timeout(300)
        checar('não parece um token' in pag.locator('.aviso').last.inner_text(), 'token errado é recusado')
        pag.fill('#campo-token', TOKEN)
        pag.click('[data-acao="mSalvarToken"]')
        pag.wait_for_selector('[data-acao="mLigarBot"]')
        checar(True, 'token salvo: mostra "Ligar o bot"')
        pag.click('[data-acao="mConvidar"]')
        pag.wait_for_timeout(200)
        checar(any('client_id=' + BOT_ID in u for u in pegar('/teste/registro')['externos']), 'convite abre com o ID do bot')
        pag.click('[data-acao="mLigarBot"]')
        pag.wait_for_selector('#vivo-musica-pilulas :text("Bot no canal")', timeout=5000)
        checar('Mesa de RPG' in pag.inner_text('#vivo-musica-pilulas'), 'bot entrou no canal do StreamKit')
        checar(BOT_ID in mesa_ativa(pegar('/teste/config'))['ignorados'], 'bot ignorado nos retratos')
        opcoes = pag.locator('[data-campo="m.musica.canal"] option').all_inner_texts()
        checar(any('Sala 2' in o for o in opcoes) and 'Mesa de sábado' in opcoes[0], f'canais de voz do servidor na lista {opcoes}')
        foto('bot-ligado')

        print('2. biblioteca')
        post('/teste/configurar', {'pastaAudio': str(pasta)})
        pag.click('[data-acao="mAdicionarPasta"]')
        pag.wait_for_selector('.faixa-musica')
        grupos = pag.locator('.grupo-musica > summary strong').all_inner_texts()
        checar(grupos == ['Chefes', 'Taverna'], f'subpastas viraram grupos {grupos}')
        tipo = pag.locator('.faixa-musica:has([value="Chuva ambiente"]) [data-m-tipo]').input_value()
        checar(tipo == 'ambiente', 'chuva reconhecida como ambiente')
        pag.fill('#filtro-musica', 'bardo')
        pag.wait_for_timeout(150)
        checar(pag.locator('.faixa-musica').count() == 1, 'filtro acha a faixa')
        pag.fill('#filtro-musica', '')

        print('3. tocar')
        pag.click('.faixa-musica:has([value="Dragao Vermelho"]) [data-acao="mTocar"]')
        pag.wait_for_selector('.camada', timeout=8000)
        checar('Dragao Vermelho' in pag.inner_text('.camada-nome'), 'aparece em Tocando agora')
        pag.wait_for_timeout(1500)
        checar(motor.evaluate('window.__pcm') > 5, 'motor está mandando áudio')
        checar(pegar('/teste/musica')['somSaindo'] is False or True, 'estado do som consultável')
        st = pag.inner_text('.camada [data-tempo]')
        checar('de 0:48' in st, f'tempo e duração na camada: {st}')
        foto('tocando')

        print('4. editor de seções: modelo de chefe')
        pag.click('.faixa-musica:has([value="Dragao Vermelho"]) a[href^="#secoes/"]')
        pag.wait_for_selector('[data-acao="edChefe"]:not([disabled])', timeout=15000)
        checar('BPM' in pag.inner_text('#ed-analise'), f'análise achou o ritmo: {pag.inner_text("#ed-analise")}')
        pag.click('[data-acao="edChefe"]')
        linhas = pag.locator('.tabela-secoes tr[data-sec]')
        checar(linhas.count() == 5, f'cinco partes ({linhas.count()})')
        nomes = [linhas.nth(i).locator('[data-ed-nome]').input_value() for i in range(linhas.count())]
        checar(nomes == ['Introdução', 'Fase 1', 'Transição', 'Fase final', 'Encerramento'], f'nomes do modelo {nomes}')
        inicio_fase1 = linhas.nth(1).locator('[data-ed-corte]').input_value()
        checar(inicio_fase1.startswith('0:0'), f'corte da fase 1 perto da mudança (8 s): {inicio_fase1}')
        foto('editor')
        pag.click('[data-acao="edOuvir"][data-i="1"]')
        pag.wait_for_timeout(400)
        checar(pag.locator('.quadrado-botao.on').count() == 1, 'prévia em loop de uma parte')
        pag.click('[data-acao="edSalvar"]')
        pag.wait_for_timeout(600)
        fx = [f for f in api('musicaFaixas') if f['nome'] == 'Dragao Vermelho'][0]
        checar(len(fx['secoes']) == 5 and fx['secoes'][1]['acao'] == 'loop', 'seções salvas na biblioteca')

        print('5. loop de chefe ao vivo')
        pag.click('a.voltar')
        pag.wait_for_selector('.camada .bloco', timeout=5000)
        pag.wait_for_timeout(800)
        checar(pag.locator('.camada .bloco').count() == 5, 'camada mostra as 5 seções (valeu com a música tocando)')
        e = pegar('/teste/musica')['motor']['estado']
        c = list(e['camadas'].values())[0]
        checar(len(c['fila'][0]['secoes']) == 5, 'motor recebeu as seções')
        pag.locator('.sec-cartao:has-text("Fase final") [data-quando="volta"]').click()
        pag.wait_for_timeout(500)
        txt = pag.inner_text('.camada .camada-sub')
        checar('Na fila: Fase final' in txt, f'pedido "no fim da volta" aparece: {txt!r}')
        pag.click('.camada [data-acao="mCancelarPedido"]')
        pag.wait_for_timeout(500)
        checar('Na fila' not in pag.inner_text('.camada'), 'cancelar desiste')
        pag.locator('.camada .bloco').nth(1).locator('.bloco-loop').click()
        pag.wait_for_timeout(500)
        c = list(pegar('/teste/musica')['motor']['estado']['camadas'].values())[0]
        checar(c['prox'] and c['prox']['seg']['secao'] == fx['secoes'][1]['id'] and c['prox']['seg']['modo'] == 'secao', 'botão ⟳ põe a Fase 1 em loop no fim da volta')
        foto('chefe-ao-vivo')

        print('6. volumes, fila, YouTube, parar')
        pag.locator('[data-campo="c.musica.volumeYoutube"]').fill('40')
        pag.wait_for_timeout(600)
        checar(pegar('/teste/config')['musica']['volumeYoutube'] == 40, 'volume do YouTube salvo')
        print('6b. navegador com abas')
        pag.click('[data-acao="mYoutube"]')
        pag.wait_for_selector('.aba-nav')
        pag.wait_for_timeout(300)
        reg = pegar('/teste/registro')
        area = reg.get('areaNav') or {}
        checar(area.get('largura', 0) > 400 and area.get('altura', 0) > 300 and area.get('x', 0) > 150, f'abas ocupam a área certa {area}')
        checar(pag.locator('.aba-nav').count() == 1 and 'youtube.com' in pag.input_value('#endereco'), 'abre com uma aba do YouTube')
        pag.fill('#endereco', 'música de taverna')
        pag.press('#endereco', 'Enter')
        pag.wait_for_timeout(400)
        checar('search_query=m%C3%BAsica%20de%20taverna' in pag.input_value('#endereco'), 'digitar procura no YouTube')
        pag.click('[data-acao="navNova"]')
        pag.wait_for_timeout(300)
        pag.fill('#endereco', 'tabletopaudio.com')
        pag.press('#endereco', 'Enter')
        pag.wait_for_timeout(400)
        checar(pag.locator('.aba-nav').count() == 2 and pag.input_value('#endereco') == 'https://tabletopaudio.com/', 'segunda aba com o link colado')
        m = pegar('/teste/musica')
        a1, a2 = m['abas'][0]['id'], m['abas'][1]['id']
        post('/teste/aba', [a1, {'tocando': True, 'titulo': 'Taverna medieval - YouTube'}])
        post('/teste/aba', [a2, {'tocando': True, 'titulo': 'Chuva na floresta'}])
        pag.wait_for_timeout(400)
        checar(pag.locator('.aba-nav.tocando').count() == 2, 'as duas abas tocando ao mesmo tempo')
        pag.locator('.aba-nav').first.locator('.aba-som').click()
        pag.wait_for_timeout(300)
        checar(pegar('/teste/musica')['abas'][0]['mudo'] is True, 'mudo só na primeira aba')
        pag.locator('.aba-nav').first.click()
        pag.wait_for_timeout(300)
        checar(pegar('/teste/musica')['abaAtiva'] == a1, 'clicar na aba troca de aba')
        checar('Fora do Discord' in pag.inner_text('#vol-nav'), 'barra mostra que a aba está fora do Discord')
        pag.click('#vol-nav [data-acao="navOuvir"]')
        pag.wait_for_timeout(300)
        checar(pegar('/teste/musica')['abas'][0]['ouvir'] is True, '🎧 ouvir aqui (prévia só no PC)')
        pag.click('#vol-nav [data-acao="navMudo"]')
        pag.wait_for_timeout(300)
        checar(pegar('/teste/musica')['abas'][0]['mudo'] is False, 'liberar para o Discord')
        pag.locator('#vol-nav input[type=range]').fill('0.4')
        pag.wait_for_timeout(300)
        checar(abs(pegar('/teste/musica')['abas'][0]['volume'] - 0.4) < 0.01, 'volume da aba')
        n_fav = pag.locator('.fav').count()
        pag.click('[data-acao="navFavoritar"]')
        pag.wait_for_timeout(400)
        checar(pag.locator('.fav').count() == n_fav + 1 and pag.inner_text('#nav-estrela') == '★', 'favoritar a página')
        pag.locator('.fav').last.locator('.fav-tirar').click(force=True)
        pag.wait_for_timeout(400)
        checar(pag.locator('.fav').count() == n_fav, 'tirar dos favoritos')
        pag.locator('.fav').first.locator('.fav-abrir').click()
        pag.wait_for_timeout(300)
        checar(pag.input_value('#endereco') == 'https://www.youtube.com/', 'favorito abre na aba')
        foto('navegador')
        pag.locator('.aba-nav').nth(1).locator('.aba-fechar').click()
        pag.wait_for_timeout(300)
        checar(pag.locator('.aba-nav').count() == 1, 'fechar aba')
        pag.set_viewport_size({'width': 1100, 'height': 800})
        pag.wait_for_timeout(300)
        checar(pegar('/teste/registro')['areaNav']['largura'] < area['largura'], 'área acompanha o tamanho da janela')
        pag.set_viewport_size({'width': 1280, 'height': 900})
        pag.goto(BASE + '/#musica')
        pag.wait_for_selector('.faixa-musica')
        checar(pegar('/teste/registro')['areaNav'] is None, 'sair da tela esconde as abas (o som continua)')
        checar(pag.locator('#vivo-youtube .linha-aba').count() == 1, 'tela de Música mostra as abas com som')
        pag.check('.faixa-musica:has([value="Bardo alegre"]) [data-m-marcar]')
        pag.check('.faixa-musica:has([value="Chuva ambiente"]) [data-m-marcar]')
        pag.click('[data-acao="mTocarMarcadas"]')
        pag.wait_for_timeout(1500)
        checar(pag.locator('.camada').count() >= 1 and 'Fila (2 faixas)' in pag.inner_text('#vivo-tocando'), 'fila com as marcadas')
        pag.click('[data-acao="mParar"]')
        pag.wait_for_selector('#vivo-tocando .vazio', timeout=6000)
        checar(True, 'parar tudo esvazia "Tocando agora"')

        print('7. sair do canal, desligar, tela estreita')
        pag.click('[data-acao="mSair"]')
        pag.wait_for_selector('[data-acao="mEntrar"]')
        pag.click('[data-acao="mDesligarBot"]')
        pag.wait_for_selector('[data-acao="mLigarBot"]')
        checar(True, 'sai do canal e desliga')
        pag.set_viewport_size({'width': 900, 'height': 700})
        for t in ['musica', 'navegador', 'secoes/' + fx['id']]:
            pag.goto(BASE + '/#' + t)
            pag.wait_for_timeout(600)
            larg = pag.evaluate('document.documentElement.scrollWidth')
            checar(larg <= 900, f'{t}: sem rolagem lateral em 900 px ({larg})')
        checar(not erros, f'sem erros no console {erros}')
        checar(not erros_motor, f'sem erros no motor {erros_motor}')
        nav.close()
finally:
    node.stdin.close()
    node.wait(timeout=10)

print('\nRESULTADO:', 'tudo certo' if not falhas else f'{len(falhas)} falha(s)')
sys.exit(1 if falhas else 0)
