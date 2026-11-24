// @vitest-environment node
//
// The servers the browser suite starts, and how they stop. They start through
// a shell, as `npx tsx …` and `npx vite …` do, so the process the suite holds
// is the shell: the server listening on the port is a grandchild. Stopping
// only the shell left Vite (and at times the backend) running on Windows,
// where the next run, or a dev server, then met a port already taken, or
// worse, a stale server already answering.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, connect, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertPortFree, startServer, stopServer } from './servers';

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
      "require('node:http').createServer((q, s) => s.end('ok')).listen(Number(process.argv[2]), '127.0.0.1');");
    // The child starts it and stays, as npx does; stopping the child alone leaves the listener.
    writeFileSync(join(dir, 'parent.cjs'),
      "require('node:child_process').spawn(process.execPath, [require('node:path').join(__dirname, 'listener.cjs'), process.argv[2]], { stdio: 'ignore' });"
      + ' setInterval(() => {}, 1000);');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('stops the whole tree, the server listening under the shell included, before it returns', async () => {
    const port = await freePort();
    const proc = startServer('node', ['parent.cjs', String(port)], dir, {});
    await until(() => answers(port));

    await stopServer(proc);

    expect(await answers(port)).toBe(false);
  }, 30_000);

  it('does nothing for a server that has already stopped', async () => {
    const proc = startServer('node', ['-e', '0'], dir, {});
    await new Promise((resolve) => proc.once('exit', resolve));
    await expect(stopServer(proc)).resolves.toBeUndefined();
  });

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
