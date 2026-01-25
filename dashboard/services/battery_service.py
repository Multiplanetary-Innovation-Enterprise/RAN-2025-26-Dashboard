from typing import Any, Dict
from .base import BaseService, ServiceStatus

class BatteryService(BaseService):
    name = "bat"

    def __init__(self):
        self._ok = True

    async def poll(self) -> Dict[str, Any]:
        # Replace with real battery telemetry if available
        return {"v": 12.0, "i": 0.8, "temp": 30.0}

    async def status(self) -> ServiceStatus:
        return ServiceStatus(ok=self._ok)
