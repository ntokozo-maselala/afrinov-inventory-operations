import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// DATABASE_URL is only needed for migration/introspection commands. `prisma
// generate` runs in pretypecheck/pretest/prebuild where the variable may be
// absent, so fall back to a placeholder instead of letting env() throw.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/afrinov',
  },
});
