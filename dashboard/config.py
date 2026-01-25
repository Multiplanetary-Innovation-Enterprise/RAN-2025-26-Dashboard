from dataclasses import dataclass
from typing import List

@dataclass(frozen=True)
class DashboardConfig:
    # WebSocket server running on laptop
    ws_url: str = "ws://192.168.1.60:8765/ws"

    # Rates
    heartbeat_hz: float = 5.0       # 200 ms
    telemetry_hz: float = 10.0      # default push rate (can be overridden by "set")

    # Telemetry fields to include by default
    tlm_fields: List[str] = None

    # Identity
    client_name: str = "pi"

    def __post_init__(self):
        if self.tlm_fields is None:
            object.__setattr__(self, "tlm_fields", ["imu", "enc", "bat", "net", "mux", "queue"])
