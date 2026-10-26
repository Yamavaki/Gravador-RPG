# Gravador RPG 0.5.1

Companheiro do OBS para gravar sessões de RPG no Windows:

- **Marcadores por atalho** (F9), inclusive com nome, que vão para a linha do tempo da sessão e para dentro do arquivo do OBS.
- **Retratos de quem está falando** no vídeo, lidos do seu próprio Discord pelo StreamKit (sem bot), com qualquer imagem que você quiser.
- **Nome no vídeo** à sua escolha: personagem, jogador, nome do Discord, os dois, nenhum, ou um texto livre por pessoa.
- **Overlay liga e desliga** quando você quiser, em qualquer lugar da tela: 9 pontos, fila deitada ou em pé, começando por qualquer ponta, ajuste fino arrastando na prévia, só quem fala, tamanho, espaço, formato e efeito.
- **Limpeza automática**: guarda as últimas X horas e tira as mais antigas, sem tocar no que tem marcador.
- **Várias mesas**: uma para a sua campanha como mestre, outras para mesas onde você é jogador.
- **Cortes** a partir dos marcadores: início e fim no detalhe, volume de cada faixa de áudio, e exportação para YouTube 2K, YouTube 1080p, WhatsApp (cabe em 16 MB), TikTok/Reels/Shorts, WhatsApp vertical ou corte rápido sem recodificar.
- **Vertical com câmera animada**: você enquadra uma parte da tela, cria pontos no tempo, dá zoom e escolhe a transição. Os retratos são redesenhados onde você quiser, acendendo em quem fala.
- **Compilado** de melhores momentos, juntando vários cortes num vídeo só.
- **Módulo do Foundry** (opcional) que marca sozinho combates, críticos e trocas de cena.
- **Novo na 0.3 — Canais salvos**: vários canais de voz por mesa, trocados com um clique (até no meio da gravação).
- **Novo na 0.3 — Bot de música** no Discord, no estilo do Kenku FM: toca as músicas do seu PC (com as seções e loops de chefe do Trilha Viva, camadas de ambiente e efeitos, fila e crossfade) e um **navegador com abas** dentro do app (YouTube com a sua conta e outros sites), várias tocando ao mesmo tempo.
- **Novo na 0.5.1 — Atualização automática**: quando sai versão nova, aparece **Atualizar para X** no menu; um clique e o app se atualiza e abre de novo sozinho.
- **Novo na 0.5 — Identidade visual**: logo e textos (o @ do Discord, o canal) por cima do vídeo, ao vivo no OBS e/ou só nos cortes, posicionados com o mouse; **imagem final** com fade no fim dos cortes (uma padrão para horizontais e outra para verticais); **fundo próprio** no vertical "tela inteira"; e **música rápida** nos cortes com volume, fades e pontos de volume no tempo.
- **Novo na 0.4 — Legendas** nos cortes: o app transcreve a fala aqui no seu PC, marca quem falou, e você corrige o texto, escolhe a aparência e posiciona com o mouse.
- **Novo na 0.4 — Momentos sugeridos**: o app ouve a sessão e aponta risadas, gritos e falatório que podem virar corte, mesmo sem marcador.
- **Novo na 0.3.1 — Bandeja**: o X deixa o app perto do relógio (tudo continua funcionando); para sair de vez, botão direito no ícone → **Sair**.

---

## 1. Instalar (uma vez)

1. Instale o **Node.js LTS**: <https://nodejs.org> (tudo padrão, "Next" até o fim).
2. Extraia este ZIP numa pasta fixa, por exemplo `C:\Gravador RPG`.
3. Dê dois cliques em **INSTALAR.bat** e espere terminar.
4. Para abrir: **ABRIR.bat**.

Quer um programa com ícone na área de trabalho? Rode **EMPACOTAR.bat**. Ele cria `dist\Gravador RPG-win32-x64\Gravador RPG.exe`; crie um atalho dele.

Suas configurações, imagens, sessões, músicas e o token do bot ficam em `%APPDATA%\Gravador RPG` (separado da pasta do app), e não se perdem ao atualizar.

### Atualizar para uma versão nova

