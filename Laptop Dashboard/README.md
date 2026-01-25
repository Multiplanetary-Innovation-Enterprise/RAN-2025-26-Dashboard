# Laptop Driver Station Dashboard

This dashboard runs on the **driver station laptop**.

It serves the browser UI and acts as a **relay between the browser and the rover Pi**.
It does not control hardware or generate telemetry.

---

## Responsibilities

- Serve the dashboard UI
- Accept WebSocket connections from:
  - Browser
  - Rover Pi
- Relay messages between browser and Pi
- Proxy the rover’s MJPEG video stream to the browser

---

## Quick Start 

```bash
./start_pi_dashboard.sh
Open in a browser: http://localhost:8765
```

## Project Structure 
laptop-dashboard/
├─ server/
│  └─ app.py        # HTTP + WebSocket relay + video proxy
├─ web/
│  ├─ index.html    # UI
│  ├─ app.js        # WebSocket logic, teleop, telemetry rendering
│  ├─ gamepad.js    # Gamepad input + visualization
│  └─ style.css
└─ README.md


## Communication
    WebSocket endpoint:
        ws://<laptop-ip>:8765/ws

    Video endpoint (browser-facing):
        http://<laptop-ip>:8765/video.mjpg

