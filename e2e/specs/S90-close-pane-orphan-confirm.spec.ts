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
 * 回収できるかの条件は `src/main/pty/tmux.ts` 冒頭が唯一の正。
 *
 * ⭐ **Issue #155 で前提が反転した。** gemini にも安定した `agentSessionId` が入り
 * （S102）、分類が `ptyKind` から `agentSessionId` の有無へ変わったので、
 * **tmux + gemini の1ペインでは確認が出なくなった**。この spec はその新しい
 * 振る舞いと、**確認を消した分の受け皿（閉じた直後の告知）が実際に鳴ること**を見る。
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
test('S90 Cmd+W で回収できる gemini ペインは確認なしで閉じ、2枚同時なら確認が出る', async () => {
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
  // **先に見るのが要点。** あとに置くと、直前の確認をキャンセルした状態が
  // 残っているせいで通ったのか区別しにくい。
  // シェルは `maybeWrapWithTmux` が必ず素通しするので `wrappedInTmux` は false。
  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(2, { timeout: 15_000 });
  await window.keyboard.press('Meta+w');
  // タブが1枚に戻る = 確認を挟まずそのまま閉じた。
  await expect(tabs).toHaveCount(1, { timeout: 15_000 });
  await expect(dialog).toHaveCount(0);

  // --- 本題1: tmux でラップされた gemini タブは、確認なしで閉じる ---------------
  //
  // ⭐ **Issue #155 でここが反転した。** gemini にも安定した `agentSessionId` が
  // 入り、履歴から戻れるようになったので、止める理由が消えた。
  await window.keyboard.press('Meta+Shift+E');
  await expect(tabs).toHaveCount(2, { timeout: 15_000 });
  await expect(window.locator('.tab-bar__tab--gemini')).toHaveCount(1, { timeout: 15_000 });
  // ラップされたことを画面から確認する（`wrappedInTmux` が Renderer まで
  // 届いていなければ、以降の assert は別の理由で通ってしまう。S84 と同じ hook）。
  await window.keyboard.press('Meta+f');
  await expect(window.locator('.terminal-search__hint')).toBeVisible({ timeout: 15_000 });
  await window.keyboard.press('Escape');

  await window.keyboard.press('Meta+w');

  await expect(tabs).toHaveCount(1, { timeout: 15_000 });
  await expect(dialog).toHaveCount(0);

  // ⭐ **確認を消した分の受け皿が実際に鳴っていること**（design-review で4人が
  // 「削除ではなく降格にせよ」と指摘した本体）。ここを見ないと、
  // 「確認をやめただけで何も伝えない」実装でも green になる。
  //
  // ⛔ **行き先は `.app-status` ではなく通知バナー**（2026-08-07 に変更）。
  // `.app-status` は `clip: rect(0,0,0,0)` で**画面から隠されている**ので、
  // そこへ流していた間、「タブを閉じても AI は走り続けている」という
  // この操作でいちばん驚く事実が**支援技術利用者にしか届いていなかった**。
  // Issue #155 が心配した非対称が、ちょうど裏返しの形で実現していた
  // （design-review で5人中4人が独立に指摘）。
  //
  // `.notice-list` は error が無ければ `role="status"` なので、**視覚と読み上げの
  // 両方に1回ずつ**届く。判定の正は `closedTabChannel`（`test/unit/close-tab-copy.test.ts`）。
  const notices = window.locator('.notice-banner');
  await expect(notices).toContainText(['終了せず残っています']);
  await expect(notices).toContainText(['Gemini 1 件']);

  // ⛔ **同じ文言を2回告知したら2回とも届くこと**（Issue #155 の design-review で
  // a11y が「受け皿が成立する前提条件」と指摘）。バナーは1件ごとに別 key で
  // 積まれるので（`pushNotice`）、2回目は**新しい要素として増える**。
  // 同じ文言をまとめてしまう実装（dedupe）に変えると、ここが 1 のままで落ちる。
  const persistentNotices = window.locator('.notice-banner', { hasText: '終了せず残っています' });
  await expect(persistentNotices).toHaveCount(1);

  await window.keyboard.press('Meta+Shift+E');
  await expect(window.locator('.tab-bar__tab--gemini')).toHaveCount(1, { timeout: 15_000 });
  await window.keyboard.press('Meta+w');
  await expect(tabs).toHaveCount(1, { timeout: 15_000 });
  await expect(persistentNotices).toHaveCount(2, { timeout: 15_000 });

  // ⛔ **同じ文を live region にも流していないこと**（VoiceOver が2回読む）。
  // 「両方に流さない」は `closedTabChannel` が守っている唯一の規約なので、
  // 破ったら気づけるようにここで見る。
  await expect(window.locator('.app-status')).not.toContainText('終了せず残っています');

  // --- 本題2: 2枚を一度に閉じるときは、いまも確認が出る -------------------------
  //
  // **確認の機構ごと消す直し方**（`needsCloseConfirmation` が常に false）でも
  // 上までは green になるので、残っている条件を必ず1つ踏む。
  await window.keyboard.press('Meta+Shift+E');
  await expect(tabs).toHaveCount(2, { timeout: 15_000 });
  await expect(window.locator('.tab-bar__tab--gemini')).toHaveCount(1, { timeout: 15_000 });
  await window.keyboard.press('Meta+d');

  // ⛔ **`.terminal-pane` の総数で分割を確かめない。** この時点でタブが2枚あるので、
  // 分割していなくても総数は2になる（実際にこれで空振りした）。
  // **アクティブなタブの x ボタンのラベル**は、そのタブのペイン数だけを見ている。
  await expect(tabs.nth(1).locator('.tab-bar__close')).toHaveAttribute(
    'aria-label',
    'タブを閉じる（2 ペイン）',
    { timeout: 15_000 },
  );

  await window.keyboard.press('Meta+Alt+w');

  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(tabs).toHaveCount(2);

  // キャンセルすればタブは残る（確認が形だけになっていないこと）。
  await window.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(tabs).toHaveCount(2);
});
