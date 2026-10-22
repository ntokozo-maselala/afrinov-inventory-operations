import bcrypt from 'bcryptjs';
import { prisma } from '../src/shared/db.js';

const ADMIN_EMAIL = 'admin@afrinov.local';

async function main(): Promise<void> {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password || !password.trim()) {
    throw new Error('Set a non-empty SEED_ADMIN_PASSWORD before rotating the bootstrap admin password.');
  }
  if (password.length < 8) {
    throw new Error('SEED_ADMIN_PASSWORD must be at least 8 characters to rotate the bootstrap admin password.');
  }
  if (/^\0+$/.test(password)) {
    throw new Error('SEED_ADMIN_PASSWORD cannot consist only of NUL characters.');
  }

  const admin = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } });
  if (!admin) {
    throw new Error(`Bootstrap admin ${ADMIN_EMAIL} was not found; no credentials were changed.`);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: admin.id }, data: { passwordHash } });
    await tx.auditLogEntry.create({
      data: {
        actorId: null,
        action: 'PASSWORD_ROTATE',
        entityType: 'User',
        entityId: admin.id,
        before: { email: admin.email },
        after: { email: admin.email, passwordRotated: true },
      },
    });
  });

  console.log(`Rotated the bootstrap admin password for ${ADMIN_EMAIL}.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Failed to rotate the bootstrap admin password.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
