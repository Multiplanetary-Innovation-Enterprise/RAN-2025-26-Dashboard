/*  app.js — Driver Station Browser Logic
    Responsibilities:
      1) Open a WebSocket to /ws (one pipe for all control + telemetry)
      2) Send heartbeats and teleop commands at capped rates
      3) Render incoming telemetry frames
      4) Provide buttons for e-stop + queue commands
    We keep names explicit and un-abstracted on purpose.
*/
let ws = null;
let isConnected = false;
let lastCmdSentMs = 0;
let teleop_lx = 0.0;                // linear x (m/s)
let teleop_az = 0.0;                // angular z (rad/s)
let teleop_lt = 0.0;                // linear x (m/s)
let teleop_rt = 0.0;               // angular z (rad/s)
let LT = 0.0;
let RT = 0.0;
let RX = 0.0;
let RY = 0.0;
let A = 0.0;
let B = 0.0;
let X = 0.0;
let Y = 0.0;
let LB = 0.0;
let RB = 0.0;
let BACK = 0.0;
let START = 0.0;
let LCLICK = 0.0;
let RCLICK = 0.0;
let DPAD_UP = 0.0;
let DPAD_DOWN = 0.0;
let DPAD_LEFT = 0.0;
let DPAD_RIGHT = 0.0;
let HOME = 0.0;
const CMD_PERIOD_MS = 50;           // 20 Hz cap
const HEARTBEAT_PERIOD_MS = 200;

// Allow other scripts (gamepad.js) to set teleop targets cleanly.
window.DS_setTeleop = function(lx, az, lt2, rt2) {
  teleop_lx = Number(lx) || 0.0;
  teleop_az = Number(az) || 0.0;
  teleop_lt = Number(lt2) || 0.0;
  teleop_rt = Number(rt2) || 0.0;
  //console.log("Lx: " + teleop_lx)
  //console.log("Az: " + teleop_az)
  $("#lx").textContent = teleop_lx.toFixed(2);
  $("#az").textContent = teleop_az.toFixed(2);
};

window.updateButtons = function(gp) {
  RX = Number(gp.axes[2]) || 0.0;
  RY = Number(gp.axes[3]) || 0.0;
  LT=gp.buttons[6].value || 0.0;
  RT=gp.buttons[7].value || 0.0;
  A=gp.buttons[0].value;
  B=gp.buttons[1].value;
  X=gp.buttons[2].value;
  Y=gp.buttons[3].value;
  LB=gp.buttons[4].value;
  RB=gp.buttons[5].value;
  BACK=gp.buttons[8].value;
  START=gp.buttons[9].value;
  LCLICK=gp.buttons[10].value;
  RCLICK=gp.buttons[11].value;
  DPAD_UP=gp.buttons[12].value;
  DPAD_DOWN=gp.buttons[13].value;
  DPAD_LEFT=gp.buttons[14].value;
  DPAD_RIGHT=gp.buttons[15].value;
  HOME=gp.buttons[16].value;
}

const $ = sel => document.querySelector(sel);

function setConnStatus(text) { $("#connStatus").textContent = text; }
function setOwner(text) { $("#owner").textContent = text; }
function setVideoStats(text) { $("#videoStats").textContent = text; }

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(`ws://${location.hostname}:8765/ws`);
  ws.onopen = () => {
    isConnected = true;
    setConnStatus("connected");
    sendJson({ t:"set", telemetry_hz: 10 });        // Ask for 10 Hz telemetry by default
  };
  ws.onclose = () => {
    isConnected = false;
    setConnStatus("disconnected");
  };
  ws.onmessage = (evt) => {
    const m = JSON.parse(evt.data);
    handleServerMessage(m);
  };
}

