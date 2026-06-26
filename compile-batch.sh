#!/usr/bin/env bash
# T3 · headless 批处理驱动器 —— 全量 435 篇用（pilot 3 篇本轮已由 agent 直接编译）。
#
# 用法:  ./compile-batch.sh <phase> [batch_size]
#   phase=entities  Phase 0：只抽 person/org/country → 追加 wiki/aliases.md（不写页）
#   phase=pages     Phase 1：用冻结词典写 wiki 页（只读 aliases.md）
# 环境:  COMPILE_AGENT=claude|codex （默认 claude）
# 断点续跑：每批指纹记在 .done/，重跑自动跳过；失败记入 .compile-log 不中断。
set -euo pipefail
KB="$(cd "$(dirname "$0")" && pwd)"
RAW="$KB/raw"; WIKI="$KB/wiki"; LOG="$KB/.compile-log"; DONE="$KB/.done"
mkdir -p "$DONE"
PHASE="${1:-pages}"; BATCH="${2:-12}"; AGENT="${COMPILE_AGENT:-claude}"
SCHEMA="$KB/CLAUDE.md"; ALIASES="$WIKI/aliases.md"

if [ "$PHASE" = entities ]; then
  TASK="只读以下文稿，按 CLAUDE.md 的实体定义抽出 person/org/country，输出『规范slug | type | 别名』追加到 wiki/aliases.md。不要写任何 wiki 页。"
else
  TASK="按 CLAUDE.md 把以下文稿编译为 wiki 页（主体/事件/观点/source）。写 [[链接]] 时只查 wiki/aliases.md 用规范 slug，不要修改 aliases.md。"
fi

mapfile -t FILES < <(ls "$RAW"/*.md 2>/dev/null | sort -V)
total=${#FILES[@]}; i=0
echo "=== $PHASE | $total files | batch=$BATCH | agent=$AGENT ===" | tee -a "$LOG"
while [ "$i" -lt "$total" ]; do
  batch=("${FILES[@]:$i:$BATCH}")
  key=$(printf '%s\n' "${batch[@]}" | md5sum | cut -c1-8)
  if [ -f "$DONE/$PHASE-$key" ]; then
    echo "skip $PHASE/$key (done)"; i=$((i+BATCH)); continue
  fi
  echo "[$PHASE] batch $key (${#batch[@]} files)" | tee -a "$LOG"
  PROMPT="遵守规则层：
$(cat "$SCHEMA")

当前冻结词典 aliases.md：
$(cat "$ALIASES" 2>/dev/null || echo '(空)')

任务：$TASK

文稿：
$(for f in "${batch[@]}"; do echo "=== $(basename "$f") ==="; cat "$f"; done)"
  ok=1
  if [ "$AGENT" = codex ]; then
    codex exec "$PROMPT" -C "$KB" --dangerously-bypass-approvals-and-sandbox </dev/null >>"$LOG" 2>&1 || ok=0
  else
    claude -p "$PROMPT" --dangerously-skip-permissions >>"$LOG" 2>&1 || ok=0
  fi
  if [ "$ok" = 1 ]; then touch "$DONE/$PHASE-$key"; else echo "FAIL $PHASE/$key — 见 $LOG，重跑会自动续" | tee -a "$LOG"; fi
  i=$((i+BATCH))
done
echo "[$PHASE] 全部批次处理完毕。日志：$LOG"
