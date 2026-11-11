import os
import json
import base64
import random
import subprocess
import streamlit as st
import streamlit.components.v1 as components

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
SYS_DIR = os.path.join(ROOT_DIR, "Sistema")
ROMS_DIR = os.path.join(ROOT_DIR, "Roms")
EMU_DIR = os.path.join(ROOT_DIR, "Emulador")
ICON_PATH = os.path.join(SYS_DIR, "snes.png")

st.set_page_config(
    page_title="Super Nintendo — Central Online (PC & Celular)",
    page_icon=ICON_PATH if os.path.exists(ICON_PATH) else "🎮",
    layout="wide",
    initial_sidebar_state="expanded",
)

# Custom Console-Grade Dark Styling (Responsive for PC + Mobile Smartphones)
st.markdown(
    """
    <style>
    .block-container {
        padding-top: 1.2rem !important;
        padding-bottom: 2.5rem !important;
        max-width: 1480px !important;
    }
    div[data-testid="stVerticalBlockBorderWrapper"] {
        background: #181529;
        border: 1px solid #2D294A !important;
        border-radius: 12px !important;
        transition: transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
    }
    div[data-testid="stVerticalBlockBorderWrapper"]:hover {
        border-color: #9775FA !important;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
    }
    .game-title {
        font-weight: 700;
        font-size: 0.94rem;
        color: #F3F4F8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin: 4px 0 2px 0;
    }
    .game-meta {
        font-size: 0.76rem;
        color: #9A98B5;
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
    }
    .cover-box {
        width: 100%;
        height: 155px;
        background: #0F0D1B;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
    }
    .cover-box img {
        max-width: 96%;
        max-height: 95%;
        object-fit: contain;
        border-radius: 4px;
    }
    .snes-header {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
        background: linear-gradient(135deg, #19162D 0%, #121020 100%);
        border: 1px solid #2D294A;
        border-radius: 14px;
        padding: 15px 20px;
        margin-bottom: 16px;
    }
    .snes-dots span {
        display: inline-block;
        width: 9px;
        height: 9px;
        border-radius: 50%;
        margin-left: 4px;
    }
    @media (max-width: 768px) {
        .block-container {
            padding-left: 0.7rem !important;
            padding-right: 0.7rem !important;
        }
        .snes-header h2 {
            font-size: 1.15rem !important;
        }
        .cover-box {
            height: 135px;
        }
    }
    </style>
    """,
    unsafe_allow_html=True,
)


@st.cache_data
def load_games():
    games_file = os.path.join(SYS_DIR, "games.json")
    if not os.path.exists(games_file):
        return []
    with open(games_file, "r", encoding="utf-8") as f:
        return json.load(f)


@st.cache_data(max_entries=120)
def get_cover_b64(rel_cover_path):
    full_path = os.path.join(ROOT_DIR, rel_cover_path.replace("/", os.sep))
    if not os.path.exists(full_path):
        return ""
    with open(full_path, "rb") as f:
        return base64.b64encode(f.read()).decode("ascii")


