export function createWheelTelemetryCard(rootId) {
  const root = document.getElementById(rootId);
  if (!root) {
    console.warn(`Wheel card root not found: ${rootId}`);
    return { update: () => {} };
  }

  const el = {
    rps: root.querySelector(".rps"),
    cmd: root.querySelector(".cmd"),
    current: root.querySelector(".current"),
    temp: root.querySelector(".temp"),
    fault: root.querySelector(".fault"),
  };

  function update(data) {
  if (!data) return;

  if (el.rps)
    el.rps.textContent = (data.measured_rps ?? 0).toFixed(2);

  if (el.cmd)
    el.cmd.textContent = (data.commanded_rps ?? 0).toFixed(2);

  if (el.current)
    el.current.textContent = (data.current ?? 0).toFixed(1);

  if (el.temp)
    el.temp.textContent = (data.temp ?? 0).toFixed(1);

  if (el.fault) {
    if (data.fault_state === "disconnected") {
      el.fault.textContent = "NOT CONNECTED";
      el.fault.className = "fault fault-disconnected";
    }
    else if (data.fault_state === "fault") {
      el.fault.textContent = "FAULT";
      el.fault.className = "fault fault-active";
    }
    else {
      el.fault.textContent = "OK";
      el.fault.className = "fault fault-ok";
    }
  }
}

  return { update };
}