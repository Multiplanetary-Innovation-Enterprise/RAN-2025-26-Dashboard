/*  app.js — Driver Station Browser Logic
    Responsibilities:
      1) Open a WebRTC PeerConnection to the laptop relay.
      2) Send teleop commands and heartbeats over DataChannels.
      3) Render incoming telemetry frames.
      4) Provide buttons for e-stop + queue commands.

    HTTP is used only for WebRTC SDP signaling. There is no WebSocket transport.
*/
import { flWheel } from "./wheel_cards/fl_telemetry.js";
import { frWheel } from "./wheel_cards/fr_telemetry.js";
import { rlWheel } from "./wheel_cards/rl_telemetry.js";
import { rrWheel } from "./wheel_cards/rr_telemetry.js";

let pc = null;
let cmdChannel = null;
let telemetryChannel = null;
let controlChannel = null;
let heartbeatChannel = null;

let isConnected = false;
let latestFaults = null;
let lastCmdSentMs = 0;
let lastHeartbeatId = 0;
let reconnectTimer = null;
let reconnectDelayMs = 1000;

const BROWSER_OFFER_PATH = "/api/webrtc/browser/offer";
const MAX_RECONNECT_DELAY_MS = 5000;

let dualTeleopCmd = {
  c1_lx: 0, c1_az: 0, c1_rx: 0, c1_ry: 0, c1_rt: 0, c1_lt: 0,
  c1_a: 0, c1_b: 0, c1_x: 0, c1_y: 0, c1_lb: 0, c1_rb: 0, c1_back: 0, c1_start: 0, c1_lclick: 0, c1_rclick: 0, c1_dup: 0, c1_ddown: 0, c1_dleft: 0, c1_dright: 0, c1_home: 0, c1_share: 0,
  c2_lx: 0, c2_az: 0, c2_rx: 0, c2_ry: 0, c2_rt: 0, c2_lt: 0,
  c2_a: 0, c2_b: 0, c2_x: 0, c2_y: 0, c2_lb: 0, c2_rb: 0, c2_back: 0, c2_start: 0, c2_lclick: 0, c2_rclick: 0, c2_dup: 0, c2_ddown: 0, c2_dleft: 0, c2_dright: 0, c2_home: 0, c2_share: 0
};

const CMD_PERIOD_MS = 50;           // 20 Hz cap
const HEARTBEAT_PERIOD_MS = 200;    // 5 Hz
const WHEEL_STATE_POLL_MS = 100;    // retained timing constant for UI compatibility
const FAULT_POLL_MS = 1000;         // retained timing constant for UI compatibility
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

window.DS_setTeleop = function(
  c1_lx, c1_az, c1_rx, c1_ry, c1_rt, c1_lt,
  c1_a, c1_b, c1_x, c1_y, c1_lb, c1_rb, c1_back, c1_start, c1_lclick, c1_rclick, c1_dup, c1_ddown, c1_dleft, c1_dright, c1_home, c1_share,
  c2_lx, c2_az, c2_rx, c2_ry, c2_rt, c2_lt,
  c2_a, c2_b, c2_x, c2_y, c2_lb, c2_rb, c2_back, c2_start, c2_lclick, c2_rclick, c2_dup, c2_ddown, c2_dleft, c2_dright, c2_home, c2_share
) {
  dualTeleopCmd = {
    c1_lx, c1_az, c1_rx, c1_ry, c1_rt, c1_lt,
    c1_a, c1_b, c1_x, c1_y, c1_lb, c1_rb, c1_back, c1_start, c1_lclick, c1_rclick, c1_dup, c1_ddown, c1_dleft, c1_dright, c1_home, c1_share,
    c2_lx, c2_az, c2_rx, c2_ry, c2_rt, c2_lt,
    c2_a, c2_b, c2_x, c2_y, c2_lb, c2_rb, c2_back, c2_start, c2_lclick, c2_rclick, c2_dup, c2_ddown, c2_dleft, c2_dright, c2_home, c2_share
  };

  const lxEl = $("#lx");
  const azEl = $("#az");
  if (lxEl) lxEl.textContent = Number(c1_lx || 0).toFixed(2);
  if (azEl) azEl.textContent = Number(c1_az || 0).toFixed(2);
};

const $ = sel => document.querySelector(sel);

function setConnStatus(text) {
  const el = $("#connStatus");
  if (el) el.textContent = text;
}

