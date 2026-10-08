#!/usr/bin/env bash
# Run one Codex task non-interactively, or resume it with a follow-up.
# Full-access sandbox is intentional (user decision): tasks may need network (pnpm install, MCP servers, model APIs).
#
#   dispatch.sh run    <task-id> <model> <workdir> <prompt-file>
#   dispatch.sh resume <task-id> <workdir> <prompt-file>
#
# <model>: fast | precise | glm (zai-coding/glm-5.3, full) | sol61 (gpt-6.1-sol, high) | sol (gpt-5.6-sol, high) | luna (gpt-6-luna, xhigh) | any full model id from the codex-router catalog.
# Outputs go to .claude/codex-runs/<task-id>/:
#   events.jsonl   raw codex --json event stream (appended across turns)
#   last.md        final agent message of the latest turn
#   thread_id      codex session id, used by `resume`
#   model          model used, reused by `resume`
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUNS="$REPO/.claude/codex-runs"

resolve_effort() {
  case "$1" in
    sol|sol61) echo "high" ;;
    luna) echo "xhigh" ;;
    *) echo "" ;;
  esac
}

resolve_model() {
  case "$1" in
    fast) echo "commandcode/deepseek-v4.1-flash" ;;
    precise) echo "zai-coding/glm-5.3-flash" ;;
    glm) echo "zai-coding/glm-5.3" ;;
    sol) echo "gpt-5.6-sol" ;;
    sol61) echo "gpt-6.1-sol" ;;
    luna) echo "gpt-6-luna" ;;
    *) echo "$1" ;;
  esac
}

cmd="${1:?usage: dispatch.sh run|resume ...}"
shift

case "$cmd" in
  run)
    task="${1:?task-id}"; alias_name="${2:?model}"; model="$(resolve_model "$alias_name")"; effort="$(resolve_effort "$alias_name")"; workdir="${3:?workdir}"; prompt="${4:?prompt-file}"; prompt="$(realpath "$prompt")"
    out="$RUNS/$task"
    mkdir -p "$out"
    echo "$model" > "$out/model"
    echo "$effort" > "$out/effort"
    effort_args=()
    [[ -n "$effort" ]] && effort_args=(-c "model_reasoning_effort=\"$effort\"")
    cp "$prompt" "$out/turn-1.md"
    cd "$workdir"
    set +e
    codex exec -m "$model" "${effort_args[@]}" -s danger-full-access --json -o "$out/last.md" - < "$prompt" >> "$out/events.jsonl" 2>> "$out/stderr.log"
    status=$?
    set -e
    ;;
  resume)
    task="${1:?task-id}"; workdir="${2:?workdir}"; prompt="${3:?prompt-file}"; prompt="$(realpath "$prompt")"
    out="$RUNS/$task"
    thread="$(cat "$out/thread_id")"
    model="$(cat "$out/model")"
    effort="$(cat "$out/effort" 2>/dev/null || true)"
    effort_args=()
    [[ -n "$effort" ]] && effort_args=(-c "model_reasoning_effort=\"$effort\"")
    n=$(ls "$out"/turn-*.md | wc -l)
    cp "$prompt" "$out/turn-$((n + 1)).md"
    cd "$workdir"
    set +e
    codex exec resume "$thread" -m "$model" "${effort_args[@]}" -c sandbox_mode='"danger-full-access"' --json -o "$out/last.md" - < "$prompt" >> "$out/events.jsonl" 2>> "$out/stderr.log"
    status=$?
    set -e
    ;;
  *)
    echo "unknown command: $cmd" >&2
    exit 2
    ;;
esac

# Capture the session id from the first event that carries one.
if [[ ! -s "$out/thread_id" ]]; then
  grep -o -m1 -E '"(thread_id|session_id)":"[^"]+"' "$out/events.jsonl" | cut -d'"' -f4 > "$out/thread_id" || true
fi

echo "task=$task model=$model exit=$status thread=$(cat "$out/thread_id" 2>/dev/null)"
echo "--- last message ($out/last.md) ---"
cat "$out/last.md" 2>/dev/null || echo "(none; see $out/stderr.log)"
exit "$status"
