// --- Config ---
const MAX_CONTROLLERS = 1;
const MAX_STEER_DEG = 30; // +/- degrees for front wheel steering

// Xbox button mapping (standard Gamepad layout)
const XBOX_BUTTONS = [
  "A",           // 0
  "B",           // 1
  "X",           // 2
  "Y",           // 3
  "LB",          // 4
  "RB",          // 5
  "LT",          // 6
  "RT",          // 7
  "BACK",        // 8
  "START",       // 9
  "L_STICK",     // 10
  "R_STICK",     // 11
  "DPAD_UP",     // 12
  "DPAD_DOWN",   // 13
  "DPAD_LEFT",   // 14
  "DPAD_RIGHT",  // 15
  "GUIDE"        // 16 (sometimes not exposed)
];

// Elements
const slotEl = document.querySelector(".controller-slot");
const leftStickDot = document.getElementById("left-stick-dot");
const rightStickDot = document.getElementById("right-stick-dot");
const pressedSummaryEl = document.getElementById("pressed-summary");

// Rover elements
const wheelFL = document.querySelector(".wheel.front-left");
const wheelFR = document.querySelector(".wheel.front-right");
const wheelRL = document.querySelector(".wheel.rear-left");
const wheelRR = document.querySelector(".wheel.rear-right");
const throttleFill = document.getElementById("throttle-fill");
const throttleLabel = document.getElementById("throttle-label");

// Runtime data for controller 1
const controllerState = {
    index: null,
    buttonMeta: [], // [{pressed, pressedAt}]
    buttonEls: []
};

// Build button indicators for controller 1
  const grid = slotEl.querySelector(".buttons-grid");
  XBOX_BUTTONS.forEach((name, btnIndex) => {
    const div = document.createElement("div");
    div.className = "button-indicator";
    div.dataset.buttonIndex = btnIndex.toString();
    div.textContent = name;
    grid.appendChild(div);

    controllerState.buttonEls[btnIndex] = div;
    controllerState.buttonMeta[btnIndex] = {
      pressed: false,
      pressedAt: 0
    };
  });

// Listen for connection/disconnection events
window.addEventListener("gamepadconnected", e => {
  console.log("Gamepad connected:", e.gamepad);
});

window.addEventListener("gamepaddisconnected", e => {
  console.log("Gamepad disconnected:", e.gamepad);
});

// Main loop
function update() {
  if (typeof window.DS_setTeleop !== "function") {
    requestAnimationFrame(update);
    return;
  }
  
  const gamepads = (navigator.getGamepads
    ? navigator.getGamepads()
    : []);
  const gp = gamepads.find(g => g) || null;

    if (!gp) {
      slotEl.querySelector(".status").textContent = "Not connected";
      slotEl.classList.remove("connected");
      clearButtonIndicators(controllerState);
      resetController0Visuals();
    } else {
      slotEl.classList.add("connected");
      slotEl.querySelector(".status").textContent = `Connected: ${gp.id}`;
      controllerState.index = gp.index;

      updateButtons(gp, controllerState);
      updateSticksAndText(gp);
      updateRoverFromGamepad(gp);
    }

  requestAnimationFrame(update);
}

// Clear pressed state for slot
function clearButtonIndicators(state) {
  state.buttonEls.forEach(el => el && el.classList.remove("pressed"));
  state.buttonMeta.forEach(meta => {
    meta.pressed = false;
    meta.pressedAt = 0;
  });
}

// Reset visuals when controller 1 is not present
function resetController0Visuals() {
  if (leftStickDot) {
    leftStickDot.style.transform = "translate(0px, 0px)";
  }
  if (rightStickDot) {
    rightStickDot.style.transform = "translate(0px, 0px)";
  }
  if (pressedSummaryEl) {
    pressedSummaryEl.textContent = "No input yet…";
  }
  updateRoverFromGamepad(null);
}

