@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
    echo Instale o Node.js antes de iniciar o medidor.
    pause
    exit /b 1
)
if not exist "node_modules\express\package.json" (
    echo Instale as dependencias com npm ci nesta pasta e tente novamente.
    pause
    exit /b 1
)
echo Iniciando o servidor do medidor...
echo Quando aparecer "Servidor rodando na porta", abra http://localhost:3000
echo Se voce configurou outra PORT no .env, use essa porta no endereco.
echo Mantenha esta janela aberta enquanto usar o painel. Para encerrar, pressione Ctrl+C.
node server.js
pause
