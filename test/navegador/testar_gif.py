"""Exportar GIF (horizontal e vertical) com as opções para o Discord.
Uso: python3 test/navegador/testar_gif.py"""
import json, subprocess, sys, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
RAIZ = Path(__file__).resolve().parents[2]
node = subprocess.Popen(['node', str(RAIZ / 'test/navegador/harness.js')], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
porta = int(node.stdout.readline().split()[1]); B = f'http://127.0.0.1:{porta}'
pegar = lambda c: json.loads(urllib.request.urlopen(B + c).read())
def api(n, *a): return json.loads(urllib.request.urlopen(urllib.request.Request(B + '/api/' + n, data=json.dumps(list(a)).encode(), method='POST')).read())
falhas=[]
def checar(c,m): print(('  ok   ' if c else '  FALHA ')+m); c or falhas.append(m)
try:
  with sync_playwright() as p:
    nav = p.chromium.launch(); pag = nav.new_page(viewport={'width':1360,'height':900})
    erros=[]; pag.on('pageerror', lambda e: erros.append(str(e))); pag.on('console', lambda m: m.type=='error' and erros.append(m.text))
    pag.goto(B+'/#mesa'); pag.wait_for_selector('[data-acao="addJogador"]')
    sid = pegar('/teste/criar-sessao')['id']; cid = api('salvarCorte', sid, {'nome':'G','ini':2000,'fim':5000})['id']
    pag.goto(B+f'/#corte/{sid}/{cid}'); pag.wait_for_selector('#opcoes-gif', timeout=20000)
    pag.click('#opcoes-gif summary')
    pag.select_option('[data-campo="c.cortes.gif.largura"]', '320')
    pag.select_option('[data-campo="c.cortes.gif.limiteMB"]', '50')
    pag.wait_for_timeout(700)
    g = pegar('/teste/config')['cortes']['gif']
    checar(g['largura']==320 and g['limiteMB']==50, f'opções salvas {g}')
    for el in pag.locator('[data-preset]').all(): el.uncheck()
    pag.check('[data-preset][value="gif"]')
    pag.click('[data-acao="exportarCorte"]')
    fim=time.time()+120
    while time.time()<fim:
      f=pegar('/teste/fila')
      if f and all(x['estado'] in ('pronto','erro') for x in f): break
      time.sleep(0.5)
    x=f[-1]; checar(x['estado']=='pronto' and x['saida'].endswith('.gif'), f"gif exportado {x['erro']} {x['saida']}")
    pag.click('text=Editar vertical'); pag.wait_for_selector('[data-preset="gif-vertical"]'); pag.wait_for_timeout(1000)
    pag.click('[data-acao="exportarVertical"][data-preset="gif-vertical"]')
    fim=time.time()+120
    while time.time()<fim:
      f=pegar('/teste/fila')
      if len(f)>=2 and all(x['estado'] in ('pronto','erro') for x in f): break
      time.sleep(0.5)
    x=f[-1]; checar(x['estado']=='pronto' and x['saida'].endswith('.gif'), f"gif vertical {x['erro']}")
    r=subprocess.run(['ffprobe','-v','error','-show_entries','stream=width,height','-of','csv=p=0',x['saida']],capture_output=True,text=True); print(r.stdout)
    pag.goto(B+'/#momentos'); pag.wait_for_selector('[data-compilado]', timeout=20000)
    for cb in pag.locator('[data-compilado]').all(): cb.check()
    opts = pag.locator('#preset-compilado option').all_inner_texts()
    checar(not any('GIF' in o for o in opts), f'compilado sem GIF {opts}')
    checar(not erros, f'sem erros {erros}')
finally:
  node.stdin.close(); node.wait(timeout=20)
print('\nRESULTADO:', 'tudo certo' if not falhas else f'{len(falhas)} falha(s)')
sys.exit(1 if falhas else 0)
