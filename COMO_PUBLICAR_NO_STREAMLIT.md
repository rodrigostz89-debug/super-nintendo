# 🌐 Como Publicar sua Central Super Nintendo no Streamlit Cloud

O projeto já está **100% configurado** dentro da pasta `C:\Users\CASA\Desktop\jogos` com:
- `app.py` (Site completo em Streamlit com player de Super Nintendo no navegador + todos os 745 jogos)
- `requirements.txt` (Dependências para o servidor da nuvem)
- `.streamlit/config.toml` (Tema escuro gamer configurado)
- `.gitignore` (Já configurado para ignorar os arquivos `.exe` locais do Windows e subir apenas o necessário para a nuvem)

---

## Passo 1 — Testar no seu PC agora (Sem gastar internet)
1. Abra a pasta `C:\Users\CASA\Desktop\jogos`
2. Dê **2 cliques** em **`Abrir Site Streamlit (Local).bat`**
3. O site abrirá no seu navegador em `http://localhost:8501`!

---

## Passo 2 — Subir para o GitHub (Quando estiver no Wi-Fi ilimitado)
1. Crie uma conta gratuita em [https://github.com](https://github.com) (caso ainda não tenha).
2. Clique em **New Repository** (Novo Repositório):
   - Nome sugerido: `super-nintendo-central`
   - Visibilidade: marque **🔒 Private (Privado)** *(muito importante para evitar bloqueio de direitos autorais)*
   - Clique em **Create repository**.
3. Abra o terminal (PowerShell) dentro da pasta `C:\Users\CASA\Desktop\jogos` (ou peça aqui para o Antigravity fazer por você quando estiver no Wi-Fi!) e rode:
   ```powershell
   cd "C:\Users\CASA\Desktop\jogos"
   git init
   git branch -M main
   git add .
   git commit -m "Central Super Nintendo Streamlit"
   git remote add origin https://github.com/SEU_USUARIO/super-nintendo-central.git
   git push -u origin main
   ```

---

## Passo 3 — Ativar o site grátis no Streamlit Cloud
1. Acesse [https://share.streamlit.io](https://share.streamlit.io) e entre com a sua conta do **GitHub**.
2. Clique no botão **Create app** (canto superior direito).
3. Preencha:
   - **Repository:** `SEU_USUARIO/super-nintendo-central`
   - **Branch:** `main`
   - **Main file path:** `app.py`
   - **App URL (domínio personalizado gratuito):** escolha o nome que quiser, por exemplo `meus-jogos-snes.streamlit.app`
4. *(Opcional)* Se quiser colocar **senha de acesso** no site:
   - Clique em **Advanced settings...** → **Secrets** e digite:
     ```toml
     SENHA = "sua_senha_aqui"
     ```
5. Clique em **Deploy!** — em cerca de 2 minutos seu site estará no ar funcionando em qualquer computador ou celular!
