/*  app.js — Driver Station browser logic
      1) Open a WebRTC PeerConnection to the laptop relay.
      2) Send teleop commands (20 Hz) and heartbeats (5 Hz) over DataChannels.
      3) Render incoming telemetry, faults, and alerts.
      4) E-stop and queue buttons.

    HTTP is used only for WebRTC SDP signaling. There is no WebSocket transport.
*/

const BROWSER_OFFER_PATH = "/api/webrtc/browser/offer";
const PROTOCOL_VERSION = "0.3";

const CMD_PERIOD_MS = 50;           // 20 Hz cap
const HEARTBEAT_PERIOD_MS = 200;    // 5 Hz
const MAX_RECONNECT_DELAY_MS = 5000;
const HANDSHAKE_TIMEOUT_MS = 10000;
const ALERT_CLEAR_MS = 8000;

// Must match the laptop relay and the Pi's NetworkHandler.
const CHANNEL_OPTIONS = {
  cmd:       { ordered: false, maxRetransmits: 0 },
  telemetry: { ordered: false, maxRetransmits: 0 },
  control:   { ordered: true },
  heartbeat: { ordered: false, maxRetransmits: 0 },
};

const MOTORS = ["fl", "fr", "rl", "rr"];

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

let pc = null;
let channels = {};
let isConnected = false;
let reconnectTimer = null;
let reconnectDelayMs = 1000;

let teleopCmd = {};
let lastCmdSentMs = 0;
let lastHeartbeatId = 0;
let queueSeq = 0;

let latestFaults = null;
let faultCells = {};   // "fl/brownout" -> <td>
let alertTimer = null;

const $ = sel => document.querySelector(sel);
const decoder = new TextDecoder();

function setText(sel, text) {
  const el = $(sel);
  if (el) el.textContent = text;
}

// Called by gamepad.js every frame with the full c1_* / c2_* command.
export function setTeleop(cmd) {
  teleopCmd = cmd;
}

// ------------------------------------------------------------
// WebRTC transport
// ------------------------------------------------------------

function waitForIceGatheringComplete(peer) {
  if (peer.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    const timeout = setTimeout(resolve, 5000);

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

  for (const channel of Object.values(channels)) {
    try { channel.close(); } catch (_) { /* already closed */ }
  }
  channels = {};

  if (pc) {
    try { pc.close(); } catch (_) { /* already closed */ }
  }
  pc = null;
}

function channelOpen(name) {
  return channels[name]?.readyState === "open";
}

function channelStates() {
  return Object.keys(CHANNEL_OPTIONS)
    .map(name => `${name}=${channels[name]?.readyState ?? "none"}`)
    .join(" ");
}

function markConnectionState() {
  const peerConnected = pc?.connectionState === "connected";

  console.log(`[WebRTC] peer=${pc?.connectionState ?? "none"} ${channelStates()}`);

  // Control is ready once cmd + control are up. Telemetry/heartbeat are
  // independent streams and must not block teleoperation.
  if (peerConnected && channelOpen("cmd") && channelOpen("control")) {
    if (!isConnected) {
      isConnected = true;
      reconnectDelayMs = 1000;
      setText("#connStatus", "connected");

      send("control", { t: "hello", ver: PROTOCOL_VERSION, client: "browser" });
      send("control", { t: "set", telemetry_hz: 10 });
    }
    return;
  }

  if (peerConnected) {
    setText("#connStatus", `connecting (${channelStates()})`);
  }
}

function scheduleReconnect() {
  if (reconnectTimer || isConnected) return;

  setText("#connStatus", `reconnecting in ${(reconnectDelayMs / 1000).toFixed(1)}s`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebRTC();
  }, reconnectDelayMs);

  reconnectDelayMs = Math.min(reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
}

function onChannelMessage(evt) {
  try {
    const raw = typeof evt.data === "string" ? evt.data : decoder.decode(evt.data);
    handleServerMessage(JSON.parse(raw));
  } catch (err) {
    console.error(`Invalid '${evt.target.label}' DataChannel message:`, err);
  }
}

function openChannel(peer, name) {
  const channel = peer.createDataChannel(name, CHANNEL_OPTIONS[name]);
  channel.binaryType = "arraybuffer";

  channel.onopen = () => {
    console.log(`[WebRTC] '${name}' DataChannel open`);
    markConnectionState();
  };

  channel.onclose = () => {
    console.log(`[WebRTC] '${name}' DataChannel closed`);
    isConnected = false;
    setText("#connStatus", "transport disconnected");
  };

  channel.onerror = event => {
    console.error(`[WebRTC] '${name}' DataChannel error:`, event);
    isConnected = false;
  };

  // The browser only ever sends on "cmd".
  if (name !== "cmd") channel.onmessage = onChannelMessage;

  return channel;
}

async function connectWebRTC() {
  if (pc && (pc.connectionState === "connecting" || pc.connectionState === "connected")) {
    return;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  closePeerConnection();
  setText("#connStatus", "connecting");

  const peer = new RTCPeerConnection();
  pc = peer;

  peer.onconnectionstatechange = () => {
    const state = peer.connectionState;
    console.log(`[WebRTC] peer connection state: ${state}`);

    if (state === "connected") {
      markConnectionState();
    } else if (state === "failed" || state === "closed") {
      if (pc === peer) {
        closePeerConnection();
        setText("#connStatus", "disconnected");
        scheduleReconnect();
      }
    } else if (state === "disconnected") {
      isConnected = false;
      setText("#connStatus", "transport disconnected");
    }
  };

  for (const name of Object.keys(CHANNEL_OPTIONS)) {
    channels[name] = openChannel(peer, name);
  }

  try {
    await peer.setLocalDescription(await peer.createOffer());
    await waitForIceGatheringComplete(peer);

    const response = await fetch(BROWSER_OFFER_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        sdp: peer.localDescription.sdp,
        sdp_type: peer.localDescription.type,
        client: "browser",
        protocol: PROTOCOL_VERSION,
      }),
    });

    if (!response.ok) {
      throw new Error(`signaling HTTP ${response.status}`);
    }

    const answer = await response.json();
    if (!answer.ok) {
      throw new Error(answer.error || "signaling request failed");
    }

    await peer.setRemoteDescription({ type: answer.sdp_type, sdp: answer.sdp });
    console.log("[WebRTC] signaling complete.");

    // Surface a stuck SCTP/DataChannel handshake instead of sitting in "connecting".
    setTimeout(() => {
      if (pc === peer && !isConnected) {
        console.error(`[WebRTC] DataChannel handshake timeout: peer=${peer.connectionState} ${channelStates()}`);
      }
    }, HANDSHAKE_TIMEOUT_MS);
  } catch (err) {
    console.error("[WebRTC] connection setup failed:", err);

    if (pc === peer) closePeerConnection();

    setText("#connStatus", "connection failed");
    scheduleReconnect();
  }
}

