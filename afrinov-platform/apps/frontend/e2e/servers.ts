// Starting and stopping the servers the browser suite runs against.
//
// They start through a shell (`npx tsx …`, `npx vite …`), so the process the
// suite holds is the shell, and the server listening on the port is one or
// two processes below it. Stopping only the shell left those running: on
// Windows every run left Vite on 5173, and the next run, or a developer's own
// dev server, then met a port already taken, or a stale server answering.
// So a server is stopped with everything it started, and the suite waits
// until it has gone; and a port that something already answers on is refused
// before the suite starts, so it never tests a server it didn't start.
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { connect } from 'node:net';

const windows = process.platform === 'win32';

/**
 * Starts a server through a shell. On Linux and macOS it leads a process
 * group of its own, so it can be stopped with everything it started; on
 * Windows a new group would open a console window, and `taskkill /T`
 * follows the process tree instead.
 */
export function startServer(cmd: string, args: string[], cwd: string, env: Record<string, string>): ChildProcessWithoutNullStreams {
  // One command line: Node 24 deprecates arguments beside `shell: true`
  // (DEP0190), as the shell would join them unescaped anyway. Every argument
  // here is a fixed word from this suite, never outside input.
  return spawn([cmd, ...args].join(' '), { cwd, env: { ...process.env, ...env }, shell: true, stdio: 'pipe', detached: !windows });
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function within(timeoutMs: number, done: () => boolean): Promise<boolean> {
  const start = Date.now();
  while (!done()) {
    if (Date.now() - start > timeoutMs) return false;
    await pause(50);
  }
  return true;
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}

/**
 * Stops a server and everything it started, and returns once they have gone:
 * on Windows `taskkill /T /F` on the tree; elsewhere SIGTERM to its process
 * group, then SIGKILL if anything is still there after `graceMs`. (In a
 * container whose PID 1 is node itself, an orphan that has exited is never
 * reaped and still counts as in the group, so the stop waits out both grace
 * periods before returning; with an init, as on CI, it returns at once.)
 */
export async function stopServer(proc: ChildProcessWithoutNullStreams | null, graceMs = 5_000): Promise<void> {
  if (!proc || proc.pid === undefined) return;
  const pid = proc.pid;
  if (windows) {
    // A shell that has already exited no longer links its children into a
    // tree taskkill can follow; that doesn't happen here, as the shell waits
    // for the server it runs.
    if (proc.exitCode !== null || proc.signalCode !== null) return;
    const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    await Promise.race([exited, pause(graceMs)]);
    return;
  }
  if (!groupAlive(pid)) return;
  signalGroup(pid, 'SIGTERM');
  if (await within(graceMs, () => !groupAlive(pid))) return;
  signalGroup(pid, 'SIGKILL');
  await within(graceMs, () => !groupAlive(pid));
}

function answers(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    socket.setTimeout(1_000, () => { socket.destroy(); resolve(false); });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

/**
 * Refuses a port that something already answers on (IPv4 or IPv6 loopback):
 * the suite's readiness check would take that server's answer for its own,
 * and the tests would run against it and whatever database it uses.
 */
export async function assertPortFree(port: number, what: string): Promise<void> {
  const taken = (await Promise.all([answers(port, '127.0.0.1'), answers(port, '::1')])).some(Boolean);
  if (taken) {
    throw new Error(
      `Port ${port} is already in use, so ${what} for the browser suite can't start there, and the suite would test `
      + 'whatever answers instead. Stop it (a dev server, or one left by an earlier run) and run the suite again.',
    );
  }
}
