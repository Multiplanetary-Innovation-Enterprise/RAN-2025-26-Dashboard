from typing import Any, Dict
from .base import BaseService, ServiceStatus

# This is a stub file for actual implementation when you guys
# have the Encoder hardware and library available.

class EncoderService(BaseService):
    name = "enc"

    def __init__(self):
        self._l_rps = 0.0
        self._r_rps = 0.0
        self._ticks = [0, 0]
        self._hz = 100
        self._ok = True

    async def poll(self) -> Dict[str, Any]:
        return {"l_rps": self._l_rps, "r_rps": self._r_rps, "ticks": self._ticks, "hz": self._hz}

    async def status(self) -> ServiceStatus:
        return ServiceStatus(ok=self._ok)
