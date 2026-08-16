import tseslint from 'typescript-eslint'
import obsidianmd from 'eslint-plugin-obsidianmd'
import globals from 'globals'
import { globalIgnores } from 'eslint/config'

/**
 * `import.meta.dirname` is Node-only and this file is typed by the default
 * project (tsconfig.json), which has no `node` types, so it resolves to an
 * error type. Assert it once here rather than at each use site.
 */
const tsconfigRootDir = import.meta.dirname as string

export default tseslint.config(
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
      'obsidianmd/prefer-window-timers': 'off',
      'obsidianmd/no-global-this': 'off',
    },
  },
  {
    files: ['**/*.{ts,cts,mts,tsx,js,cjs,mjs,jsx}'],
    /**
     * Restates obsidianmd's `no-restricted-disable` list (ESLint replaces rule
     * options rather than merging them) so two rules can still be silenced
     * inline where the codebase has a documented reason: `ui/sentence-case` for
     * unit symbols like "kg" and "0s", and `no-global-this` for the test-harness
     * `vi.stubGlobal('activeWindow', globalThis)` bootstrapping.
     *
     * Patterns are matched with gitignore semantics, so `obsidianmd/*` excludes
     * the `obsidianmd/ui` segment wholesale and nothing beneath it can be
     * re-included. The `ui` pair below reopens that segment before restricting
     * its rules individually.
     */
    rules: {
      'eslint-comments/no-restricted-disable': [
        'error',
        'obsidianmd/*',
        '!obsidianmd/ui',
        'obsidianmd/ui/*',
        '!obsidianmd/ui/sentence-case',
        '!obsidianmd/no-global-this',
        'no-console',
        'no-restricted-globals',
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
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      'obsidianmd/no-plugin-as-component': 'error',
      'obsidianmd/no-view-references-in-plugin': 'error',
      'obsidianmd/no-unsupported-api': 'error',
      'obsidianmd/prefer-file-manager-trash-file': 'error',
      'obsidianmd/prefer-instanceof': 'error',
      'obsidianmd/no-global-this': 'error',
      /**
       * Intentionally left off. `prefer-window-timers` wants bare `window.setTimeout`
       * / `window.setInterval`, which breaks in Obsidian popout windows. This project
       * mandates `activeWindow.setTimeout` / `activeWindow.setInterval` for popout
       * safety (see AGENTS.md "Popout safety"), so enabling this rule would push the
       * source in the opposite direction of the documented convention.
       */
      'obsidianmd/prefer-window-timers': 'off',
    },
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['tests/**/*.ts'],
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
