// components/bandwidth-panel.js
class BandwidthPanel extends HTMLElement {
  connectedCallback() {
    if (this._rendered) return;
    this._rendered = true;

    this.classList.add('card');
    this.id = this.id || 'bandwidthSecton';

    this.innerHTML = `
        <h3>Bandwidth Utilization (Mbps)</h3>
        <div class="bandwidth-chart-wrap">
          <canvas></canvas>
        </div>
    `;

    const canvas = this.querySelector("canvas");
    this.initChart(canvas);

    // Seed first point so the line renders immediately
    this.pushSample(0);

    // Listen for bandwidth events from app.js
    window.addEventListener("bandwidth", (e) => {
      const { rx_mb_s = 0, tx_mb_s = 0 } = e.detail || {};
      this.pushSample(rx_mb_s + tx_mb_s);
    });
  }

  initChart(canvas) {
    const ctx = canvas.getContext("2d");

    this.chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            data: [],
            borderWidth: 2,
            tension: 0.25,
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
            max: 1,
            title: {
              display: true,
              text: "MB/s"
            },
            ticks: {
              stepSize: 0.1
            }
          },
          x: {
            ticks: {
              maxTicksLimit: 6
            }
          }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  }

  pushSample(value) {
    if (!this.chart ||!Number.isFinite(value)) return;

    // Hard clamp to chart range
    value = Math.max(0, Math.min(5, value));

    this.chart.data.labels.push("");
    this.chart.data.datasets[0].data.push(value);

    // Keep ~60 seconds of history
    if (this.chart.data.labels.length > 60) {
     this.chart.data.labels.shift();
     this.chart.data.datasets[0].data.shift();
    }

    this.chart.update("none");
  }
}

customElements.define("bandwidth-panel", BandwidthPanel);