// Apply pending Prisma migrations against DATABASE_URL.
import { execSync } from 'node:child_process';

console.log('Applying Prisma migrations…');
try {
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });
  console.log('Migrations applied.');
} catch (err) {
  console.error('Migration failed', err);
  process.exit(1);
}