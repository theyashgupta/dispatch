import fs from "node:fs";
import path from "node:path";

const STUB_CLAUDE = `#!/bin/sh
[ "$1" = "-p" ] || { echo "2.1.212 (Claude Code)"; exit 0; }
[ "$ASK_STUB_MODE" = ignoreterm ] && trap '' TERM
[ -n "$ASK_STUB_PID" ] && echo $$ > "$ASK_STUB_PID"
[ -n "$ASK_STUB_ARGV" ] && printf '%s\n' "$@" > "$ASK_STUB_ARGV"
if [ -n "$ASK_STUB_STDIN" ]; then cat > "$ASK_STUB_STDIN"; else cat > /dev/null; fi
case "$ASK_STUB_MODE" in
  answer) echo "Stub answer: LOCAL-921"; exit 0 ;;
  sleep) exec sleep 30 ;;
  ignoreterm) exec sleep 30 ;;
  fail) echo "stub failure" >&2; exit 1 ;;
  empty) exit 0 ;;
esac
exit 2
`;

/**
 * Write the Ask stub `claude` into a bin dir; it records its pid and stdin, then acts on
 * `ASK_STUB_MODE`.
 *
 * @remarks `exec sleep` keeps the recorded pid on the sleeping process, so a pid check after an
 * abort proves the child itself is gone, not only its shell; `ignoreterm` passes an ignored
 * SIGTERM into that process so only the SIGKILL escalation can end it.
 */
export function writeStubClaude(binDir: string): string {
  const file = path.join(binDir, "claude");
  fs.writeFileSync(file, STUB_CLAUDE, { mode: 0o755 });
  return file;
}
