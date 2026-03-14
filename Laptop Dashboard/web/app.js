/*  app.js — Driver Station Browser Logic
    Responsibilities:
      1) Open a WebSocket to /ws (one pipe for all control + telemetry)
      2) Send heartbeats and teleop commands at capped rates
      3) Render incoming telemetry frames
      4) Provide buttons for e-stop + queue commands
    We keep names explicit and un-abstracted on purpose.
*/
import { flWheel } from "./wheel_cards/fl_telemetry.js";
import { frWheel } from "./wheel_cards/fr_telemetry.js";
import { rlWheel } from "./wheel_cards/rl_telemetry.js";
import { rrWheel } from "./wheel_cards/rr_telemetry.js";

let ws = null;
let isConnected = false;
let latestFaults = null;
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
const WHEEL_STATE_POLL_MS = 100;    // 10 Hz
const FAULT_POLL_MS = 1000;         // 1 Hz
let lastFaultPoll = 0;

const FAULT_LIST = [
  "brownout",
  "over_current",
  "over_voltage",
  "under_voltage",
  "hardware_failure",
  "device_temp",
  "processor_temp",
  "supply_over_current",
  "stator_over_current",

  "sticky_brownout",
  "sticky_over_current",
  "sticky_over_voltage",
  "sticky_under_voltage",
  "sticky_hardware_failure",
  "sticky_device_temp",
  "sticky_processor_temp",
  "sticky_supply_over_current",
  "sticky_stator_over_current",
];

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
    telemetryPollLoop();  // Start telemetry polling loop on connect
  };
  ws.onclose = () => {
    isConnected = false;
    setConnStatus("disconnected");
  };
  ws.onmessage = (evt) => {
    const m = JSON.parse(evt.data);
    console.log("WS message received:", m);
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

function telemetryPollLoop() {
  const now = performance.now();

  if (isConnected) {
    console.log("Sending svc requests...");

    // wheel telemetry (10 Hz)
    sendJson({ t: "svc", name: "wheel_state.poll" });

    // fault telemetry (1 Hz)
    if (now - lastFaultPoll >= FAULT_POLL_MS) {
      sendJson({ t: "svc", name: "faults.poll" });
      lastFaultPoll = now;
    }
  }

  setTimeout(telemetryPollLoop, WHEEL_STATE_POLL_MS);
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
    if (m.faults) {
      console.log("TLM faults received:", m.faults);
      handleFaults(m.faults)
    }
    if (m.wheel_state) {
      console.log("TLM wheel_state received:", m.wheel_state);
      handleWheelState(m.wheel_state);
    }
    if (m.drive_mode) {
      console.log("TLM drive mode recieved:", m.drive_mode);
      handleDriveMode(m.drive_mode);
    }
    if (m.net) {
      // Instantaneous kbps values
      const ctl = m.net.ctl_kbps ?? 0;
      const tlm = m.net.tlm_kbps ?? 0;
      const vid = m.net.vid_kbps ?? 0;

      // Rolling averages
      const ctl_avg = m.net.ctl_kbps_avg ?? 0;
      const tlm_avg = m.net.tlm_kbps_avg ?? 0;
      const vid_avg = m.net.vid_kbps_avg ?? 0;

      $("#netKbps").textContent = `${ctl} | ${tlm} | ${vid} (avg: ${ctl_avg} | ${tlm_avg} | ${vid_avg})`;
      
      // create bandwidth event for bandwidth-panel.js
      // Instantaneous
      const rx_mb_s = (tlm + vid) / 1000;  // convert kbps to Mbps (Megabits per second)
      const tx_mb_s = ctl / 1000;          // convert kbps to Mbps (Megabits per second)

      // Rolling average
      const rx_mb_s_avg = (tlm_avg + vid_avg) / 1000;  // convert kbps to Mbps (Megabits per second)
      const tx_mb_s_avg = ctl_avg / 1000;              // convert kbps to Mbps (Megabits per second)

      window.dispatchEvent(
        new CustomEvent("bandwidth", { 
          detail: { rx_mb_s, tx_mb_s, rx_mb_s_avg, tx_mb_s_avg }
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

function handleWheelState(data) {
  if (!data) return;

  const ws = data?.wheel_state ?? data;
  if (!ws) return;

  updateWheelCard("fl", flWheel, ws.fl);
  updateWheelCard("fr", frWheel, ws.fr);
  updateWheelCard("rl", rlWheel, ws.rl);
  updateWheelCard("rr", rrWheel, ws.rr);
}

function updateWheelCard(name, card, wheelData) {
  if (!card || !wheelData) return;

  const fault = latestFaults?.[name];

  let fault_state = "ok";

  if (!fault || fault.connected === false) {
    fault_state = "disconnected";
  } 
  else if (fault.fault === true) {
    fault_state = "fault";
  }

  card.update({
    ...wheelData,
    fault_state
  });
}

function handleFaults(data) {
  if (!data) return;

  const faults = data.kraken_faults ?? data;
  if (!faults) return;

  latestFaults = faults;
  updateFaultTable(latestFaults);
}

function buildFaultLookupTable() {
  const table = document.querySelector("#fault_table_body");
  if (!table) return;

  table.innerHTML = "";

  ["fl", "fr", "rl", "rr"].forEach(motor => {
    FAULT_LIST.forEach(fault => {
      const tr = document.createElement("tr");
      tr.dataset.motor = motor;
      tr.dataset.fault = fault;

      tr.innerHTML = `
        <td>${motor.toUpperCase()}</td>
        <td>${fault.replace(/_/g, " ")}</td>
        <td class="fault-cell unknown">—</td>
      `;

      table.appendChild(tr);
    });
  });
}

function updateFaultTable(faults) {
  if (!faults) return;

  ["fl", "fr", "rl", "rr"].forEach(motor => {
    const m = faults[motor];
    if (!m) return;

    FAULT_LIST.forEach(fault => {
      const row = document.querySelector(
        `tr[data-motor="${motor}"][data-fault="${fault}"]`
      );
      if (!row) return;

      const cell = row.querySelector(".fault-cell");
      if (!cell) return;

      // Motor not connected
      if (!m.connected) {
        cell.textContent = "NOT CONNECTED";
        cell.className = "fault-cell fault-disconnected";
        return;
      }

      // Normal fault check
      const active = !!(m.bits && m.bits[fault]);

      cell.textContent = active ? "FAULT" : "OK";
      cell.className = `fault-cell ${active ? "fault-active" : "fault-ok"}`;
    });
  });
}

function handleDriveMode(drivemode) {
  if (!drivemode) return;

  const mode = drivemode.drive_mode ?? drivemode;
  if (!mode) return;

  const el = document.getElementById("drive-mode-value");
  if (!el) return;

  el.textContent = mode;
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
  buildFaultLookupTable();
  bindKeyboardTeleop();
  bindButtons();
  heartbeatLoop();
  cmdLoop();
}
main();
