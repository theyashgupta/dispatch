import fsp from "node:fs/promises";
import writeFileAtomic from "write-file-atomic";
import { run } from "../adapters/exec.js";
import { DISPATCH_DIR, PTY_SHIM_PATH } from "../services/infra/paths.js";

/**
 * Body of `~/.dispatch/pty-shim.py`: a stdin/stdout-transparent pty wrapper that strips DECSET
 * 2026 (synchronized output) begin/end markers from the wrapped program's output.
 *
 * @remarks TERM-05: Claude Code probes its host with DECRQM(2026) and tmux always answers
 * "supported", so the classic renderer wraps every frame in `?2026h`/`?2026l`. tmux implements a
 * synchronized pane update as a full pane repaint, which never scrolls the attached client's
 * terminal, so the web client accumulates no local scrollback and mobile touch scrolling has
 * nothing local to scroll (probe-verified: identical 200-line output reached an attached client
 * as 202 buffer lines unwrapped vs 78 wrapped). A marker split across reads is held back via the
 * shared 7-byte prefix and re-examined with the next chunk. `String.raw` keeps the Python escape
 * sequences literal.
 * @remarks Three data-loss guards a future editor must not simplify away. `write_all` exists
 * because `os.write` is a thin `write(2)` that returns a SHORT count when a signal lands after a
 * partial transfer, and this shim handles SIGWINCH on every client attach, detach and phone
 * rotation, so a dropped tail would be a truncated CSI/OSC sequence corrupting everything after it.
 * The `pending` holdback is flushed on EOF, because breaking the loop with bytes still held would
 * silently drop the child's final write whenever it ends on any 1-to-7-byte prefix of the marker
 * (a bare `ESC`, or the `ESC[?2` that opens the very common `ESC[?25l`). And `IDLE_FLUSH_S` bounds
 * the holdback: a `ESC[?2026$p` DECRQM probe split at exactly the 7-byte prefix would otherwise sit
 * in `pending` forever with the child blocked on a reply that can never arrive. Its value must stay
 * comfortably ABOVE the real split window (a genuine marker's two halves arrive microseconds apart;
 * `--check pty-shim`'s own `split` case forces a deliberate 200ms gap), because flushing early
 * would emit a partial marker instead of stripping it.
 */
const PTY_SHIM_SCRIPT = String.raw`#!/usr/bin/env python3
import os, sys, pty, select, signal, fcntl, termios, tty

MARKERS = (b'\x1b[?2026h', b'\x1b[?2026l')
PREFIX = b'\x1b[?2026'
IDLE_FLUSH_S = 0.5

pid, master = pty.fork()
if pid == 0:
    os.execvp(sys.argv[1], sys.argv[1:])

def sync_size(*_):
    try:
        w = fcntl.ioctl(0, termios.TIOCGWINSZ, b'\0' * 8)
        fcntl.ioctl(master, termios.TIOCSWINSZ, w)
    except OSError:
        pass
signal.signal(signal.SIGWINCH, sync_size)
sync_size()

def write_all(fd, data):
    while data:
        try:
            n = os.write(fd, data)
        except InterruptedError:
            continue
        except OSError:
            return
        if n <= 0:
            return
        data = data[n:]

old = None
try:
    old = termios.tcgetattr(0); tty.setraw(0)
except termios.error:
    pass

pending = b''
try:
    while True:
        r, _, _ = select.select([0, master], [], [], IDLE_FLUSH_S)
        if not r:
            if pending: write_all(1, pending); pending = b''
            continue
        if 0 in r:
            try: d = os.read(0, 65536)
            except OSError: d = b''
            if not d: break
            write_all(master, d)
        if master in r:
            try: d = os.read(master, 65536)
            except OSError: d = b''
            if not d:
                if pending: write_all(1, pending); pending = b''
                break
            d = pending + d
            for m in MARKERS: d = d.replace(m, b'')
            pending = b''
            for i in range(min(len(PREFIX), len(d)), 0, -1):
                if d.endswith(PREFIX[:i]):
                    pending = d[-i:]; d = d[:-i]; break
            if d: write_all(1, d)
finally:
    if old is not None: termios.tcsetattr(0, termios.TCSADRAIN, old)

try:
    _, status = os.waitpid(pid, 0)
    code = os.waitstatus_to_exitcode(status)
    sys.exit(128 - code if code < 0 else code)
except ChildProcessError:
    sys.exit(0)
`;

/**
 * Idempotently (re)write `~/.dispatch/pty-shim.py` at boot, or remove it when python3 is broken.
 *
 * @remarks A resolvable-but-broken python3 (the macOS CLT stub) would kill every pane at spawn,
 * so the probe RUNS python3 rather than resolving its path. Removal on failure matters as much
 * as the write: `newSession` treats file existence as the wrap capability, so a stale shim left
 * behind after an OS change would break every future session instead of degrading scroll. The
 * probe is time-bounded because it runs before the HTTP listener is up and the exact binary it
 * exists to catch, the macOS CLT stub, can block on an install prompt: unbounded, that hangs boot
 * with no output.
 */
export async function installPtyShim(): Promise<void> {
  try {
    await run("python3", ["-c", "pass"], { timeout: 5000 });
  } catch {
    await fsp.rm(PTY_SHIM_PATH, { force: true });
    console.warn(
      "[pty-shim] python3 unavailable, claude panes spawn unwrapped and mobile scrollback degrades to the visible screen",
    );
    return;
  }
  await fsp.mkdir(DISPATCH_DIR, { recursive: true, mode: 0o700 });
  await writeFileAtomic(PTY_SHIM_PATH, PTY_SHIM_SCRIPT, { mode: 0o755 });
  await fsp.chmod(PTY_SHIM_PATH, 0o755);
}