function sendJson(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function heartbeatLoop() {
  if (isConnected) sendJson({ t:"hb" });
  setTimeout(heartbeatLoop, HEARTBEAT_PERIOD_MS);
}

function cmdLoop() {
  const now = performance.now();
  if (isConnected && now - lastCmdSentMs >= CMD_PERIOD_MS) {
    const payload = { 
      t: "cmd", 
      lx: teleop_lx, 
      az: teleop_az,
      rx: RX,
      ry: RY,
      lt: LT, 
      rt: RT 
    };

    if (A) payload.btnA = 1;
    if (B) payload.btnB = 1;
    if (X) payload.btnX = 1;
    if (Y) payload.btnY = 1;
    if (LB) payload.btnLB = 1;
    if (RB) payload.btnRB = 1;
    if (BACK) payload.btnBACK = 1;
    if (START) payload.btnSTART = 1;
    if (LCLICK) payload.btnLCLICK = 1;
    if (RCLICK) payload.btnRCLICK = 1;
    if (DPAD_UP) payload.btnDUP = 1;
    if (DPAD_DOWN) payload.btnDDOWN = 1;
    if (DPAD_LEFT) payload.btnDLEFT = 1;
    if (DPAD_RIGHT) payload.btnDRIGHT = 1;
    if (HOME) payload.btnHOME = 1;
    sendJson(payload);
    lastCmdSentMs = now;
  }
  requestAnimationFrame(cmdLoop);
}

// Handle incoming messages from server
// Types: "hello", "tlm", "queue.state", "queue.result", "alert"
// t: string which indicates message type, tlm: telemetry object, queue: queue state/result object, alert: alert object.
//    mux: { string }, which is the current motion owner. Can be "teleop", "autonomy", or "" (none).
//    imu: { rpy: [number,number,number] }
//    enc: { l_rps:number, r_rps:number }
//    bat: { v:number, i:number }
//    net: { ctl_kbps:number, tlm_kbps:number, vid_kbps:number }
function handleServerMessage(m) {
  if (m.t === "hello") {
    // server greeting with version
  } 
  else if (m.t === "tlm") {
    if (m.mux) setOwner(m.mux);
    if (m.imu && m.imu.rpy) $("#imuRpy").textContent = m.imu.rpy.map(v => v.toFixed(2)).join(", ");
    if (m.enc) $("#encRps").textContent = `${(m.enc.l_rps ?? 0).toFixed(2)} / ${(m.enc.r_rps ?? 0).toFixed(2)}`;
    if (m.bat) $("#battery").textContent = `${(m.bat.v ?? 0).toFixed(2)} V, ${(m.bat.i ?? 0).toFixed(2)} A`;
    if (m.net) {
      const ctl = m.net.ctl_kbps ?? 0;
      const tlm = m.net.tlm_kbps ?? 0;
      const vid = m.net.vid_kbps ?? 0;

      $("#netKbps").textContent = `${ctl} | ${tlm} | ${vid}`;
      
      // create bandwidth event for bandwidth-panel.js
      const rx_mb_s = (tlm + vid) / 1024;
      const tx_mb_s = ctl / 1024;

      window.dispatchEvent(
        new CustomEvent("bandwidth", { 
          detail: { rx_mb_s, tx_mb_s }
        })
      );
    }
    if (m.wheel_cmd) {
      const panel = document.querySelector("rover-visual-panel");
      if (panel) panel.updateWheelAnimation(m.wheel_cmd);
    }
  } 
  else if (m.t === "queue.state") {
    $("#queueState").textContent = `active: ${(m.active?.progress ?? 0 * 100).toFixed(0)}% | pending: ${m.pending ?? 0}`;
  } 
  else if (m.t === "queue.result") {
    $("#queueState").textContent = `result: ${m.success ? "success" : "fail"} (${m.reason||""})`;
  } 
  else if (m.t === "alert") {
    alert(`${m.level?.toUpperCase()||"INFO"}: ${m.msg}`);
  }
}

/* Keyboard teleop: W/S forward/back, A/D left/right. */
function bindKeyboardTeleop() {
  const pressed = new Set();
  const map = { ArrowUp:"U", KeyW:"U", ArrowDown:"D", KeyS:"D", ArrowLeft:"L", KeyA:"L", ArrowRight:"R", KeyD:"R" };

  // Recompute teleop_lx and teleop_az based on currently pressed keys, and update display.  
  function recompute() {
    const fwd   = (pressed.has("U") ? 1 : 0) + (pressed.has("D") ? -1 : 0);
    const turn  = (pressed.has("R") ? 1 : 0) + (pressed.has("L") ? -1 : 0);
    teleop_lx = 0.5 * fwd;   // 0.5 m/s max — tune here
    teleop_az = 1.0 * turn;  // 1.0 rad/s max — tune here
    $("#lx").textContent = teleop_lx.toFixed(2);
    $("#az").textContent = teleop_az.toFixed(2);
  }
  window.addEventListener("keydown", (e) => { const t = map[e.code]; if (t){ pressed.add(t); e.preventDefault(); recompute(); } });
  window.addEventListener("keyup",   (e) => { const t = map[e.code]; if (t){ pressed.delete(t); e.preventDefault(); recompute(); } });
}

// Bind button click handlers
// E-stop, connect, enqueue, cancel buttons
function bindButtons() {
  $("#btnConnect").onclick = () => connectWebSocket();
  $("#btnEstop").onclick   = () => sendJson({ t:"estop", value:true });
  $("#btnEnqueue").onclick = () => {
    const distance = parseFloat($("#inDistance").value);
    const heading  = parseFloat($("#inHeading").value);
    const maxspd   = parseFloat($("#inMaxSpeed").value);
    sendJson({ t:"queue.drive", distance_m: distance, heading_deg: heading, max_speed_mps: maxspd });
  };
  $("#btnCancel").onclick = () => sendJson({ t:"queue.cancel" });
}

// Main entry point
function main() {
  bindKeyboardTeleop();
  bindButtons();
  heartbeatLoop();
  cmdLoop();
}
main();