function setOwner(text) {
  const el = $("#owner");
  if (el) el.textContent = text;
}

function waitForIceGatheringComplete(peer) {
  if (peer.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      resolve();
    }, 5000);

    peer.addEventListener("icegatheringstatechange", () => {
      if (peer.iceGatheringState === "complete") {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

function closePeerConnection() {
  isConnected = false;

  const channels = [
    cmdChannel,
    telemetryChannel,
    controlChannel,
    heartbeatChannel,
  ];

  for (const channel of channels) {
    try {
      if (channel) channel.close();
    } catch (_) {
      // Already closed.
    }
  }

  cmdChannel = null;
  telemetryChannel = null;
  controlChannel = null;
  heartbeatChannel = null;

  if (pc) {
    try {
      pc.close();
    } catch (_) {
      // Already closed.
    }
  }

  pc = null;
}

function markConnectionState() {
  const ready =
    pc &&
    pc.connectionState === "connected" &&
    cmdChannel &&
    cmdChannel.readyState === "open" &&
    telemetryChannel &&
    telemetryChannel.readyState === "open" &&
    controlChannel &&
    controlChannel.readyState === "open" &&
    heartbeatChannel &&
    heartbeatChannel.readyState === "open";

  if (ready) {
    if (!isConnected) {
      isConnected = true;
      reconnectDelayMs = 1000;
      setConnStatus("connected");

      sendJson({
        t: "set",
        telemetry_hz: 10,
      });
    }
  } else if (isConnected) {
    isConnected = false;
    setConnStatus("transport degraded");
  }
}

function scheduleReconnect() {
  if (reconnectTimer || isConnected) return;

  setConnStatus(
    `reconnecting in ${(reconnectDelayMs / 1000).toFixed(1)}s`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebRTC();
  }, reconnectDelayMs);

  reconnectDelayMs = Math.min(
    reconnectDelayMs * 2,
    MAX_RECONNECT_DELAY_MS
  );
}

function attachChannel(channel, name, onmessage = null) {
  channel.binaryType = "arraybuffer";

  channel.onopen = () => {
    console.log(`[WebRTC] '${name}' DataChannel open`);
    markConnectionState();
  };

  channel.onclose = () => {
    console.log(`[WebRTC] '${name}' DataChannel closed`);
    isConnected = false;
    setConnStatus("transport disconnected");
  };

  channel.onerror = event => {
    console.error(`[WebRTC] '${name}' DataChannel error:`, event);
    isConnected = false;
  };

  if (onmessage) {
    channel.onmessage = onmessage;
  }
}

async function connectWebRTC() {
  if (
    pc &&
    (
      pc.connectionState === "connecting" ||
      pc.connectionState === "connected"
    )
  ) {
    return;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  closePeerConnection();

  setConnStatus("connecting");

  const peer = new RTCPeerConnection();
  pc = peer;

  peer.onconnectionstatechange = () => {
    const state = peer.connectionState;
    console.log(`[WebRTC] peer connection state: ${state}`);

    if (state === "connected") {
      markConnectionState();
      return;
    }

    if (state === "failed" || state === "closed") {
      if (pc === peer) {
        closePeerConnection();
        setConnStatus("disconnected");
        scheduleReconnect();
      }
      return;
    }

    if (state === "disconnected") {
      isConnected = false;
      setConnStatus("transport disconnected");
    }
  };

  peer.oniceconnectionstatechange = () => {
    console.log(
      `[WebRTC] ICE connection state: ${peer.iceConnectionState}`
    );
  };

  cmdChannel = peer.createDataChannel("cmd", {
    ordered: false,
    maxRetransmits: 0,
  });

  telemetryChannel = peer.createDataChannel("telemetry", {
    ordered: false,
    maxRetransmits: 0,
  });

  controlChannel = peer.createDataChannel("control", {
    ordered: true,
  });

  heartbeatChannel = peer.createDataChannel("heartbeat", {
    ordered: false,
    maxRetransmits: 0,
  });

  attachChannel(cmdChannel, "cmd");
  attachChannel(
    telemetryChannel,
    "telemetry",
    evt => {
      try {
        const raw =
          typeof evt.data === "string"
            ? evt.data
            : new TextDecoder().decode(evt.data);

        handleServerMessage(JSON.parse(raw));
      } catch (err) {
        console.error(
          "Invalid telemetry DataChannel message:",
          err
        );
      }
    }
  );

  attachChannel(
    controlChannel,
    "control",
    evt => {
      try {
        const raw =
          typeof evt.data === "string"
            ? evt.data
            : new TextDecoder().decode(evt.data);

        handleServerMessage(JSON.parse(raw));
      } catch (err) {
        console.error(
          "Invalid control DataChannel message:",
          err
        );
      }
    }
  );

  attachChannel(
    heartbeatChannel,
    "heartbeat",
    evt => {
      try {
        const raw =
          typeof evt.data === "string"
            ? evt.data
            : new TextDecoder().decode(evt.data);

        handleServerMessage(JSON.parse(raw));
      } catch (err) {
        console.error(
          "Invalid heartbeat DataChannel message:",
          err
        );
      }
    }
  );

  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    await waitForIceGatheringComplete(peer);

    const response = await fetch(
      BROWSER_OFFER_PATH,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          sdp: peer.localDescription.sdp,
          sdp_type: peer.localDescription.type,
          client: "browser",
          protocol: "0.3",
        }),
      }
    );

    if (!response.ok) {
      throw new Error(
        `signaling HTTP ${response.status}`
      );
    }

    const answer = await response.json();

    if (!answer.ok) {
      throw new Error(
        answer.error || "signaling request failed"
      );
    }

    await peer.setRemoteDescription({
      type: answer.sdp_type,
      sdp: answer.sdp,
    });

    console.log("[WebRTC] signaling complete.");
  } catch (err) {
    console.error(
      "[WebRTC] connection setup failed:",
      err
    );

    if (pc === peer) {
      closePeerConnection();
    }

    setConnStatus("connection failed");
    scheduleReconnect();
  }
}

