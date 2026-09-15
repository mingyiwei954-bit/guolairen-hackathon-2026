#!/bin/sh
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
exec env DEMO_INTERACTIONS=1 APP_PORT="${APP_PORT:-5174}" "$PROJECT_DIR/.venv-content/bin/python" "$PROJECT_DIR/server.py"
