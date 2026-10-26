"""Testa a leitura do StreamKit num navegador real, com o HTML do widget de voz."""
import json, subprocess, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parents[2]
falhas = []

def checar(cond, msg):
    print(('  ok   ' if cond else '  FALHA ') + msg)
    if not cond:
        falhas.append(msg)

# pega o código real da função coletarStreamKit e o interpretar, do módulo do app
codigo = subprocess.check_output(['node', '-e', '''
const sk = require(process.argv[1]);
process.stdout.write(sk.coletarStreamKit.toString());
''', str(RAIZ / 'src/core/streamkit.js')], text=True)

def interpretar(brutos):
    return json.loads(subprocess.check_output(['node', '-e', '''
const sk = require(process.argv[1]);
process.stdout.write(JSON.stringify(sk.interpretar(JSON.parse(process.argv[2]))));
''', str(RAIZ / 'src/core/streamkit.js'), json.dumps(brutos)], text=True))

with sync_playwright() as p:
    nav = p.chromium.launch()
    pag = nav.new_page()
    pag.goto((RAIZ / 'test/navegador/streamkit-exemplo.html').as_uri())
    coletar = f'() => ({codigo})(document)'

    print('1. widget no formato conhecido')
    r = interpretar(pag.evaluate(coletar))
    checar(r == [
        {'discordId': '187691838138400768', 'nome': 'ana_rpg', 'falando': True},
        {'discordId': '298765432109876543', 'nome': 'Beto#Gamer', 'falando': False},
        {'discordId': '311111111111111111', 'nome': 'Gustavo', 'falando': False},
    ], f'três pessoas, ids e quem fala {r}')

    print('2. muda quem fala')
    pag.evaluate('''() => {
        const imgs = document.querySelectorAll('img.avatar');
        imgs[0].classList.remove('speaking'); imgs[2].classList.add('speaking');
    }''')
    r = interpretar(pag.evaluate(coletar))
    checar([x['falando'] for x in r] == [False, False, True], 'Gustavo falando agora')

    print('3. pessoa sai do canal')
    pag.evaluate("() => document.querySelectorAll('li.voice-state')[1].remove()")
    r = interpretar(pag.evaluate(coletar))
    checar([x['nome'] for x in r] == ['ana_rpg', 'Gustavo'], 'Beto saiu')

    print('4. se o Discord mudar os nomes das classes, ainda acha')
    pag.set_content('''<ul class="Voice_list__x9"><li class="Voice_item__a1">
        <img class="Voice_avatar__q2 Voice_speaking__z7" src="https://cdn.discordapp.com/avatars/187691838138400768/x.png">
        <span class="Voice_user__k3">ana_rpg</span></li>
        <li class="Voice_item__a1"><img class="Voice_avatar__q2" src="https://cdn.discordapp.com/avatars/298765432109876543/y.png">
        <span>Beto</span></li></ul>''')
    r = interpretar(pag.evaluate(coletar))
    checar(r == [
        {'discordId': '187691838138400768', 'nome': 'ana_rpg', 'falando': True},
        {'discordId': '298765432109876543', 'nome': 'Beto', 'falando': False},
    ], f'formato novo {r}')

    print('5. página sem ninguém (canal vazio ou sem autorização)')
    pag.set_content('<div>Discord não está aberto</div>')
    checar(pag.evaluate(coletar) == [], 'lista vazia, sem erro')
    nav.close()

print('\nRESULTADO:', 'tudo certo' if not falhas else f'{len(falhas)} falha(s)')
sys.exit(1 if falhas else 0)
