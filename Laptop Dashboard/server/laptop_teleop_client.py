#!/usr/bin/env python3
"""
!!!!!!!!!!!!!!!!!!!!!!!!! This file is deprecated, for debugging uses only. !!!!!!!!!!!!!!!!!!!!!!!!!

laptop_teleop_client.py

Minimal TCP client that:
  - Reads an Xbox controller via pygame
  - Maps the left stick (Y and X) to a teleop command:
        lx = forward/backward (m/s)
        az = turn left/right (rad/s)
  - Sends ONE command line "lx az\\n" to the Pi, then exits.

This lets you test the full path:
  Xbox controller -> laptop -> TCP -> Pi -> printed command.
"""

import socket
import time

import pygame


# ---------- CONFIGURE THIS ----------
PI_HOST = "10.37.88.234"  
PI_PORT = 6000             
# -----------------------------------


def init_joystick():
    """Initialize pygame and open the first joystick device."""
    pygame.init()
    pygame.joystick.init()

    if pygame.joystick.get_count() == 0:
        raise RuntimeError("No joystick/gamepad detected. Plug in the Xbox controller first.")

    js = pygame.joystick.Joystick(0)
    js.init()
    print(f"[CLIENT] Using joystick: {js.get_name()}")
    return js


def read_xbox_axes(js):
    """
    Read the current Xbox left-stick axes from pygame.

    Assumes:
      - Axis 1 = left stick vertical (up/down)
      - Axis 0 = left stick horizontal (left/right)
    This can vary by OS/controller; adjust if needed.
    Returns (lx, az) in range [-1.0, +1.0].
    """
    pygame.event.pump()  # update internal state

    # Note: Many controllers use:
    #   axis 1: up/down (negative = up, positive = down)
    #   axis 0: left/right
    raw_y = js.get_axis(1)
    raw_x = js.get_axis(0)

    # Deadzone to prevent drift
    def deadzone(v, dz=0.1):
        return 0.0 if abs(v) < dz else v

    raw_y = deadzone(raw_y)
    raw_x = deadzone(raw_x)

    # Map:
    #   forward stick (up) => negative raw_y (so we invert)
    lx = -raw_y     # forward/back, [-1..1]
    az = raw_x      # turn left/right, [-1..1]

    return lx, az


def main():
    js = init_joystick()

    # Wait a moment for the user to center stick or move it as desired
    print("[CLIENT] Move the stick to the position you want to send, then press ENTER in this terminal.")
    input("[CLIENT] Press ENTER to capture and send one command...")

    # Read one snapshot from the controller
    lx, az = read_xbox_axes(js)
    print(f"[CLIENT] Captured joystick state: lx={lx:.2f}, az={az:.2f}")

    # (Optional) scale these to m/s and rad/s if you want, for now we just send raw [-1..1].
    cmd_lx = lx
    cmd_az = az

    line = f"{cmd_lx:.3f} {cmd_az:.3f}\n"
    data = line.encode("utf-8")

    # Connect to the Pi TCP server
    print(f"[CLIENT] Connecting to {PI_HOST}:{PI_PORT} ...")
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.connect((PI_HOST, PI_PORT))
    print("[CLIENT] Connected, sending command...")

    sock.sendall(data)
    print(f"[CLIENT] Sent line: {line.strip()!r}")

    sock.close()
    print("[CLIENT] Connection closed. Done.")

    pygame.joystick.quit()
    pygame.quit()


if __name__ == "__main__":
    main()
