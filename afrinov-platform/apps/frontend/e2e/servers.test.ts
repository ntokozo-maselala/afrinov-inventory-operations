// @vitest-environment node
//
// The servers the browser suite starts, and how they stop. They start through
// a shell, as `npx tsx …` and `npx vite …` do, so the process the suite holds
// is the shell: the server listening on the port is a grandchild. Stopping
// only the shell left Vite (and at times the backend) running on Windows,
// where the next run, or a dev server, then met a port already taken, or
// worse, a stale server already answering.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, connect, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertPortFree, assertRunning, startServer, stopServer, waitUntilReady } from './servers';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * How long a fixture process lives at most. A test that fails can't always
 * stop what it started (on Windows, once the shell above a process has gone,
 * taskkill can no longer follow the tree down to it), so each one ends
 * itself; the tests take a second or two.
 */
const FIXTURE_LIFETIME_MS = 20_000;

/** True when something accepts a connection on the port. */
function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function until(check: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('the browser suite\'s servers', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'afrinov-e2e-servers-'));
    // The grandchild listens, as the node process under `npx vite` does.
    writeFileSync(join(dir, 'listener.cjs'),
      "require('node:http').createServer((q, s) => s.end('ok')).listen(Number(process.argv[2]), '127.0.0.1');"
      + ` setTimeout(() => process.exit(0), ${FIXTURE_LIFETIME_MS});`);
    // The child starts it and stays, as npx does; stopping the child alone leaves the listener.
    writeFileSync(join(dir, 'parent.cjs'),
      "require('node:child_process').spawn(process.execPath, [require('node:path').join(__dirname, 'listener.cjs'), process.argv[2]], { stdio: 'ignore' });"
      + ` setTimeout(() => process.exit(0), ${FIXTURE_LIFETIME_MS});`);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('stops the whole tree, the server listening under the shell included, before it returns', async () => {
    const port = await freePort();
    const proc = startServer('node', ['parent.cjs', String(port)], dir, {});
    try {
      await until(() => answers(port));

      await stopServer(proc);

      expect(await answers(port)).toBe(false);
    } finally {
      // A failed wait or assertion must not leave the tree running.
      await stopServer(proc);
    }
  }, 30_000);

  it('does nothing for a server that has already stopped', async () => {
    const proc = startServer('node', ['-e', '0'], dir, {});
    await new Promise((resolve) => proc.once('exit', resolve));
    await expect(stopServer(proc)).resolves.toBeUndefined();
  });

  // Cubic, PR #211: the servers must not outlive the runner. Ctrl+C reaches
  // them through the terminal (they share its process group); a runner that
  // exits before its teardown (an error) stops them from its exit hook.
  it('stops the servers when the process that started them exits, however it ends', async () => {
    const port = await freePort();
    writeFileSync(join(dir, 'runner.mjs'), [
      `import { startServer, stopServersOnExit } from ${JSON.stringify(pathToFileURL(join(here, 'servers.ts')).href)};`,
      `const proc = startServer('node', ['parent.cjs', '${port}'], ${JSON.stringify(dir)}, {});`,
      'stopServersOnExit(() => [proc]);',
      "const { connect } = await import('node:net');",
      `const up = () => new Promise((r) => { const s = connect({ port: ${port}, host: '127.0.0.1' }); s.once('connect', () => { s.destroy(); r(true); }); s.once('error', () => r(false)); });`,
      // Bounded: a server that never listens ends the runner (code 4) instead of leaving it polling.
      'for (let i = 0; !(await up()); i += 1) { if (i > 150) process.exit(4); await new Promise((r) => setTimeout(r, 100)); }',
      // Ends without any teardown, as a runner does on an error.
      'process.exit(3);',
    ].join('\n'));
    const runner = spawn(process.execPath, ['runner.mjs'], { cwd: dir, stdio: 'ignore' });
    const code = await new Promise<number | null>((resolve) => runner.once('exit', resolve));
    expect(code).toBe(3);
    // If the hook failed, the fixtures still end themselves (FIXTURE_LIFETIME_MS).
    expect(await answers(port)).toBe(false);
  }, 30_000);

  // Cubic, PR #211: the ports are checked once, before the start; something
  // could take one in between and answer the readiness check. A server of
  // ours that exits (on "port in use") then fails setup instead.
  it('fails if the server exits before it is ready, saying how it ended', async () => {
    const proc = startServer('node', ['-e', '"process.exit(7)"'], dir, {});
    await expect(waitUntilReady(proc, 'the backend', () => new Promise<boolean>(() => {}), 10_000))
      .rejects.toThrow(/the backend exited \(code 7\) before it was ready/);
  });

  // Cubic, PR #211: a check that never settles must not hold setup past its limit.
  it('gives up at its time limit even when a check never answers', async () => {
    const proc = startServer('node', ['-e', `"setTimeout(() => {}, ${FIXTURE_LIFETIME_MS})"`], dir, {});
    try {
      const started = Date.now();
      await expect(waitUntilReady(proc, 'the backend', () => new Promise<boolean>(() => {}), 500))
        .rejects.toThrow(/the backend was not ready after 0.5 seconds/);
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      await stopServer(proc);
    }
  }, 10_000);

  it('is ready once the check passes while the server is still running', async () => {
    const port = await freePort();
    const proc = startServer('node', ['parent.cjs', String(port)], dir, {});
    try {
      await expect(waitUntilReady(proc, 'the backend', () => answers(port), 15_000)).resolves.toBeUndefined();
      await stopServer(proc);
      expect(() => assertRunning(proc, 'the backend')).toThrow(/the backend has exited/);
    } finally {
      await stopServer(proc);
    }
  }, 30_000);

  describe('assertPortFree', () => {
    let taken: Server;
    let port: number;
    beforeAll(async () => {
      taken = createServer();
      await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
      port = (taken.address() as { port: number }).port;
    });
    afterAll(() => new Promise<void>((resolve) => taken.close(() => resolve())));

    // A server left from an earlier run, or a dev server, would otherwise
    // answer the readiness check, and the suite would test it instead of the
    // one it means to start, against whatever database that one uses.
    it('refuses a port something already answers on, naming it and what to do', async () => {
      await expect(assertPortFree(port, 'the backend')).rejects.toThrow(
        new RegExp(`Port ${port} is already in use.*the backend`, 's'),
      );
    });

    it('accepts a port nothing answers on', async () => {
      await expect(assertPortFree(await freePort(), 'the backend')).resolves.toBeUndefined();
    });
  });
});
