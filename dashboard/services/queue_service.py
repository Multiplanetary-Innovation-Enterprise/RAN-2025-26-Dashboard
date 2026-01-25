from typing import Any, Dict, Optional
from .base import BaseService

class QueueService(BaseService):
    name = "queue"

    def __init__(self):
        self._active: Optional[Dict[str, Any]] = None
        self._pending: list[Dict[str, Any]] = []
        self._last_result: Optional[Dict[str, Any]] = None

    async def handle_queue_drive(self, cmd: Dict[str, Any]) -> None:
        # cmd contains id, distance_m, heading_deg, max_speed_mps
        self._pending.append(cmd)

        # Stub behavior: immediately activate if idle
        if self._active is None:
            self._active = self._pending.pop(0)
            self._active["progress"] = 0.0
            self._active["remaining_m"] = float(self._active.get("distance_m", 0.0))

    async def handle_queue_cancel(self) -> None:
        self._active = None
        self._pending.clear()
        self._last_result = {"success": False, "reason": "Cancelled"}

    async def poll(self) -> Dict[str, Any]:
        # Stub behavior: simulate progress
        if self._active:
            self._active["progress"] = min(1.0, float(self._active["progress"]) + 0.02)
            self._active["remaining_m"] = max(0.0, float(self._active["remaining_m"]) - 0.02)
            if self._active["progress"] >= 1.0:
                done = self._active
                self._active = None
                self._last_result = {"id": done.get("id"), "success": True, "reason": "Done"}

        state = {
            "active": None,
            "pending": [{"id": x.get("id")} for x in self._pending],
        }
        if self._active:
            state["active"] = {
                "id": self._active.get("id"),
                "progress": self._active.get("progress", 0.0),
                "remaining_m": self._active.get("remaining_m", 0.0),
            }

        out: Dict[str, Any] = {"state": state}
        if self._last_result:
            out["result"] = dict(self._last_result)
            self._last_result = None
        return out