1. **Feche o app.**
2. Extraia o ZIP novo **por cima** da pasta antiga (substituir tudo). Pode ser numa pasta nova também.
3. Abra pelo **ABRIR.bat**. Na primeira vez depois de atualizar ele roda o INSTALAR sozinho (precisa de internet).

Nada do que você configurou muda: mesas, jogadores, imagens, link do StreamKit, senha do OBS, atalhos, limites, pasta dos cortes, chave do Foundry, sessões gravadas e músicas. Se a versão nova precisar converter a configuração, ela guarda antes uma cópia do arquivo antigo (`config.antes-da-v…json`, na mesma pasta). Se você usa o **EMPACOTAR.bat**, rode ele de novo depois de atualizar.

---

## 2. Configurar o OBS (uma vez)

### Ligar o OBS ao app
1. OBS → **Ferramentas → Configurações do servidor WebSocket**.
2. Marque **Ativar servidor WebSocket**.
3. Clique em **Mostrar informações de conexão** e copie a **senha**.
4. No app: **Conexões → OBS**, cole a senha. A bolinha fica verde.

### Gravação (pensado para a sua RTX 5070 Ti)
OBS → **Configurações → Saída** → **Modo de saída: Avançado** → aba **Gravação**:

| Opção | Valor | Por quê |
|---|---|---|
| Formato da gravação | **MP4 Híbrido** | Guarda os marcadores dentro do arquivo e não corrompe se o PC travar |
| Codificador de vídeo | **NVIDIA NVENC HEVC** | Usa a placa de vídeo: quase não pesa no Foundry e ocupa menos espaço |
| Controle de taxa | **Quantização constante** (CQP), nível **16** | Qualidade fixa: mapa parado gasta pouco, cena com movimento ganha bits |
| Predefinição | **P7** (Mais lento, melhor qualidade) | A 5070 Ti dá conta sem pesar no jogo |
| Dividir arquivo automaticamente | **Por tempo, 30 min** | Pedaços que o app consegue limpar |
| Faixas de áudio | **1, 2, 3 e 4** | 1 = tudo junto, 2 = seu microfone, 3 = Discord, 4 = Foundry |

**Separar o áudio** (para depois baixar a música ou cortar uma conversa):
1. Adicione a fonte **Captura de áudio de aplicativo** escolhendo o **Discord**.
2. Outra **Captura de áudio de aplicativo** para o navegador ou app do Foundry.
3. Em **Propriedades avançadas de áudio** (engrenagem do Mixer), marque a faixa **1** em todas as fontes, mais a faixa própria de cada uma (mic = 2, Discord = 3, Foundry = 4).

**Vídeo**: em **Configurações → Vídeo**, use a resolução em que quer o vídeo final (1920×1080 ou 2560×1440) e 30 ou 60 FPS.

**Replay (opcional)**: **Saída → Buffer de replay** → ativar, 120 segundos. O app liga o buffer sozinho quando a gravação começa, e **F10** salva os últimos 2 minutos.

Espaço: com essa configuração, uma sessão costuma ficar entre 2 e 4 GB por hora em 1080p. O limite padrão do app é 10 horas ou 40 GB.

---

## 3. Ligar o Discord (StreamKit)

O StreamKit é a ferramenta oficial do Discord para mostrar quem está falando numa live. O app abre ele escondido e lê quem fala no **seu** Discord. Não precisa de bot nem de permissão no servidor.

1. Deixe o **Discord aberto** no PC.
2. No app: **Conexões → Abrir StreamKit**.
3. Clique em **Install for OBS**. O Discord pede autorização: aceite. É só uma vez.
4. Escolha **Voice Widget**, o **servidor** e o **canal de voz** da mesa.
5. O link aparece sozinho no app como um **canal salvo**, já em uso. Dê um nome para ele (ex.: "Mesa de sábado").

### Vários canais

Repita os passos 2 a 4 para cada canal onde vocês jogam: cada link vira mais um canal na lista de **Conexões**. Para trocar:

- em **Conexões**, botão **Usar este**;
- no **menu ao lado**, em "Canal de voz" (aparece quando a mesa tem 2 ou mais canais);
- em **Sessão ao vivo**, ao lado do status.

A troca vale na hora, inclusive no meio da gravação: a leitura recomeça no canal novo e o bot de música (se estiver ligado) vai junto. Cada mesa tem a sua lista. Se preferir, cole um link à mão com **Adicionar canal**.

