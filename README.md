![banner](.images/banner_dark_themed.png)

# Laptop Dashboard (Driver Station)

The **Laptop Dashboard** is a web‑based **Driver Station** that runs on a laptop and acts as the central control, visualization, and relay node between:

- **Human operators** (via a browser UI and gamepad input)
- **The rover Pi** (ROS2 + Hardware interface)
- **Live video and telemetry streams**

It is designed for low-latency teleoperation, clear system visibility, and robust separation of concerns: the browser never talks directly to the rover, and the rover never exposes services directly to operators.

---

## Responsibilities by Layer

### Laptop (Driver Station Server)

Implimented in `server/app.py` using **aiohttp**.

Responsibilities:

- Serve the web dashboard UI and static assets
- Host a single Websocket endpoint (`/ws`)
- Relay messages between the browser and the Pi
- Proxy the Pi's MJPEG video stream

The laptop:

- Accepts **many browser clients**
- Accepts **one Pi client**
- Never interprets gamepad button commands -- it forwards them verbatim

### Browser (Dashboard UI)

Implemented in `web/` using plain JavaScript + Web Components.

Responsibilities:

- Capture operator input (Xbox controller)
- Visualize telemetry, queue state, alerts, and rover motion
- Send teleop, estop, and queue commands over WebSocket

### Rover Pi (Client)

_Not in this repo_

Responsibilities:

- Connect to the laptop’s `/ws` endpoint

- Execute teleop commands (subject to mux + estop)

- Publish authoritative telemetry

- Host an MJPEG video stream (proxied by laptop)

---

## Repository Layout

<pre>
RAN-2025-26-Dashboard/
├── Laptop Dashboard/
│   ├── README.md
│   ├── requirements.txt                         # Python deps (aiohttp)
│   ├── run_dashboard.ps1                        # Windows helper script
│   ├── start_dashboard.py                       # One-command launcher
│   ├── server/
│   │   ├── app.py
│   │   ├── laptop_teleop_client.py
│   │   └── __pycache__
│   │       ├── realsense_source.cpython-313.pyc
│   │       └── telemetry_source.cpython-313.pyc
|   |
│   ├── web/
│   │   ├── app.js                               # Browser WS
│   │   ├── example.png
│   │   ├── gamepad.js                           # Xbox controller support
│   │   ├── index.html                           # Dashboard layout
│   │   ├── main.js                              # Component loader
│   │   ├── style.css                            # Global styles
│   │   └── components/                          # Web components
│   │       ├── connection-bar.js
│   │       ├── controller-panel.js
│   │       ├── queue-panel.js
│   │       ├── rover-visual-panel.js
│   │       ├── telemetry-panel.js
│   │       ├── teleop-panel.js
│   │       └── video-panel.js
|   |
│   └── wire_protocol.txt                        # Authoritative WS protocol
└── README.md                                    # This file
</pre>

---

## Running the Dashboard

from the `RAN-2025-26-Dashboard` directory:

```bash
python3 "Laptop Dashboard"/start_dashboard.py
```

This will:

- Create a `.venv` if missing
- Install dependencies
- Launch the server
- Open `http://localhost:8765` in your browser

Press **Ctrl+C** in the terminal to stop the server.
   
---

## Network Configuration

Edit this line in `server/app.py`:

```bash
PI_HTTP_VIDEO = "http://<PI_IP>:9002/video.mjpg"
```

The Pi must be reachable from the laptop over the network.

---

## WebSocket Protocol

All communication uses one **Websocket** at:

```bash
/ws
```

Message format:

- UTF-8 JSON
- One object per frame
- Low latency, no request/response blocking

The **full, authoritative specification** is in:

```bash
wire_protocol.txt
```

---

## Teleoperation Model

Browser sends raw xbox button data to rover Pi, which maps the buttons and interprets the data.

---
## Mux / Ownership

Only one motion source may command the rover at a time:

- `teleop` – Driver Station
- `auton` – onboard autonomy

The Pi is authoritative. The current owner is broadcast via telemetry and shown in the UI.

---

## Video Pipeline

- Pi hosts MJPEG (e.g. `/video.mjpg`)
- Laptop proxies it at:

```bash
/video.mjpg
```

Benefits:

- Browser never needs Pi IP access
- Easier firewalling and future recording

---

## Design Philosophy

- Explicit
- One socket, one protocol
- UI is stateless; Pi is authoritative
- Robust

---

## Authors

Benji Sutton

Jacob Earl

Royce Doll

---
