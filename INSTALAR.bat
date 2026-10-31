@echo off
chcp 65001 >nul
title Gravador RPG - instalar
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  O Node.js nao esta instalado neste PC.
  echo  Vou abrir o site: baixe a versao "LTS", instale com tudo padrao
  echo  e depois rode este INSTALAR.bat de novo.
  echo.
  start "" https://nodejs.org/
  pause
  exit /b 1
)
echo.
echo  Instalando o Gravador RPG. Leva de 1 a 3 minutos na primeira vez...
echo.
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo  Deu erro na instalacao. Confira a internet e rode de novo.
  pause
  exit /b 1
)
rem marca a versao instalada (o ABRIR.bat reinstala sozinho depois de uma atualizacao)
del /q "node_modules\.instalado-*" >nul 2>nul
echo ok> "node_modules\.instalado-0.6.1"
if not exist "node_modules\@discordjs\voice\package.json" (
  echo.
  echo  Aviso: as bibliotecas do bot de musica nao instalaram.
  echo  O resto do app funciona. Para o bot, confira a internet e rode este INSTALAR.bat de novo.
)
echo.
echo  Suas configuracoes, mesas, jogadores e musicas ficam guardadas a parte
echo  e continuam iguais depois de atualizar.
echo.
rem chamado pelo ABRIR.bat (primeira vez ou atualizacao): segue direto para abrir o app
if /i "%~1"=="auto" exit /b 0
echo  Pronto! Para abrir o app, use o ABRIR.bat
echo  (ou rode o EMPACOTAR.bat para criar um programa .exe com atalho).
echo.
pause
