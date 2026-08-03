import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

import baseConfig from '../playwright.config';

/**
 * パッケージ版スモークの設定（`make e2e-packaged` / `make install-app` の関門）。
 *
 * 通常の E2E（playwright.config.ts）は node_modules の electron で out/ を起動する。
 * こちらは `electron-builder --dir` が dist/ に生成した本物の .app バイナリを起動し、
 * asar・app.isPackaged: true・本番の preload 読み込みといったパッケージング層まで
 * 検証対象にする。差分の検出が目的なので、全シナリオではなくスモークだけを回す:
 *
 * - S01: 起動してウィンドウ・サイドバー・ターミナルが出る（asar / preload）
 * - S09: claude タブが PTY で起動する（asarUnpack した node-pty の spawn-helper）
 * - S12: タスク一覧が出る（execFile によるポーリング）
 * - S39: 最小 PATH からログインシェル解決で CLI が見つかる（shell-path / Issue #40）
 *
 * なお本物の launchd（Finder / Dock）起動・Gatekeeper・署名はここでも検証できない。
 * その層は診断ログ（~/.ai-terminal/shell-path.log）と手動確認で補う
 * （.claude/skills/e2e/reference/limitations.md）。
 */

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// electron-builder は arch ごとに出力先を分ける（Apple Silicon: mac-arm64 / Intel: mac）
const appBundle = ['dist/mac-arm64/ai-terminal.app', 'dist/mac/ai-terminal.app']
  .map((p) => join(REPO_ROOT, p))
  .find((p) => existsSync(p));

if (!appBundle) {
  throw new Error(
    'パッケージ済みアプリが dist/ に見つかりません。先に `make package-dir` を実行してください（`make e2e-packaged` なら一括で行われます）',
  );
}

// ハーネス（e2e/fixtures/harness.ts）はこの環境変数を見て executablePath を切り替える
process.env.AI_TERMINAL_E2E_PACKAGED_APP = join(appBundle, 'Contents', 'MacOS', 'ai-terminal');

// **ベース設定の `projects` は引き継がない。**
//
// Issue #120 周5（PR #125）が撮影レーンを取り込むためベース設定に `projects` を
// 足したが、**この設定はそれを spread しており、Playwright は `projects` がある場合
// トップレベルの `testDir` / `testMatch` を無視する**（各 project の指定が優先される）。
// その結果、ここで指定しているスモーク4本ではなく、ベース側の project の
// `testDir: './e2e/specs'` がこの設定ファイル基準（= `e2e/e2e/specs`）で解決され、
// **存在しないディレクトリを見て `No tests found` で落ちていた。**
//
// つまり `make e2e-packaged` と、それを関門にしている `make install-app` は
// PR #125 以降ずっと壊れていた（install-app を回すまで誰も踏まない経路だったため
// 気づかれなかった）。**ベース設定に project を足す変更は、それを spread している
// このレーンを黙って壊す。**
const { projects: _baseProjects, ...baseWithoutProjects } = baseConfig;

export default defineConfig({
  ...baseWithoutProjects,
  // ベース設定の testDir はルート基準の './e2e/specs'。この設定ファイルは e2e/ に
  // 置かれており、testDir は設定ファイルからの相対で解決されるため指定し直す
  testDir: './specs',
  testMatch: [
    'S01-launch.spec.ts',
    'S09-launch-claude.spec.ts',
    'S12-task-list.spec.ts',
    'S39-path-via-login-shell.spec.ts',
  ],
  // 通常レーンの HTML レポート（e2e/report）を上書きしない
  reporter: [['list']],
});
