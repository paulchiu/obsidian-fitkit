import tseslint from 'typescript-eslint'
import obsidianmd from 'eslint-plugin-obsidianmd'
import globals from 'globals'
import { globalIgnores } from 'eslint/config'

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
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.json'],
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    /**
     * obsidianmd 0.3.0's hybrid recommended config enables its typed rules (which
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
        tsconfigRootDir: import.meta.dirname,
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
