import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { requiresDatabaseUrl } from './src/shared/databaseUrlGuard.js';

const databaseUrl = process.env.DATABASE_URL;

// The datasource falls back to a local URL so schema-only commands (generate,
// validate, format) work without DATABASE_URL in pretypecheck/pretest/prebuild.
// For every other command a missing variable is an error: silently migrating
// the local `afrinov` database instead of the intended server is worse.
if (requiresDatabaseUrl(process.argv) && !databaseUrl) {
  throw new Error(
    'DATABASE_URL is required for this Prisma command but was not set. ' +
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
