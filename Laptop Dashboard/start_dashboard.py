#!/usr/bin/env python3
"""
start_dashboard.py

One-command launcher for the Driver Station dashboard.

- Ensures .venv exists (creates it if missing)
- Installs requirements.txt (if present)
- Starts server/app.py using the venv's Python
- Opens http://localhost:8765 in your browser
- Ctrl+C in this script will stop the server
"""

import os
import sys
import time
import subprocess
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_DIR = ROOT / ".venv"

if os.name == "nt":
    PYTHON_BIN = VENV_DIR / "Scripts" / "python.exe"
    PIP_BIN = VENV_DIR / "Scripts" / "pip.exe"
else:
    PYTHON_BIN = VENV_DIR / "bin" / "python"
    PIP_BIN = VENV_DIR / "bin" / "pip"


def ensure_venv():
    """Create .venv and install dependencies if needed."""
    if not PYTHON_BIN.exists():
        print("[start] Creating virtualenv at .venv ...")
        subprocess.check_call([sys.executable, "-m", "venv", str(VENV_DIR)])

    req = ROOT / "requirements.txt"
    if req.exists():
        print("[start] Installing/updating requirements ...")
        subprocess.check_call([str(PIP_BIN), "install", "-r", str(req)])
    else:
        print("[start] No requirements.txt found, skipping dependency install.")


def main():
    ensure_venv()

    print("[start] Launching Driver Station server ...")
    server_proc = subprocess.Popen(
        [str(PYTHON_BIN), "server/app.py"],
        cwd=str(ROOT),
    )

    try:
        # Give the server a moment to bind to the port
        time.sleep(2)
        url = "http://localhost:8765"
        print(f"[start] Opening {url} in your browser ...")
        webbrowser.open(url)

        print("[start] Server running. Press Ctrl+C to stop.")
        # Wait for server process to exit (or Ctrl+C)
        server_proc.wait()
    except KeyboardInterrupt:
        print("\n[start] Stopping server ...")
        server_proc.terminate()
        try:
            server_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            print("[start] Server did not exit cleanly, killing ...")
            server_proc.kill()


if __name__ == "__main__":
    main()
