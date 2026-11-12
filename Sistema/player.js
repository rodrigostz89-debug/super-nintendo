(function () {
  const cfg = (window.parent && window.parent._pendingEmuConfig) ? window.parent._pendingEmuConfig : {};
  window.EJS_player = "#player";
  window.EJS_core = "snes";
  window.EJS_gameName = cfg.title || "Super Nintendo";
  window.EJS_gameUrl = cfg.romUrl || "";
  window.EJS_pathtodata = "https://cdn.emulatorjs.org/stable/data/";
  window.EJS_startOnLoaded = true;
  window.EJS_color = "#7950f2";
  window.EJS_hideSettings = ["save-state-location"];
  if (cfg.extract7zUrl) {
    window.EJS_paths = Object.assign({}, window.EJS_paths || {}, {
      "extract7z.js": cfg.extract7zUrl
    });
  }
})();

// Route EmulatorJS built-in bottom-bar Save/Load buttons directly to Cloud Storage
window.EJS_onSaveState = function(data) {
  if (window.parent && typeof window.parent.saveCurrentGameToCloud === "function") {
    window.parent.saveCurrentGameToCloud(data && data.state ? data.state : null);
  }
};
window.EJS_onLoadState = function() {
  if (window.parent && typeof window.parent.loadCurrentGameFromCloud === "function") {
    window.parent.loadCurrentGameFromCloud();
  }
};
window.EJS_onSaveSave = function() {
  if (window.parent && typeof window.parent.saveCurrentGameToCloud === "function") {
    window.parent.saveCurrentGameToCloud();
  }
};
window.EJS_onLoadSave = function() {
  if (window.parent && typeof window.parent.loadCurrentGameFromCloud === "function") {
    window.parent.loadCurrentGameFromCloud();
  }
};

