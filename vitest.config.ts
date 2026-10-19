import { defineConfig } from 'vitest/config'

export default defineConfig({
  /** Vite 8 transforms with Oxc; its `esbuild` option is deprecated. */
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
