import tseslint from 'typescript-eslint'
import obsidianmd from 'eslint-plugin-obsidianmd'
import globals from 'globals'
import { defineConfig, globalIgnores } from 'eslint/config'
import type { Linter } from 'eslint'

/**
 * `import.meta.dirname` is Node-only and this file is typed by the default
 * project (tsconfig.json), which has no `node` types, so it resolves to an
 * error type. Assert it once here rather than at each use site.
 */
const tsconfigRootDir = import.meta.dirname as string

/**
 * The object options obsidianmd's recommended config gives `rule`, so a fence below can add to them
 * rather than replace them (ESLint replaces rule options rather than merging). A fence sets the
 * whole rule to `error`, so in fenced folders obsidianmd's own checks rise from warnings to errors.
 */
const recommendedOptions = (rule: string): object[] => {
  const setting = [...obsidianmd.configs.recommended].reverse().find((c) => c.rules?.[rule])
  const entry = setting?.rules?.[rule]
  return Array.isArray(entry)
    ? entry.slice(1).filter((o): o is object => typeof o === 'object' && o !== null)
    : []
}

interface Banned {
  paths: { name: string; message: string }[]
  patterns: { group: string[]; message: string }[]
}

/** Bans imports across a tier boundary, on top of obsidianmd's own restricted imports. */
const fence = ({ paths, patterns }: Banned): Linter.RuleEntry => [
  'error',
  {
    paths: [...recommendedOptions('@typescript-eslint/no-restricted-imports'), ...paths],
    patterns,
  },
]

/** Obsidian's own globals, banned where code must run without Obsidian. */
const NO_OBSIDIAN_GLOBALS: Linter.RuleEntry = [
  'error',
  ...recommendedOptions('no-restricted-globals'),
  ...['activeDocument', 'activeWindow', 'createFragment'].map((name) => ({
    name,
    message: 'Only src/ui/obsidian uses Obsidian globals; reach the document through an element.',
  })),
]

/**
 * The plugin shell modules outside `src/ui/obsidian`, which import `obsidian`, as a fenced folder
 * reaches them; listed by path, since a bare `settings` pattern would catch `domain/settings`.
 */
const shells = (up: string): Banned['paths'] =>
  ['settings', 'main'].map((m) => ({
    name: `${up}${m}`,
    message: 'The plugin shell imports obsidian; take what you need as an argument.',
  }))

/** Obsidian's DOM prototype extensions, banned where code must run on a plain DOM. */
const NO_OBSIDIAN_DOM: Linter.RuleEntry = [
  'error',
  ...[
    'empty',
    'createEl',
    'createDiv',
    'createSpan',
    'createSvg',
    'addClass',
    'removeClass',
    'toggleClass',
    'setCssProps',
    'setAttr',
    'doc',
    'win',
  ].map((property) => ({
    property,
    message: 'An Obsidian DOM extension; use the standard DOM, or JSX in a component.',
  })),
]