def render_browser_emulator(game):
    rom_path = os.path.join(ROMS_DIR, game["file"])
    if not os.path.exists(rom_path):
        st.error(f"Arquivo da ROM não encontrado: `{game['file']}`")
        return

    with open(rom_path, "rb") as f:
        rom_bytes = f.read()
    rom_b64 = base64.b64encode(rom_bytes).decode("ascii")
    safe_title = game["title"].replace('"', '\\"')

    player_html = f"""
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
      <style>
        html, body {{
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          background: #090810;
          overflow: hidden;
          font-family: "Segoe UI", system-ui, sans-serif;
          touch-action: none !important;
          user-select: none !important;
          -webkit-user-select: none !important;
          -webkit-touch-callout: none !important;
        }}
        #ejs-player,
        .ejs_virtualGamepad_parent,
        .ejs_virtualGamepad_left,
        .ejs_virtualGamepad_right,
        .ejs_virtualGamepad_top,
        .ejs_virtualGamepad_bottom,
        .ejs_virtualGamepad_button,
        .ejs_dpad_main {{
          touch-action: none !important;
          user-select: none !important;
          -webkit-user-select: none !important;
          -webkit-touch-callout: none !important;
        }}
        .player-bar {{
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          background: #151226;
          border: 1px solid #3D2E75;
          border-bottom: none;
          border-radius: 12px 12px 0 0;
          padding: 8px 14px;
          color: #EAE9F5;
          font-size: 13px;
        }}
        .bar-btns {{
          display: flex;
          gap: 8px;
          align-items: center;
        }}
        .fs-btn {{
          background: linear-gradient(135deg, #7950F2, #5F3DC4);
          color: #fff;
          border: 1px solid #9775FA;
          border-radius: 8px;
          padding: 6px 12px;
          font-weight: 700;
          font-size: 12px;
          cursor: pointer;
        }}
        .fs-btn:hover {{
          background: #845EF7;
        }}
        #game-container {{
          width: 100%;
          height: 530px;
          border-radius: 0 0 12px 12px;
          overflow: hidden;
          border: 1px solid #3D2E75;
          box-sizing: border-box;
          background: #000;
        }}
        #ejs-player {{
          width: 100%;
          height: 100%;
        }}
        .ejs_virtualGamepad_button.b_yb {{
          left: -14px !important;
          top: 86px !important;
          width: 46px !important;
          height: 46px !important;
          line-height: 44px !important;
          font-size: 14px !important;
          font-weight: 800 !important;
          background: rgba(245, 196, 28, 0.28) !important;
          border: 2px solid #f5c41c !important;
          color: #fff !important;
          box-shadow: 0 0 10px rgba(245, 196, 28, 0.35);
          z-index: 25;
        }}
        .ejs_virtualGamepad_button.b_lock_y {{
          left: -14px !important;
          top: -6px !important;
          width: 46px !important;
          height: 32px !important;
          line-height: 30px !important;
          font-size: 12px !important;
          font-weight: 800 !important;
          border-radius: 10px !important;
          background: rgba(121, 80, 242, 0.3) !important;
          border: 1.5px solid #9775fa !important;
          color: #fff !important;
          z-index: 25;
        }}
        .ejs_virtualGamepad_button.b_lock_y.locked {{
          background: rgba(32, 192, 92, 0.85) !important;
          border-color: #51cf66 !important;
          box-shadow: 0 0 12px rgba(32, 192, 92, 0.8);
        }}
        .ejs_virtualGamepad_button_down {{
          background-color: rgba(121, 80, 242, 0.78) !important;
          border-color: #fff !important;
          transform: scale(0.94);
        }}
      </style>
    </head>
    <body>
      <div class="player-bar">
        <span>📱 <b>Correr + Pular (Y+B):</b> deslize o polegar do Y para o B, use o botão <b>Y+B</b> ou ative <b>🔒 Segurar Y</b>!</span>
        <div class="bar-btns">
          <button class="fs-btn" id="topLockYBtn" onclick="window.toggleLockY && window.toggleLockY()">🔒 Segurar Y: OFF</button>
          <button class="fs-btn" onclick="goFullscreen()">⛶ Tela Cheia</button>
        </div>
      </div>
      <div id="game-container">
        <div id="ejs-player"></div>
      </div>
      <script>
        function goFullscreen() {{
          const el = document.getElementById("game-container");
          if (el.requestFullscreen) el.requestFullscreen();
          else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
          else if (el.msRequestFullscreen) el.msRequestFullscreen();
        }}

        (function() {{
          const b64 = "{rom_b64}";
          const bin = atob(b64);
          const len = bin.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {{
            bytes[i] = bin.charCodeAt(i);
          }}
          const blob = new Blob([bytes], {{ type: "application/octet-stream" }});
          const blobUrl = URL.createObjectURL(blob);

          window.EJS_player = "#ejs-player";
          window.EJS_core = "snes";
          window.EJS_gameName = "{safe_title}";
          window.EJS_gameUrl = blobUrl;
          window.EJS_pathtodata = "https://cdn.emulatorjs.org/stable/data/";
          window.EJS_startOnLoaded = true;
          window.EJS_color = "#7950F2";
          window.EJS_backgroundColor = "#090810";
          window.EJS_defaultOptions = {{
            "save-state-location": "browser"
          }};

          const touchBtns = new Set();
          const keyBtns = new Set();
          const heldCodes = new Set();
          const touchOrigins = new Map();
          const prevManaged = new Map();
          const externalHeld = new Set();
          let lockY = false;
          let rawSim = null;

          const CODE_MAP = {{
            ArrowUp: [4], ArrowDown: [5], ArrowLeft: [6], ArrowRight: [7],
            KeyS: [1], KeyY: [1], KeyJ: [1], ShiftLeft: [1], ShiftRight: [1], Numpad4: [1], Numpad1: [1],
            KeyX: [0], KeyB: [0], KeyK: [0], Space: [0], Numpad2: [0], Numpad0: [0],
            KeyZ: [8], KeyL: [8], Numpad6: [8], Numpad3: [8],
            KeyA: [9], KeyI: [9], Numpad8: [9], Numpad5: [9],
            KeyQ: [10], KeyU: [10], Numpad7: [10],
            KeyE: [11], KeyW: [11], KeyO: [11], Numpad9: [11],
            KeyC: [1, 0],
            Enter: [3], NumpadEnter: [3],
            KeyV: [2], Backspace: [2]
          }};

          function isHeld(btnId) {{
            return touchBtns.has(btnId) || keyBtns.has(btnId) || (btnId === 1 && lockY);
          }}

          function ensureHooked() {{
            const emu = window.EJS_emulator;
            if (!emu || !emu.gameManager) return null;
            const gm = emu.gameManager;
            if (!gm._multiWrapped && typeof gm.simulateInput === "function") {{
              rawSim = gm.simulateInput.bind(gm);
              gm.simulateInput = function(player, btnId, val) {{
                if (player === 0) {{
                  if (val === 0 && isHeld(btnId)) {{
                    rawSim(0, btnId, 1);
                    return;
                  }}
                  if (val > 0) externalHeld.add(btnId);
                  else externalHeld.delete(btnId);
                }}
                rawSim(player, btnId, val);
                if (player === 0 && val > 0) {{
                  for (let b = 0; b <= 11; b++) {{
                    if (b !== btnId && (isHeld(b) || externalHeld.has(b))) {{
                      rawSim(0, b, 1);
                    }}
                  }}
                }}
              }};
              gm._multiWrapped = true;
            }}
            return rawSim;
          }}

          function syncAllInputs() {{
            const sim = ensureHooked();
            if (!sim) return;
            for (let b = 0; b <= 11; b++) {{
              const nowActive = isHeld(b);
              const wasActive = prevManaged.get(b) || false;
              if (nowActive) {{
                sim(0, b, 1);
                prevManaged.set(b, true);
              }} else if (wasActive) {{
                sim(0, b, 0);
                prevManaged.set(b, false);
              }}
            }}
            updateGamepadVisuals();
          }}

          function updateGamepadVisuals() {{
            const topBtn = document.getElementById("topLockYBtn");
            if (topBtn) {{
              topBtn.textContent = lockY ? "🔒 Segurar Y: ON" : "🔒 Segurar Y: OFF";
              topBtn.style.background = lockY ? "#20c05c" : "";
            }}
            const rightPad = document.querySelector(".ejs_virtualGamepad_right");
            if (!rightPad) return;
            const map = [[".b_y", 1], [".b_b", 0], [".b_a", 8], [".b_x", 9]];
            for (const [sel, id] of map) {{
              const el = rightPad.querySelector(sel);
              if (el) el.classList.toggle("ejs_virtualGamepad_button_down", isHeld(id));
            }}
            const ybEl = rightPad.querySelector(".b_yb");
            if (ybEl) ybEl.classList.toggle("ejs_virtualGamepad_button_down", touchBtns.has(1) && touchBtns.has(0));
            const lockEl = rightPad.querySelector(".b_lock_y");
            if (lockEl) {{
              lockEl.classList.toggle("locked", lockY);
              lockEl.textContent = lockY ? "🔒Y ON" : "🔒Y";
            }}
          }}

          window.toggleLockY = function(forceState) {{
            lockY = typeof forceState === "boolean" ? forceState : !lockY;
            syncAllInputs();
            return lockY;
          }};

          function enhanceVirtualGamepad() {{
            ensureHooked();
            const rightPad = document.querySelector(".ejs_virtualGamepad_right");
            if (!rightPad || rightPad.dataset.multiEnhanced === "1") return;
            rightPad.dataset.multiEnhanced = "1";

            const ybBtn = document.createElement("div");
            ybBtn.className = "ejs_virtualGamepad_button b_yb";
            ybBtn.textContent = "Y+B";
            rightPad.appendChild(ybBtn);

            const lockBtn = document.createElement("div");
            lockBtn.className = "ejs_virtualGamepad_button b_lock_y";
            lockBtn.textContent = "🔒Y";
            rightPad.appendChild(lockBtn);
          }}

          setInterval(enhanceVirtualGamepad, 350);

          function getButtonCenters() {{
            const rightPad = document.querySelector(".ejs_virtualGamepad_right");
            if (!rightPad || rightPad.offsetParent === null) return null;
            const specs = [
              {{ sel: ".b_y", ids: [1], r: 38 }},
              {{ sel: ".b_b", ids: [0], r: 38 }},
              {{ sel: ".b_a", ids: [8], r: 38 }},
              {{ sel: ".b_x", ids: [9], r: 38 }},
              {{ sel: ".b_yb", ids: [1, 0], r: 35 }}
            ];
            const list = [];
            for (const s of specs) {{
              const el = rightPad.querySelector(s.sel);
              if (!el) continue;
              const rect = el.getBoundingClientRect();
              if (rect.width === 0) continue;
              list.push({{
                ids: s.ids,
                cx: rect.left + rect.width / 2,
                cy: rect.top + rect.height / 2,
                r: s.r
              }});
            }}
            return list.length ? list : null;
          }}

          function handleActionTouch(e) {{
            const rightPad = document.querySelector(".ejs_virtualGamepad_right");
            if (!rightPad || rightPad.offsetParent === null) return;

            if (e.type === "touchstart") {{
              for (let i = 0; i < e.changedTouches.length; i++) {{
                const t = e.changedTouches[i];
                const lockEl = rightPad.querySelector(".b_lock_y");
                if (lockEl) {{
                  const lr = lockEl.getBoundingClientRect();
                  if (t.clientX >= lr.left - 8 && t.clientX <= lr.right + 8 && t.clientY >= lr.top - 8 && t.clientY <= lr.bottom + 8) {{
                    window.toggleLockY();
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return;
                  }}
                }}
              }}
            }}

            const centers = getButtonCenters();
            if (!centers) return;

            let intercepted = false;

            if (e.type === "touchstart") {{
              for (let i = 0; i < e.changedTouches.length; i++) {{
                const t = e.changedTouches[i];
                const hitOrigin = new Set();
                for (const c of centers) {{
                  if (Math.hypot(t.clientX - c.cx, t.clientY - c.cy) <= c.r + 6) {{
                    c.ids.forEach(id => hitOrigin.add(id));
                  }}
                }}
                if (hitOrigin.size > 0) {{
                  touchOrigins.set(t.identifier, hitOrigin);
                  intercepted = true;
                }}
              }}
            }}

            const activeIds = new Set();
            for (let i = 0; i < e.touches.length; i++) {{
              activeIds.add(e.touches[i].identifier);
              if (touchOrigins.has(e.touches[i].identifier)) intercepted = true;
            }}
            for (const oldId of Array.from(touchOrigins.keys())) {{
              if (!activeIds.has(oldId)) {{
                touchOrigins.delete(oldId);
                intercepted = true;
              }}
            }}

            if (!intercepted && touchBtns.size === 0) return;

            touchBtns.clear();
            for (let i = 0; i < e.touches.length; i++) {{
              const t = e.touches[i];
              const originSet = touchOrigins.get(t.identifier);
              if (!originSet) continue;

              for (const c of centers) {{
                const dist = Math.hypot(t.clientX - c.cx, t.clientY - c.cy);
                if (dist <= c.r) {{
                  c.ids.forEach(id => touchBtns.add(id));
                }}
              }}

              for (const origId of originSet) {{
                const origCenter = centers.find(c => c.ids.length === 1 && c.ids[0] === origId);
                if (origCenter) {{
                  const distFromOrigin = Math.hypot(t.clientX - origCenter.cx, t.clientY - origCenter.cy);
                  if (distFromOrigin <= 85) {{
                    touchBtns.add(origId);
                  }}
                }}
              }}
            }}

            syncAllInputs();
            if (intercepted) {{
              e.preventDefault();
              e.stopImmediatePropagation();
            }}
          }}

          document.addEventListener("touchstart", handleActionTouch, {{ passive: false, capture: true }});
          document.addEventListener("touchmove", handleActionTouch, {{ passive: false, capture: true }});
          document.addEventListener("touchend", handleActionTouch, {{ passive: false, capture: true }});
          document.addEventListener("touchcancel", handleActionTouch, {{ passive: false, capture: true }});

          function rebuildKeyBtns() {{
            keyBtns.clear();
            for (const code of heldCodes) {{
              const mapped = CODE_MAP[code];
              if (mapped) {{
                for (const b of mapped) keyBtns.add(b);
              }}
            }}
            syncAllInputs();
          }}

          function onKeyEvent(e) {{
            const emu = window.EJS_emulator;
            if (emu && emu.controlPopup && emu.controlPopup.parentElement && emu.controlPopup.parentElement.parentElement && !emu.controlPopup.parentElement.parentElement.hasAttribute("hidden")) {{
              return;
            }}
            const mapped = CODE_MAP[e.code];
            if (!mapped) return;

            if (e.type === "keydown") {{
              if (!e.repeat) {{
                heldCodes.add(e.code);
                rebuildKeyBtns();
              }}
            }} else if (e.type === "keyup") {{
              heldCodes.delete(e.code);
              rebuildKeyBtns();
            }}
            e.preventDefault();
            e.stopImmediatePropagation();
          }}

          window.addEventListener("keydown", onKeyEvent, true);
          window.addEventListener("keyup", onKeyEvent, true);
          window.addEventListener("blur", () => {{
            heldCodes.clear();
            rebuildKeyBtns();
          }});

          const script = document.createElement("script");
          script.src = "https://cdn.emulatorjs.org/stable/data/loader.js";
          document.body.appendChild(script);
        }})();
      </script>
    </body>
    </html>
    """
    components.html(player_html, height=585)


