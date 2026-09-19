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
    files: ["src/**/*.ts", "design-preview/**/*.ts"],
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
    // A handoff bearer is a credential: an invitation link works for seven days
    // and a prepared destination for one, and both used to live in
    // `localStorage`, where any script on the origin can read them. They are
    // held in HttpOnly cookies now, so reaching for web storage in these files
    // again is a regression, not a preference. The rule is scoped to the files
    // that hold a bearer rather than to `src/**`, because the theme and the
    // selected workspace are non-secret preferences and legitimately use it.
    files: [
      "src/app/core/services/pending-*.ts",
      "src/app/core/services/handoff-*.ts",
      "src/app/auth/invitation-accept.component.ts",
    ],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "localStorage",
          message: "Los bearers de handoff viven en una cookie HttpOnly del servidor (PendingHandoffService); no los guardes en el navegador.",
        },
        {
          name: "sessionStorage",
          message: "Los bearers de handoff viven en una cookie HttpOnly del servidor (PendingHandoffService); no los guardes en el navegador.",
        },
      ],
    },
  },
  {
    // The specs of those files assert the opposite — that nothing was written
    // to web storage — so they are the one place allowed to name the globals
    // they check.
    files: ["src/**/*.spec.ts"],
    rules: { "no-restricted-globals": "off" },
  },
  {
    files: ["src/**/*.html", "design-preview/**/*.html"],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
  },
  {
    files: ["e2e/**/*.ts", "playwright.config.ts", "playwright.release.config.ts"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["e2e/**/*.mjs"],
    extends: [eslint.configs.recommended],
    languageOptions: { globals: globals.node, sourceType: "module" },
  },
);
