import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const MOCK_BANKS_RESTRICTION = {
  paths: [
    {
      name: '@simulador/mock-banks',
      message: 'Os bancos simulados só podem ser importados em testes *.integration.test.ts.',
    },
  ],
};

export default defineConfig(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'apps/api/src/generated/**'] },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    rules: {
      // Allows `const { field: _omitted, ...rest } = obj` to drop a field on purpose.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  {
    // The mock banks are a test fixture: production code talks to banks only over HTTP.
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/**/*.integration.test.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', MOCK_BANKS_RESTRICTION],
    },
  },
  {
    // Dependencies point inward: the domain imports no framework, infra or outer layer.
    // This block replaces the one above for domain files, so it repeats the mock-banks rule.
    files: ['apps/api/src/domain/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@simulador/shared',
              allowTypeImports: true,
              message: 'O domínio só pode importar tipos do shared (use import type).',
            },
            ...MOCK_BANKS_RESTRICTION.paths,
          ],
          patterns: [
            {
              group: [
                'fastify',
                'fastify/*',
                '@fastify/*',
                '@prisma/*',
                'pino',
                'pino-*',
                'zod',
                'zod/*',
                'node:*',
              ],
              message: 'O domínio não depende de framework, infraestrutura ou runtime.',
            },
            {
              group: [
                '**/application',
                '**/application/*',
                '**/infra',
                '**/infra/*',
                '**/http',
                '**/http/*',
              ],
              message: 'O domínio não importa camadas externas (application, infra, http).',
            },
          ],
        },
      ],
    },
  },
  // Must stay last: turns off rules that conflict with Prettier formatting.
  prettier,
);