(function() {
  // SNES Button IDs in EmulatorJS:
  // 0=B, 1=Y, 2=Select, 3=Start, 4=Up, 5=Down, 6=Left, 7=Right, 8=A, 9=X, 10=L, 11=R
  const touchBtns = new Set();
  const keyBtns = new Set();
  const gpBtns = new Set();
  const heldCodes = new Set();
  const touchOrigins = new Map();
  const dpadTouches = new Map();
  const prevManaged = new Map();
  const externalHeld = new Set();
  const hatAxes = new Set();
  let hasUsedTouch = false;
  let internalSimCall = false;
  let rawSim = null;
  let controlsInitialized = false;
  let popupWasOpen = false;
  let popupLastKey = "";
  let popupBaseline = null;
  let popupWaitRelease = false;

  const GP_BTN_LABELS = {
    0: "BUTTON_1",
    1: "BUTTON_2",
    2: "BUTTON_3",
    3: "BUTTON_4",
    4: "LEFT_TOP_SHOULDER",
    5: "RIGHT_TOP_SHOULDER",
    6: "LEFT_BOTTOM_SHOULDER",
    7: "RIGHT_BOTTOM_SHOULDER",
    8: "SELECT",
    9: "START",
    10: "LEFT_STICK",
    11: "RIGHT_STICK",
    12: "DPAD_UP",
    13: "DPAD_DOWN",
    14: "DPAD_LEFT",
    15: "DPAD_RIGHT"
  };
  const GP_BTN_INDEX = {};
  for (const [k, v] of Object.entries(GP_BTN_LABELS)) {
    GP_BTN_INDEX[v] = Number(k);
  }

  // Multi-key anti-ghosting keyboard map
  const CODE_MAP = {
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
  };

  function isHeld(btnId) {
    return touchBtns.has(btnId) || keyBtns.has(btnId) || gpBtns.has(btnId);
  }

  function getStorage() {
    try {
      if (window.parent && window.parent.localStorage) return window.parent.localStorage;
    } catch (e) {}
    try {
      return window.localStorage;
    } catch (e) {}
    return null;
  }

  function saveUsbControlsToStorage(controlsObj) {
    const st = getStorage();
    if (!st || !controlsObj || !controlsObj[0]) return;
    try {
      const map0 = {};
      for (let b = 0; b <= 13; b++) {
        if (controlsObj[0][b]) {
          map0[b] = {
            value: controlsObj[0][b].value,
            value2: controlsObj[0][b].value2
          };
        }
      }
      st.setItem("snes_usb_controls_v1", JSON.stringify(map0));
    } catch (e) {}
  }

  function initUsbControlsConfig(emu) {
    if (controlsInitialized || !emu || !emu.controls || !emu.controls[0]) return;
    controlsInitialized = true;

    // Neutralize EmulatorJS's buggy built-in gamepadEvent so our 60fps multi-button engine handles both configuration & gameplay
    emu.gamepadEvent = function() {};
    if (emu.gamepad && emu.gamepad.listeners) {
      emu.gamepad.listeners.axischanged = function() {};
      emu.gamepad.listeners.buttondown = function() {};
      emu.gamepad.listeners.buttonup = function() {};
    }

    // Apply DirectInput USB SNES default button layout (matching standard USB SNES/Generic controllers: X=0, A=1, B=2, Y=3)
    const snesUsbDefaults = {
      0: "BUTTON_3", // B
      1: "BUTTON_4", // Y
      2: "SELECT",   // Select
      3: "START",    // Start
      4: "DPAD_UP",
      5: "DPAD_DOWN",
      6: "DPAD_LEFT",
      7: "DPAD_RIGHT",
      8: "BUTTON_2", // A
      9: "BUTTON_1", // X
      10: "LEFT_TOP_SHOULDER",  // L
      11: "RIGHT_TOP_SHOULDER"  // R
    };
    if (emu.defaultControllers && emu.defaultControllers[0]) {
      for (const [b, v2] of Object.entries(snesUsbDefaults)) {
        if (emu.defaultControllers[0][b]) emu.defaultControllers[0][b].value2 = v2;
      }
    }
    for (const [b, v2] of Object.entries(snesUsbDefaults)) {
      if (emu.controls[0][b]) emu.controls[0][b].value2 = v2;
    }

    // Restore user's custom saved USB controller bindings across all games if present
    const st = getStorage();
    if (st) {
      try {
        const raw = st.getItem("snes_usb_controls_v1");
        if (raw) {
          const saved0 = JSON.parse(raw);
          for (const [b, obj] of Object.entries(saved0)) {
            if (emu.controls[0][b] && obj) {
              if (obj.value !== undefined) emu.controls[0][b].value = obj.value;
              if (obj.value2 !== undefined) emu.controls[0][b].value2 = obj.value2;
            }
          }
        }
      } catch (e) {}
    }

    if (typeof emu.checkGamepadInputs === "function") {
      try { emu.checkGamepadInputs(); } catch (e) {}
    }

    if (typeof emu.saveSettings === "function" && !emu._saveWrapped) {
      const origSave = emu.saveSettings.bind(emu);
      emu.saveSettings = function() {
        origSave();
        saveUsbControlsToStorage(emu.controls);
      };
      emu._saveWrapped = true;
    }

    // Make built-in Save State button instant (skip slow screenshot capture) and route to Cloud
    emu.takeScreenshot = async function() {
      return { screenshot: null, format: "png" };
    };
  }

  function ensureHooked() {
    const emu = window.EJS_emulator;
    if (!emu || !emu.gameManager) return null;
    initUsbControlsConfig(emu);
    const gm = emu.gameManager;
    if (!gm._multiWrapped && typeof gm.simulateInput === "function") {
      rawSim = gm.simulateInput.bind(gm);
      gm.simulateInput = function(player, btnId, val) {
        if (player === 0 && (btnId === 24 || btnId === 25)) {
          if (val === 1 && window.parent) {
            if (btnId === 24 && typeof window.parent.saveCurrentGameToCloud === "function") {
              window.parent.saveCurrentGameToCloud();
            } else if (btnId === 25 && typeof window.parent.loadCurrentGameFromCloud === "function") {
              window.parent.loadCurrentGameFromCloud();
            }
          }
          return;
        }
        if (player === 0 && !internalSimCall) {
          if (hasUsedTouch && ((btnId >= 4 && btnId <= 7) || btnId === 0 || btnId === 1 || btnId === 8 || btnId === 9 || btnId === 10 || btnId === 11)) {
            rawSim(0, btnId, isHeld(btnId) ? 1 : 0);
            updateGamepadVisuals();
            return;
          }
          if (val === 0 && isHeld(btnId)) {
            rawSim(0, btnId, 1);
            return;
          }
          if (val > 0) externalHeld.add(btnId);
          else externalHeld.delete(btnId);
        }
        rawSim(player, btnId, val);
        if (player === 0 && val > 0 && !internalSimCall) {
          for (let b = 0; b <= 11; b++) {
            if (b !== btnId && (isHeld(b) || externalHeld.has(b))) {
              rawSim(0, b, 1);
            }
          }
        }
      };
      gm._multiWrapped = true;
    }
    return rawSim;
  }

  const hookTimer = setInterval(() => {
    if (ensureHooked()) clearInterval(hookTimer);
  }, 100);

  function syncAllInputs() {
    const sim = ensureHooked();
    if (!sim) return;
    internalSimCall = true;
    for (let b = 0; b <= 11; b++) {
      const nowActive = isHeld(b);
      const wasActive = prevManaged.get(b) || false;
      if (nowActive) {
        sim(0, b, 1);
        prevManaged.set(b, true);
      } else if (wasActive) {
        sim(0, b, 0);
        prevManaged.set(b, false);
      }
    }
    internalSimCall = false;
    updateGamepadVisuals();
  }

  function getAllConnectedGamepads() {
    const list = [];
    const seen = new Set();
    const navs = [navigator];
    try {
      if (window.parent && window.parent !== window && window.parent.navigator) {
        navs.push(window.parent.navigator);
      }
    } catch (e) {}
    for (const nav of navs) {
      try {
        const raw = nav.getGamepads ? nav.getGamepads() : (nav.webkitGetGamepads ? nav.webkitGetGamepads() : []);
        if (!raw) continue;
        for (let i = 0; i < raw.length; i++) {
          const gp = raw[i];
          if (gp && gp.connected !== false && !seen.has(gp.index)) {
            seen.add(gp.index);
            list.push(gp);
          }
        }
      } catch (e) {}
    }
    return list;
  }

  function isGpButtonPressed(gp, idx) {
    if (!gp || !gp.buttons || idx < 0 || idx >= gp.buttons.length) return false;
    const b = gp.buttons[idx];
    if (!b) return false;
    return typeof b === "object" ? (Boolean(b.pressed) || (typeof b.value === "number" && b.value > 0.55)) : (b === 1);
  }

  function getAxisName(idx) {
    return ["LEFT_STICK_X", "LEFT_STICK_Y", "RIGHT_STICK_X", "RIGHT_STICK_Y"][idx] || ("EXTRA_STICK_" + idx);
  }

  function getAxisIndex(name) {
    const std = ["LEFT_STICK_X", "LEFT_STICK_Y", "RIGHT_STICK_X", "RIGHT_STICK_Y"].indexOf(name);
    if (std >= 0) return std;
    if (name && name.startsWith("EXTRA_STICK_")) {
      const n = parseInt(name.slice(12), 10);
      return isNaN(n) ? -1 : n;
    }
    return -1;
  }

  function decodePovHatDirections(val) {
    if (typeof val !== "number" || !isFinite(val) || val > 1.08 || val < -1.08) return [];
    const step = Math.round(val * 7);
    const dirs = [];
    if (step === -7 || step === -5 || step === 7) dirs.push(4);
    if (step === -1 || step === 1 || step === 3) dirs.push(5);
    if (step === 3 || step === 5 || step === 7) dirs.push(6);
    if (step === -5 || step === -3 || step === -1) dirs.push(7);
    return dirs;
  }

  function pollUsbGamepads() {
    const emu = window.EJS_emulator;
    if (emu) initUsbControlsConfig(emu);

    const gamepads = getAllConnectedGamepads();
    if (!gamepads.length) {
      if (gpBtns.size > 0) {
        gpBtns.clear();
        syncAllInputs();
      }
      return;
    }

    // Detect POV Hat switch on axes[9] (resting value > 1.08)
    for (const gp of gamepads) {
      if (gp.axes && gp.axes.length >= 10 && gp.axes[9] > 1.08) {
        hatAxes.add(gp.index);
      }
    }

    // Keep EmulatorJS's Connected Gamepad dropdown automatically populated & selected
    if (emu && emu.gamepadLabels && emu.gamepadSelection) {
      if (emu.gamepad) {
        emu.gamepad.gamepads = gamepads.map(gp => ({
          id: gp.id,
          index: gp.index,
          axes: Array.from(gp.axes || []),
          buttons: {}
        }));
      }
      let selChanged = false;
      const firstVal = gamepads[0].id + "_" + gamepads[0].index;
      if (!emu.gamepadSelection[0] || emu.gamepadSelection[0] === "notconnected") {
        emu.gamepadSelection[0] = firstVal;
        selChanged = true;
      }
      const sel0 = emu.gamepadLabels[0];
      if (sel0 && (sel0.options.length !== gamepads.length + 1 || selChanged)) {
        try { emu.updateGamepadLabels(); } catch (e) {}
      }
    }

    // Check if EmulatorJS's Control Configuration Popup ("Set") is currently open
    const popupWrap = emu && emu.controlPopup && emu.controlPopup.parentElement && emu.controlPopup.parentElement.parentElement;
    const isPopupOpen = Boolean(popupWrap && !popupWrap.hasAttribute("hidden"));

    if (isPopupOpen) {
      const btnNum = emu.controlPopup.getAttribute("button-num") || "";
      const playerNum = parseInt(emu.controlPopup.getAttribute("player-num") || "0", 10);
      const popupKey = playerNum + ":" + btnNum;

      if (emu.controlPopup.innerText && emu.controlPopup.innerText.includes("Press Keyboard")) {
        emu.controlPopup.innerText = emu.controlPopup.innerText.replace("Press Keyboard", "Pressione no Controle USB ou Teclado");
      }

      if (!popupWasOpen || popupLastKey !== popupKey) {
        popupWasOpen = true;
        popupLastKey = popupKey;
        popupBaseline = { buttons: {}, axes: {}, hat: {} };
        let anyPressedNow = false;
        for (const gp of gamepads) {
          popupBaseline.buttons[gp.index] = {};
          popupBaseline.axes[gp.index] = {};
          for (let b = 0; b < (gp.buttons ? gp.buttons.length : 0); b++) {
            const p = isGpButtonPressed(gp, b);
            popupBaseline.buttons[gp.index][b] = p;
            if (p) anyPressedNow = true;
          }
          for (let a = 0; a < (gp.axes ? gp.axes.length : 0); a++) {
            popupBaseline.axes[gp.index][a] = gp.axes[a] || 0;
          }
          if (hatAxes.has(gp.index) && gp.axes && gp.axes.length >= 10) {
            const hd = decodePovHatDirections(gp.axes[9]);
            popupBaseline.hat[gp.index] = hd;
            if (hd.length > 0) anyPressedNow = true;
          }
        }
        popupWaitRelease = anyPressedNow;
        return;
      }

      if (popupWaitRelease) {
        let stillHeld = false;
        for (const gp of gamepads) {
          for (let b = 0; b < (gp.buttons ? gp.buttons.length : 0); b++) {
            if (isGpButtonPressed(gp, b)) stillHeld = true;
          }
          if (hatAxes.has(gp.index) && gp.axes && gp.axes.length >= 10) {
            if (decodePovHatDirections(gp.axes[9]).length > 0) stillHeld = true;
          }
        }
        if (stillHeld) return;
        popupWaitRelease = false;
        for (const gp of gamepads) {
          for (let b = 0; b < (gp.buttons ? gp.buttons.length : 0); b++) {
            popupBaseline.buttons[gp.index][b] = false;
          }
          for (let a = 0; a < (gp.axes ? gp.axes.length : 0); a++) {
            popupBaseline.axes[gp.index][a] = gp.axes[a] || 0;
          }
        }
      }

      let detectedLabel = null;
      let detectedGp = null;

      for (const gp of gamepads) {
        // 1. Check buttons
        for (let b = 0; b < (gp.buttons ? gp.buttons.length : 0); b++) {
          const nowP = isGpButtonPressed(gp, b);
          const wasP = popupBaseline && popupBaseline.buttons[gp.index] && popupBaseline.buttons[gp.index][b];
          if (nowP && !wasP) {
            detectedLabel = GP_BTN_LABELS[b] || ("GAMEPAD_" + b);
            detectedGp = gp;
            break;
          }
        }
        if (detectedLabel) break;

        // 2. Check POV Hat switch on axes[9]
        if (hatAxes.has(gp.index) && gp.axes && gp.axes.length >= 10) {
          const hd = decodePovHatDirections(gp.axes[9]);
          if (hd.length > 0) {
            const hatMap = { 4: "DPAD_UP", 5: "DPAD_DOWN", 6: "DPAD_LEFT", 7: "DPAD_RIGHT" };
            detectedLabel = hatMap[hd[0]];
            detectedGp = gp;
            break;
          }
        }

        // 3. Check standard axes (D-Pad / Analog Sticks)
        for (let a = 0; a < (gp.axes ? gp.axes.length : 0); a++) {
          if (a === 9 && hatAxes.has(gp.index)) continue;
          const val = gp.axes[a] || 0;
          const rest = (popupBaseline && popupBaseline.axes[gp.index] && typeof popupBaseline.axes[gp.index][a] === "number")
            ? popupBaseline.axes[gp.index][a]
            : 0;
          if (Math.abs(val - rest) >= 0.45 && Math.abs(val) >= 0.5) {
            const dir = val > 0 ? "+1" : "-1";
            detectedLabel = getAxisName(a) + ":" + dir;
            detectedGp = gp;
            break;
          }
        }
        if (detectedLabel) break;
      }

      if (detectedLabel && detectedGp) {
        if (emu.gamepadSelection) {
          emu.gamepadSelection[playerNum] = detectedGp.id + "_" + detectedGp.index;
          if (typeof emu.updateGamepadLabels === "function") {
            try { emu.updateGamepadLabels(); } catch (e) {}
          }
        }
        emu.controls[playerNum] = emu.controls[playerNum] || {};
        emu.controls[playerNum][btnNum] = emu.controls[playerNum][btnNum] || {};
        emu.controls[playerNum][btnNum].value2 = detectedLabel;
        popupWrap.setAttribute("hidden", "");
        popupWasOpen = false;
        if (typeof emu.checkGamepadInputs === "function") {
          try { emu.checkGamepadInputs(); } catch (e) {}
        }
        if (typeof emu.saveSettings === "function") {
          try { emu.saveSettings(); } catch (e) {}
        }
        saveUsbControlsToStorage(emu.controls);
      }
      return;
    } else {
      popupWasOpen = false;
    }

    // Gameplay mode: Read all simultaneously pressed buttons & D-Pad directions from the USB controller
    gpBtns.clear();
    const p0Controls = (emu && emu.controls && emu.controls[0]) ? emu.controls[0] : null;

    for (const gp of gamepads) {
      if (p0Controls) {
        for (let b = 0; b <= 11; b++) {
          const entry = p0Controls[b];
          if (!entry || entry.value2 === undefined || entry.value2 === null || entry.value2 === "") continue;
          const spec = String(entry.value2);

          if (spec.includes(":")) {
            const [axName, axDir] = spec.split(":");
            const axIdx = getAxisIndex(axName);
            if (axIdx >= 0 && gp.axes && axIdx < gp.axes.length) {
              const v = gp.axes[axIdx] || 0;
              if ((axDir === "+1" || axDir === "1") && v >= 0.38) gpBtns.add(b);
              else if (axDir === "-1" && v <= -0.38) gpBtns.add(b);
            }
          } else {
            let bIdx = GP_BTN_INDEX[spec];
            if (bIdx === undefined && spec.startsWith("GAMEPAD_")) {
              bIdx = parseInt(spec.slice(8), 10);
            } else if (bIdx === undefined && !isNaN(spec)) {
              bIdx = parseInt(spec, 10);
            }
            if (bIdx !== undefined && !isNaN(bIdx) && isGpButtonPressed(gp, bIdx)) {
              gpBtns.add(b);
            }
          }
        }
      }

      // Always support D-Pad via Axes 0/1, Buttons 12..15, and POV Hat Axes 9 simultaneously with Y+B!
      if (gp.axes && gp.axes.length >= 2) {
        if (gp.axes[0] <= -0.38) { gpBtns.add(6); gpBtns.delete(7); }
        else if (gp.axes[0] >= 0.38) { gpBtns.add(7); gpBtns.delete(6); }
        if (gp.axes[1] <= -0.38) { gpBtns.add(4); gpBtns.delete(5); }
        else if (gp.axes[1] >= 0.38) { gpBtns.add(5); gpBtns.delete(4); }
      }
      if (hatAxes.has(gp.index) && gp.axes && gp.axes.length >= 10) {
        const hd = decodePovHatDirections(gp.axes[9]);
        for (const d of hd) gpBtns.add(d);
      }
      if (gp.buttons && gp.buttons.length >= 16) {
        if (isGpButtonPressed(gp, 12)) gpBtns.add(4);
        if (isGpButtonPressed(gp, 13)) gpBtns.add(5);
        if (isGpButtonPressed(gp, 14)) gpBtns.add(6);
        if (isGpButtonPressed(gp, 15)) gpBtns.add(7);
      }
    }

    syncAllInputs();
  }

  // 60fps continuous multi-button assertion & USB Gamepad polling
  setInterval(() => {
    pollUsbGamepads();
    if (touchBtns.size > 0 || keyBtns.size > 0 || gpBtns.size > 0) {
      const sim = ensureHooked();
      if (!sim) return;
      internalSimCall = true;
      for (let b = 0; b <= 11; b++) {
        if (isHeld(b)) {
          sim(0, b, 1);
          prevManaged.set(b, true);
        }
      }
      internalSimCall = false;
    }
  }, 16);

  function updateGamepadVisuals() {
    const padParent = document.querySelector(".ejs_virtualGamepad_parent");
    if (!padParent) return;
    const map = [
      [".b_y", 1],
      [".b_b", 0],
      [".b_a", 8],
      [".b_x", 9],
      [".b_l", 10],
      [".b_r", 11]
    ];
    for (const [sel, id] of map) {
      const el = padParent.querySelector(sel);
      if (el) el.classList.toggle("ejs_virtualGamepad_button_down", isHeld(id));
    }
    const dpadMain = padParent.querySelector(".ejs_dpad_main");
    if (dpadMain) {
      dpadMain.classList.toggle("ejs_dpad_up_pressed", isHeld(4));
      dpadMain.classList.toggle("ejs_dpad_down_pressed", isHeld(5));
      dpadMain.classList.toggle("ejs_dpad_left_pressed", isHeld(6));
      dpadMain.classList.toggle("ejs_dpad_right_pressed", isHeld(7));
    }
  }

  function getDpadGeometry() {
    const leftPad = document.querySelector(".ejs_virtualGamepad_left");
    if (!leftPad || leftPad.offsetParent === null) return null;
    const visualEl = leftPad.querySelector(".back, .ejs_dpad_main") || leftPad;
    const vRect = visualEl.getBoundingClientRect();
    const lRect = leftPad.getBoundingClientRect();
    const baseRect = (vRect.width > 20 && vRect.height > 20) ? vRect : lRect;
    if (baseRect.width === 0 || baseRect.height === 0) return null;
    return {
      cx: baseRect.left + baseRect.width / 2,
      cy: baseRect.top + baseRect.height / 2,
      rect: lRect.width > 0 ? lRect : baseRect
    };
  }

  function getButtonCenters() {
    const rightPad = document.querySelector(".ejs_virtualGamepad_right");
    if (!rightPad || rightPad.offsetParent === null) return null;
    const padParent = document.querySelector(".ejs_virtualGamepad_parent") || document;
    const specs = [
      { sel: ".b_y", ids: [1], r: 38 },
      { sel: ".b_b", ids: [0], r: 38 },
      { sel: ".b_a", ids: [8], r: 38 },
      { sel: ".b_x", ids: [9], r: 38 },
      { sel: ".b_l", ids: [10], r: 42 },
      { sel: ".b_r", ids: [11], r: 42 }
    ];
    const list = [];
    for (const s of specs) {
      const el = padParent.querySelector(s.sel);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) continue;
      list.push({
        ids: s.ids,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
        r: s.r
      });
    }
    return list.length ? list : null;
  }

  // Unified Multi-Touch Handler: Simultaneously tracks Left D-Pad (Up/Down/Left/Right) + Right Action Buttons (Y+B thumb-slide, A, X, L, R)
  function handleGamepadTouch(e) {
    const centers = getButtonCenters();
    const dpad = getDpadGeometry();
    if (!centers && !dpad) return;

    hasUsedTouch = true;
    let isGamepadTouch = false;

    if (e.type === "touchstart") {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        const hitOrigin = new Set();
        if (centers) {
          for (const c of centers) {
            if (Math.hypot(t.clientX - c.cx, t.clientY - c.cy) <= c.r + 8) {
              c.ids.forEach(id => hitOrigin.add(id));
            }
          }
        }
        if (hitOrigin.size > 0) {
          touchOrigins.set(t.identifier, hitOrigin);
          isGamepadTouch = true;
        } else if (
          dpad &&
          t.clientX >= dpad.rect.left - 60 &&
          t.clientX <= dpad.rect.right + 60 &&
          t.clientY >= dpad.rect.top - 60 &&
          t.clientY <= dpad.rect.bottom + 60
        ) {
          dpadTouches.set(t.identifier, { startX: t.clientX, startY: t.clientY });
          isGamepadTouch = true;
        }
      }
    }

    const activeIds = new Set();
    for (let i = 0; i < e.touches.length; i++) {
      const id = e.touches[i].identifier;
      activeIds.add(id);
      if (touchOrigins.has(id) || dpadTouches.has(id)) {
        isGamepadTouch = true;
      }
    }
    for (const oldId of Array.from(touchOrigins.keys())) {
      if (!activeIds.has(oldId)) {
        touchOrigins.delete(oldId);
        isGamepadTouch = true;
      }
    }
    for (const oldId of Array.from(dpadTouches.keys())) {
      if (!activeIds.has(oldId)) {
        dpadTouches.delete(oldId);
        isGamepadTouch = true;
      }
    }

    if (!isGamepadTouch && touchBtns.size === 0) return;

    touchBtns.clear();
    for (let i = 0; i < e.touches.length; i++) {
      const t = e.touches[i];

      // 1. Left D-Pad / Joystick touch (4=Up, 5=Down, 6=Left, 7=Right)
      if (dpad && dpadTouches.has(t.identifier)) {
        const dx = t.clientX - dpad.cx;
        const dy = t.clientY - dpad.cy;
        const dist = Math.hypot(dx, dy);
        if (dist >= 6) {
          const absX = Math.abs(dx);
          const absY = Math.abs(dy);
          if (absX >= 6 && absX >= absY * 0.40) {
            touchBtns.add(dx < 0 ? 6 : 7);
          }
          if (absY >= 6 && absY >= absX * 0.40) {
            touchBtns.add(dy < 0 ? 4 : 5);
          }
        }
        continue;
      }

      // 2. Right Action & Shoulder buttons (with Y -> B thumb-slide memory)
      const originSet = touchOrigins.get(t.identifier);
      if (!originSet || !centers) continue;

      for (const c of centers) {
        const dist = Math.hypot(t.clientX - c.cx, t.clientY - c.cy);
        if (dist <= c.r) {
          c.ids.forEach(id => touchBtns.add(id));
        }
      }

      for (const origId of originSet) {
        const origCenter = centers.find(c => c.ids[0] === origId);
        if (origCenter) {
          const distFromOrigin = Math.hypot(t.clientX - origCenter.cx, t.clientY - origCenter.cy);
          if (distFromOrigin <= 90) {
            touchBtns.add(origId);
          }
        }
      }
    }

    syncAllInputs();
    if (isGamepadTouch && e.cancelable) {
      e.preventDefault();
    }
  }

  document.addEventListener("touchstart", handleGamepadTouch, { passive: false, capture: true });
  document.addEventListener("touchmove", handleGamepadTouch, { passive: false, capture: true });
  document.addEventListener("touchend", handleGamepadTouch, { passive: false, capture: true });
  document.addEventListener("touchcancel", handleGamepadTouch, { passive: false, capture: true });

  function rebuildKeyBtns() {
    keyBtns.clear();
    for (const code of heldCodes) {
      const mapped = CODE_MAP[code];
      if (mapped) {
        for (const b of mapped) keyBtns.add(b);
      }
    }
    syncAllInputs();
  }

  function onKeyEvent(e) {
    const emu = window.EJS_emulator;
    if (emu && emu.controlPopup && emu.controlPopup.parentElement && emu.controlPopup.parentElement.parentElement && !emu.controlPopup.parentElement.parentElement.hasAttribute("hidden")) {
      return;
    }
    const mapped = CODE_MAP[e.code];
    if (!mapped) return;

    if (e.type === "keydown") {
      heldCodes.add(e.code);
      rebuildKeyBtns();
    } else if (e.type === "keyup") {
      heldCodes.delete(e.code);
      rebuildKeyBtns();
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  window.addEventListener("keydown", onKeyEvent, true);
  window.addEventListener("keyup", onKeyEvent, true);
  window.addEventListener("blur", () => {
    heldCodes.clear();
    rebuildKeyBtns();
  });
  window._forwardKeyEvent = onKeyEvent;

  // Cloud Save & Load hooks into EmulatorJS gameManager
  window.captureEmulatorState = function() {
    const emu = window.EJS_emulator;
    if (!emu || !emu.gameManager || typeof emu.gameManager.getState !== "function") return null;
    return emu.gameManager.getState();
  };

  window.showEmulatorMessage = function(msg) {
    const emu = window.EJS_emulator;
    if (emu && typeof emu.displayMessage === "function") {
      try { emu.displayMessage(msg); } catch (e) {}
    }
  };

  window.restoreEmulatorState = function(uint8Bytes) {
    const emu = window.EJS_emulator;
    if (!emu || !emu.gameManager || !uint8Bytes || !uint8Bytes.length) return false;
    const gm = emu.gameManager;
    // Copy into iframe-realm Uint8Array so Emscripten FS.writeFile accepts the view
    const localBytes = new Uint8Array(uint8Bytes.length);
    for (let i = 0; i < uint8Bytes.length; i++) localBytes[i] = uint8Bytes[i];
    if (typeof gm.loadState === "function") {
      gm.loadState(localBytes);
      if (typeof emu.displayMessage === "function") {
        try { emu.displayMessage("SAVE CARREGADO DA NUVEM!"); } catch (e) {}
      }
      return true;
    }
    if (!gm.FS || !gm.functions) return false;
    const fname = "game.state";
    try { gm.FS.unlink("/" + fname); } catch (e) {}
    gm.FS.writeFile("/" + fname, localBytes);
    if (gm.clearEJSResetTimer) gm.clearEJSResetTimer();
    gm.functions.loadState(fname, 0);
    return true;
  };
})();
