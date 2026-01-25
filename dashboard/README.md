# Rover Pi Dashboard

This dashboard runs on the **rover’s Raspberry Pi**.

It owns all hardware, generates telemetry, streams video, and connects to the laptop
over WebSocket.

---

## Responsibilities

- Read sensors (IMU, encoders, battery)
- Control motors
- Manage teleop vs autonomy (mux)
- Handle queued drive commands
- Generate telemetry frames
- Serve MJPEG video
- Connect to the laptop dashboard

---

## Project Structure
pi-dashboard/
├─ services/
│ ├─ imu_service.py
│ ├─ encoder_service.py
│ ├─ battery_service.py
│ ├─ drive_service.py
│ ├─ queue_service.py
│ └─ camera_service.py
├─ service_center.py
├─ network_handler.py
├─ dashboard.py
├─ start_pi_dashboard.sh
└─ README.md

## Quick Start

```bash
source .venv/bin/activate
./start_pi_dashboard.sh
```

## Communication
    Connects to laptop WebSocket:
        ws://<laptop-ip>:8765/ws

    Serves video locally:
        http://<pi-ip>:9002/video.mjpg