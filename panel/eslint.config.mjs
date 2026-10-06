import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '.angular/**', 'test-results/**'] },
  { files: ['src/**/*.ts'], extends: [eslint.configs.recommended, ...tseslint.configs.recommended, ...angular.configs.tsRecommended], processor: angular.processInlineTemplates,
    rules: { '@angular-eslint/component-selector': ['error', { type: 'element', prefix: 'app', style: 'kebab-case' }] } },
  { files: ['src/**/*.html'], extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility] },
);
