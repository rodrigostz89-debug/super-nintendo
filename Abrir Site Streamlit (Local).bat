@echo off
chcp 65001 >nul
title Super Nintendo — Servidor Local Streamlit
cd /d "%~dp0"
echo =========================================================
echo   Iniciando o Site Super Nintendo no Streamlit (Local)...
echo   O navegador abrirá automaticamente em alguns segundos!
echo   (Para encerrar o servidor, basta fechar esta janela)
echo =========================================================
python -m streamlit run app.py --server.port 8501
pause
