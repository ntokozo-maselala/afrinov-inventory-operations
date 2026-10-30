// Runs once before the integration suites.
//
// The seed creates the bootstrap admin with a forced password change (PRA-05),
// so until that change is made the admin may call nothing but
// `/auth/password`. The suites sign in as that admin to set up their data, so
// the change is marked done here, once, on the throwaway test database only.
// The forced change itself is covered by `password-lifecycle.real-http.test.ts`
// with users of its own. Any lockout left by an earlier run is cleared too.
import { loadTestEnvironmentFile, requireIsolatedTestDatabaseUrl } from '../scripts/test-environment.js';

export default async function setup(): Promise<void> {
  loadTestEnvironmentFile(`${process.cwd()}/.env.test`);
  requireIsolatedTestDatabaseUrl();
  const { prisma } = await import('../src/shared/db.js');
  try {
    await prisma.user.updateMany({
      where: { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@afrinov.local' },
      data: { mustChangePassword: false, failedLoginCount: 0, lockedUntil: null },
    });
  } finally {
    await prisma.$disconnect();
  }
}
