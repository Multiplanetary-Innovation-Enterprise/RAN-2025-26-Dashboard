// components/bandwidth-panel.js
class BandwidthPanel extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.classList.add('card');

    this.innerHTML = `
        <h3>Bandwidth Utilization (Mbps)</h3>
        <div class="bandwidth-chart-wrap">
          <canvas></canvas>
        </div>
        <p class="hint">
          Note: Payload only. Does not include protocol overhead, so actual link utilization may be higher.
      </p>
    `;

    const canvas = this.querySelector("canvas");
    this.initChart(canvas);

    // Seed first point so the line renders immediately
    this.pushSample(0, 0);

    // Listen for bandwidth events from app.js
    window.addEventListener("bandwidth", (e) => {
      const { 
        rx_mb_s = 0,
        tx_mb_s = 0,
        rx_mb_s_avg = 0,
        tx_mb_s_avg = 0
      } = e.detail || {};

      const inst = rx_mb_s + tx_mb_s;
      const avg  = rx_mb_s_avg + tx_mb_s_avg;

      this.pushSample(inst, avg);
    });
  }

  initChart(canvas) {
    const ctx = canvas.getContext("2d");

    // Pull colors from the theme tokens in style.css
    const css = getComputedStyle(document.documentElement);
    const token = (name) => css.getPropertyValue(name).trim();
    const muted = token("--text-muted");
    const grid = token("--border");

    this.chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          // Instantaneous bandwidth
          {
            label: "Instantaneous",
            data: [],
            borderWidth: 1,
            borderColor: token("--text-muted"),
            tension: 0.25,
            pointRadius: 0
          },

          // Average bandwidth
          {
            label: "Average",
            data: [],
            borderWidth: 2.5,
            borderColor: token("--accent"),
            tension: 0.15,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        animation: false,
        maintainAspectRatio: false,
        scales: {
          y: {
            min: 0,
            max: 4,
            title: {
              display: true,
              text: "Mb/s",
              color: muted
            },
            ticks: {
              stepSize: 0.1,
              color: muted
            },
            grid: { color: grid },
            border: { color: grid }
          },
          x: {
            title: {
              display: true,
              text: "Time (s)",
              color: muted
            },
            ticks: {
              maxTicksLimit: 6,
              color: muted
            },
            grid: { color: grid },
            border: { color: grid }
          }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }

  pushSample(inst, avg = null) {
    if (!this.chart) return;

    if (!Number.isFinite(inst)) inst = 0;
    if (!Number.isFinite(avg)) avg = 0;

    inst = Math.max(0, Math.min(5, inst));
    avg = Math.max(0, Math.min(5, avg));

    this.chart.data.labels.push("");
    this.chart.data.datasets[0].data.push(inst);
    this.chart.data.datasets[1].data.push(avg);

    // Keep the last 60 samples (~6 s at the default 10 Hz telemetry rate)
    if (this.chart.data.labels.length > 60) {
     this.chart.data.labels.shift();
     this.chart.data.datasets[0].data.shift();
     this.chart.data.datasets[1].data.shift();
    }

    this.chart.update("none");
  }
}

customElements.define("bandwidth-panel", BandwidthPanel);