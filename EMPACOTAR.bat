@echo off
chcp 65001 >nul
title Gravador RPG - criar programa
cd /d "%~dp0"
if not exist "node_modules\electron" call INSTALAR.bat
echo.
echo  Criando o programa (Gravador RPG.exe). Leva alguns minutos...
echo.
call npm run empacotar
if errorlevel 1 (
  echo  Deu erro ao criar o programa.
  pause
  exit /b 1
)
echo.
echo  Pronto! O programa esta em:
echo    dist\Gravador RPG-win32-x64\Gravador RPG.exe
echo  Clique com o botao direito nele e escolha "Mostrar mais opcoes" ^> "Enviar para" ^> "Area de trabalho (criar atalho)".
echo.
explorer "dist\Gravador RPG-win32-x64"
pause
