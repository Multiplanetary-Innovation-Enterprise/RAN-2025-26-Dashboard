// components/power-chart.js
// Rolling power line chart fed by the "power" window event from app.js.
//   <power-chart source="motors"></power-chart>      power per drive Kraken
//   <power-chart source="efficiency"></power-chart>  efficiency per drive Kraken
//   <power-chart source="pi"></power-chart>          Raspberry Pi board power
// Uses the global Chart (components/chart.js).

const WINDOW_S = 30;
const MAX_SAMPLES = WINDOW_S * 10;   // telemetry arrives at ~10 Hz

// Categorical slots 1-4 (dark-surface steps). Fixed per motor, never cycled.
const MOTOR_SERIES = [
  { key: "fl", label: "Front Left",  color: "#3987e5" },
  { key: "fr", label: "Front Right", color: "#d95926" },
  { key: "rl", label: "Rear Left",   color: "#199e70" },
  { key: "rr", label: "Rear Right",  color: "#c98500" },
];

const SOURCES = {
  motors: {
    title: "Drive Motor Power (W)",
    hint: "Battery-side power per Kraken: supply voltage X supply current. Negative values are regenerative braking.",
    series: MOTOR_SERIES,
    read: d => d.motors && MOTOR_SERIES.map(s => d.motors[s.key]),
    unit: "W",
    suggestedMax: 50,
  },
  efficiency: {
    title: "Drive Motor Efficiency (%)",
    hint: "Rotor mechanical power ÷ winding electrical power (motor only, no gearbox). Gaps: idle or regenerating.",
    series: MOTOR_SERIES,
    read: d => d.efficiency && MOTOR_SERIES.map(s => d.efficiency[s.key]),
    unit: "%",
    min: 0,
    max: 100,
  },
  pi: {
    title: "Raspberry Pi Power (W)",
    hint: "Pi 5 PMIC rails, sampled at 1 Hz. Excludes USB devices and HATs powered through the Pi.",
    series: [{ key: "pi", label: "Raspberry Pi", color: null }],  // null = theme accent
    read: d => (typeof d.pi_w === "number" ? [d.pi_w] : null),
    unit: "W",
    suggestedMax: 10,
    stepped: true,
  },
};

class PowerChart extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this._src = SOURCES[this.getAttribute("source")] ?? SOURCES.motors;
    this.classList.add("card");

    this.innerHTML = `
      <h3>${this._src.title}</h3>
      <div class="power-chart-wrap"><canvas></canvas></div>
      <p class="hint">${this._src.hint}</p>
    `;

    this.initChart(this.querySelector("canvas"));
    window.addEventListener("power", e => this.pushSample(e.detail || {}));
  }

  initChart(canvas) {
    const css = getComputedStyle(document.documentElement);
    const token = name => css.getPropertyValue(name).trim();
    const muted = token("--text-muted");
    const grid = token("--border");
    const multi = this._src.series.length > 1;

    this.chart = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels: [],
        datasets: this._src.series.map(s => ({
          label: s.label,
          data: [],
          borderColor: s.color ?? token("--accent"),
          backgroundColor: s.color ?? token("--accent"),
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          tension: 0,
          stepped: !!this._src.stepped,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          y: {
            suggestedMin: 0,
            suggestedMax: this._src.suggestedMax,
            min: this._src.min,
            max: this._src.max,
            title: { display: true, text: this._src.unit, color: muted },
            ticks: { color: muted },
            grid: { color: grid },
            border: { color: grid },
          },
          x: {
            title: { display: true, text: `Last ${WINDOW_S} s`, color: muted },
            ticks: { maxTicksLimit: 6, maxRotation: 0, color: muted },
            grid: { color: grid },
            border: { color: grid },
          },
        },
        plugins: {
          legend: {
            display: multi,
            position: "top",
            align: "end",
            labels: { color: muted, boxWidth: 12, boxHeight: 2 },
          },
          tooltip: {
            callbacks: {
              label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} ${this._src.unit}`,
            },
          },
        },
      },
    });
  }

  pushSample(detail) {
    const values = this._src.read(detail);
    if (!this.chart || !values) return;

    const { labels, datasets } = this.chart.data;
    labels.push(new Date().toLocaleTimeString([], { hour12: false }));
    values.forEach((v, i) => datasets[i].data.push(Number.isFinite(v) ? v : null));

    if (labels.length > MAX_SAMPLES) {
      labels.shift();
      for (const ds of datasets) ds.data.shift();
    }

    // Skip the redraw while the page is hidden; data still accumulates.
    if (this.offsetParent !== null) this.chart.update("none");
  }
}

customElements.define("power-chart", PowerChart);
