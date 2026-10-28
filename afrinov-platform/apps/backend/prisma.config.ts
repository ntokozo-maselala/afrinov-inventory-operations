import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Commands that open a database connection. Only these require DATABASE_URL;
// schema-only commands (generate, validate, format) and informational flags
// (--version, --help) must keep working without one, since they run in
// pretypecheck/pretest/prebuild where the variable may be absent.
const DB_COMMANDS = new Set(['migrate', 'db', 'introspect', 'studio']);

const command = process.argv[2] ?? '';
const isFlag = command.startsWith('-');
const databaseUrl = process.env.DATABASE_URL;

// Falling back to a local URL for a DB-touching command could apply migrations
// to the wrong server, so require the variable to be set explicitly.
if (!isFlag && DB_COMMANDS.has(command) && !databaseUrl) {
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
