module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  ignorePatterns: [
    'node_modules/',
    '.next/',
    'dist/',
    'out/',
    'coverage/',
    'broadcast/',
    'cache/',
    'contracts/',
    'circuits/',
    '.local/',
  ],
  rules: {
    'no-console': 'off',
  },
};
