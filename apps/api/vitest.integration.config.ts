import { defineConfig } from 'vitest/config';
import { INTEGRATION_TESTS } from './vitest.config';

// Integration tests only: real HTTP against the mock banks started in-process.
export default defineConfig({
  test: {
    include: [INTEGRATION_TESTS],
  },
});
