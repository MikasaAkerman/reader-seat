import js from '@eslint/js'
import eslintConfigPrettier from 'eslint-config-prettier'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'src-tauri/target/**',
      'src-tauri/gen/**',
      'node_modules/**',
      'fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'no-undef': 'off',
      'vue/multi-word-component-names': 'off',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tauri-apps/*'],
              message:
                '业务代码不得直接 import @tauri-apps/*，请经 src/platform 访问（仅 src/platform/tauri.ts 例外）。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vue',
              message: 'src/core 必须是纯 TypeScript，不得依赖 Vue。',
            },
            {
              name: 'dexie',
              message: 'src/core 必须是纯 TypeScript，不得依赖 Dexie。',
            },
            {
              name: 'pinia',
              message: 'src/core 必须是纯 TypeScript，不得依赖 Pinia。',
            },
            {
              name: 'vue-router',
              message: 'src/core 必须是纯 TypeScript，不得依赖 Vue Router。',
            },
          ],
          patterns: [
            {
              group: ['@tauri-apps/*', 'vue', 'dexie', 'pinia', 'vue-router'],
              message: 'src/core 必须是纯 TypeScript，不得依赖 Vue / Dexie / Tauri。',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/platform/tauri.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
  eslintConfigPrettier,
)
