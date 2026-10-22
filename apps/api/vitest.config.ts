import { configDefaults, defineConfig } from 'vitest/config';

export const INTEGRATION_TESTS = 'src/**/*.integration.test.ts';

// Unit tests only: fast, no network, no servers. Integration tests run with
// vitest.integration.config.ts (npm run test:integration).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, INTEGRATION_TESTS],
  },
});
