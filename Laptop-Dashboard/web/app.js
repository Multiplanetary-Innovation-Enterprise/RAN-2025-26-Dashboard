/*  app.js — Driver Station browser logic
      1) Open a WebRTC PeerConnection to the laptop relay.
      2) Send teleop commands (20 Hz) and heartbeats (5 Hz) over DataChannels.
      3) Render incoming telemetry, faults, and alerts.
      4) E-stop buttons.

    HTTP is used only for WebRTC SDP signaling. There is no WebSocket transport.
*/

const BROWSER_OFFER_PATH = "/api/webrtc/browser/offer";
const PROTOCOL_VERSION = "0.3";

const CMD_PERIOD_MS = 50;           // 20 Hz cap
const HEARTBEAT_PERIOD_MS = 200;    // 5 Hz
const MAX_RECONNECT_DELAY_MS = 5000;
const HANDSHAKE_TIMEOUT_MS = 10000;
const ALERT_CLEAR_MS = 8000;

// Link health monitor (connection bar)
const LINK_RENDER_MS = 250;
const HB_LOSS_TIMEOUT_MS = 1000;    // an unanswered heartbeat counts as lost
const HB_LOSS_WINDOW = 25;          // ~5 s of heartbeats at 5 Hz
const HB_LOSS_WARN_PCT = 10;
const LINK_WARN_AGE_MS = 600;       // ~3 missed heartbeats / 6 telemetry frames
const LINK_LOST_AGE_MS = 1500;
const PI_RTT_WARN_MS = 150;
const WIFI_WARN_DBM = -67;          // weaker than this: video starts to suffer
const WIFI_BAD_DBM = -75;           // weaker than this: drops are likely
const WIFI_TREND_MS = 10000;        // signal history used for the trend
const WIFI_TREND_MIN_MS = 5000;     // history needed before showing a trend
const WIFI_TREND_DB_PER_S = 0.6;    // ~6 dB per 10 s counts as rising / falling

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

let connectedAt = null;     // performance.now() when the session came up
let hbPending = new Map();  // heartbeat id -> performance.now() at send
let hbOutcomes = [];        // recent heartbeats: true = acked, false = lost
let hbRttMs = null;         // latest browser <-> laptop RTT
let lastHbAckAt = null;
let lastTlmAt = null;
let piRttMs = null;         // Pi <-> laptop RTT, reported in telemetry
let wifi = null;            // latest tlm.wifi (Pi <-> router)
let wifiHistory = [];       // [{ at, dbm }] covering the trend window

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
  resetLinkHealth();

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
      connectedAt = performance.now();
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
    if (send("heartbeat", { t: "hb", id: lastHeartbeatId, ts_ms: Date.now() })) {
      hbPending.set(lastHeartbeatId, performance.now());
    }
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

// hello / hello.ack need no handling.
function handleServerMessage(m) {
  switch (m.t) {
    case "tlm":
      handleTelemetry(m);
      break;
    case "hb.ack":
      onHeartbeatAck(m);
      break;
    case "alert":
      showAlert(m.level, m.msg);
      break;
  }
}