---

## 4. Cadastrar os jogadores

Em **Mesa e jogadores**:

1. Entre no canal de voz com o pessoal. Quem estiver lá aparece em "No canal de voz e ainda não cadastrados": clique em **Adicionar à mesa**.
2. Em cada cartão: **Escolher imagem** (qualquer imagem: token, retrato, arte, foto), nome do **personagem** e do **jogador**, e a **cor** do destaque.
3. Ajuste o **enquadramento** (horizontal, vertical, zoom) para o rosto ficar no centro.
4. **Nome no vídeo**: um padrão para a mesa e, se quiser, uma exceção por pessoa. Exemplo: você como "Narrador".
5. Bots podem ser **ignorados**: somem do vídeo e da linha do tempo. O bot de música do app é ignorado sozinho.

A ligação com o Discord é feita pelo **ID** da pessoa (quando o Discord mostra a foto dela) ou pelo **nome que aparece na chamada**. Se a pessoa não tiver foto no Discord, confira se o "Nome no Discord" está igual ao da chamada.

---

## 5. Colocar o overlay no OBS

1. No app: **Overlay → Copiar** o endereço.
2. No OBS, na cena do jogo: **+** em Fontes → **Navegador**.
3. Cole em **URL**. Largura **1920**, altura **1080**.
4. Desmarque **"Desligar fonte quando não estiver visível"**.
5. Deixe essa fonte **por cima** da captura do Foundry.

Tudo o que você muda no app aparece no OBS na hora:

- **Ponto da tela**: um dos 9 pontos (cantos, meios das bordas ou centro). É dali que a fila sai.
- **Fila**: **Deitada** (lado a lado) ou **Em pé** (um embaixo do outro).
- **Começa por**: esquerda → direita ou o contrário; de cima para baixo ou de baixo para cima.
- **Mostrar**: todo mundo, ou **só quem fala** (aparece quem está falando, no ponto escolhido, um ao lado do outro se falarem juntos).
- **Com o mouse na prévia**: **arraste** para colocar os retratos exatamente onde quiser e **puxe a bolinha amarela** do canto da caixa para aumentar ou diminuir. Também dá pelos controles "Para os lados", "Para cima / para baixo" e "Tamanho". **Voltar ao ponto escolhido** desfaz o ajuste de posição.
- **Tamanho** (24 a 400 px), **espaço entre os retratos** e **distância da borda**.
- Muita gente para o espaço? Os retratos diminuem sozinhos até caber.

Os cortes horizontais (YouTube, WhatsApp) com retratos redesenhados usam essa mesma posição. Para tirar os retratos do vídeo, desmarque **Mostrar retratos no OBS**.

---

## 6. Durante a sessão

| Atalho | O que faz |
|---|---|
| **Ctrl+F9** | Começa / para a gravação |
| **F9** | Marca o momento |
| **Shift+F9** | Marca e abre uma caixinha para dar nome (Enter salva, Esc deixa sem nome) |
| **F10** | Salva o replay dos últimos minutos |

Os atalhos funcionam com o Foundry na frente. Dá para trocá-los em **Gravação e atalhos** (o app avisa se outro programa já usa a tecla). Os marcadores podem ser renomeados depois em **Sessão ao vivo**.

Cada gravação gera uma pasta em `%APPDATA%\Gravador RPG\sessoes` com a linha do tempo: quem falou, quando, e os marcadores. É ela que a fase de cortes vai usar para redesenhar os retratos no vídeo vertical.

---

## 7. Cortes e exportação

Em **Momentos e cortes** aparece cada gravação, com os marcadores.

1. Clique em **Criar corte** num marcador. O corte começa 30 s antes e vai até 15 s depois (dá para mudar em Gravação e atalhos).
2. No editor: arraste as alças amarelas, digite os tempos, ou use o vídeo: <kbd>Espaço</kbd> toca, <kbd>I</kbd> marca o início, <kbd>O</kbd> o fim, setas andam 0,1 s (com Shift, 1 s). As faixas coloridas embaixo mostram quem falou.
3. **Áudio**: "Áudio pronto" usa a faixa 1 do OBS. "Misturar" deixa você baixar a música, o Discord ou o microfone separadamente.
4. Marque os formatos e clique em **Exportar**. A fila mostra o progresso; quando terminar, **Mostrar na pasta**.

