// The rules SonarCloud applies to this project, as local warnings: `npm run lint` shows them while
// coding instead of a month later. Only warnings: they never stop a build, and leaving one is a choice.
import { fileURLToPath } from 'node:url';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';

const root = fileURLToPath(new URL('../..', import.meta.url));

/** The SonarCloud rules that have an ESLint twin (unicorn's are Sonar's S7xxx). */
const RULES = [
  'sonarjs/cognitive-complexity', 'sonarjs/no-nested-functions', 'sonarjs/no-nested-template-literals', 'sonarjs/no-nested-conditional',
  'sonarjs/no-nested-assignment', 'sonarjs/no-inverted-boolean-check', 'sonarjs/no-selector-parameter', 'sonarjs/no-identical-functions',
  'sonarjs/regex-complexity', 'sonarjs/concise-regex', 'sonarjs/redundant-type-aliases', 'sonarjs/use-type-alias', 'sonarjs/misplaced-loop-counter',
  'sonarjs/no-misleading-array-reverse', 'sonarjs/no-unenclosed-multiline-block', 'sonarjs/arguments-order', 'sonarjs/void-use',
  'unicorn/new-for-builtins', 'unicorn/prefer-at', 'unicorn/prefer-array-find', 'unicorn/prefer-array-some', 'unicorn/prefer-array-flat-map',
  'unicorn/prefer-set-has', 'unicorn/prefer-math-min-max', 'unicorn/prefer-modern-math-apis', 'unicorn/prefer-native-coercion-functions',
  'unicorn/no-useless-spread', 'unicorn/no-array-push-push', 'unicorn/prefer-dom-node-dataset', 'unicorn/prefer-top-level-await',
  'unicorn/prefer-number-properties', 'unicorn/prefer-code-point', 'unicorn/prefer-math-trunc', 'unicorn/prefer-string-replace-all',
  '@typescript-eslint/prefer-optional-chain', '@typescript-eslint/prefer-for-of', '@typescript-eslint/prefer-readonly',
  '@typescript-eslint/no-base-to-string', '@typescript-eslint/prefer-return-this-type',
  'no-await-in-loop', 'no-sequences', 'no-duplicate-imports',
];

export default [
  { ignores: ['**/node_modules/**', 'dist/**', 'dist-electron/**', 'release/**', 'src/dsp/wasm/pkg/**', 'tests/wasm-pkg/**', 'tests/reference/**', 'tools/**'] },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { projectService: true, tsconfigRootDir: root },
    },
    plugins: { sonarjs, unicorn, '@typescript-eslint': tseslint.plugin },
    rules: {
      ...Object.fromEntries(RULES.map(r => [r, 'warn'])),
      'sonarjs/cognitive-complexity': ['warn', 15],
    },
  },
];
