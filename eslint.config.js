import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Architecture boundaries (docs/03-project-structure.md §3).
 *
 * These are the rules that make the anti-pattern in §51 of the spec
 * structurally impossible rather than merely discouraged. If a plugin cannot
 * import the sales engine, it cannot fork the sales engine.
 */
/**
 * Patterns are matched against the import specifier, and this project uses
 * relative imports — there is no `@/` alias. An earlier revision of these
 * rules matched `@/features/*` and therefore never fired at all.
 * `**\/` matches any number of `..\/` segments.
 *
 * These rules are the first line of defence. The authoritative check is
 * `tools/check-boundaries.mjs`, which resolves imports to real file paths and
 * so can catch cases a glob cannot (e.g. one plugin importing a sibling).
 */
const anyDepth = ['**/', '../../', '../../../', '../../../../']

const noFeaturesFromPlugins = {
  group: anyDepth.flatMap((prefix) => [`${prefix}features`, `${prefix}features/*`, `${prefix}features/**`]),
  message:
    'Plugins may not import features. Register a description through the ' +
    'PluginAPI, or compose via events (docs/05 §4).',
}

const noPluginsFromComponents = {
  group: anyDepth.flatMap((prefix) => [`${prefix}plugins`, `${prefix}plugins/*`, `${prefix}plugins/**`]),
  message: 'The UI kit may not import plugins.',
}

const noFeaturesFromComponents = {
  group: anyDepth.flatMap((prefix) => [`${prefix}features`, `${prefix}features/*`, `${prefix}features/**`]),
  message: 'The UI kit may not import features — it must stay business-ignorant.',
}

const noAppFromComponents = {
  group: anyDepth.flatMap((prefix) => [`${prefix}app`, `${prefix}app/*`, `${prefix}app/**`]),
  message: 'The UI kit may not import the app layer — no stores, no router, no Supabase.',
}

const noUiFromDomain = {
  group: anyDepth.flatMap((prefix) =>
    ['app', 'components', 'features', 'plugins', 'layouts'].flatMap((layer) => [
      `${prefix}${layer}`,
      `${prefix}${layer}/*`,
      `${prefix}${layer}/**`,
    ])
  ),
  message: 'Domain logic may not import UI or platform layers — it must stay pure.',
}

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'supabase/functions/*/index.ts'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // The browser-driving audit runs real page code through page.evaluate, so
  // its callbacks legitimately touch DOM globals even though node executes
  // the file. Everything else in tools/ is a plain node script.
  {
    files: ['tools/mobile-audit.mjs'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        getComputedStyle: 'readonly',
        MouseEvent: 'readonly',
        KeyboardEvent: 'readonly',
        Event: 'readonly',
      },
    },
  },

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
      // `log` stays banned: it is the one that survives into production and
      // becomes noise. `debug` is allowed because the plugin Logger wraps it
      // deliberately and can be silenced by the browser's level filter.
      'no-console': ['warn', { allow: ['warn', 'error', 'debug', 'info'] }],
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
            noFeaturesFromComponents,
            noPluginsFromComponents,
            noAppFromComponents,
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
            noUiFromDomain,
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
            { group: ['@supabase/supabase-js'], message: 'Plugins may not hold a Supabase client (docs/05 §4).' },
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
