import { defineConfig } from 'vitest/config';
import { INTEGRATION_TESTS } from './vitest.config.ts';

// Integration tests only: real HTTP against the mock banks, real SQLite with the migrations.
export default defineConfig({
  test: {
    include: [INTEGRATION_TESTS],
  },
});