function send(channelName, obj) {
  const channel = channels[channelName];
  if (!channel || channel.readyState !== "open") return false;

  try {
    channel.send(JSON.stringify(obj));
    return true;
  } catch (err) {
    console.error(`[WebRTC] '${channelName}' send failed:`, err);
    return false;
  }
}

function heartbeatLoop() {
  if (channelOpen("heartbeat")) {
    lastHeartbeatId += 1;
    send("heartbeat", { t: "hb", id: lastHeartbeatId, ts_ms: Date.now() });
  }
}

function cmdLoop() {
  const now = performance.now();

  if (isConnected && now - lastCmdSentMs >= CMD_PERIOD_MS) {
    const payload = { t: "cmd" };

    // NaN serializes to JSON null, which the Pi rejects before publishing Joy.
    for (const [key, value] of Object.entries(teleopCmd)) {
      payload[key] = Number.isFinite(value) ? value : 0;
    }

    send("cmd", payload);
    lastCmdSentMs = now;
  }

  requestAnimationFrame(cmdLoop);
}

// ------------------------------------------------------------
// Incoming messages
// ------------------------------------------------------------

// hello / hello.ack / hb.ack need no handling.
function handleServerMessage(m) {
  switch (m.t) {
    case "tlm":
      handleTelemetry(m);
      break;
    case "queue.state":
      renderQueueState(m);
      break;
    case "queue.result":
      setText("#queueResult", `last result: ${m.success ? "success" : "fail"} (${m.reason || ""})`);
      break;
    case "alert":
      showAlert(m.level, m.msg);
      break;
  }
}

// Telemetry frame fields (see wire_protocol.txt):
//   mux, imu, enc, bat, net, queue, estop, faults, wheel_state, drive_mode
function handleTelemetry(m) {
  if (m.mux) setText("#owner", m.mux);
  if (m.imu?.rpy) setText("#imuRpy", m.imu.rpy.map(v => v.toFixed(2)).join(", "));
  if (m.enc) setText("#encRps", `${(m.enc.l_rps ?? 0).toFixed(2)} / ${(m.enc.r_rps ?? 0).toFixed(2)}`);
  if (m.bat) setText("#battery", `${(m.bat.v ?? 0).toFixed(2)} V, ${(m.bat.i ?? 0).toFixed(2)} A`);
  if (typeof m.estop === "boolean") renderEstop(m.estop);
  if (m.queue) renderQueueState(m.queue);

  if (m.faults) {
    latestFaults = m.faults;
    updateFaultTable(latestFaults);
  }

  if (m.wheel_state) {
    const wheels = m.wheel_state.wheel_state ?? m.wheel_state;

    for (const motor of MOTORS) {
      $(`wheel-card[wheel="${motor}"]`)?.update?.(wheels[motor], wheelFaultState(motor));
    }
    $("rover-visual-panel")?.update?.(wheels, m.wheel_state.steer_source);
  }

  const mode = m.drive_mode?.drive_mode ?? m.drive_mode;
  if (typeof mode === "string") setText("#drive-mode-value", mode);

  if (m.net) handleNetStats(m.net);
}

