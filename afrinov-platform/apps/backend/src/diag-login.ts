import { buildServer } from './server.js';

async function main() {
  // This tool is compiled into the production image, so it must refuse to run
  // there: it prints a full login response, which includes a live bearer token.
  if (process.env.NODE_ENV === 'production') {
    console.error('diag-login refuses to run when NODE_ENV=production.');
    process.exit(2);
  }
  // Diagnostic bootstrap credentials are sourced from the environment, never
  // hardcoded. Mirrors the value the seed uses to create the admin account.
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@afrinov.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error('SEED_ADMIN_PASSWORD is required for the diagnostic login tool.');
    process.exit(2);
  }
  const app = await buildServer({ skipConfigValidation: true });
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: adminEmail, password: adminPassword },
    });
    console.log('status:', res.statusCode);
    if (res.statusCode === 200) {
      // Deliberately omit the response body: it contains a signed bearer token.
      console.log('body: <redacted — login succeeded>');
    } else {
      console.log('body:', res.body);
    }
    console.log('headers:', JSON.stringify(res.headers));
  } catch (e) {
    console.error('INJECT THREW:', e);
  } finally {
    await app.close();
  }
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
