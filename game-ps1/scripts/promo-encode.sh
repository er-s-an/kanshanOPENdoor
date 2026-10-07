#!/usr/bin/env bash
# promo-encode: 把 promo-record 的帧序列合成 ≤30s 成片。
# 用法: bash scripts/promo-encode.sh [frames_dir] [out.mp4]
# 1800 帧 @ 60fps = 30.0s（模拟时间 60s 的 2x timelapse）。
set -euo pipefail
FRAMES_DIR="${1:-.kanshan/promo-frames}"
OUT="${2:-../evidence/ps1-engine/promo/engine-promo-30s.mp4}"
mkdir -p "$(dirname "$OUT")"
ffmpeg -y -framerate 60 -i "$FRAMES_DIR/f-%05d.png" \
  -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$OUT"
