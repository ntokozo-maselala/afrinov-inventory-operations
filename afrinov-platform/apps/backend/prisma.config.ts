import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Commands that never open a connection. They run in pretypecheck/pretest/prebuild
// where DATABASE_URL may be absent, so a placeholder URL is harmless.
const OFFLINE_COMMANDS = new Set(['generate', 'validate', 'format']);

// Every other command (migrate, db seed, introspect, …) does touch the database.
// Falling back to a local URL there could apply migrations to the wrong server,
// so require the variable to be set explicitly.
const command = process.argv[2] ?? '';
const databaseUrl = process.env.DATABASE_URL;

if (!OFFLINE_COMMANDS.has(command) && !databaseUrl) {
  throw new Error(
    `DATABASE_URL is required for "prisma ${command}" but was not set. ` +
      'Set it in the environment or in apps/backend/.env.',
  );
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl ?? 'postgresql://localhost:5432/afrinov',
  },
});
