import react from '@vitejs/plugin-react';
import { loadEnv, type ProxyOptions } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // No VITE_ prefix: read by the dev server only, never bundled into the front.
  const { API_PROXY_TARGET = 'http://localhost:3000' } = loadEnv(mode, process.cwd(), '');

  // The front calls the API on its own origin (/api, see src/config.ts): no CORS, and response
  // headers such as Retry-After stay readable. In production a reverse proxy does the same.
  const proxy: Record<string, ProxyOptions> = {
    '/api/': { target: API_PROXY_TARGET, rewrite: (path) => path.replace(/^\/api/, '') },
  };

  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/testing/setup.ts'],
    },
  };
});
