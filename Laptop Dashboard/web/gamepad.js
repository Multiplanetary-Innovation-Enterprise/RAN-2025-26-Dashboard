// --- Config & Elements ---
const MAX_CONTROLLERS = 2;
const MAX_STEER_DEG = 30; // +/- degrees for front wheel steering

// Xbox button mapping (standard Gamepad layout)
const XBOX_BUTTONS = [
  "A", "B", "X", "Y", "LB", "RB", "LT", "RT",
  "BACK", "START", "L_STICK", "R_STICK",
  "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT", "GUIDE"
];

// Declare DOM element variables globally so they can be populated later
let slotEls = [];
let leftStickDot, rightStickDot, pressedSummaryEl;
let wheelFL, wheelFR, wheelRL, wheelRR, throttleFill, throttleLabel;

// Per-controller runtime data
const controllerState = [];
for (let i = 0; i < MAX_CONTROLLERS; i++) {
  controllerState[i] = {
    index: null,
    buttonMeta: [], // [{pressed, pressedAt}]
    buttonEls: []
  };
}

const teleopState = [
  { lx: 0, az: 0 },
  { lx: 0, az: 0 }
];

// Listen for connection/disconnection events
window.addEventListener("gamepadconnected", e => {
  console.log("Gamepad connected:", e.gamepad);
});

window.addEventListener("gamepaddisconnected", e => {
  console.log("Gamepad disconnected:", e.gamepad);
});

// --- Initialization ---
function init() {
  // 1. Query the DOM only after everything is ready
  slotEls = document.querySelectorAll(".controller-slot");
  
  // Use IDs to match your Web Component template
  leftStickDot = document.querySelector("#left-stick-dot");
  rightStickDot = document.querySelector("#right-stick-dot");
  pressedSummaryEl = document.querySelector("#pressed-summary");

  // Rover elements
  wheelFL = document.querySelector(".wheel.front-left");
  wheelFR = document.querySelector(".wheel.front-right");
  wheelRL = document.querySelector(".wheel.rear-left");
  wheelRR = document.querySelector(".wheel.rear-right");
  throttleFill = document.querySelector(".throttle-fill");
  throttleLabel = document.querySelector(".throttle-label");

  // 2. Build button indicators elements for each slot
  slotEls.forEach((slotEl, slotIndex) => {
    const grid = slotEl.querySelector(".buttons-grid");
    if (!grid) return;

    XBOX_BUTTONS.forEach((name, btnIndex) => {
      const div = document.createElement("div");
      div.className = "button-indicator";
      div.dataset.buttonIndex = btnIndex.toString();
      div.textContent = name;
      grid.appendChild(div);

      controllerState[slotIndex].buttonEls[btnIndex] = div;
      controllerState[slotIndex].buttonMeta[btnIndex] = {
        pressed: false,
        pressedAt: 0
      };
    });
  });

  // 3. Start the main loop
  requestAnimationFrame(update);
}

// Wait for BOTH the HTML to be parsed AND the Web Component to be defined
Promise.all([
  customElements.whenDefined('controller-panel'),
  new Promise(resolve => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', resolve);
    } else {
      resolve();
    }
  })
]).then(() => {
  init();
});

// --- Main Loop & Logic ---
function update() {
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

  for (let slot = 0; slot < MAX_CONTROLLERS; slot++) {
    // Safety check in case DOM wasn't fully queried yet
    if (!slotEls[slot]) continue; 

    const slotEl = slotEls[slot];
    const statusEl = slotEl.querySelector(".status");

    const gp = gamepads[slot]; 
    if (!gp) {
      statusEl.textContent = "Not connected";
      slotEl.classList.remove("connected");
      clearButtonIndicators(controllerState[slot]);
      if (slot === 0) resetController0Visuals(); 
      continue;
    }

    slotEl.classList.add("connected");
    statusEl.textContent = `Connected: ${gp.id}`;

    controllerState[slot].index = gp.index;

    updateButtons(gp, controllerState[slot], slot);

    computeTeleopFromGamepad(gp, slot);
    if (slot === 0) {
      updateSticksAndText(gp);
    }
  }

  sendDualTeleop();
  requestAnimationFrame(update);
}

