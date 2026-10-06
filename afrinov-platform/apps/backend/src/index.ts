import { loadConfig } from './shared/config.js';
import { start } from './server.js';

// Process-level safety net: make asynchronous/uncaught failures visible during
// startup and runtime. These do NOT swallow or recover from fatal errors — they
// log diagnostics to stderr and terminate, so a broken state is never silently
// served to clients.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
  process.exit(1);
});

// Validate configuration before starting the server so misconfiguration
// fails fast with a clear message rather than a cryptic DB/JWT error.
try {
  loadConfig();
} catch (err) {
  console.error('Configuration error:', (err as Error).message);
  process.exit(1);
}

start().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
