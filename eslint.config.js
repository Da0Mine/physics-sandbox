import globals from 'globals';

// 只开最能抓住模块化错误的规则：未定义变量、未使用的导入/变量、对导入绑定的赋值。
export default [
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: globals.browser },
    rules: {
      'no-undef': 'error',
      'no-import-assign': 'error',
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
    },
  },
];
