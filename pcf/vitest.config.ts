import { defineConfig } from 'vitest/config';

// Vitest, not Jest, deliberately:
//  - pcf-scripts owns its own webpack + tsc invocation and is not user-extensible. Vitest is a
//    standalone ESM-native runner with its own transform, so it never participates in the control
//    build. Jest here would mean a second TypeScript pipeline to keep in sync with
//    pcf-scripts/tsconfig_base.json.
//  - the repo is already ESM (eslint.config.mjs, every script in scripts/).
//  - jsdom can be requested per file with `// @vitest-environment jsdom`, which matters because
//    domain/threading.ts and domain/quoting.ts are string-pure while sanitise.ts will need a DOM.
export default defineConfig({
  test: {
    globals: false, // tests import describe/it/expect explicitly; see tsconfig.test.json
    environment: 'node',
    include: ['CaseEmailClient/**/*.test.ts?(x)'],
    coverage: {
      // data/ too: the send sequence, pre-flight and uploads live there (R1).
      include: ['CaseEmailClient/domain/**/*.ts', 'CaseEmailClient/data/**/*.ts'],
      reporter: ['text', 'html'],
    },
  },
});
