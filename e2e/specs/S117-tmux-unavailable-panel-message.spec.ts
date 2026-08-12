import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp | undefined;

test.afterEach(async () => {
  if (launched) await closeApp(launched);
  launched = undefined;
});

/**
 * #244 周7。タスク一覧には「押せる行」と「押せない行」が混ざる。周5で押せる行の
 * 左端に線を出したので**どれが押せるかは見える**ようになったが、**押せない理由は
 * 画面のどこにも出ていなかった。**
 *
 * ⚠ **とくに困るのは異常時。** 「アプリを閉じても AI の作業を続ける」
 * （`useTmux`）を有効にしているのに tmux が見つからないと、**全行が一斉に
 * 押せなくなる。** 利用者にはアプリが壊れたようにしか見えない。
 *
 * ⭐ **やることはパネル単位のメッセージだけ。** 行ごとに「アプリ外」「操作できません」
 * のような語は出さない（design-review で5/5が「提案 F はパネル単位。行ごとに同じ文を
 * 出さない」と決めている。理由の全文は `tmuxUnavailableCopy.ts` 冒頭）。
 *
 * ⭐ **否定側が2つ要る。** 「常に出す」実装は否定側1（`fakeTmux: true` で tmux が
 * 使える）で、「有効無効を見ない」実装は否定側2（`useTmux: false`）で、それぞれ
 * 落とせる。片方だけだと通ってしまう。
 *
 * ⭐ **「tmux が使えない」を作るのに専用のハーネスオプションは要らない。**
 * `harness.ts` の起動時 `PATH` は `<binDir>:/usr/bin:/bin:/usr/sbin:/sbin` に
 * 絞られており、開発機の本物の tmux（多くは /opt/homebrew/bin 等）はここに無い。
 * `fakeTmux` を立てない限り PATH 上に tmux は1本も無いので、
 * `config: { useTmux: true }` だけで「設定は有効だが tmux が使えない」を
 * 自然に再現できる。
 */
test('S117 設定は有効なのに tmux が使えないときだけ、タスクパネルにメッセージが1つ出る', async () => {
  const message = () =>
    launched!.window.locator('.task-list .panel-empty--tmux-unavailable');

  // --- 肯定側: useTmux: true かつ tmux が使えない（fakeTmux を立てない） ------
  launched = await launchApp({ config: { useTmux: true } });
  await expect(launched.window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );
  await expect(message()).toHaveCount(1, { timeout: 20_000 });
  // 「アプリを閉じても AI の作業を続ける」= PERSIST_SETTING_LABEL の一部。
  await expect(message()).toContainText('アプリを閉じても AI の作業を続ける');
  // ⛔ tmux を主語にしない（closeTabCopy.ts / killSessionCopy.ts と同じ規約）。
  await expect(message()).not.toContainText(/tmux/i);
  await closeApp(launched);

  // --- 否定側1: useTmux: true かつ tmux が使える（fakeTmux: true） -------------
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
  await expect(launched.window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );
  // ポーリングが最低1周走るまで待ってから「出ていない」を確認する
  // （まだ1周も来ていないだけで「出ない」を確認したことにしない）。
  await expect(launched.window.locator('.task-item')).not.toHaveCount(0, { timeout: 20_000 });
  await expect(message()).toHaveCount(0);
  await closeApp(launched);

  // --- 否定側2: useTmux: false（設定で無効。DEFAULT_CONFIG の既定） -------------
  launched = await launchApp();
  await expect(launched.window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );
  await expect(launched.window.locator('.task-item')).not.toHaveCount(0, { timeout: 20_000 });
  await expect(message()).toHaveCount(0);
});
