#!/bin/bash
# 看山任意门 · 演示服务一键启动（游戏网关 + cloudflared 隧道）
# 公网地址：https://kanshan.hk2048.online
# 机器重启后跑一遍即可：bash start-demo.sh
cd "$(dirname "$0")"
export ZHIDA_BASE_URL=https://api.kimi.com/coding/v1
export ZHIDA_MODEL=kimi-for-coding
export ZHIHU_ACCESS_SECRET="$KIMI_CODE_API_KEY"
export CHAT_PORT=8791
lsof -ti :8791 | xargs kill 2>/dev/null
pkill -f 'cloudflared tunnel' 2>/dev/null
sleep 1
nohup node server/gateway.mjs > /tmp/kanshan-v2-gw.log 2>&1 &
echo "gateway pid $!"
nohup cloudflared tunnel --config ~/.cloudflared/kanshan.yml run > /tmp/kanshan-v2-tunnel.log 2>&1 &
echo "tunnel pid $!"
sleep 4
curl -s http://127.0.0.1:8791/api/health && echo && curl -s -o /dev/null -w 'public: %{http_code}\n' https://kanshan.hk2048.online/api/health
