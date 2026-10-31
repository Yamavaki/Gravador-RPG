@echo off
cd /d "%~dp0"
rem primeira vez ou versao nova (atualizacao): instala o que falta. As configuracoes nao sao tocadas.
if not exist "node_modules\.instalado-0.6.1" (
  call INSTALAR.bat auto
)
if not exist "node_modules\electron\dist\electron.exe" exit /b 1
start "" "node_modules\electron\dist\electron.exe" .