function sendChannel(channel, obj) {
  if (!channel || channel.readyState !== "open") {
    return false;
  }

  try {
    channel.send(
      JSON.stringify(obj)
    );
    return true;
  } catch (err) {
    console.error(
      "[WebRTC] DataChannel send failed:",
      err
    );
    return false;
  }
}

function sendJson(obj) {
  let channel = controlChannel;

  if (obj.t === "cmd") {
    channel = cmdChannel;
  } else if (obj.t === "hb" || obj.t === "hb.ack") {
    channel = heartbeatChannel;
  }

  const sent = sendChannel(
    channel,
    obj
  );

  if (!sent) {
    return false;
  }

  return true;
}

function heartbeatLoop() {
  if (
    heartbeatChannel &&
    heartbeatChannel.readyState === "open"
  ) {
    lastHeartbeatId += 1;

    sendChannel(
      heartbeatChannel,
      {
        t: "hb",
        id: lastHeartbeatId,
        ts_ms: Date.now(),
      }
    );
  }

  setTimeout(
    heartbeatLoop,
    HEARTBEAT_PERIOD_MS
  );
}

function cmdLoop() {
  const now = performance.now();

  if (
    isConnected &&
    now - lastCmdSentMs >= CMD_PERIOD_MS
  ) {
    const payload = {
      t: "cmd",
      ...dualTeleopCmd,
    };

    sendChannel(
      cmdChannel,
      payload
    );

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
  else if (m.t === "hb.ack") {
    return;
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
    
    dualTeleopCmd.c1_lx = 0.5 * fwd;   // 0.5 m/s max — tune here
    dualTeleopCmd.c1_az = 1.0 * turn;  // 1.0 rad/s max — tune here
    
    const lxEl = $("#lx");
    const azEl = $("#az");
    if(lxEl) lxEl.textContent = dualTeleopCmd.c1_lx.toFixed(2);
    if(azEl) azEl.textContent = dualTeleopCmd.c1_az.toFixed(2);
  }
  window.addEventListener("keydown", (e) => { const t = map[e.code]; if (t){ pressed.add(t); e.preventDefault(); recompute(); } });
  window.addEventListener("keyup",   (e) => { const t = map[e.code]; if (t){ pressed.delete(t); e.preventDefault(); recompute(); } });
}

// Bind button click handlers
// E-stop, connect, enqueue, cancel buttons
function bindButtons() {
  $("#btnConnect").onclick = () => connectWebRTC();
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

  // These loops run exactly once for the lifetime of the page.
  // They simply stop transmitting while the WebRTC transport is unavailable.
  heartbeatLoop();
  cmdLoop();
}
main();
