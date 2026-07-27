import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'out/**', 'dist/**', 'build/**'],
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
