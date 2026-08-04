import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  // **既定（`/bin/zsh`）ではなく `/bin/bash` で起動する。** これがこの spec の要点。
  // `buildShellPlan()`（src/main/pty/manager.ts）は `config.shell -> $SHELL -> /bin/zsh`
  // の順で解決するので、`config.shell` を渡せばハーネスを改造せずに `$SHELL` と
  // 違うシェルを踏める（ハーネスは `SHELL: '/bin/zsh'` をハードで固定している）。
  launched = await launchApp({ config: { shell: '/bin/bash' } });
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * Issue #137。**画面に出るシェルの名前が、実際に起動したシェルを反映していること。**
 *
 * それまで Renderer は `'zsh'` をリテラルで持っており、`$SHELL=/bin/fish` の人にも
 * `zsh` と表示していた。決定順の唯一の正は Main の `buildShellPlan()` で、
 * Renderer は `AppConfig.shell` を読んでも既定が `undefined` なので `$SHELL` を
 * 知りえない。そのため `SpawnPtyResult.shellName` -> `PaneLeaf.shellName` で運ぶ。
 *
 * **この spec が無いと、直したことを誰も守らない。** 既存の関門（`S57` / `S86` /
 * `test/unit/pane-header.test.ts` / 撮影）はすべて「`zsh` と出る」を見ているが、
 * ハーネスの `$SHELL` が `/bin/zsh` である以上、**リテラルに戻しても全部 green のまま**。
 * loop.md の「検査は正しいが、その条件を踏んでいない」に該当する。
 *
 * **プロンプトを待たない。** ハーネスは `ZDOTDIR` + `.zshrc` で `PROMPT='%1~ %# '` を
 * 書いているが、**bash は `.zshrc` を読まない**ので `demo-project %` は出ない。
 * 既存 spec の定番である「プロンプト待ち」を流用すると 20 秒でタイムアウトする。
 * ここでは DOM に出る文字列だけを待つ。
 *
 * **3つの出口を全部見る。** 語が1箇所だけ直って他が `zsh` のまま、という壊れ方を
 * 防ぐ（`paneHeader.ts` だけ直すと、同じ画面でタブが `zsh`・ヘッダが `bash` になる）。
 */
test('S88 画面に出るシェル名が、実際に起動したシェル（config.shell）を反映する', async () => {
  const { window } = launched;

  const tabs = window.locator('.tab-bar__tab');
  const panes = window.locator('.terminal-pane');
  const headers = window.locator('.pane-header');

  await expect(tabs).toHaveCount(1, { timeout: 15_000 });

  // --- 出口1: タブの見出し ---------------------------------------------------
  //
  // `useTabs.ts` の `spawnLeaf` が spawn 結果からシェルの既定タイトルを決める。
  // ここが `zsh` に戻ると赤くなる。
  await expect(window.locator('.tab-bar__title').first()).toHaveText('bash', { timeout: 20_000 });

  // --- 出口2: ペインヘッダ（分割中のみ出る）-----------------------------------
  //
  // 分割で作られるのは常にシェル（`splitActivePane`）なので、2枚とも `bash` になる。
  await window.keyboard.press('Meta+d');
  await expect(panes).toHaveCount(2, { timeout: 15_000 });
  await expect(headers).toHaveCount(2, { timeout: 15_000 });
  await expect(headers.nth(0)).toContainText('bash');
  await expect(headers.nth(1)).toContainText('bash');
  // **`zsh` がどこにも残っていないこと。** 片方だけ直す壊れ方に赤くなる。
  await expect(window.locator('.tab-bar')).not.toContainText('zsh');
  await expect(headers.nth(0)).not.toContainText('zsh');
  await expect(headers.nth(1)).not.toContainText('zsh');

  // --- 出口3: 読み上げ（aria-label）------------------------------------------
  //
  // 分割中の非アクティブなペインは WebGL 描画 + screenReaderMode false のため、
  // 支援技術から見て中身が空。この `aria-label` がそのペインについて届く唯一の情報。
  // **役割の語（シェル）も添わっていること**を同時に見る（Issue #137 の design-review）。
  const inactiveLabel = await window
    .locator('.terminal-pane:not(.is-active)')
    .first()
    .getAttribute('aria-label');
  expect(inactiveLabel, 'ペインのアクセシブルネームが取れていない').not.toBeNull();
  expect(inactiveLabel).toContain('bash');
  expect(inactiveLabel).toContain('シェル');
  expect(inactiveLabel).not.toContain('zsh');
});