def is_local_windows_emu_available():
    emu_exe = os.path.join(EMU_DIR, "asnes9x-x64.exe")
    return os.name == "nt" and os.path.exists(emu_exe)


def launch_local_pc_emu(game):
    emu_exe = os.path.join(EMU_DIR, "asnes9x-x64.exe")
    rom_path = os.path.join(ROMS_DIR, game["file"])
    if os.path.exists(emu_exe) and os.path.exists(rom_path):
        subprocess.Popen([emu_exe, "-fullscreen", rom_path], cwd=EMU_DIR)
        st.toast(f"▶ Iniciando {game['title']} no Snes9x do PC!")


def check_optional_password():
    try:
        secret_pwd = st.secrets.get("SENHA", "")
    except Exception:
        secret_pwd = ""
    if not secret_pwd:
        return True
    if st.session_state.get("auth_ok"):
        return True

    st.markdown("### 🔒 Acesso Privado — Central Super Nintendo")
    pwd = st.text_input("Digite a senha de acesso:", type="password")
    if st.button("Entrar", type="primary"):
        if pwd == secret_pwd:
            st.session_state["auth_ok"] = True
            st.rerun()
        else:
            st.error("Senha incorreta.")
    return False


def main():
    if not check_optional_password():
        return

    all_games = load_games()
    if "active_game" not in st.session_state:
        st.session_state["active_game"] = None
    if "favorites" not in st.session_state:
        st.session_state["favorites"] = set()
    if "page" not in st.session_state:
        st.session_state["page"] = 1

    # Sidebar Navigation & Filters
    with st.sidebar:
        if os.path.exists(ICON_PATH):
            st.image(ICON_PATH, width=68)
        st.markdown("## 🎮 Super Nintendo")
        st.caption(f"Catálogo completo com **{len(all_games)} jogos** (PC & Celular).")

        search_q = st.text_input("🔍 Pesquisar jogo", placeholder="Ex: Mario, Top Gear, Zelda...")

        categories = [
            "🎮 Todos os Jogos",
            "⭐ Favoritos",
            "⚔️ Ação & Aventura",
            "🛡️ RPG",
            "🥊 Luta",
            "🏎️ Corrida",
            "⚽ Esportes",
            "🚀 Nave & Tiro",
            "🧩 Estratégia & Puzzle",
            "🕹️ Clássicos",
        ]
        selected_cat = st.selectbox("📂 Categoria", categories)

        letters = ["Todos"] + [chr(c) for c in range(ord("A"), ord("Z") + 1)] + ["#"]
        selected_letter = st.selectbox("🔤 Filtrar por Letra", letters)

        per_page = st.select_slider("🖼️ Jogos por página", options=[20, 40, 60, 100], value=40)

        st.divider()
        if st.button("🎲 Sortear Jogo Surpresa", use_container_width=True, type="primary"):
            if all_games:
                chosen = random.choice(all_games)
                st.session_state["active_game"] = chosen
                st.rerun()

        st.markdown(
            """
            ---
            **📱 Como jogar no Celular:**
            - Ao abrir qualquer jogo no celular, o **controle touch (Direcional + A, B, X, Y, L, R, Start, Select)** aparece automaticamente na tela!
            - Toque em **⛶ Tela Cheia** e gire o celular deitado.

            **⌨️ Controles no PC:**
            - **Setas**: Direcional
            - **Z / X / A / S**: Botões B, A, Y, X
            - **Enter**: Start | **Shift**: Select
            - Aceita **Controle USB / Bluetooth**!
            """
        )

    # Top Header Banner
    st.markdown(
        f"""
        <div class="snes-header">
          <div>
            <h2 style="margin:0;font-size:1.42rem;letter-spacing:0.6px;">
              SUPER NINTENDO — PC & CELULAR
              <span class="snes-dots">
                <span style="background:#2A6CEB"></span>
                <span style="background:#20C05C"></span>
                <span style="background:#F5C41C"></span>
                <span style="background:#E03131"></span>
              </span>
            </h2>
            <div style="color:#9A98B5;font-size:0.86rem;margin-top:3px;">
              Toque em <b>▶ Jogar</b> em qualquer capa para jogar direto no navegador do celular ou computador!
            </div>
          </div>
          <div style="background:#252140;padding:6px 14px;border-radius:99px;font-weight:700;font-size:0.85rem;border:1px solid #3D2E75;">
            {len(all_games)} Jogos
          </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    # Active Game Player Section
    active_game = st.session_state.get("active_game")
    if active_game:
        with st.container(border=True):
            col_title, col_pc, col_dl, col_close = st.columns([5, 2.2, 1.8, 1.2])
            with col_title:
                st.markdown(f"### 🕹️ Jogando: **{active_game['title']}** `({active_game['region']})`")
            with col_pc:
                if is_local_windows_emu_available():
                    if st.button("🖥️ Emulador PC", use_container_width=True):
                        launch_local_pc_emu(active_game)
            with col_dl:
                rom_file_path = os.path.join(ROMS_DIR, active_game["file"])
                if os.path.exists(rom_file_path):
                    with open(rom_file_path, "rb") as rf:
                        st.download_button(
                            "📥 Baixar ROM",
                            data=rf.read(),
                            file_name=active_game["file"],
                            mime="application/octet-stream",
                            use_container_width=True,
                        )
            with col_close:
                if st.button("✖ Fechar Jogo", use_container_width=True):
                    st.session_state["active_game"] = None
                    st.rerun()

            render_browser_emulator(active_game)

    # Filter Games
    filtered = all_games
    if selected_cat == "⭐ Favoritos":
        favs = st.session_state["favorites"]
        filtered = [g for g in filtered if g["id"] in favs]
    elif selected_cat != "🎮 Todos os Jogos":
        clean_cat = selected_cat.split(" ", 1)[1].strip()
        filtered = [g for g in filtered if g["category"] == clean_cat]

    if selected_letter != "Todos":
        filtered = [g for g in filtered if g["letter"] == selected_letter]

    if search_q.strip():
        q = search_q.strip().lower()
        filtered = [g for g in filtered if q in g["title"].lower() or q in g["file"].lower()]

    total_filtered = len(filtered)
    total_pages = max(1, (total_filtered + per_page - 1) // per_page)
    if st.session_state["page"] > total_pages:
        st.session_state["page"] = 1

    pcol1, pcol2, pcol3 = st.columns([4, 3, 2])
    with pcol1:
        st.markdown(f"**Exibindo {total_filtered} jogos** (Página {st.session_state['page']} de {total_pages})")
    with pcol3:
        if total_pages > 1:
            new_page = st.number_input("Página:", min_value=1, max_value=total_pages, value=st.session_state["page"], step=1, label_visibility="collapsed")
            if new_page != st.session_state["page"]:
                st.session_state["page"] = new_page
                st.rerun()

    start_idx = (st.session_state["page"] - 1) * per_page
    page_games = filtered[start_idx : start_idx + per_page]

    if not page_games:
        st.info("Nenhum jogo encontrado com esses filtros.")
        return

    cols_per_row = 4
    for i in range(0, len(page_games), cols_per_row):
        row_items = page_games[i : i + cols_per_row]
        cols = st.columns(cols_per_row)
        for col, g in zip(cols, row_items):
            with col:
                with st.container(border=True):
                    b64_img = get_cover_b64(g["cover"])
                    img_src = f"data:image/jpeg;base64,{b64_img}" if b64_img else ""
                    st.markdown(
                        f"""
                        <div class="cover-box">
                          <img src="{img_src}" alt="{g['title']}">
                        </div>
                        <div class="game-title" title="{g['title']}">{g['title']}</div>
                        <div class="game-meta">
                          <span>{g['category']}</span>
                          <span>{g['region']}</span>
                        </div>
                        """,
                        unsafe_allow_html=True,
                    )
                    b1, b2 = st.columns([3.2, 1])
                    with b1:
                        if st.button("▶ Jogar", key=f"play_{g['id']}", use_container_width=True, type="primary"):
                            st.session_state["active_game"] = g
                            st.rerun()
                    with b2:
                        is_fav = g["id"] in st.session_state["favorites"]
                        star_lbl = "⭐" if is_fav else "☆"
                        if st.button(star_lbl, key=f"fav_{g['id']}", use_container_width=True):
                            if is_fav:
                                st.session_state["favorites"].remove(g["id"])
                            else:
                                st.session_state["favorites"].add(g["id"])
                            st.rerun()


if __name__ == "__main__":
    main()
