#!/usr/bin/env bash
# start_pi_dashboard.sh
#
# Starts the Pi onboard dashboard:
#  - activates virtual environment
#  - launches dashboard.py
#
# Usage:
#   ./start_pi_dashboard.sh

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV_PATH="$PROJECT_ROOT/.venv"
PYTHON="$VENV_PATH/bin/python"

echo "[PI] Starting Pi Dashboard"
echo "[PI] Project root: $PROJECT_ROOT"

# Activate venv
if [ ! -d "$VENV_PATH" ]; then
  echo "[PI][ERROR] Virtual environment not found at $VENV_PATH"
  exit 1
fi

source "$VENV_PATH/bin/activate"

echo "[PI] Using Python: $(which python)"
echo "[PI] Launching dashboard..."

exec python dashboard.py
