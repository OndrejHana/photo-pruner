#!/usr/bin/env bash
set -euo pipefail
if [[ -z "${APPETIZE_API_TOKEN:-}" ]]; then
  set -a
  source "${APPETIZE_SECRETS_FILE:-$HOME/.config/secrets/appetize}"
  set +a
fi
exec appetize "$@"
