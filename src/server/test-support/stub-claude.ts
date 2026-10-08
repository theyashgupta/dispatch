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

const CONNECTOR_CLAUDE = `#!/bin/sh
DIR="$CONNECTOR_STUB_DIR"
case "$1" in
  mcp)
    echo "mcp list" >> "$DIR/calls.log"
    [ -f "$DIR/mcp-list.txt" ] && cat "$DIR/mcp-list.txt"
    exit 0 ;;
  -p)
    echo "call" >> "$DIR/calls.log"
    for a in "$@"; do printf '%s\\n' "$a" >> "$DIR/argv.log"; done
    echo "@@" >> "$DIR/argv.log"
    cat >> "$DIR/stdin.log"
    echo "@@" >> "$DIR/stdin.log"
    echo $$ > "$DIR/claude.pid"
    echo "$CLAUDE_CODE_MCP_STARTUP_WAIT_MS" >> "$DIR/env.log"
    ALLOWED=""
    PREV=""
    for a in "$@"; do
      [ "$PREV" = "--allowedTools" ] && ALLOWED="$a"
      PREV="$a"
    done
    TOOLS=$(printf '%s' "$ALLOWED" | sed 's/[^,][^,]*/"&"/g')
    MODE=reply
    [ -f "$DIR/mode" ] && MODE=$(cat "$DIR/mode")
    TEXT_FILE="$DIR/reply.json"
    [ -s "$DIR/tool-text.txt" ] && TEXT_FILE="$DIR/tool-text.txt"
    TEXT=$(tr -d '\\n' < "$TEXT_FILE" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    ERR=false
    [ "$MODE" = toolerror ] && ERR=true
    USES=""
    RESULTS=""
    N=0
    OLDIFS="$IFS"
    IFS=,
    for T in $ALLOWED; do
      N=$((N+1))
      [ "$MODE" = profileonly ] && [ "$N" -gt 1 ] && break
      E=$ERR
      RT="$TEXT"
      if [ "$MODE" = mixed ] && [ "$N" -eq 3 ]; then E=true; RT=channel_not_found; fi
      [ -n "$USES" ] && USES="$USES,"
      [ -n "$RESULTS" ] && RESULTS="$RESULTS,"
      USES="$USES{\\"type\\":\\"tool_use\\",\\"id\\":\\"t$N\\",\\"name\\":\\"$T\\",\\"input\\":{}}"
      RESULTS="$RESULTS{\\"tool_use_id\\":\\"t$N\\",\\"type\\":\\"tool_result\\",\\"content\\":[{\\"type\\":\\"text\\",\\"text\\":\\"$RT\\"}],\\"is_error\\":$E}"
    done
    IFS="$OLDIFS"
    case "$MODE" in
      reply|toolerror|denied|mixed|profileonly|nouse)
        echo "{\\"type\\":\\"system\\",\\"subtype\\":\\"init\\",\\"tools\\":[$TOOLS],\\"mcp_servers\\":[{\\"name\\":\\"claude.ai Slack\\",\\"status\\":\\"connected\\"}]}"
        if [ "$MODE" != nouse ]; then
          echo "{\\"type\\":\\"assistant\\",\\"message\\":{\\"content\\":[$USES]}}"
          printf '%s\\n' "{\\"type\\":\\"user\\",\\"message\\":{\\"content\\":[$RESULTS]}}"
        fi
        if [ "$MODE" = denied ]; then
          tr -d '\\n' < "$DIR/reply.json" | sed 's/^{/{"permission_denials":[{"tool_name":"x"}],/'; echo
        else
          tr -d '\\n' < "$DIR/reply.json"; echo
        fi ;;
      notools)
        echo '{"type":"system","subtype":"init","tools":[],"mcp_servers":[{"name":"claude.ai Slack","status":"pending"}]}'
        tr -d '\\n' < "$DIR/reply.json"; echo ;;
      sleep) exec sleep 30 ;;
      fail) exit 3 ;;
    esac
    exit 0 ;;
esac
echo "2.1.291 (Claude Code)"
exit 0
`;

/**
 * Write the connector fake `claude` into a bin dir; it works inside the folder `CONNECTOR_STUB_DIR` names.
 *
 * @remarks `calls.log` gets one `mcp list` line per list read and one `call` line per model call, and
 * `argv.log` and `stdin.log` hold each call's input, each closed by an `@@` line. In `reply` mode the fake
 * uses every allowed tool and answers each with a tool result holding `tool-text.txt` when it is not empty,
 * else the text of `reply.json`. The `mode` file holds `reply`, `toolerror`, `denied`, `mixed` (the third
 * tool answers an error result), `profileonly`, `notools`, `nouse`, `sleep` or `fail`.
 */
export function writeConnectorClaude(binDir: string): string {
  const file = path.join(binDir, "claude");
  fs.writeFileSync(file, CONNECTOR_CLAUDE, { mode: 0o755 });
  return file;
}
