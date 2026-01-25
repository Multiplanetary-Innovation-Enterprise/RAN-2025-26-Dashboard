from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Dict, Optional

@dataclass
class ServiceStatus:
    ok: bool
    msg: str = ""

class BaseService:
    """
    Base interface for a Pi service.
    Keep services small:
      - start/stop lifecycle
      - a single poll() for latest data (non-blocking if possible)
      - optional handle_* methods for commands
    """

    name: str = "base"

    async def start(self) -> None:
        return

    async def stop(self) -> None:
        return

    async def poll(self) -> Dict[str, Any]:
        """
        Return the latest data for this service.
        Must be quick. No long blocking calls.
        """
        return {}

    async def status(self) -> ServiceStatus:
        return ServiceStatus(ok=True)

    # Optional hooks
    async def handle_cmd(self, lx: float, az: float) -> None:
        return

    async def handle_estop(self, value: bool) -> None:
        return

    async def handle_queue_drive(self, cmd: Dict[str, Any]) -> None:
        return

    async def handle_queue_cancel(self) -> None:
        return
