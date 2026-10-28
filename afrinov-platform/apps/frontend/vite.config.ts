import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { demoBuildRefusal } from './src/config/buildGuard.ts';

// Fails a production build that would ship demo login or mock data.
function refuseDemoFlagsInProduction(): Plugin {
  return {
    name: 'afrinov:refuse-demo-flags-in-production',
    apply: 'build',
    configResolved(config) {
      const refusal = demoBuildRefusal(config.mode, config.env);
      if (refusal) throw new Error(refusal);
    },
  };
}

export default defineConfig({
  plugins: [react(), refuseDemoFlagsInProduction()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    // exceljs ships as a ~930 kB lazy chunk. It is only fetched on demand by
    // the export actions (`await import('exceljs')`), so it never affects first
    // paint; the default 500 kB budget is meant for eagerly-loaded code.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/react-router')) {
            return 'vendor-router';
          }
        },
      },
    },
  },
});