// Telemetry frame fields (see wire_protocol.txt):
//   mux, net, estop, faults, wheel_state, drive_mode, wifi
function handleTelemetry(m) {
  lastTlmAt = performance.now();
  if (m.wifi) onWifiSample(m.wifi);
  if (m.mux) setText("#owner", m.mux);
  if (typeof m.estop === "boolean") renderEstop(m.estop);

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
  if (Number.isFinite(net.rtt_ms)) piRttMs = net.rtt_ms;

  const ctl = net.ctl_kbps ?? 0;
  const tlm = net.tlm_kbps ?? 0;
  const vid = net.vid_kbps ?? 0;
  const ctlAvg = net.ctl_kbps_avg ?? 0;
  const tlmAvg = net.tlm_kbps_avg ?? 0;
  const vidAvg = net.vid_kbps_avg ?? 0;

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

// ------------------------------------------------------------
// Link health (heartbeat monitor)
//   Laptop: browser <-> laptop relay heartbeats (RTT, loss, last reply)
//   Rover:  laptop <-> Pi, from the Pi's heartbeat RTT and telemetry age
//   Wi-Fi:  Pi <-> router signal strength and its trend (tlm.wifi)
// ------------------------------------------------------------

function resetLinkHealth() {
  connectedAt = null;
  hbPending.clear();
  hbOutcomes = [];
  hbRttMs = null;
  lastHbAckAt = null;
  lastTlmAt = null;
  piRttMs = null;
  wifi = null;
  wifiHistory = [];
}

function recordHeartbeat(acked) {
  hbOutcomes.push(acked);
  if (hbOutcomes.length > HB_LOSS_WINDOW) hbOutcomes.shift();
}

function onHeartbeatAck(m) {
  const sentAt = hbPending.get(m.id);
  if (sentAt === undefined) return;   // already counted as lost

  hbPending.delete(m.id);
  lastHbAckAt = performance.now();
  hbRttMs = lastHbAckAt - sentAt;
  recordHeartbeat(true);
}

function renderLink(sel, state, detail) {
  const el = $(sel);
  if (!el) return;
  el.dataset.state = state;
  el.querySelector(".link-detail").textContent = detail;
}

const fmtRtt = ms => (ms < 1 ? "<1 ms" : `${Math.round(ms)} ms`);
const fmtAge = ms => `${(ms / 1000).toFixed(1)} s`;

function renderLinkHealth() {
  const now = performance.now();

  for (const [id, sentAt] of hbPending) {
    if (now - sentAt > HB_LOSS_TIMEOUT_MS) {
      hbPending.delete(id);
      recordHeartbeat(false);
    }
  }

  if (connectedAt === null) {
    renderLink("#linkLaptop", "off", "—");
    renderLink("#linkRover", "off", "—");
    renderLink("#linkWifi", "off", "—");
    return;
  }

  const hbAge = now - (lastHbAckAt ?? connectedAt);
  const lost = hbOutcomes.filter(acked => !acked).length;
  const lossPct = hbOutcomes.length ? Math.round(100 * lost / hbOutcomes.length) : 0;

  if (hbAge > LINK_LOST_AGE_MS) {
    renderLink("#linkLaptop", "bad", `no reply ${fmtAge(hbAge)}`);
  } else if (hbRttMs === null) {
    renderLink("#linkLaptop", "warn", "waiting");
  } else {
    const degraded = hbAge > LINK_WARN_AGE_MS || lossPct >= HB_LOSS_WARN_PCT;
    renderLink("#linkLaptop", degraded ? "warn" : "ok", `${fmtRtt(hbRttMs)} · ${lossPct}% loss`);
  }

  const tlmAge = now - (lastTlmAt ?? connectedAt);

  if (tlmAge > LINK_LOST_AGE_MS) {
    renderLink("#linkRover", "bad", `no data ${fmtAge(tlmAge)}`);
  } else if (lastTlmAt === null) {
    renderLink("#linkRover", "warn", "waiting");
  } else {
    const rtt = piRttMs === null ? "—" : fmtRtt(piRttMs);
    const stale = tlmAge > LINK_WARN_AGE_MS;
    const degraded = stale || piRttMs >= PI_RTT_WARN_MS;
    renderLink("#linkRover", degraded ? "warn" : "ok", stale ? `${rtt} · data ${fmtAge(tlmAge)} old` : rtt);
  }

  renderWifi(tlmAge);
}

function onWifiSample(w) {
  wifi = w;
  if (!w.connected || !Number.isFinite(w.signal_dbm)) return;

  const now = performance.now();
  wifiHistory.push({ at: now, dbm: w.signal_dbm });
  while (now - wifiHistory[0].at > WIFI_TREND_MS) wifiHistory.shift();
}

// Least-squares slope of the signal in dB/s (smooths out RSSI jitter);
// 0 until WIFI_TREND_MIN_MS of history exists.
function wifiSlopeDbPerS() {
  const n = wifiHistory.length;
  if (n < 2 || wifiHistory[n - 1].at - wifiHistory[0].at < WIFI_TREND_MIN_MS) return 0;

  const t0 = wifiHistory[0].at;
  let st = 0, sd = 0, stt = 0, std = 0;
  for (const { at, dbm } of wifiHistory) {
    const t = (at - t0) / 1000;
    st += t;
    sd += dbm;
    stt += t * t;
    std += t * dbm;
  }

  const denom = n * stt - st * st;
  return denom ? (n * std - st * sd) / denom : 0;
}

// Pi <-> router Wi-Fi. A falling trend raises a warning before the level
// itself is bad, which is the early sign of an approaching drop.
function renderWifi(tlmAge) {
  const el = $("#linkWifi");
  if (!el) return;

  el.title = "Pi ⇄ router Wi-Fi signal (1 Hz). " +
    `Green ≥ ${WIFI_WARN_DBM} dBm, amber to ${WIFI_BAD_DBM}, red below; ` +
    `↓/↑ = changing ${WIFI_TREND_DB_PER_S * 10}+ dB per 10 s.`;

  if (!wifi) {
    renderLink("#linkWifi", "off", lastTlmAt === null ? "—" : "not reported");
    return;
  }

  const dbm = wifi.signal_dbm;

  if (tlmAge > LINK_LOST_AGE_MS) {
    renderLink("#linkWifi", "off", Number.isFinite(dbm) ? `last ${dbm} dBm` : "—");
    return;
  }

  if (!wifi.connected || !Number.isFinite(dbm)) {
    renderLink("#linkWifi", "bad", wifi.error ? "read error" : "not associated");
    if (wifi.error) el.title += `\n${wifi.error}`;
    return;
  }

  const slope = wifiSlopeDbPerS();
  const falling = slope <= -WIFI_TREND_DB_PER_S;
  const arrow = falling ? " ↓" : slope >= WIFI_TREND_DB_PER_S ? " ↑" : "";
  const state = dbm < WIFI_BAD_DBM ? "bad" : (dbm < WIFI_WARN_DBM || falling) ? "warn" : "ok";
  const rate = Number.isFinite(wifi.tx_mbps) ? ` · ${Math.round(wifi.tx_mbps)} Mb/s` : "";

  renderLink("#linkWifi", state, `${dbm} dBm${arrow}${rate}`);

  const details = [
    wifi.ssid && `SSID ${wifi.ssid}`,
    Number.isFinite(wifi.freq_mhz) && `${(wifi.freq_mhz / 1000).toFixed(2)} GHz`,
    Number.isFinite(wifi.rx_mbps) && `rx ${Math.round(wifi.rx_mbps)} / tx ${Math.round(wifi.tx_mbps)} Mb/s`,
  ].filter(Boolean);
  if (details.length) el.title += `\n${details.join(" · ")}`;
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
  setInterval(renderLinkHealth, LINK_RENDER_MS);
  cmdLoop();
}

main();