function sendDualTeleop() {
  if (typeof window.DS_setTeleop !== "function") return;

  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp1 = gamepads[controllerState[0].index];
  const gp2 = gamepads[controllerState[1].index];

  const getBtn = (gp, idx) => {
    if (!gp || !gp.buttons[idx]) return 0;
    const b = gp.buttons[idx];
    return (typeof b === "object" ? b.value : b) > 0.5 ? 1 : 0;
  };

  const getAnalog = (gp, type, idx) => {
    if (!gp) return 0;
    if (type === "axis") return gp.axes[idx] || 0;
    if (type === "trigger") {
      const b = gp.buttons[idx];
      return b ? (typeof b === "object" ? b.value : b) : 0;
    }
    return 0;
  };

  window.DS_setTeleop(
    // CONTROLLER 1
    teleopState[0].lx,             
    teleopState[0].az,             
    getAnalog(gp1, "axis", 2),     // C1 Right stick X
    getAnalog(gp1, "axis", 3),     // C1 Right stick Y
    getAnalog(gp1, "trigger", 7),  // C1 Right Trigger (Button 7)
    getAnalog(gp1, "trigger", 6),  // C1 Left Trigger (Button 6)
    
    getBtn(gp1, 0), getBtn(gp1, 1), getBtn(gp1, 2), getBtn(gp1, 3),
    getBtn(gp1, 4), getBtn(gp1, 5), getBtn(gp1, 8), getBtn(gp1, 9),
    getBtn(gp1, 10), getBtn(gp1, 11), getBtn(gp1, 12), getBtn(gp1, 13),
    getBtn(gp1, 14), getBtn(gp1, 15), getBtn(gp1, 16), getBtn(gp1, 17),

    // CONTROLLER 2
    teleopState[1].lx,             
    teleopState[1].az,             
    getAnalog(gp2, "axis", 2),     // C2 Right stick X
    getAnalog(gp2, "axis", 3),     // C2 Right stick Y
    getAnalog(gp2, "trigger", 7),  // C2 Right Trigger
    getAnalog(gp2, "trigger", 6),  // C2 Left Trigger
    
    getBtn(gp2, 0), getBtn(gp2, 1), getBtn(gp2, 2), getBtn(gp2, 3),
    getBtn(gp2, 4), getBtn(gp2, 5), getBtn(gp2, 8), getBtn(gp2, 9),
    getBtn(gp2, 10), getBtn(gp2, 11), getBtn(gp2, 12), getBtn(gp2, 13),
    getBtn(gp2, 14), getBtn(gp2, 15), getBtn(gp2, 16), getBtn(gp2, 17)
  );
}

function clearButtonIndicators(state) {
  state.buttonEls.forEach(el => el && el.classList.remove("pressed"));
  state.buttonMeta.forEach(meta => {
    meta.pressed = false;
    meta.pressedAt = 0;
  });
}

function resetController0Visuals() {
  if (leftStickDot) leftStickDot.style.transform = "translate(0px, 0px)";
  if (rightStickDot) rightStickDot.style.transform = "translate(0px, 0px)";
  if (pressedSummaryEl) pressedSummaryEl.textContent = "No input yet…";
  
  teleopState[0] = { lx: 0, az: 0 };
  setWheelSteer(0);
  setThrottle(0);
}

function updateButtons(gp, state, slot) {
  const now = performance.now();

  gp.buttons.forEach((btn, i) => {
    const meta = state.buttonMeta[i];
    const el = state.buttonEls[i];
    if (!meta || !el) return;

    // Safely check if 'btn' is an object or a primitive number
    const pressed = typeof btn === "object" ? (btn.pressed || btn.value > 0.5) : (btn > 0.5);

    if (pressed && !meta.pressed) {
      meta.pressed = true;
      meta.pressedAt = now;
    } else if (!pressed && meta.pressed) {
      meta.pressed = false;
      meta.pressedAt = 0;
    }

    if (pressed) {
      el.classList.add("pressed");
    } else {
      el.classList.remove("pressed");
    }
  });
}

