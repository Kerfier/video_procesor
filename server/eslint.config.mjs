// @ts-check
import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';
import eslintPluginPrettier from 'eslint-plugin-prettier';

export default tseslint.config(
  // Ignored paths
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'eslint.config.mjs'],
  },

  // Base recommended rules
  eslint.configs.recommended,

  // TypeScript typed rules
  ...tseslint.configs.recommendedTypeChecked,

  // Language config
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Project-specific rules
  {
    plugins: { prettier: eslintPluginPrettier },
    rules: {
      // Prettier integration
      'prettier/prettier': ['error', { endOfLine: 'lf' }],

      // Safety
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',

      // Unused variables — use TS-aware version, ignore _-prefixed
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

      // NestJS uses class-based DI; return types on controllers are inferred
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',

      // Empty stub modules/services are expected during scaffolding
      '@typescript-eslint/no-empty-function': 'warn',
    },
  },

  // Must be last — disables formatting rules that conflict with Prettier
  prettierConfig,
);
