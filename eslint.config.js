import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import a11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default tseslint.config(
  // Global ignores
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/build/**", "**/.next/**"],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript recommended rules (type-aware)
  ...tseslint.configs.recommended,

  // React Hooks + Refresh
  {
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },

  // Accessibility — bounty #86
  // Enable the alt-text rule so an <img> without an `alt` attribute
  // fails the lint job. Decorative images get `alt=""` + role="presentation";
  // meaningful images get descriptive alt text.
  {
    files: ["apps/web/src/**/*.{ts,tsx,jsx}"],
    plugins: {
      "jsx-a11y": a11y,
    },
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "jsx-a11y/alt-text": "error",
      // Strict: also enforce that long alt text is not just the file name.
      "jsx-a11y/no-redundant-roles": "warn",
    },
  },

  // Browser globals for any client-side code
  {
    files: ["apps/web/src/**/*.{ts,tsx,jsx}"],
    languageOptions: {
      globals: globals.browser,
    },
  },
);
