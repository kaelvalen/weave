import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'src-tauri/target', 'src-tauri/gen'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs['recommended-latest'],
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2020,
        __TAURI_PLUGIN_OS__: 'readonly',
        __TAURI_PLATFORM__: 'readonly',
        __TAURI_PLATFORM_CLASS__: 'readonly',
      },
    },
    rules: {
      'import/no-unresolved': 'off',
      'import/extensions': 'off',
      'import/prefer-default-export': 'off',
      'import/no-extraneous-dependencies': 'off',
    },
  }
);
