import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'] },
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
    // Dependencies point inward: the domain imports no framework, infra or outer layer.
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
