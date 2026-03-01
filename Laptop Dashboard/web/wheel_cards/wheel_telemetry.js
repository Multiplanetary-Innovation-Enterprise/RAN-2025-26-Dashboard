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

    if (el.rps && data.rps != null)
      el.rps.textContent = data.rps.toFixed(2);

    if (el.cmd && data.cmd_rps != null)
      el.cmd.textContent = data.cmd_rps.toFixed(2);

    if (el.current && data.current != null)
      el.current.textContent = data.current.toFixed(1);

    if (el.temp && data.temp != null)
      el.temp.textContent = data.temp.toFixed(1);

    if (el.fault && data.fault != null) {
      el.fault.textContent = data.fault ? "FAULT" : "OK";
      el.fault.className = `fault ${data.fault ? "fault" : "ok"}`;
    }
  }

  return { update };
}