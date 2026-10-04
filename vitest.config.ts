import { defineConfig } from 'vitest/config'

// Characterization tests for the annotation model (see src/lib/__tests__).
// They exist to pin current behavior while the modules around them are
// restructured, so they deliberately assert exact numbers rather than ranges.
//
// The environment is plain node, not jsdom: nothing under test touches the
// DOM except text measurement, and that already has a deterministic no-DOM
// fallback (`getMeasureCtx` returns null -> measureTextBounds estimates from
// character count). jsdom would not improve on that — its canvas has no
// measureText either — while making every run slower.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
