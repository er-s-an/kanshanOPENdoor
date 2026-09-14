#!/bin/bash
# 看山任意门 · 演示服务一键启动（游戏网关 + cloudflared 隧道）
# 公网地址：https://kanshan.hk2048.online
# 机器重启后跑一遍即可：bash start-demo.sh
set -euo pipefail

project_dir="$(cd "$(dirname "$0")" && pwd)"
tunnel_config="$HOME/.cloudflared/kanshan.yml"
cd "$project_dir"

if [[ -z "${KIMI_CODE_API_KEY:-}" ]]; then
  echo "KIMI_CODE_API_KEY is required to start the chat gateway." >&2
  exit 1
fi

if [[ ! -f "$tunnel_config" ]]; then
  echo "Tunnel configuration not found: $tunnel_config" >&2
  exit 1
fi

export ZHIDA_BASE_URL=https://api.kimi.com/coding/v1
export ZHIDA_MODEL=kimi-for-coding
export ZHIHU_ACCESS_SECRET="$KIMI_CODE_API_KEY"
export CHAT_PORT=8791

existing_gateway_pid="$(lsof -tiTCP:8791 -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "$existing_gateway_pid" ]]; then
  echo "Gateway already listens on :8791 (pid $existing_gateway_pid); leaving it untouched."
else
  nohup node server/gateway.mjs > /tmp/kanshan-v2-gw.log 2>&1 &
  echo "gateway pid $!"
fi

if pgrep -f 'cloudflared tunnel.*kanshan\.yml.*run' >/dev/null; then
  echo "Kanshan Cloudflare Tunnel is already running; leaving it untouched."
else
  nohup cloudflared tunnel --config "$tunnel_config" run > /tmp/kanshan-v2-tunnel.log 2>&1 &
  echo "tunnel pid $!"
fi

sleep 2
curl -fsS http://127.0.0.1:8791/api/health
echo
for route_path in / /myopia-3d/ /myopia-3d/end-consort.html; do
  curl -sS -o /dev/null -w "public ${route_path}: %{http_code}\n" "https://kanshan.hk2048.online${route_path}"
done
