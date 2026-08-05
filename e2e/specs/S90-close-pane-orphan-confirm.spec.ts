import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  // **偽 tmux + `useTmux: true`。** これが無いと `wrappedInTmux` が立たず、
  // 「閉じると回収できなくなる」状態そのものを作れない（S84 と同じ構成）。
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * Issue #158。**`Cmd+W`（ペインを閉じる）が、確認の判定を通ること。**
 *
 * `Cmd+W` はペインが1枚しか無いタブでは結果としてタブごと閉じるが、
 * **その経路は「タブを閉じる唯一の入口」とされていた `requestCloseTab` を
 * 通っていなかった**（`App.tsx` の `case 'close-pane'` が `closeActivePane` を
 * 直接呼んでいた）。そのため tmux でラップされた gemini のペインを `Cmd+W` で
 * 閉じると、**確認も通知も一切出ないまま、アプリからは二度と回収できない
 * tmux セッションとプロセスが残る**。
 *
 * gemini が回収できない理由は `src/main/pty/tmux.ts` が唯一の正。
 * tmux セッション名は `buildTmuxSessionName(plan.agentSessionId ?? ptyId)` で
 * 決まり、安定した `agentSessionId` を持つのは claude だけ。gemini は
 * 使い捨ての `ptyId` に頼るので、閉じた時点で名前を二度と再現できない。
 *
 * ⚠ **「gemini に ID を採番できないから」ではない**（Issue #155 / 2026-08-06 実測）。
 * `gemini --session-id <UUID>` は存在する。それでも採番しないのは、閉じたあとに
 * 選び直す側（`gemini --list-sessions`）が走行中セッションを一覧に出さず、しかも
 * 実行するとその JSONL を削除するため。**この spec の前提（回収できない）は覆っていない。**
 *
 * **`Cmd+W` は `Cmd+Option+W` より押しやすく、実運用ではこちらが主要な経路になる。**
 *
 * 判定の正は `closeTabCopy.ts` の `needsCloseConfirmation`（`test/unit/` が
 * 「1 leaf・tmux+gemini / tmux+claude / tmux 無し」の3ケースを固定している）。
 * ここでは**実際に `Cmd+W` を押したときにその判定を通ること**だけを見る。
 *
 * **手数が増えていないことも同じ spec で見る。** 確認が要らない側（tmux でラップ
 * されないシェル）で `Cmd+W` を押してもダイアログが出ないこと。これが無いと
 * 「全部確認するようにした」という直し方でも green になってしまう。
 */
test('S90 Cmd+W で回収不能な gemini ペインを閉じようとすると確認が出て、シェルでは出ない', async () => {
  const { window } = launched;

  const tabs = window.locator('.tab-bar__tab');
  const dialog = window.locator('[role="alertdialog"]');

  await expect(tabs).toHaveCount(1, { timeout: 15_000 });
  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  // --- 否定側を先に見る: シェルタブの Cmd+W は確認を出さない -------------------
  //
  // **先に見るのが要点。** あとに置くと、gemini の確認をキャンセルした状態が
  // 残っているせいで通ったのか区別しにくい。
  // シェルは `maybeWrapWithTmux` が必ず素通しするので `wrappedInTmux` は false。
  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(2, { timeout: 15_000 });
  await window.keyboard.press('Meta+w');
  // タブが1枚に戻る = 確認を挟まずそのまま閉じた。
  await expect(tabs).toHaveCount(1, { timeout: 15_000 });
  await expect(dialog).toHaveCount(0);

  // --- 本題: tmux でラップされた gemini タブを Cmd+W で閉じようとする -----------
  await window.keyboard.press('Meta+Shift+E');
  await expect(tabs).toHaveCount(2, { timeout: 15_000 });
  await expect(window.locator('.tab-bar__tab--gemini')).toHaveCount(1, { timeout: 15_000 });
  // ラップされたことを画面から確認する（`wrappedInTmux` が Renderer まで
  // 届いていなければ、以降の assert は別の理由で通ってしまう。S84 と同じ hook）。
  await window.keyboard.press('Meta+f');
  await expect(window.locator('.terminal-search__hint')).toBeVisible({ timeout: 15_000 });
  await window.keyboard.press('Escape');

  await window.keyboard.press('Meta+w');

  // **確認が出ること。** タブはまだ閉じていない。
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(tabs).toHaveCount(2);
  // 文言は closeTabCopy が決める（`test/unit/close-tab-copy.test.ts` が正）。
  // ここでは「回収できない」ことが本文に出ていることだけを見る。
  await expect(dialog).toContainText('アプリから開き直す手段がありません');

  // キャンセルすればタブは残る（確認が形だけになっていないこと）。
  await window.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(tabs).toHaveCount(2);
});