// Update button meta + highlight
function updateButtons(gp, state) {
  const now = performance.now();

  gp.buttons.forEach((btn, i) => {
    const meta = state.buttonMeta[i];
    const el = state.buttonEls[i];
    if (!meta || !el) return;

    const pressed = btn.pressed || btn.value > 0.5;

    // state transitions
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

// Left/right stick visuals + text summary for slot 0
function updateSticksAndText(gp) {
  // Axes: 0 = LS X, 1 = LS Y, 2 = RS X, 3 = RS Y (standard)
  const lx = gp.axes[0] || 0;
  const ly = gp.axes[1] || 0;
  const rx = gp.axes[2] || 0;
  const ry = gp.axes[3] || 0;

  // Move stick dots (radius 30px inside 80px circle)
  const radius = 30;
  if (leftStickDot) {
    leftStickDot.style.transform =
      `translate(${(lx * radius).toFixed(1)}px, ${(ly * radius).toFixed(1)}px)`;
  }
  if (rightStickDot) {
    rightStickDot.style.transform =
      `translate(${(rx * radius).toFixed(1)}px, ${(ry * radius).toFixed(1)}px)`;
  }

  // Magnitude + angle for left stick
  const mag = Math.min(1, Math.sqrt(lx * lx + ly * ly));
  const magPct = (mag * 100).toFixed(0);
  // atan2: y is inverted in UI, but for angle semantics we might want -ly
  const angleRad = Math.atan2(-ly, lx);
  const angleDeg = (angleRad * 180 / Math.PI + 360) % 360;

  const leftStickStr = `LEFT_STICK: ${magPct}% @ ${angleDeg.toFixed(0)}°`;

  // Active buttons + hold times
  const state = controllerState;
  const now = performance.now();

  const pressedPieces = [];
  state.buttonMeta.forEach((meta, i) => {
    if (!meta.pressed) return;
    const name = XBOX_BUTTONS[i] || `B${i}`;
    const seconds = ((now - meta.pressedAt) / 1000).toFixed(1);
    pressedPieces.push(`${name}: ${seconds}s`);
  });

  const suffix = pressedPieces.length
    ? pressedPieces.join(", ")
    : "No buttons pressed";

  if (pressedSummaryEl) {
    pressedSummaryEl.textContent = `${leftStickStr}, ${suffix}`;
  }
}

// Update rover wheels & throttle from left stick
function updateRoverFromGamepad(gp) {
  if (!gp) {
    // Neutral
    setWheelSteer(0);
    setThrottle(0);
    if (typeof window.DS_setTeleop === "function") {
      //window.DS_setTeleop(0.0, 0.0);
      window.DS_setTeleop(0.0, 0.0, 0.0, 0.0);
    }

    return;
  }
  window.updateButtons(gp);
  //Left Stick
  const lx = gp.axes[0] || 0;
  const ly = gp.axes[1] || 0;
  //Right Stick
  //const rx = gp.axes[2] || 0;
  //const ry = gp.axes[3] || 0;
  //Triggers
  const lt = gp.buttons[6].value || 0;
  const rt = gp.buttons[7].value || 0;

  // In most gamepad layouts: up = -1, down = +1
  const throttleRaw = -ly; // so up stick = forward
  const steerRaw = lx;

  // Drive the rover using the same teleop variables app.js already sends (cmdLoop).
  if (typeof window.DS_setTeleop === "function") {
    // Match keyboard scaling in app.js: 0.5 m/s max, 1.0 rad/s max
    const cmd_lx = 1 * throttleRaw;
    const cmd_az = 1.0 * steerRaw;
    //window.DS_setTeleop(cmd_lx, cmd_az);
    window.DS_setTeleop(cmd_lx,
                        cmd_az,
                        //gp.axes[2] || 0.0,     // rx
                        //gp.axes[3] || 0.0,     // ry
                        rt,
                        lt,
                        /*
                        gp.buttons[0].pressed ? 1 : 0,   // A
                        gp.buttons[1].pressed ? 1 : 0,   // B
                        gp.buttons[2].pressed ? 1 : 0,   // X
                        gp.buttons[3].pressed ? 1 : 0,   // Y
                        gp.buttons[4].pressed ? 1 : 0,   // LB
                        gp.buttons[5].pressed ? 1 : 0,   // RB
                        gp.buttons[8].pressed ? 1 : 0,   // BACK
                        gp.buttons[9].pressed ? 1 : 0,   // START
                        gp.buttons[10].pressed ? 1 : 0,  // LCLICK
                        gp.buttons[11].pressed ? 1 : 0,  // RCLICK
                        gp.buttons[12].pressed ? 1 : 0,  // DUP
                        gp.buttons[13].pressed ? 1 : 0,  // DDOWN
                        gp.buttons[14].pressed ? 1 : 0,  // DLEFT
                        gp.buttons[15].pressed ? 1 : 0,  // DRIGHT
                        gp.buttons[16]?.pressed ? 1 : 0 // HOME
                        */
);
  }


  setWheelSteer(steerRaw * MAX_STEER_DEG);
  setThrottle(throttleRaw);
}

function setWheelSteer(deg) {
  // Front wheels steer; rear wheels fixed
  const frontTransform = `rotate(${deg.toFixed(1)}deg)`;
  const rearTransform = `rotate(0deg)`;

  if (wheelFL) wheelFL.style.transform = frontTransform;
  if (wheelFR) wheelFR.style.transform = frontTransform;
  if (wheelRL) wheelRL.style.transform = rearTransform;
  if (wheelRR) wheelRR.style.transform = rearTransform;

  // Color tint based on steering intensity (optional)
  const intensity = Math.min(1, Math.abs(deg) / MAX_STEER_DEG);
  const baseColor = 63; // from #3f485f
  const delta = Math.round(80 * intensity);
  const newG = baseColor + delta;
  const newB = baseColor + delta;

  [wheelFL, wheelFR, wheelRL, wheelRR].forEach(w => {
    if (!w) return;
    w.style.backgroundColor = `rgb(${baseColor}, ${newG}, ${newB})`;
  });
}

function setThrottle(throttle) {
  // Clamp to [-1, 1]
  const t = Math.max(-1, Math.min(1, throttle));
  const percent = (t * 100).toFixed(0);

  // Fill grows symmetrically from center:
  // height proportional to |t|, and translate so center = 50%
  const height = Math.abs(t) * 100;
  const directionSign = t >= 0 ? 1 : -1; // up / down from center
  console.log("SetThrottle")
  if (throttleFill) {
    throttleFill.style.height = `${height}%`;
    throttleFill.style.transform =
      `translateY(${directionSign > 0 ? "0%" : "-100%"})`;
  }

  if (throttleLabel) {
    const dirLabel = t > 0.05 ? "Forward" : t < -0.05 ? "Reverse" : "Neutral";
    throttleLabel.textContent =
      `Throttle: ${percent}% (${dirLabel})`;
  }
}
//window.setThrottle = setThrottle;

// Kick off
requestAnimationFrame(update);