Os vídeos vão para `Vídeos\Gravador RPG` (dá para trocar). Com a sua RTX, a exportação usa a placa (NVENC) e é rápida.

### Vertical (TikTok, Reels, Shorts)

No editor de corte, **Editar vertical →**:

- A caixa amarela é o que aparece no vertical. **Arraste** para mover, puxe a **alça do canto** ou use a **rodinha** para dar zoom.
- Mexer na caixa cria um **ponto** no tempo atual (os losangos embaixo). Entre um ponto e outro a câmera anda sozinha: **desliza devagar**, **desliza rápido no fim** ou **corte seco**.
- <kbd>K</kbd> cria um ponto onde você está. **Câmeras salvas** guardam enquadramentos que você usa sempre ("Mapa inteiro", "Chat de rolagens").
- **Tela inteira com fundo desfocado** mostra o vídeo todo no meio, sem câmera.
- **Retratos no vertical**: as mesmas opções do overlay (ponto da tela, fila deitada ou em pé, começa por, todo mundo ou só quem fala, tamanho, espaço, distância da borda). Na prévia, **arraste os retratos** para mover e **puxe a bolinha amarela** para mudar o tamanho. A prévia mostra exatamente o que vai sair.
- **Som**: a prévia toca o áudio do corte (botão **🔊 Som** para desligar).

Se você gravou com o overlay desligado, marque **Desenhar retratos nos vídeos horizontais** para que os cortes de YouTube e WhatsApp também tenham os retratos.

### Momentos sugeridos

Em cada sessão, **✨ Procurar momentos** ouve a gravação (alguns minutos para uma sessão longa; pode continuar usando o app) e lista trechos que se destacam: volume alto (risadas, gritos, comemoração) e várias pessoas falando ao mesmo tempo. Cada sugestão diz o motivo e quem estava falando. **Criar corte** abre o editor; o **✕** descarta a sugestão para sempre. O resultado fica guardado — abrir de novo é na hora.

**Criar corte de todos os marcadores** faz de uma vez um corte para cada marcador que ainda não tem.

### Legendas

No painel **Legendas** (no editor de corte e no vertical):

1. **Gerar legendas**: o app separa o áudio do corte (faixa 1) e transcreve. Na primeira vez ele baixa o programa de transcrição e o modelo (**Preciso**, ~550 MB, ou **Rápido**, ~190 MB — escolha em *Transcrição*). Depois disso tudo roda no seu PC, sem internet. Cada trecho já vem com quem falou (pelo StreamKit).
2. **Corrigir**: cada trecho tem o texto (clique e escreva; <kbd>Enter</kbd> vai para o próximo), quem fala, início e fim, ▶ para ouvir e ✕ para apagar. **+ Legenda aqui** cria um trecho no ponto atual do vídeo. **Trocar uma palavra em tudo** conserta de uma vez um nome que o modelo sempre erra (ex.: "Cael" → "Kael").
3. **Posição**: na prévia (por cima do vídeo no horizontal; na prévia do vertical), **arraste a legenda** para mover — ela gruda no centro quando passa por ele —, puxe a **bolinha do canto** para aumentar ou diminuir a letra e as **barrinhas das laterais** para a largura (onde a frase quebra de linha). O horizontal e o vertical guardam posições separadas.
4. **Aparência** (vale para todos os cortes da mesa): fonte, tamanho, negrito, MAIÚSCULAS, cor do texto ou a cor de cada personagem, palavra falada destacada, contorno e sombra **ou** caixa atrás do texto (cor e opacidade), quantas palavras aparecem por vez (estilo TikTok) ou a frase inteira, e o nome de quem fala antes da fala.
5. **Mostrar neste corte** liga e desliga sem perder o texto. A exportação queima a legenda no vídeo do jeito que aparece na prévia (o *Corte rápido* não leva legenda, porque copia o vídeo original).

### Identidade visual (logo, textos e imagem final)

No menu **Overlay → Identidade visual**:

