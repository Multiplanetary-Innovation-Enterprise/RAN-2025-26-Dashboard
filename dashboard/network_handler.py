from __future__ import annotations
import asyncio, json, time
from typing import Any, Dict, Optional

from aiohttp import ClientSession, WSMsgType

def now_ms() -> int:
    return int(time.time() * 1000)

class NetworkHandler:
    """
    Owns the WebSocket connection to the laptop server.
    This file should contain no sensor logic. Only protocol and connection logic.
    """

    def __init__(self, ws_url: str, client_name: str = "pi"):
        self.ws_url = ws_url
        self.client_name = client_name

        self._session: Optional[ClientSession] = None
        self._ws = None

        self._tx_bytes_ctl = 0
        self._tx_bytes_tlm = 0
        self._rx_bytes = 0

        self._last_hb_id = 0
        self._hb_sent_ts: Dict[int, int] = {}
        self.rtt_ms: int = 0

        self._connected = asyncio.Event()

    async def connect(self) -> None:
        self._session = ClientSession()
        self._ws = await self._session.ws_connect(self.ws_url, heartbeat=20)
        self._connected.set()

    async def close(self) -> None:
        self._connected.clear()
        if self._ws:
            await self._ws.close()
        if self._session:
            await self._session.close()

    async def send(self, msg: Dict[str, Any], channel: str = "ctl") -> None:
        data = json.dumps(msg, separators=(",", ":"))
        await self._ws.send_str(data)
        n = len(data.encode("utf-8"))
        if channel == "tlm":
            self._tx_bytes_tlm += n
        else:
            self._tx_bytes_ctl += n

    async def recv_loop(self, on_message) -> None:
        """
        Receives messages forever and calls on_message(dict).
        """
        await self._connected.wait()
        async for m in self._ws:
            if m.type == WSMsgType.TEXT:
                self._rx_bytes += len(m.data.encode("utf-8"))
                try:
                    obj = json.loads(m.data)
                except Exception:
                    continue
                await on_message(obj)
            elif m.type == WSMsgType.ERROR:
                break

    async def heartbeat_loop(self, hz: float) -> None:
        await self._connected.wait()
        period = 1.0 / max(0.1, hz)
        while True:
            self._last_hb_id += 1
            hb_id = self._last_hb_id
            ts = now_ms()
            self._hb_sent_ts[hb_id] = ts
            await self.send({"t": "hb", "id": hb_id, "ts_ms": ts}, channel="ctl")
            await asyncio.sleep(period)

    def handle_hb_ack(self, msg: Dict[str, Any]) -> None:
        hb_id = int(msg.get("id", -1))
        sent = self._hb_sent_ts.pop(hb_id, None)
        if sent is None:
            return
        self.rtt_ms = max(0, now_ms() - sent)

    def get_net_stats_kbps(self, interval_s: float) -> Dict[str, Any]:
        # Compute kbps based on bytes accumulated over interval
        ctl_kbps = int((self._tx_bytes_ctl * 8) / 1000 / max(0.001, interval_s))
        tlm_kbps = int((self._tx_bytes_tlm * 8) / 1000 / max(0.001, interval_s))

        # reset counters for next interval
        self._tx_bytes_ctl = 0
        self._tx_bytes_tlm = 0

        return {
            "ctl_kbps": ctl_kbps,
            "tlm_kbps": tlm_kbps,
            "vid_kbps": 0,
            "rtt_ms": int(self.rtt_ms),
        }