function updateSticksAndText(gp) {
  const lx = gp.axes[0] || 0;
  const ly = gp.axes[1] || 0;
  const rx = gp.axes[2] || 0;
  const ry = gp.axes[3] || 0;

  const radius = 30;
  if (leftStickDot) {
    leftStickDot.style.transform = `translate(${(lx * radius).toFixed(1)}px, ${(ly * radius).toFixed(1)}px)`;
  }
  if (rightStickDot) {
    rightStickDot.style.transform = `translate(${(rx * radius).toFixed(1)}px, ${(ry * radius).toFixed(1)}px)`;
  }

  const mag = Math.min(1, Math.sqrt(lx * lx + ly * ly));
  const magPct = (mag * 100).toFixed(0);
  const angleRad = Math.atan2(-ly, lx);
  const angleDeg = (angleRad * 180 / Math.PI + 360) % 360;

  const leftStickStr = `LEFT_STICK: ${magPct}% @ ${angleDeg.toFixed(0)}°`;

  const state = controllerState[0];
  const now = performance.now();

  const pressedPieces = [];
  state.buttonMeta.forEach((meta, i) => {
    if (!meta.pressed) return;
    const name = XBOX_BUTTONS[i] || `B${i}`;
    const seconds = ((now - meta.pressedAt) / 1000).toFixed(1);
    pressedPieces.push(`${name}: ${seconds}s`);
  });

  const suffix = pressedPieces.length ? pressedPieces.join(", ") : "No buttons pressed";

  if (pressedSummaryEl) {
    pressedSummaryEl.textContent = `${leftStickStr}, ${suffix}`;
  }
}

function computeTeleopFromGamepad(gp, slot) {
  if (!gp) {
    teleopState[slot] = { lx: 0, az: 0 };
    return;
  }

  const lx = gp.axes[0] || 0;
  const ly = gp.axes[1] || 0;

  const throttleRaw = -ly;
  const steerRaw = lx;

  teleopState[slot] = {
    lx: 1.0 * throttleRaw,
    az: 1.0 * steerRaw
  };

  if (slot === 0) {
    setWheelSteer(steerRaw * MAX_STEER_DEG);
    setThrottle(throttleRaw);
  }
}

function setWheelSteer(deg) {
  const frontTransform = `rotate(${deg.toFixed(1)}deg)`;
  const rearTransform = `rotate(0deg)`;

  if (wheelFL) wheelFL.style.transform = frontTransform;
  if (wheelFR) wheelFR.style.transform = frontTransform;
  if (wheelRL) wheelRL.style.transform = rearTransform;
  if (wheelRR) wheelRR.style.transform = rearTransform;

  const intensity = Math.min(1, Math.abs(deg) / MAX_STEER_DEG);
  const baseColor = 63; 
  const delta = Math.round(80 * intensity);
  const newG = baseColor + delta;
  const newB = baseColor + delta;

  [wheelFL, wheelFR, wheelRL, wheelRR].forEach(w => {
    if (!w) return;
    w.style.backgroundColor = `rgb(${baseColor}, ${newG}, ${newB})`;
  });
}

function setThrottle(throttle) {
  const t = Math.max(-1, Math.min(1, throttle));
  const percent = (t * 100).toFixed(0);

  const height = Math.abs(t) * 100;
  const directionSign = t >= 0 ? 1 : -1; 
  
  if (throttleFill) {
    throttleFill.style.height = `${height}%`;
    throttleFill.style.transform = `translateY(${directionSign > 0 ? "0%" : "-100%"})`;
  }

  if (throttleLabel) {
    const dirLabel = t > 0.05 ? "Forward" : t < -0.05 ? "Reverse" : "Neutral";
    throttleLabel.textContent = `Throttle: ${percent}% (${dirLabel})`;
  }
}
