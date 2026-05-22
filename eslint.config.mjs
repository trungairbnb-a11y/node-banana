import nextPlugin from "eslint-config-next";
import tseslint from "typescript-eslint";

/**
 * ESLint flat config for Next 16.
 *
 * Next.js 16 removed the `next lint` subcommand, so we run ESLint directly
 * via `npm run lint`. The `eslint-config-next` package already exports a
 * flat-config array compatible with ESLint 9.
 *
 * https://nextjs.org/docs/app/api-reference/config/eslint
 */
const config = [
  ...nextPlugin,
  ...tseslint.configs.recommended,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "build/**",
      "dist/**",
      "coverage/**",
      "next-env.d.ts",
      "public/**",
    ],
  },
  {
    rules: {
      // This is a "soft" migration — `next lint` was broken (Next 16 removed
      // it) so existing code has never been linted. Downgrade noisy/legacy
      // rules to warnings so CI doesn't fail on pre-existing issues. New code
      // can be cleaned up incrementally.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "react/no-unescaped-entities": "off",
      "react-hooks/exhaustive-deps": "warn",
      // react-hooks v7 ships the experimental react-compiler rules. They
      // flag a lot of existing patterns in this codebase — downgrade so
      // they don't break CI.
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/set-state-in-render": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/component-hook-factories": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/error-boundaries": "warn",
      "react-hooks/unsupported-syntax": "warn",
      "react-hooks/incompatible-library": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/globals": "warn",
      "react-hooks/config": "warn",
      "react-hooks/gating": "warn",
      "react-hooks/fbt": "warn",
      "prefer-const": "warn",
    },
  },
];

export default config;
