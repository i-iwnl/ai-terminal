import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * 単体テストの設定。
 *
 * 対象は「外部に触れない純粋関数」だけ。PTY の起動・xterm の描画・IPC の配線は
 * E2E（playwright.config.ts）が担保する。ここで Electron を立ち上げない。
 *
 * Main プロセスのモジュールは `electron` / `node-pty` をトップレベルで import して
 * いるため、素の Node では解決できない。テスト用のスタブに差し替えて import だけを
 * 通す（test/stubs/ を参照）。
 *
 * 実行は `make unit`。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      electron: resolve(__dirname, 'test/stubs/electron.ts'),
      'node-pty': resolve(__dirname, 'test/stubs/node-pty.ts'),
    },
  },
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    // 既定の reporter は実行のたびに画面を書き換える。CI でもローカルでも
    // 同じログが残るよう、追記型の出力にする。
    reporters: ['default'],
  },
});