export default defineConfig(
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        activeWindow: 'readonly',
        activeDocument: 'readonly',
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'eslint.config.mts',
            'manifest.json',
            'version-bump.mjs',
            'vitest.config.ts',
          ],
        },
        tsconfigRootDir,
        extraFileExtensions: ['.json'],
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    /**
     * obsidianmd's hybrid recommended config enables its typed rules (which
     * call getParserServices()) globally rather than only on TypeScript files. On
     * package.json (parsed with the JSON language) and on *.mjs/config files they
     * crash with "rule which requires type information". Turn the typed rules off
     * everywhere; the block below re-enables them on real TypeScript source where
     * parser services exist.
     */
    rules: {
      'obsidianmd/no-plugin-as-component': 'off',
      'obsidianmd/no-view-references-in-plugin': 'off',
      'obsidianmd/no-unsupported-api': 'off',
      'obsidianmd/prefer-file-manager-trash-file': 'off',
      'obsidianmd/prefer-instanceof': 'off',
      'obsidianmd/no-global-this': 'off',
    },
  },
  {
    files: ['**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}'],
    /**
     * Restates obsidianmd's `no-restricted-disable` list (ESLint replaces rule
     * options rather than merging them) so `no-global-this` can still be
     * silenced inline for the test-harness `vi.stubGlobal('activeWindow',
     * globalThis)` bootstrapping.
     *
     * Patterns are matched with gitignore semantics, so `obsidianmd/*` excludes
     * the `obsidianmd/ui` segment wholesale. The `ui` pair below reopens that
     * segment before restricting its rules individually.
     */
    rules: {
      'eslint-comments/no-restricted-disable': [
        'error',
        'obsidianmd/*',
        '!obsidianmd/ui',
        'obsidianmd/ui/*',
        '!obsidianmd/no-global-this',
        'no-console',
        'no-restricted-globals',
        'no-restricted-properties',
        '@typescript-eslint/no-restricted-imports',
        'no-alert',
        '@typescript-eslint/no-deprecated',
        '@typescript-eslint/no-explicit-any',
        '@microsoft/sdl/no-document-write',
        'no-eval',
        '@microsoft/sdl/no-inner-html',
        'obsidianmd/no-nodejs-modules',
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: {
      'obsidianmd/no-plugin-as-component': 'error',
      'obsidianmd/no-view-references-in-plugin': 'error',
      'obsidianmd/no-unsupported-api': 'error',
      'obsidianmd/prefer-file-manager-trash-file': 'error',
      'obsidianmd/prefer-instanceof': 'error',
      'obsidianmd/no-global-this': 'error',
      'obsidianmd/prefer-window-timers': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    /** The domain runs without Obsidian, Preact, the vault or the UI, and lint holds it to that. */
    files: ['src/domain/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': fence({
        paths: [
          { name: 'obsidian', message: 'src/domain never imports obsidian.' },
          { name: 'preact', message: 'src/domain returns data; src/ui/components draws it.' },
          ...shells('../'),
        ],
        patterns: [
          {
            group: ['preact/*', '**/ui/*', '**/vault/*'],
            message: 'src/domain imports only itself.',
          },
        ],
      }),
      'no-restricted-globals': NO_OBSIDIAN_GLOBALS,
      'no-restricted-properties': NO_OBSIDIAN_DOM,
    },
  },
  {
    /** The UI model is pure data over the domain: no DOM, Preact or Obsidian. */
    files: ['src/ui/model/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': fence({
        paths: [
          { name: 'obsidian', message: 'src/ui/model never imports obsidian.' },
          {
            name: 'preact',
            message: 'src/ui/model returns data; src/ui/components draws it.',
          },
          ...shells('../../'),
        ],
        patterns: [
          {
            group: ['preact/*', '**/components/*', '**/obsidian/*', '**/vault/*'],
            message: 'src/ui/model imports only src/domain and itself.',
          },
        ],
      }),
      'no-restricted-globals': NO_OBSIDIAN_GLOBALS,
      'no-restricted-properties': NO_OBSIDIAN_DOM,
    },
  },
  {
    files: ['src/ui/components/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': fence({
        paths: [
          {
            name: 'obsidian',
            message:
              'Components reach Obsidian through the Host context; only src/ui/obsidian imports it.',
          },
          ...shells('../../'),
        ],
        patterns: [
          {
            group: ['**/obsidian/*', '**/vault/*'],
            message: 'Components take what they need as props or from the Host context.',
          },
        ],
      }),
      'no-restricted-globals': NO_OBSIDIAN_GLOBALS,
      'no-restricted-properties': NO_OBSIDIAN_DOM,
    },
  },
  {
    files: ['src/vault/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': fence({
        paths: [],
        patterns: [{ group: ['**/ui/*'], message: 'The vault tier never imports from src/ui.' }],
      }),
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: false,
        project: './tsconfig.vitest.json',
        tsconfigRootDir,
      },
    },
  },
  {
    files: ['tests/harness/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Harness code runs under node during tests and never ships to a mobile device.
      'obsidianmd/no-nodejs-modules': 'off',
      /** The harness implements the `createEl` family, so it cannot call it without recursing. */
      'obsidianmd/prefer-create-el': 'off',
    },
  },
  {
    files: ['tests/domain/workout-note-model.test.ts', 'version-bump.mjs'],
    /** These run only under Node and never ship in the mobile plugin bundle. */
    rules: {
      'obsidianmd/no-nodejs-modules': 'off',
    },
  },
  {
    files: ['version-bump.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  globalIgnores([
    'node_modules',
    'dist',
    'esbuild.config.mjs',
    'versions.json',
    'main.js',
    'scripts/**/*.ts',
  ]),
)
