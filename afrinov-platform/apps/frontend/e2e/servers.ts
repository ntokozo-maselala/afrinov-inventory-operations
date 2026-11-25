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
import { readdirSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';

const windows = process.platform === 'win32';

/**
 * Starts a server through a shell. It stays in the runner's process group,
 * so the terminal's Ctrl+C reaches it as it reaches the runner, however the
 * runner handles the signal.
 */
export function startServer(cmd: string, args: string[], cwd: string, env: Record<string, string>): ChildProcessWithoutNullStreams {
  // One command line: Node 24 deprecates arguments beside `shell: true`
  // (DEP0190), as the shell would join them unescaped anyway. Every argument
  // here is a fixed word from this suite, never outside input.
  return spawn([cmd, ...args].join(' '), { cwd, env: { ...process.env, ...env }, shell: true, stdio: 'pipe' });
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

/** Every process's parent, on Linux from /proc, elsewhere (macOS) from ps. */
function parents(): Map<number, number> {
  const parentOf = new Map<number, number>();
  if (process.platform === 'linux') {
    for (const entry of readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        // "pid (name) state ppid …": the name may hold spaces and brackets.
        const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
        parentOf.set(Number(entry), Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]));
      } catch {
        // Gone while we looked.
      }
    }
  } else {
    const ps = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).stdout ?? '';
    for (const line of ps.split('\n')) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number);
      if (pid && ppid !== undefined && !Number.isNaN(ppid)) parentOf.set(pid, ppid);
    }
  }
  return parentOf;
}

/** The process and every process below it, deepest last. */
function tree(root: number): number[] {
  const parentOf = parents();
  const found = [root];
  for (let i = 0; i < found.length; i += 1) {
    for (const [pid, ppid] of parentOf) if (ppid === found[i] && !found.includes(pid)) found.push(pid);
  }
  return found;
}

function signalAll(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

function anyAlive(pids: number[]): boolean {
  return pids.some((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Stops a server and everything it started, and returns once they have gone:
 * on Windows `taskkill /T /F` on the tree; elsewhere SIGTERM to the shell and
 * every process below it, then SIGKILL to any still there after `graceMs`.
 * (In a container whose PID 1 is node itself, an orphan that has exited is
 * never reaped and still looks alive, so the stop waits out both grace
 * periods before returning; with an init, as on CI, it returns at once.)
 */
export async function stopServer(proc: ChildProcessWithoutNullStreams | null, graceMs = 5_000): Promise<void> {
  if (!proc || proc.pid === undefined) return;
  // A shell that has already exited no longer has its children below it to
  // find; that doesn't happen here, as the shell waits for the server it runs.
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  const pid = proc.pid;
  if (windows) {
    const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    await Promise.race([exited, pause(graceMs)]);
    return;
  }
  const pids = tree(pid);
  signalAll(pids, 'SIGTERM');
  if (await within(graceMs, () => !anyAlive(pids))) return;
  signalAll(pids, 'SIGKILL');
  await within(graceMs, () => !anyAlive(pids));
}

/**
 * Stops a server and everything it started at once, without waiting: for an
 * exit hook, where nothing asynchronous runs. Kills the tree (`taskkill /T
 * /F`, or SIGKILL to each process in it); the processes are gone moments
 * later.
 */
export function stopServerNow(proc: ChildProcessWithoutNullStreams | null): void {
  if (!proc || proc.pid === undefined || proc.exitCode !== null || proc.signalCode !== null) return;
  if (windows) spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else signalAll(tree(proc.pid), 'SIGKILL');
}

/**
 * Stops the servers when this process exits before teardown has, as on an
 * error or a `process.exit`; after teardown they are already stopped, and
 * this does nothing. Ctrl+C reaches the servers through the terminal on its
 * own. A process killed outright (SIGKILL, Task Manager) runs no hook at all.
 */
export function stopServersOnExit(servers: () => Array<ChildProcessWithoutNullStreams | null>): void {
  process.once('exit', () => {
    for (const proc of servers()) stopServerNow(proc);
  });
}

/** How a server that is no longer running ended. */
function ending(proc: ChildProcessWithoutNullStreams): string {
  return proc.signalCode !== null ? `signal ${proc.signalCode}` : `code ${proc.exitCode}`;
}

/** Throws if the server has exited. */
export function assertRunning(proc: ChildProcessWithoutNullStreams, what: string): void {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    throw new Error(`${what} has exited (${ending(proc)}): another process may hold its port. See its output above.`);
  }
}

/**
 * Waits until `ready()` is true while the server is still running. The ports
 * are checked before the start, but something could take one in between and
 * answer `ready()` for it; a server of ours that can't listen exits, and
 * that fails here instead of being taken for ready.
 */
export async function waitUntilReady(
  proc: ChildProcessWithoutNullStreams,
  what: string,
  ready: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  const stillRunning = () => proc.exitCode === null && proc.signalCode === null;
  // Settles when the server exits, so a check that hangs can't hide it.
  const exited = new Promise<false>((resolve) => {
    if (!stillRunning()) resolve(false);
    else proc.once('exit', () => resolve(false));
  });
  for (;;) {
    if (!stillRunning()) {
      throw new Error(`${what} exited (${ending(proc)}) before it was ready: another process may hold its port. See its output above.`);
    }
    // Bounded by the time left too, so a check that never settles can't hold
    // setup past its limit while the server keeps running.
    const timeLeft = pause(Math.max(timeoutMs - (Date.now() - start), 0)).then(() => false);
    if (await Promise.race([ready(), exited, timeLeft])) {
      assertRunning(proc, what);
      return;
    }
    if (Date.now() - start > timeoutMs) throw new Error(`${what} was not ready after ${timeoutMs / 1000} seconds.`);
    await pause(250);
  }
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
