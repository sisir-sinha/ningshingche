import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Architecture boundaries (docs/03-project-structure.md §3).
 *
 * These are the rules that make the anti-pattern in §51 of the spec
 * structurally impossible rather than merely discouraged. If a plugin cannot
 * import the sales engine, it cannot fork the sales engine.
 */
const noFeaturesFromPlugins = {
  group: ['@/features', '@/features/*', '@/features/**'],
  message:
    'Plugins may not import features. Use the injected PluginContext, ' +
    'declared dependencies, or events instead (docs/05 §4).',
}

const noCrossPluginImports = {
  group: ['@/plugins', '@/plugins/*', '@/plugins/**'],
  message:
    'Plugins may not import other plugins by alias. Use relative imports ' +
    'inside your own plugin, and compose across plugins via `dependencies` ' +
    'and events (docs/05 §4).',
}

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'supabase/functions/*/index.ts'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Node-run scripts and config files: browser-free, console allowed.
  {
    files: ['tools/**/*.mjs', '*.config.js', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'writable',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },

  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },

  // Rule 1 — the UI kit must stay business-ignorant, or it stops being reusable.
  {
    files: ['src/components/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/features', '@/features/*', '@/features/**'], message: 'The UI kit may not import features.' },
            { group: ['@/plugins', '@/plugins/*', '@/plugins/**'], message: 'The UI kit may not import plugins.' },
            { group: ['@/shared/repositories', '@/shared/repositories/*', '@/shared/repositories/**'], message: 'The UI kit may not talk to data sources.' },
            { group: ['@supabase/supabase-js'], message: 'The UI kit may not touch Supabase directly.' },
          ],
        },
      ],
    },
  },

  // Rule 2 — domain logic stays pure, so it can be the Android specification.
  {
    files: ['src/shared/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/app/*', '@/core/*', '@/components/*', '@/features/*', '@/plugins/*', '@/layouts/*'], message: 'Domain logic may not import UI or platform layers.' },
            { group: ['@/shared/repositories', '@/shared/repositories/*', '@/shared/services', '@/shared/services/*', '@/shared/stores', '@/shared/stores/*'], message: 'Domain logic may not import I/O layers — it must stay pure.' },
            { group: ['@supabase/supabase-js'], message: 'Domain logic may not touch Supabase.' },
          ],
        },
      ],
    },
  },

  // Rule 3 — plugins see only the platform, the UI kit and shared code.
  {
    files: ['src/plugins/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            noFeaturesFromPlugins,
            noCrossPluginImports,
            { group: ['@supabase/supabase-js'], message: 'Use `ctx.db` from the PluginContext, not a raw Supabase client (docs/05 §4).' },
          ],
        },
      ],
    },
  },

  // Rule 4 — presentation must not reach the database directly.
  {
    files: ['src/pages/**/*.ts', 'src/layouts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@supabase/supabase-js'], message: 'Go through a service or repository, not Supabase directly.' }] },
      ],
    },
  },
)
