import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores } from 'eslint/config';

export default tseslint.config(
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.mts', 'manifest.json', 'version-bump.mjs'],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.json'],
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'error',
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
  globalIgnores(['node_modules', 'dist', 'esbuild.config.mjs', 'versions.json', 'main.js']),
);