- **+ Imagem** (logo, selo, moldura — PNG com fundo transparente fica melhor) ou **+ Texto** (ex.: `discord.gg/minha-mesa`, com fonte, cores, contorno e sombra).
- Cada camada tem duas caixinhas: **Ao vivo** (aparece no overlay do OBS e, portanto, já sai na gravação) e **Nos cortes** (é desenhada nos vídeos exportados). Marque uma, a outra ou as duas.
- Na prévia, **arraste** a camada para mover (gruda no centro) e puxe a **bolinha azul** para o tamanho. Troque entre **Horizontal** e **Vertical** em cima da prévia: cada formato guarda a sua posição. ↑ e ↓ mudam qual fica na frente; também dá para mudar a opacidade.
- Nos cortes **horizontais**, as camadas "Ao vivo" não são desenhadas de novo (já estão na gravação). Se você gravou com o overlay desligado, marque **Desenhar retratos nos vídeos horizontais** no corte que elas entram também.
- **Imagem final dos cortes**: escolha uma imagem para os horizontais e outra para os verticais, quanto tempo fica na tela, o fade de entrada, se a imagem cabe inteira (sobrando a cor de fundo) ou cobre a tela. Ela entra com fade por cima do fim do corte; o som do corte some junto (a música rápida, se houver, continua).

Em cada corte, o painel **Visual e música** deixa **tirar uma camada** ou **a imagem final** só daquele corte. No editor, as camadas aparecem na prévia (dá para arrastar ali também) e a imagem final aparece no fim do corte.

### Música rápida nos cortes

No painel **Visual e música** de um corte:

1. Escolha uma música da biblioteca do bot (tela **Música**) ou clique em **+ Arquivos…** para adicionar.
2. **Começar a música em**: de que ponto da música começar (ex.: `1:05`). Se a música acabar antes do corte, ela recomeça.
3. **Volume geral**, **Fade de entrada** e **Fade de saída**.
4. **Volume no tempo**: clique na faixa para criar um ponto, arraste para mudar (para cima = mais alto), clique duas vezes para apagar. **+ Ponto no tempo atual** cria um ponto onde o vídeo está. Exemplo: dois pontos baixando a música enquanto alguém fala e dois subindo depois.
5. Com **Ouvir na prévia** marcado, a música toca junto com o vídeo no editor, já com o volume da curva.

### Fundo próprio no vertical

No editor vertical, em **Tela inteira com fundo**, escolha **Vídeo desfocado**, **Cor** ou **Imagem** (uma arte da sua campanha, por exemplo). Na prévia, **arraste o vídeo** para subir ou descer e use a **rodinha** para o tamanho (ou os controles abaixo). Vale para todos os cortes da mesa.

### Compilado

Marque a caixinha de vários cortes em **Momentos**, ponha na ordem, escolha o formato e clique em **Montar compilado**. As camadas "nos cortes" entram em todas as partes e a imagem final entra uma vez só, no fim.

---

## 8. Bot de música

Um bot **seu** no Discord entra no canal de voz e toca o que você escolher no app: músicas do PC e YouTube. Todo mundo no canal ouve, e ele é gravado junto na faixa do Discord do OBS (faixa 3).

### Criar o bot (uma vez, uns 3 minutos)

