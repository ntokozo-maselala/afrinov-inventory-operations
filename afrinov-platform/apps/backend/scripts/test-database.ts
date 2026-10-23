import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTestEnvironmentFile, requireIsolatedTestDatabaseUrl } from './test-environment.js';

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const action = process.argv[2];

if (action !== 'migrate' && action !== 'seed') {
  throw new Error('Choose the guarded test database action: migrate or seed.');
}

loadTestEnvironmentFile(resolve(backendDirectory, '.env.test'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = requireIsolatedTestDatabaseUrl();

if (action === 'seed' && !process.env.SEED_ADMIN_PASSWORD?.trim()) {
  throw new Error('SEED_ADMIN_PASSWORD is required to seed the isolated test database.');
}

const args = action === 'migrate'
  ? ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma']
  : ['tsx', 'src/db/seed.ts'];
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(command, args, {
  cwd: backendDirectory,
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  throw new Error(`Unable to run the guarded test database ${action} command.`);
}
process.exitCode = result.status ?? 1;
