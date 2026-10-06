import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  // Compiled into the production image; refuse to run there.
  if (process.env.NODE_ENV === 'production') {
    console.error('diagnostic refuses to run when NODE_ENV=production.');
    process.exit(2);
  }
  const u = await p.user.findUnique({
    where: { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@afrinov.local' },
    include: { roles: { include: { role: true } } },
  });
  console.log('user found:', !!u);
  if (u) {
    console.log('active:', u.active);
    console.log('roles:', u.roles.map(r => r.role.name));
    console.log('has passwordHash:', !!u.passwordHash);
  }
  const all = await p.user.findMany({ select: { email: true, active: true } });
  console.log('all users:', all);
  await p.$disconnect();
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
