#!/usr/bin/env bash
# Temporary helper: run the 46 files that failed the unit lane, one process per file
# (same isolation the ci-tests runner uses), and print "<file>: pass fail skip".
set -u

files=(
server/prompt.test.ts
server/codex.test.ts
server/conversation.test.ts
server/machines.test.ts
server/collector.test.ts
server/hermes.test.ts
server/file-view.test.ts
server/portal.test.ts
server/omo.test.ts
server/push.test.ts
server/pi.test.ts
server/telemetry.test.ts
server/claude-store.test.ts
server/codex-processes.test.ts
server/repo-diff.test.ts
server/gjc-sdk.test.ts
server/machines-refresh.test.ts
scripts/plugin.test.ts
server/session-plan.test.ts
server/grok.test.ts
server/voice.test.ts
server/conventions.test.ts
server/herdr-update.test.ts
server/omp.test.ts
src/conventions.test.ts
scripts/conventions.test.ts
server/omo-identity.test.ts
scripts/windows-plugin.test.ts
server/devices.test.ts
scripts/check-report.test.ts
server/cliproxy.test.ts
server/skills/gjc.test.ts
scripts/changelog-fold.test.ts
server/herdr/client.test.ts
server/pty/session.test.ts
scripts/ci-browser.test.ts
server/skills/grok.test.ts
server/files.test.ts
server/herdr-profiles.test.ts
server/herdr/seam.test.ts
server/install-lock.test.ts
server/project-favicon.test.ts
scripts/disposable-config.test.ts
server/rpc-guard.test.ts
server/process-start.test.ts
server/updater.test.ts
)

out="$1"
: > "$out"
for f in "${files[@]}"; do
  plain=$(bun test --timeout 60000 "./$f" 2>&1 | sed -E 's/\x1b\[[0-9;]*m//g')
  p=$(printf '%s\n' "$plain" | grep -E '^\s*[0-9]+ pass$' | head -1 | grep -oE '[0-9]+' | head -1)
  fl=$(printf '%s\n' "$plain" | grep -E '^\s*[0-9]+ fail$' | head -1 | grep -oE '[0-9]+' | head -1)
  s=$(printf '%s\n' "$plain" | grep -E '^\s*[0-9]+ skip$' | head -1 | grep -oE '[0-9]+' | head -1)
  printf '%s: pass=%s fail=%s skip=%s\n' "$f" "${p:-?}" "${fl:-?}" "${s:-?}" >> "$out"
  printf '%s: pass=%s fail=%s skip=%s\n' "$f" "${p:-?}" "${fl:-?}" "${s:-?}"
done