1. No app, abra **Música** e clique em **Discord Developer Portal** (ou abra <https://discord.com/developers/applications>).
2. **New Application**, dê um nome (ex.: "Bardo") e aceite os termos.
3. No menu da esquerda, **Bot** → **Reset Token** → **Copy**.
4. Cole o token no app e clique em **Salvar token**. Ele fica guardado só neste PC, cifrado pelo Windows. Nunca mande esse token para ninguém.
5. Clique em **Convidar para o servidor**, escolha o servidor da mesa e autorize (o app já pede só as permissões de **Conectar** e **Falar**). Só quem é administrador do servidor consegue convidar: se não for você, mande o link do convite para o dono.
6. Clique em **Ligar o bot**. Ele entra sozinho no canal de voz da mesa (o mesmo canal do StreamKit), ou no canal que você escolher em "Canal de voz do bot".

O bot não precisa de "Privileged Gateway Intents": pode deixar tudo desligado no Developer Portal. Ele aparece no StreamKit como qualquer pessoa, mas o app já o ignora nos retratos e na linha do tempo.

### Músicas do PC

- **Adicionar pasta**: escolha a pasta das suas trilhas. Cada subpasta vira um grupo (Chefes, Taverna, Exploração…). Ou **Adicionar músicas** para escolher arquivos soltos. Formatos: MP3, OGG, OPUS, WAV, FLAC, M4A, AAC.
- **▶** toca. Músicas trocam entre si com crossfade; **Ambiente** e **Efeito** tocam por cima, em camadas. O tipo é escolhido em cada faixa (o app adivinha pelo nome: "chuva", "taverna", "sfx"…).
- **Repetir**: a faixa começa de novo quando acaba (padrão para ambientes).
- **Fila**: marque as caixinhas e clique em **Tocar marcadas como fila** (com ou sem aleatório). Na camada que está tocando: **Anterior**, **Próxima**, a lista da fila, "No fim da faixa" (tocar uma vez, repetir a lista, repetir a faixa) e crossfade.
- **Pausar**, **Parar** (com fade) e **volume** em cada camada. **Parar tudo** para tudo.

### Seções e loop de chefe (vindo do Trilha Viva)

1. Clique em **Seções** na faixa.
2. **Modelo: música de chefe** cria Introdução, Fase 1, Transição, Fase final e Encerramento, com os cortes sugeridos pela análise da música (Fase 1 e Fase final em loop). Ou **Sugerir cortes**, ou dê **Ouvir** e clique em **+ Marcar corte aqui**.
3. Arraste as linhas amarelas na onda para ajustar. Com **Grudar no tempo da música**, o corte gruda na batida para a emenda não pular.
4. O quadradinho colorido de cada parte toca só ela em loop (só você ouve essa prévia).
5. Em "Quando acabar": **Segue para a próxima**, **Repete (loop)** ou **Para no fim**. **Salvar seções**. Se a música estiver tocando, vale na hora.

Na luta, em **Tocando agora**:

- **No fim da volta**: termina a repetição atual e entra na seção escolhida no tempo certo. **Agora**: troca na hora com crossfade.
- **⟳** em cada seção: na seção atual, liga e desliga o loop sem cortar; noutra seção, ela entra no fim da volta e fica repetindo.
- **Clique em qualquer ponto** da barra de seções para tocar dali.
- **Ao chegar no fim da seção**: repetir a seção, seguir a música, ou repetir a música inteira. **Tocar direto** ignora os loops salvos.

Seções funcionam em arquivos de até 10 minutos; arquivos maiores tocam inteiros.

### Navegador (YouTube e outros sites)

Em **Música → Navegador** (ou no menu, **Navegador**) abre um navegador com abas dentro do app:

- **Barra de endereço**: cole o link de uma música ou playlist, digite um site (`tabletopaudio.com`) ou escreva o que procura (`música de taverna`) para buscar no YouTube.
- **+** abre outra aba. Cada aba toca o próprio som, todas ao mesmo tempo (ex.: uma playlist de batalha numa aba e chuva noutra).
- **Escutar antes de tocar para a mesa**: em cada aba, **🎧 Ouvir aqui** toca a aba nas suas caixas de som/fone, e **📢 No Discord / 🔇 Fora do Discord** decide se a galera ouve. Para conferir uma música: deixe **Fora do Discord** e **Ouvir aqui** ligado; gostou, clique em **No Discord**. Em **Música → Abas novas começam** dá para escolher **Só aqui no PC (prévia)** para toda aba nova já abrir assim.
- O controle de volume ao lado vale para o que vai para o Discord.
- **Botão direito num vídeo ou link**: abrir em nova aba, abrir em nova aba **só para mim (prévia)**, abrir em nova aba **no Discord**, abrir em segundo plano ou copiar o endereço. Com texto selecionado: procurar no YouTube em nova aba. **Ctrl+clique** ou **botão do meio** num link abre em segundo plano; **botão do meio numa aba** fecha a aba.
- **☆** favorita a página; os favoritos ficam na faixa embaixo da barra (YouTube, YouTube Music, Tabletop Audio e SoundCloud já vêm lá).
- Trocar de tela não para o som. Na tela **Música** aparecem todas as abas que estão tocando, com volume e mudo, para mexer sem abrir o navegador.
- Atalhos com a barra em foco: **Ctrl+T** nova aba, **Ctrl+W** fecha, **Ctrl+L** vai para o endereço.
- Entre na sua conta do YouTube uma vez (fica salva; sem conta também funciona, com anúncios). As abas abertas voltam na próxima vez que você abrir o navegador. Nada é baixado: o som da página só é desviado para o bot.

Sites com proteção de cópia (Spotify, Netflix) não tocam dentro do app.

### Ouvir no PC

Você ouve o bot pelo próprio Discord, como qualquer pessoa no canal. Por isso **Ouvir aqui no PC também** vem desligado (senão você ouve duas vezes). Ligue só se estiver testando fora do canal.

---

## 9. Módulo do Foundry (opcional, só o mestre)

1. Copie a pasta `modulo-foundry\gravador-rpg-marcadores` para `Data\modules` do Foundry. Na Forge, suba o arquivo `modulo-foundry\gravador-rpg-marcadores.zip` como seus outros módulos.
2. Ative **Gravador RPG — Marcadores** no mundo.
3. Em **Configurações do módulo**, cole a **Chave** e a **Porta** que aparecem no app em **Conexões → Foundry**.
4. Ao entrar no mundo aparece "Gravador RPG conectado".

Marca sozinho: início e fim de combate, crítico e falha crítica no d20, troca de cena (e cada rodada, se ligar). Também dá para atribuir uma tecla em **Configurar controles** para "Marcar momento" com nome.

Como jogador em outra mesa você não precisa do módulo: os atalhos do app funcionam igual.

---

## 10. Limpeza das gravações

- O app guarda **no máximo** as horas e os GB que você definir (o que vier primeiro) e tira os pedaços mais antigos.
- **Nunca** apaga: o pedaço que está gravando, pedaços perto de um marcador, ou qualquer vídeo que o OBS não tenha gravado com o app aberto.
- Por padrão manda para a **Lixeira** (lembre de esvaziá-la). Dá para trocar para **apagar de vez**.
- **Ver o que sairia agora** mostra a lista antes de qualquer coisa ser tirada.

---

## Atualizações

O app procura versão nova sozinho (ao abrir e a cada 6 horas) no GitHub do projeto. Quando tiver, aparece o botão **Atualizar para X** embaixo do menu, e em **Gravação e atalhos → Atualizações** aparece o que mudou. Ao clicar, o app fecha, uma janelinha preta copia os arquivos novos e o app abre de novo (na primeira vez depois de uma versão nova ele pode instalar alguma biblioteca, leva um minuto). Configurações, mesas, músicas e gravações não mudam. Durante uma gravação o botão espera você terminar.

## 11. Problemas comuns

**A transcrição não baixa** — confira a internet e o antivírus (ele às vezes apaga o `whisper-cli.exe`). Os arquivos ficam em `%APPDATA%\Gravador RPG\whisper`; dá para apagar a pasta e tentar de novo.

**A transcrição está lenta** — ela roda no processador. Use o modelo **Rápido** em *Transcrição*, ou transcreva cortes menores.

| Sintoma | O que fazer |
|---|---|
| OBS desconectado | OBS aberto? WebSocket ativado? Senha certa? Porta 4455? |
| "Discord sem leitura" | Discord aberto? Clique em **Recarregar leitura**. Se pedir autorização, refaça o passo 3 do StreamKit |
| Canal vazio, mas tem gente | Você está no canal certo? O link do StreamKit é do canal da mesa? |
| Retrato não acende para alguém | Em **Mesa**, veja o status do cartão. Confira o nome no Discord ou peça o ID (Discord → Configurações → Avançado → Modo desenvolvedor; botão direito na pessoa → Copiar ID) |
| Mudo o overlay no app e o OBS não muda (ou fica no jeito antigo) | Desde a 0.3.3 o overlay se recarrega sozinho depois de atualizar o app. Se acontecer: no OBS, botão direito na fonte → **Propriedades** → **Atualizar cache da página atual** |
| Overlay não aparece no OBS | Fonte Navegador com o endereço do app, por cima do Foundry, 1920×1080. O app mostra "O OBS está mostrando o overlay" quando está certo |
| Atalho "usado por outro programa" | Troque a tecla em **Gravação e atalhos** |
| Marcador não vai para dentro do arquivo | Precisa do OBS 30.2 ou mais novo e formato **MP4 Híbrido**. O marcador fica salvo no app mesmo assim |
| "FFmpeg não encontrado" | Rode o **INSTALAR.bat** de novo. Ou instale o FFmpeg (`winget install ffmpeg`) e clique em **Procurar de novo** em Gravação e atalhos |
| Exportação usa o processador, não a placa | Atualize o driver da NVIDIA. Se continuar, instale o FFmpeg pelo winget (versão mais nova) e aponte para ele |
| A prévia do vídeo não toca | Alguns formatos não abrem na prévia. A exportação funciona do mesmo jeito |
| Foundry: "App não encontrado" | O app está aberto? A porta no módulo é a mesma do app? Na Forge, use o Chrome ou o Edge |
| Bot: "Bibliotecas do bot não instaladas" | Rode o **INSTALAR.bat** com internet. Em **Música**, "Ver detalhes técnicos" mostra o que falta |
| Bot: "Token inválido" | Gere outro em Developer Portal → Bot → **Reset Token** e cole em **Trocar token** |
| Bot liga mas "não está em nenhum servidor" | Use **Convidar para o servidor** (precisa ser admin do servidor) |
| Bot não entra no canal | O cargo do bot precisa de **Conectar** e **Falar** naquele canal (configurações do canal → Permissões) |
| Bot no canal, mas sem som | Tem algo tocando em **Tocando agora**? Volume do bot e da camada acima de zero? O bot só "fala" quando há som |
| YouTube: o login do Google recusa | Tente de novo pela página de login do YouTube. Se insistir, use sem conta (funciona igual, com anúncios) |
| Som do bot com chiado ou picotando | Na 0.3.1 a captura e a mistura foram refeitas para isso. Se continuar: confira a internet (o bot manda o som pela sua conexão), feche abas tocando sem necessidade e veja a "Taxa de bits" do canal de voz no Discord (padrão 64 kbps; o bot usa a taxa do canal) |
| Fechei no X e o app continua aberto | É de propósito: ele fica na bandeja, perto do relógio. Botão direito no ícone → **Sair**. Dá para desligar em **Gravação e atalhos** |
| ABRIR.bat não abre nada | O app já está aberto na bandeja (perto do relógio): clique no ícone. Se for a versão antiga presa, finalize "Electron" no Gerenciador de Tarefas |
| Música com "Arquivo não encontrado" | O arquivo foi movido ou apagado. Tire da biblioteca e adicione do lugar novo |
| Depois de atualizar, algo estranho na configuração | A configuração antiga está em `%APPDATA%\Gravador RPG\config.antes-da-v….json` |

---

## Para quem for mexer no código

- `src/core`: lógica pura (configuração, nomes, StreamKit, linha do tempo, limpeza, OBS, servidor do overlay).
- `src/main`: Electron (janelas, atalhos, StreamKit escondido) e o controlador que junta tudo.
- `src/ui`: interface. `src/overlay`: página que o OBS mostra.
- `src/core/cortes.js`, `camera.js`, `exportador.js`: montagem dos comandos do FFmpeg (câmera pelo filtro `perspective`).
- `src/core/musica`: mixer PCM (48 kHz estéreo, corrige a diferença de relógio entre placa de som e Discord), biblioteca de faixas, bot (discord.js + @discordjs/voice, carregados só quando liga), análise e tempos do Trilha Viva.
- `src/musica`: motor de áudio (página escondida servida pelo servidor local): o Trilha Viva adaptado, sem o Foundry. O som sai por um processador do Web Audio para o mixer, como no Kenku FM.
- `src/main/musica.js`: controlador da música e das abas (sem Electron, testável). `src/main/navegador.js`: abas (WebContentsView) dentro da janela. `src/main/navegador-preload.js`: desvia o som da página para o bot (AudioWorklet).
- `modulo-foundry`: o módulo do Foundry.
- `npm test` (ou **TESTAR.bat**): testes automáticos, incluindo exportações de verdade quando o FFmpeg está instalado.
- `test/navegador/*.py`: testes da interface, do overlay, dos cortes, do motor de áudio e da tela de Música num navegador real (precisam de Python e Playwright). O Discord é simulado (`test/discord-falso.js`).
