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
     * crash with "rule which requires type information". Disable the typed rules
     * everywhere; the block below re-enables the applicable ones on real TS source.
     *
     * 0.3.0 also newly enforces rules the 0.1.9 baseline did not. `prefer-window-timers`
     * directly contradicts this project's popout-safety convention (AGENTS.md prefers
     * `activeWindow.setTimeout`), and `no-unsupported-api` flags APIs newer than the
     * declared minAppVersion. Adopting those is a separate migration, so they stay off.
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
      'obsidianmd/prefer-file-manager-trash-file': 'warn',
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
