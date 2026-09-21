#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
port="${PHOTO_PRUNER_PORT:-8082}"
mkdir -p artifacts
cloudflared="$(command -v cloudflared || true)"
if [[ -z "$cloudflared" ]]; then
  cloudflared="$PWD/artifacts/cloudflared"
  if [[ ! -x "$cloudflared" ]]; then
    curl --fail --location --silent --show-error \
      https://github.com/cloudflare/cloudflared/releases/download/2026.9.1/cloudflared-linux-amd64 \
      --output "$cloudflared"
    echo '03f1f25d1cc93b9ad6c60569d44060bc4f17ed97075760ed8cfca4b12dcd68cc  artifacts/cloudflared' | sha256sum --check
    chmod 755 "$cloudflared"
  fi
fi
"$cloudflared" tunnel --url "http://localhost:$port" --no-autoupdate > artifacts/tunnel.log 2>&1 &
tunnel_pid=$!
trap 'kill "$tunnel_pid" 2>/dev/null || true' EXIT
url=''
for ((attempt=0; attempt<120; attempt++)); do
  url="$(sed -nE 's/.*(https:\/\/[a-z0-9-]+\.trycloudflare\.com).*/\1/p' artifacts/tunnel.log | head -n 1)"
  [[ -n "$url" ]] && break
  kill -0 "$tunnel_pid" 2>/dev/null || { cat artifacts/tunnel.log; exit 1; }
  sleep 0.5
done
[[ -n "$url" ]] || { echo 'Tunnel did not start. See artifacts/tunnel.log.' >&2; exit 1; }
echo "Metro tunnel: $url"
# CI disables Metro's watcher and Fast Refresh.
env -u CI EXPO_PACKAGER_PROXY_URL="$url" npx expo start --dev-client --localhost --port "$port"
