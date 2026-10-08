import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  { ignores: ["build", ".plasmo", "node_modules", "*.tsbuildinfo"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  // JSX runs through the automatic runtime (tsconfig jsx: react-jsx).
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  // Turn off stylistic rules that fight Prettier; must come after the rule sets above.
  prettier,
  {
    files: ["**/*.{ts,tsx,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        chrome: "readonly",
      },
    },
    settings: { react: { version: "18.3" } },
    rules: {
      // Type assertions (`x as T`) hide real type errors at the seams they paper over;
      // prefer narrowing, generics (querySelectorAll<T>, closest<T>) or honest types.
      // Kept as a warning so a genuinely unavoidable assertion can be justified in place.
      "@typescript-eslint/consistent-type-assertions": [
        "warn",
        { assertionStyle: "never" },
      ],
      // Underscore-prefixed arguments (e.g. the Plasmo no-op render hook) are deliberately unused.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "vitest.config.ts", "scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
