// recorder.js — records power telemetry to a CSV file in the browser.
// app.js passes every telemetry frame to recordFrame(); rows are only kept
// while recording. stopRecording() downloads the CSV (browser Downloads folder).
//
// One row per telemetry frame (~10 Hz). Frames dropped by the network are
// missing rows, but energy columns come from Pi-side counters integrated at
// the source (drive at 200 Hz, Pi at 1 Hz), so they stay correct across drops.
// Blank cells mean "no value" (e.g. efficiency while idle or regenerating).

const WHEELS = ["fl", "fr", "rl", "rr"];

const WHEEL_COLUMNS = [
  ["power_w",           w => w.power_w, 2],
  ["efficiency_pct",    w => pct(w.efficiency), 1],
  ["mech_power_w",      w => w.mech_power_w, 2],
  ["supply_current_a",  w => w.supply_current, 3],
  ["supply_voltage_v",  w => w.supply_voltage, 3],
  ["motor_voltage_v",   w => w.motor_voltage, 3],
  ["stator_current_a",  w => w.current, 3],
  ["torque_current_a",  w => w.torque_current, 3],
  ["wheel_rps",         w => w.measured_rps, 4],
  ["cmd_rps",           w => w.commanded_rps, 4],
  ["steer_deg",         w => deg(w.steer_measured), 2],   // measured only
  ["temp_c",            w => w.temp, 1],
];

const HEADER = [
  "laptop_time_iso", "pi_time_ms", "t_s", "seq",
  "drive_mode", "estop",
  "drive_power_w", "drive_mech_power_w", "drive_system_efficiency_pct",
  "drive_bus_voltage_v", "drive_energy_wh",
  "pi_power_w", "pi_input_v", "pi_energy_wh",
  "rover_power_w", "rover_energy_wh",
  ...WHEELS.flatMap(w => WHEEL_COLUMNS.map(([name]) => `${w}_${name}`)),
  "wheel_state_age_s", "pi_power_age_s",
];

// Drivetrain battery-to-rotor efficiency is undefined below this input.
const SYSTEM_EFF_MIN_INPUT_W = 4.0;

let recording = false;
let rows = [];
let startedAt = null;       // performance.now()
let firstPiMs = null;
let lastPiMs = null;
let driveEnergy = null;     // energy counters relative to the recording start
let piEnergy = null;

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

export function isRecording() {
  return recording;
}

export function startRecording() {
  if (recording) return;
  recording = true;
  rows = [];
  startedAt = performance.now();
  firstPiMs = lastPiMs = null;
  driveEnergy = energyCounter();
  piEnergy = energyCounter();
  emit();
}

export function stopRecording() {
  if (!recording) return;
  recording = false;

  if (rows.length) {
    download(
      [HEADER.join(","), ...rows].join("\r\n") + "\r\n",
      `rover_power_${fileStamp(new Date())}.csv`,
    );
  }
  emit({ saved: rows.length });
  rows = [];
}

export function recordStatus() {
  return {
    recording,
    rows: rows.length,
    elapsed_s: recording ? (performance.now() - startedAt) / 1000 : 0,
  };
}

// Called by app.js for every telemetry frame.
export function recordFrame(m) {
  if (!recording || !m) return;

  // Telemetry is unordered: keep the CSV monotonic in Pi time.
  const piMs = Number(m.ts_ms);
  if (!Number.isFinite(piMs) || (lastPiMs !== null && piMs <= lastPiMs)) return;
  if (firstPiMs === null) firstPiMs = piMs;
  lastPiMs = piMs;

  const ws = m.wheel_state ?? {};
  const wheels = ws.wheel_state ?? {};
  const pi = m.pi_power ?? {};
  const piOk = pi.available === true;

  const drivePower = num(ws.total_power_w);
  const driveMech = num(ws.total_mech_power_w);
  const piPower = piOk ? num(pi.power_w) : null;

  const busVolts = WHEELS.map(w => num(wheels[w]?.supply_voltage)).filter(v => v > 0);
  const busV = busVolts.length ? busVolts.reduce((a, v) => a + v, 0) / busVolts.length : null;

  const systemEff =
    drivePower !== null && driveMech !== null &&
    drivePower >= SYSTEM_EFF_MIN_INPUT_W && driveMech > 0
      ? Math.min(driveMech / drivePower, 1) * 100
      : null;

  const driveWh = driveEnergy.update(num(ws.drive_energy_wh), ws.energy_epoch);
  const piWh = piEnergy.update(num(pi.energy_wh), pi.energy_epoch);

  const row = [
    new Date().toISOString(),
    String(piMs),
    fmt((piMs - firstPiMs) / 1000, 3),
    String(m.seq ?? ""),
    csvText(m.drive_mode?.drive_mode ?? m.drive_mode ?? ""),
    typeof m.estop === "boolean" ? (m.estop ? "1" : "0") : "",
    fmt(drivePower, 2),
    fmt(driveMech, 2),
    fmt(systemEff, 1),
    fmt(busV, 3),
    fmt(driveWh, 5),
    fmt(piPower, 3),
    fmt(piOk ? num(pi.input_v) : null, 3),
    fmt(piWh, 5),
    fmt(drivePower !== null && piPower !== null ? drivePower + piPower : null, 2),
    fmt(driveWh !== null && piWh !== null ? driveWh + piWh : null, 5),
    ...WHEELS.flatMap(w =>
      WHEEL_COLUMNS.map(([, get, digits]) => fmt(wheels[w] ? get(wheels[w]) : null, digits))),
    fmt(num(ws.age_sec), 3),
    fmt(num(pi.age_s), 2),
  ];

  rows.push(row.join(","));
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

// Pi-side energy counters run since the Pi service started. This tracks the
// change since recording began. Net drive energy legitimately falls during
// regen, so a counter restart is detected by its epoch changing, not by a drop.
function energyCounter() {
  let last = null;
  let lastEpoch = null;
  let total = 0;
  return {
    update(raw, epoch) {
      if (raw === null) return last === null ? null : total;
      if (last !== null) total += epoch === lastEpoch ? raw - last : raw;  // restarted at 0
      last = raw;
      lastEpoch = epoch;
      return total;
    },
  };
}

function num(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function pct(v) {
  return num(v) === null ? null : v * 100;
}

function deg(rad) {
  return num(rad) === null ? null : rad * 180 / Math.PI;
}

function fmt(v, digits) {
  return num(v) === null ? "" : v.toFixed(digits);
}

function csvText(s) {
  s = String(s);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function fileStamp(d) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_` +
         `${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function download(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function emit(extra = {}) {
  window.dispatchEvent(new CustomEvent("recorder", { detail: { ...recordStatus(), ...extra } }));
}

// Warn before losing an in-progress recording to a reload or tab close.
window.addEventListener("beforeunload", e => {
  if (!recording) return;
  e.preventDefault();
  e.returnValue = "";
});
