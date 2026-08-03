import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * Issue #121 A-3 / 周2: E2E から tmux 経路を踏めるようにする。
 *
 * `.claude/skills/e2e/reference/limitations.md` は「E2E では tmux 経路を
 * 踏めない」としていたが、これは誤りだった。harness.ts は PATH の先頭に
 * 一時 HOME 配下の bin を置いており、そこへ偽 tmux（e2e/fixtures/bin/tmux）を
 * 置くだけで `config.useTmux: true` の経路（`isTmuxAvailable()` は
 * `which tmux` を見るだけ）を決定的に踏める。
 *
 * **この spec が担保すること（本題）:** `useTmux: true` + 偽 tmux 有りで
 * claude タブを起動すると、`maybeWrapWithTmux` が実際にラップし
 * （`SpawnPtyResult.wrappedInTmux: true`）、それが `useTabs.ts` ->
 * `PaneLeaf.wrappedInTmux` -> `PaneTreeView` -> `TerminalPane` まで届いて、
 * 検索バーの tmux 注記（`.terminal-search__hint`、Issue #121 A-3 で実装した
 * もの）として画面に表示されるところまで。あわせて、tmux でラップされて
 * いないシェルタブでは同じ注記が出ないこと（否定側）も見る。
 *
 * **偽 tmux シムで担保できないこと（本物の tmux との差）:**
 * - 代替画面バッファへの切り替え（本物は `ESC [ ? 1049 h` を出す）は
 *   再現していない。xterm 側のスクロールバックが実際に「いま見えている
 *   画面だけ」に制限されるかどうかはこの spec の対象外。
 * - セッションの永続化（アプリを再起動しても `tmux new-session -A` で
 *   同じセッションに再アタッチできること）は再現していない。偽 tmux は
 *   受け取ったコマンドを `exec` するだけで、tmux 本来のサーバプロセスを
 *   持たない。
 * - タブを閉じる・アプリを終了しても claude プロセスが生き残る、という
 *   tmux 永続化の主目的そのものも再現していない（`exec` した子プロセスは
 *   親と運命を共にする）。
 * - `-A`（同名セッションがあれば attach、無ければ新規作成）の分岐は
 *   検証していない。偽 tmux は常に「新規にコマンドを exec する」動きしか
 *   しないため、Cmd+W で閉じたタブへ resume で戻ったときに同じ tmux
 *   セッションへ当たるかどうかはここでは見ない。
 *
 * 担保できるのは「配線が Renderer まで届いていること」の1点で、
 * 上記のテスト容易性のために追加した偽 tmux は、これらの盲点をそのまま
 * 持ち越す。
 */
test('S84 偽 tmux でラップした claude タブは検索バーに tmux 注記が出て、シェルタブには出ない', async () => {
  const { window, fixturesDir } = launched;

  // --- 前提: 起動直後のシェルタブは tmux でラップされない -----------------
  // maybeWrapWithTmux は req.kind === 'shell' を常に素通りする
  // （src/main/pty/manager.ts）ので、useTmux: true でも対象外のはず。
  const shellScreen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(shellScreen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.press('Meta+f');
  await expect(window.locator('.terminal-search')).toBeVisible();
  await expect(window.locator('.terminal-search__hint')).toHaveCount(0);

  const shellInput = window.locator('.terminal-search input');
  expect(
    await shellInput.getAttribute('aria-describedby'),
    'tmux でラップされていないペインの検索入力欄は aria-describedby を持たないはず',
  ).toBeNull();

  await window.locator('.terminal-search button[title="検索を閉じる"]').click();
  await expect(window.locator('.terminal-search')).toBeHidden();

  // --- claude を起動する: これは kind !== 'shell' なので、useTmux: true +
  //     偽 tmux 有りの下では実際に tmux でラップされるはず ---------------------
  await window.keyboard.press('Meta+Shift+C');
  await expect(window.locator('.tab-bar__title').filter({ hasText: 'demo-project' })).toBeVisible();

  // 偽 tmux は `-- ` 以降（偽 claude の起動コマンド）を exec するだけなので、
  // 偽 claude 自身の出力（S09 と同じ ARGS 行）がラップ越しにそのまま届くはず。
  const activeRows = window
    .locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-rows')
    .first();
  await expect(activeRows).toContainText('FAKE CLAUDE READY', { timeout: 20_000 });
  await expect(activeRows).toContainText(/ARGS:.*--session-id/);

  // --- 実際に tmux 経由で起動したことを、偽 tmux が書き出したセッション名から
  //     裏取りする（`wrappedInTmux: true` を騙って画面だけ辻褄を合わせる実装を
  //     見逃さないため）。buildTmuxSessionName は `aiterm-<agentSessionId>` の形。
  const tmuxSessionName = readFileSync(join(fixturesDir, 'tmux-session-name.txt'), 'utf8').trim();
  expect(tmuxSessionName).toMatch(
    /^aiterm-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );

  // --- 本題: tmux でラップされたこのペインでは検索バーに tmux 注記が出る -----
  await window.keyboard.press('Meta+f');
  const search = window.locator('.terminal-search');
  await expect(search).toBeVisible();

  const hint = window.locator('.terminal-search__hint');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('tmux');

  // 注記の id が、検索入力欄の aria-describedby から実際に参照されていること
  // （TerminalPane.tsx: `aria-describedby={wrappedInTmux ? \`${ptyId}-search-hint\` : undefined}`）。
  const hintId = await hint.getAttribute('id');
  expect(hintId, 'tmux 注記の id が取得できなかった').not.toBeNull();

  const claudeInput = window.locator('.terminal-search input');
  await expect(claudeInput).toHaveAttribute('aria-describedby', hintId ?? '');
});
