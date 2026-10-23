import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  clean: true,
  sourcemap: true,
  // @simulador/shared exports TypeScript source (no build step), so it must be compiled into
  // the bundle instead of being left as an external import Node cannot run.
  noExternal: ['@simulador/shared'],
});
