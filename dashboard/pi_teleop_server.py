#!/usr/bin/env python3
"""
pi_teleop_server.py

Minimal TCP server that listens for a joystick teleop command
from the driver station laptop and prints it.

Protocol (very simple, text-based):
    Client connects via TCP and sends a single line:
        "<lx> <az>\n"
    where lx and az are floats in ASCII (e.g. "0.50 -0.75\n").

Example:
    On the Pi:
        python3 pi_teleop_server.py

    On the laptop (with client script):
        python3 laptop_teleop_client.py

You should see on the Pi:
    [PI] Listening on 0.0.0.0:6000 ...
    [PI] Client connected from ('192.168.x.y', 54321)
    [PI] Received command: lx=0.50, az=-0.75
"""

import socket

LISTEN_HOST = "0.0.0.0"   # listen on all interfaces
LISTEN_PORT = 6000        # port for teleop TCP

def main():
    # 1) Create a TCP socket and bind it
    server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server_sock.bind((LISTEN_HOST, LISTEN_PORT))
    server_sock.listen(1)

    print(f"[PI] Listening on {LISTEN_HOST}:{LISTEN_PORT} ...")

    # 2) Accept exactly one client connection
    conn, addr = server_sock.accept()
    print(f"[PI] Client connected from {addr}")

    try:
        # 3) Wrap the socket in a file-like object to read a line easily
        f = conn.makefile("r", encoding="utf-8", newline="\n")
        line = f.readline()
        if not line:
            print("[PI] Client closed connection without sending data.")
            return

        line = line.strip()
        print(f"[PI] Raw line received: {line!r}")

        # 4) Parse "lx az" floats
        parts = line.split()
        if len(parts) != 2:
            print("[PI] Expected two floats: lx az")
        else:
            lx = float(parts[0])
            az = float(parts[1])
            print(f"[PI] Received command: lx={lx:.2f}, az={az:.2f}")

    finally:
        conn.close()
        server_sock.close()
        print("[PI] Connection closed, server shutdown.")

if __name__ == "__main__":
    main()
