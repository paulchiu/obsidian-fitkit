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
  group: string[]
  message: string
}

/** Import patterns for the module or folder `name` at any depth, with or without an extension. */
const anyDepth = (...names: string[]): string[] =>
  names.flatMap((name) => [`**/${name}`, `**/${name}.*`, `**/${name}/**`])

/** Bans imports across a tier boundary, on top of obsidianmd's own restricted imports. */
const fence = (...patterns: Banned[]): Linter.RuleEntry => [
  'error',
  { paths: recommendedOptions('@typescript-eslint/no-restricted-imports'), patterns },
]

/** `src/main.ts` and `src/settings.ts`, which import `obsidian`; `settings-paths` is pure and allowed. */
const PLUGIN_SHELL: Banned = {
  group: anyDepth('main', 'settings'),
  message: 'The plugin shell imports obsidian; take what you need as an argument.',
}

/** Dynamic and type-query imports, which `no-restricted-imports` cannot see. */
const STATIC_IMPORTS_ONLY: Linter.RuleEntry = [
  'error',
  ...['ImportExpression', 'TSImportType'].map((selector) => ({
    selector,
    message: 'Use a static import, so the tier fence can check it.',
  })),
]

/** Obsidian's own globals, banned where code must run without Obsidian. */
const OBSIDIAN_GLOBALS = [
  'activeDocument',
  'activeWindow',
  'createFragment',
  'createEl',
  'createDiv',
  'createSpan',
  'createSvg',
  'fish',
  'fishAll',
  'sleep',
  'nextFrame',
  'ready',
  'ajax',
  'ajaxPromise',
].map((name) => ({
  name,
  message: 'Only src/ui/obsidian uses Obsidian globals; reach the document through an element.',
}))

/** Obsidian's DOM prototype extensions, minus names generic enough to hit arrays (`find`, `indexOf`). */
const NO_OBSIDIAN_DOM: Linter.RuleEntry = [
  'error',
  ...[
    'addClass',
    'addClasses',
    'appendText',
    'constructorWin',
    'createDiv',
    'createEl',
    'createSpan',
    'createSvg',
    'detach',
    'doc',
    'empty',
    'findAll',
    'findAllSelf',
    'getAttr',
    'getCssPropertyValue',
    'getText',
    'hasClass',
    'insertAfter',
    'instanceOf',
    'isActiveElement',
    'isShown',
    'matchParent',
    'onClickEvent',
    'onNodeInserted',
    'onWindowMigrated',
    'removeClass',
    'removeClasses',
    'setAttr',
    'setAttrs',
    'setChildrenInPlace',
    'setCssProps',
    'setCssStyles',
    'setText',
    'toggleClass',
    'toggleVisibility',
    'win',
  ].map((property) => ({
    property,
    message: 'An Obsidian DOM extension; use the standard DOM, or JSX in a component.',
  })),
]

/** The globals, syntax and properties every tier that runs without Obsidian is held to. */
const pureTier = (
  extraGlobals: { name: string; message: string }[] = [],
  extraSyntax: { selector: string; message: string }[] = [],
): Linter.RulesRecord => ({
  'no-restricted-globals': [
    'error',
    ...recommendedOptions('no-restricted-globals'),
    ...OBSIDIAN_GLOBALS,
    ...extraGlobals,
  ],
  'no-restricted-properties': NO_OBSIDIAN_DOM,
  'no-restricted-syntax': [...STATIC_IMPORTS_ONLY, ...extraSyntax],
})

/** The browser globals `src/ui/model` may not touch, since it holds no DOM. */
const DOM_GLOBALS = [
  'document',
  'window',
  'navigator',
  'Document',
  'Element',
  'HTMLElement',
  'SVGElement',
  'Node',
  'Event',
].map((name) => ({ name, message: 'src/ui/model holds no DOM; src/ui/components draws it.' }))

/** DOM types, which `no-restricted-globals` does not see in type positions. */
const DOM_TYPES = [
  {
    selector:
      'TSTypeReference > Identifier[name=/^(Document|Element|Node|Event|Window|(HTML|SVG)\\w*Element)$/]',
    message: 'src/ui/model holds no DOM; src/ui/components draws it.',
  },
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
     * obsidianmd's recommended config enables typed rules globally, so they crash without parser services
     * (package.json, *.mjs). Turn them off everywhere; the block below re-enables them on TypeScript source.
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
     * Restates obsidianmd's `no-restricted-disable` list (ESLint replaces rule options) so `no-global-this`
     * can be silenced inline for `vi.stubGlobal('activeWindow', globalThis)`; the `ui` pair below reopens that segment.
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
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true, requireDefaultForNonUnion: false },
      ],
    },
  },
  {
    /** The domain runs without Obsidian, Preact, the vault or the UI, and lint holds it to that. */
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': fence(
        { group: anyDepth('obsidian'), message: 'src/domain never imports obsidian.' },
        {
          group: anyDepth('preact'),
          message: 'src/domain returns data; src/ui/components draws it.',
        },
        {
          group: anyDepth('ui', 'vault'),
          message: 'src/domain imports only itself and src/settings-paths.',
        },
        PLUGIN_SHELL,
      ),
      ...pureTier(),
    },
  },
  {
    /** The UI model is pure data over the domain: no DOM, Preact or Obsidian. */
    files: ['src/ui/model/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': fence(
        {
          group: anyDepth('preact'),
          message: 'src/ui/model returns data; src/ui/components draws it.',
        },
        {
          group: anyDepth('obsidian', 'components', 'vault'),
          message: 'src/ui/model imports only src/domain, src/settings-paths and itself.',
        },
        PLUGIN_SHELL,
      ),
      ...pureTier(DOM_GLOBALS, DOM_TYPES),
    },
  },
  {
    files: ['src/ui/components/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': fence(
        {
          group: anyDepth('obsidian'),
          message:
            'Components reach Obsidian through the Host context; only src/ui/obsidian imports it.',
        },
        {
          group: anyDepth('vault'),
          message: 'Components take what they need as props or from the Host context.',
        },
        PLUGIN_SHELL,
      ),
      ...pureTier(),
    },
  },
  {
    files: ['src/vault/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': fence({
        group: anyDepth('ui'),
        message: 'The vault tier never imports from src/ui.',
      }),
      'no-restricted-syntax': STATIC_IMPORTS_ONLY,
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
