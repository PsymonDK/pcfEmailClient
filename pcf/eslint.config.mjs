import eslintjs from "@eslint/js";
import microsoftPowerApps from "@microsoft/eslint-plugin-power-apps";
import pluginPromise from "eslint-plugin-promise";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import typescriptEslint from "typescript-eslint";

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ["**/generated"],
  },
  eslintjs.configs.recommended,
  ...typescriptEslint.configs.recommendedTypeChecked,
  ...typescriptEslint.configs.stylisticTypeChecked,
  pluginPromise.configs["flat/recommended"],
  microsoftPowerApps.configs.paCheckerHosted,
  reactPlugin.configs.flat.recommended,
  // Rules of hooks, and effect dependencies. Added 2026-09-28 (R1): several of that review's React
  // bugs — a stale closure over the first render, a timer rebuilt every render — are exactly what
  // exhaustive-deps reports. Refs used deliberately to escape a dependency are commented in place.
  reactHooks.configs["recommended-latest"],
  {
    plugins: {
      "@microsoft/power-apps": microsoftPowerApps,
    },

    languageOptions: {
      globals: {
        ...globals.browser,
        ComponentFramework: true,
      },
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      // On since 2026-09-28 (R1): with it off, dead code accumulated unnoticed. A leading underscore
      // marks a parameter that is unused on purpose.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    // Test files are EXCLUDED from tsconfig.json so that `pcf-scripts build` does not type-check
    // them (it would fail on the vitest imports). But typescript-eslint's projectService then
    // cannot find them either, and every test file errors with "was not found by the project
    // service". Pointing this block at tsconfig.test.json is what reconciles the two.
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ["./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Test doubles for ComponentFramework.Context are cast through `unknown` on purpose:
      // building a complete platform context by hand would be more fiction than fixture, and the
      // cast is confined to one helper at the top of each test file.
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
    },
  },
];
