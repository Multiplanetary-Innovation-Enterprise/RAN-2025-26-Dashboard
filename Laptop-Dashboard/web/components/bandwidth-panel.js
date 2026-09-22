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
            tension: 0.25,
            pointRadius: 0
          },

          // Average bandwidth
          {
            label: "Average",
            data: [],
            borderWidth: 3,
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
            suggestedmax: 4,
            title: {
              display: true,
              text: "Mb/s"
            },
            ticks: {
              stepSize: 0.1
            }
          },
          x: {
            title: {
              display: true,
              text: "Time (s)"
            },
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

  pushSample(inst, avg = null) {
    if (!this.chart) return;

    if (!Number.isFinite(inst)) inst = 0;
    if (!Number.isFinite(avg)) avg = 0;

    inst = Math.max(0, Math.min(5, inst));
    avg = Math.max(0, Math.min(5, avg));

    this.chart.data.labels.push("");
    this.chart.data.datasets[0].data.push(inst);
    this.chart.data.datasets[1].data.push(avg);

    // Keep ~60 seconds of history
    if (this.chart.data.labels.length > 60) {
     this.chart.data.labels.shift();
     this.chart.data.datasets[0].data.shift();
     this.chart.data.datasets[1].data.shift();
    }

    this.chart.update("none");
  }
}

customElements.define("bandwidth-panel", BandwidthPanel);