function handleNetStats(net) {
  const ctl = net.ctl_kbps ?? 0;
  const tlm = net.tlm_kbps ?? 0;
  const vid = net.vid_kbps ?? 0;
  const ctlAvg = net.ctl_kbps_avg ?? 0;
  const tlmAvg = net.tlm_kbps_avg ?? 0;
  const vidAvg = net.vid_kbps_avg ?? 0;

  setText("#netKbps", `${ctl} | ${tlm} | ${vid} (avg: ${ctlAvg} | ${tlmAvg} | ${vidAvg})`);

  // kbps -> Mbps for bandwidth-panel.js
  window.dispatchEvent(new CustomEvent("bandwidth", {
    detail: {
      rx_mb_s: (tlm + vid) / 1000,
      tx_mb_s: ctl / 1000,
      rx_mb_s_avg: (tlmAvg + vidAvg) / 1000,
      tx_mb_s_avg: ctlAvg / 1000,
    },
  }));
}

function renderQueueState(q) {
  const progress = Math.round((q.active?.progress ?? 0) * 100);
  const pending = Array.isArray(q.pending) ? q.pending.length : (q.pending ?? 0);
  setText("#queueState", q.active ? `active: ${progress}% | pending: ${pending}` : `idle | pending: ${pending}`);
}

function renderEstop(latched) {
  const el = $("#estopState");
  if (!el) return;
  el.textContent = latched ? "LATCHED" : "clear";
  el.className = latched ? "estop-latched" : "estop-clear";
}

function showAlert(level = "info", msg = "") {
  const el = $("#alertMsg");
  console.log(`[alert] ${level}: ${msg}`);
  if (!el) return;

  // Never use window.alert(): it blocks the page, which stalls the cmd loop.
  el.textContent = `${level.toUpperCase()}: ${msg}`;
  el.className = `alert-${level}`;

  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => {
    el.textContent = "";
    el.className = "";
  }, ALERT_CLEAR_MS);
}

// ------------------------------------------------------------
// Kraken faults
// ------------------------------------------------------------

function wheelFaultState(motor) {
  const fault = latestFaults?.[motor];
  if (!fault || fault.connected === false) return "disconnected";
  return fault.fault === true ? "fault" : "ok";
}

function buildFaultLookupTable() {
  const table = $("#fault_table_body");
  if (!table) return;

  table.innerHTML = "";
  faultCells = {};

  for (const motor of MOTORS) {
    for (const fault of FAULT_LIST) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${motor.toUpperCase()}</td>
        <td>${fault.replace(/_/g, " ")}</td>
        <td class="fault-cell fault-unknown">—</td>
      `;
      faultCells[`${motor}/${fault}`] = tr.querySelector(".fault-cell");
      table.appendChild(tr);
    }
  }
}

function updateFaultTable(faults) {
  for (const motor of MOTORS) {
    const m = faults[motor];
    if (!m) continue;

    for (const fault of FAULT_LIST) {
      const cell = faultCells[`${motor}/${fault}`];
      if (!cell) continue;

      if (!m.connected) {
        cell.textContent = "NOT CONNECTED";
        cell.className = "fault-cell fault-disconnected";
        continue;
      }

      const active = !!m.bits?.[fault];
      cell.textContent = active ? "FAULT" : "OK";
      cell.className = `fault-cell ${active ? "fault-active" : "fault-ok"}`;
    }
  }
}

// ------------------------------------------------------------
// Operator input
// ------------------------------------------------------------

function sendEstop(value) {
  if (!send("control", { t: "estop", value })) {
    showAlert("error", `E-STOP ${value ? "" : "clear "}NOT SENT: not connected`);
  }
}

function isTypingTarget(el) {
  return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

function bindControls() {
  $("#btnConnect").onclick = () => connectWebRTC();
  $("#btnEstop").onclick = () => sendEstop(true);
  $("#btnEstopClear").onclick = () => {
    if (confirm("Clear E-STOP and allow motion?")) sendEstop(false);
  };

  $("#btnEnqueue").onclick = () => {
    queueSeq += 1;
    send("control", {
      t: "queue.drive",
      id: `drive-${queueSeq}`,
      distance_m: parseFloat($("#inDistance").value),
      heading_deg: parseFloat($("#inHeading").value),
      max_speed_mps: parseFloat($("#inMaxSpeed").value),
    });
  };
  $("#btnCancel").onclick = () => send("control", { t: "queue.cancel" });

  // Space = E-STOP. Swallow keyup too so Space never "clicks" a focused button
  // (e.g. Clear).
  const onSpace = (e, fire) => {
    if (e.code !== "Space" || isTypingTarget(e.target)) return;
    e.preventDefault();
    if (fire && !e.repeat) sendEstop(true);
  };
  window.addEventListener("keydown", e => onSpace(e, true), true);
  window.addEventListener("keyup", e => onSpace(e, false), true);
}

function main() {
  buildFaultLookupTable();
  bindControls();

  // These loops run for the lifetime of the page and simply stop
  // transmitting while the WebRTC transport is unavailable.
  setInterval(heartbeatLoop, HEARTBEAT_PERIOD_MS);
  cmdLoop();
}

main();
