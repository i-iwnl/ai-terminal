import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'out/**',
      'dist/**',
      'build/**',
      // Playwright の生成物（.gitignore と揃えること）。
      // HTML レポートにはトレースビューアの bundle が含まれ、E2E がトレースを
      // 残した実行の後だけ生成される。除外しないと make e2e の後に make check が
      // 数千件のエラーで落ちる。
      'e2e/report/**',
      'test-results/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // `any` を使わない（CLAUDE.md の規約）
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
