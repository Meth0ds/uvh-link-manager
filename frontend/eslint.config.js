const eslint = require("@eslint/js");
const tseslint = require("typescript-eslint");
const angular = require("angular-eslint");
const globals = require("globals");

// Flat config keeps the linter independent from Angular CLI builders and makes
// the same command reproducible locally and in CI.
module.exports = tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", ".angular/**", "node_modules/**"],
  },
  {
    files: ["src/**/*.ts"],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // Control-character ranges are intentional at trust boundaries. The
      // validators reject them instead of trying to interpret them.
      "no-control-regex": "off",
      // OnPush is an architectural migration, not a safe lint autofix. New
      // components may adopt it deliberately without rewriting every view.
      "@angular-eslint/prefer-on-push-component-change-detection": "off",
      "@angular-eslint/directive-selector": [
        "error",
        { type: "attribute", prefix: "app", style: "camelCase" },
      ],
      "@angular-eslint/component-selector": [
        "error",
        { type: "element", prefix: "app", style: "kebab-case" },
      ],
    },
  },
  {
    files: ["src/**/*.html"],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
  },
  {
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["e2e/**/*.mjs"],
    extends: [eslint.configs.recommended],
    languageOptions: { globals: globals.node, sourceType: "module" },
  },
);
