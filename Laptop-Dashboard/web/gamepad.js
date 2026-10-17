// gamepad.js — reads up to two Xbox controllers, shows their state in the
// controller panel, and hands the raw c1_* / c2_* command to app.js.
// The Pi republishes it as sensor_msgs/Joy on /joy1 and /joy2; button
// meaning (drive, drive mode, excavator, ...) lives in xbox_controller.

import { setTeleop } from "./app.js";

const MAX_CONTROLLERS = 2;
const STICK_RADIUS_PX = 30;

// Standard Gamepad button order (indicator labels in the controller panel)
const XBOX_BUTTONS = [
  "A", "B", "X", "Y", "LB", "RB", "LT", "RT",
  "BACK", "START", "L_STICK", "R_STICK",
  "DPAD_UP", "DPAD_DOWN", "DPAD_LEFT", "DPAD_RIGHT", "GUIDE"
];

// Wire-protocol button key -> Gamepad button index. Must match the Joy
// button layout in the Pi's drive_service.py.
const CMD_BUTTONS = {
  a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5,
  back: 8, start: 9, lclick: 10, rclick: 11,
  dup: 12, ddown: 13, dleft: 14, dright: 15, home: 16, share: 17,
};

let slotEls = [];
let leftStickDot, rightStickDot, pressedSummaryEl;

// Per-slot indicator elements and press timestamps
const controllerState = Array.from({ length: MAX_CONTROLLERS }, () => ({
  buttonEls: [],
  pressedAt: [],   // performance.now() when pressed, 0 when released
}));

window.addEventListener("gamepadconnected", e => console.log("Gamepad connected:", e.gamepad));
window.addEventListener("gamepaddisconnected", e => console.log("Gamepad disconnected:", e.gamepad));

function init() {
  slotEls = document.querySelectorAll(".controller-slot");
  leftStickDot = document.querySelector("#left-stick-dot");
  rightStickDot = document.querySelector("#right-stick-dot");
  pressedSummaryEl = document.querySelector("#pressed-summary");

  slotEls.forEach((slotEl, slot) => {
    const grid = slotEl.querySelector(".buttons-grid");
    if (!grid) return;

    XBOX_BUTTONS.forEach((name, i) => {
      const div = document.createElement("div");
      div.className = "button-indicator";
      div.textContent = name;
      grid.appendChild(div);

      controllerState[slot].buttonEls[i] = div;
      controllerState[slot].pressedAt[i] = 0;
    });
  });

  requestAnimationFrame(update);
}

customElements.whenDefined("controller-panel").then(init);

function buttonValue(gp, idx) {
  const b = gp?.buttons[idx];
  if (!b) return 0;
  return typeof b === "object" ? b.value : b;
}

function triggerValue(gp, axisIdx) {
  if (!gp) return 0;
  // Unmapped pads report triggers as axes 4/5 (-1..1). The "standard"
  // mapping only has 4 axes and reports them as buttons 6 (LT) / 7 (RT).
  if (Number.isFinite(gp.axes[axisIdx])) return (gp.axes[axisIdx] + 1) / 2;
  return buttonValue(gp, axisIdx === 5 ? 7 : 6);
}

// One controller's slice of the wire-protocol "cmd" message.
function controllerCmd(gp, prefix) {
  const axis = idx => gp?.axes[idx] || 0;

  const cmd = {
    [`${prefix}_lx`]: -axis(1),            // left stick Y (up = +)
    [`${prefix}_az`]: axis(0),             // left stick X
    [`${prefix}_rx`]: axis(2),             // right stick X
    [`${prefix}_ry`]: axis(3),             // right stick Y
    [`${prefix}_rt`]: triggerValue(gp, 5), // right trigger, 0..1
    [`${prefix}_lt`]: triggerValue(gp, 4), // left trigger, 0..1
  };

  for (const [name, idx] of Object.entries(CMD_BUTTONS)) {
    cmd[`${prefix}_${name}`] = buttonValue(gp, idx) > 0.5 ? 1 : 0;
  }

  return cmd;
}

function update() {
  const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

  for (let slot = 0; slot < MAX_CONTROLLERS; slot++) {
    const slotEl = slotEls[slot];
    if (!slotEl) continue;

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

    updateButtons(gp, controllerState[slot]);
    if (slot === 0) updateSticksAndText(gp);
  }

  setTeleop({
    ...controllerCmd(gamepads[0], "c1"),
    ...controllerCmd(gamepads[1], "c2"),
  });

  requestAnimationFrame(update);
}

function clearButtonIndicators(state) {
  state.buttonEls.forEach(el => el.classList.remove("pressed"));
  state.pressedAt.fill(0);
}

function resetController0Visuals() {
  if (leftStickDot) leftStickDot.style.transform = "translate(0px, 0px)";
  if (rightStickDot) rightStickDot.style.transform = "translate(0px, 0px)";
  if (pressedSummaryEl) pressedSummaryEl.textContent = "No input yet…";
}

function updateButtons(gp, state) {
  const now = performance.now();

  gp.buttons.forEach((btn, i) => {
    const el = state.buttonEls[i];
    if (!el) return;

    const pressed = typeof btn === "object" ? (btn.pressed || btn.value > 0.5) : (btn > 0.5);

    if (pressed && !state.pressedAt[i]) state.pressedAt[i] = now;
    else if (!pressed) state.pressedAt[i] = 0;

    el.classList.toggle("pressed", pressed);
  });
}

function updateSticksAndText(gp) {
  const lx = gp.axes[0] || 0;
  const ly = gp.axes[1] || 0;
  const rx = gp.axes[2] || 0;
  const ry = gp.axes[3] || 0;

  const dot = (x, y) => `translate(${(x * STICK_RADIUS_PX).toFixed(1)}px, ${(y * STICK_RADIUS_PX).toFixed(1)}px)`;
  if (leftStickDot) leftStickDot.style.transform = dot(lx, ly);
  if (rightStickDot) rightStickDot.style.transform = dot(rx, ry);

  if (!pressedSummaryEl) return;

  const mag = Math.min(1, Math.hypot(lx, ly));
  const angleDeg = (Math.atan2(-ly, lx) * 180 / Math.PI + 360) % 360;
  const leftStickStr = `LEFT_STICK: ${(mag * 100).toFixed(0)}% @ ${angleDeg.toFixed(0)}°`;

  const now = performance.now();
  const pressed = [];
  controllerState[0].pressedAt.forEach((t, i) => {
    if (t) pressed.push(`${XBOX_BUTTONS[i] || `B${i}`}: ${((now - t) / 1000).toFixed(1)}s`);
  });

  pressedSummaryEl.textContent = `${leftStickStr}, ${pressed.length ? pressed.join(", ") : "No buttons pressed"}`;
}
