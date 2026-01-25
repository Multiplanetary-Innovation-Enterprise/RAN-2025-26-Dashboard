from typing import Any, Dict
from .base import BaseService, ServiceStatus

# This is a stub file for actual implementation when you guys
# have the IMU hardware and library available.

class IMUService(BaseService):
    name = "imu"

    def __init__(self):
        self._rpy = [0.0, 0.0, 0.0]
        self._ok = True

    async def start(self) -> None:
        # Initialize IMU hardware here
        return

    async def poll(self) -> Dict[str, Any]:
        return {"rpy": self._rpy}

    async def status(self) -> ServiceStatus:
        return ServiceStatus(ok=self._ok, msg="" if self._ok else "IMU not ready")
