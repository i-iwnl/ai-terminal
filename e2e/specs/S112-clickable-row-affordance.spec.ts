import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Locator } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';
import { livePanesFile } from '../fixtures/tmuxLivePanes';

let launched: LaunchedApp;

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * #244 周5。**押せる行に、静止状態で見える手がかりがある。**
 *
 * それまでタスク一覧の「押せる / 押せない」は、**ホバーの塗りとカーソル形状**でしか
 * 表れていなかった。どちらもポインタを載せて初めて出るので、
 * **一覧を眺めているだけの人には、どの行が操作できるのかが1つも見えない。**
 * （読み上げには `taskRowActionLabel()` の語が `aria-label` に入っているので、
 * 欠けていたのは晴眼のマウス利用者と静止状態に対してだけ。）
 *
 * ⭐ **塗りで表す道は計算上閉じている**（design-review の a11y ペルソナが実測）。
 * `--surface-0`(#141414) の上で 1.4.11 の 3:1 を満たす最小のグレーは `#626262` だが、
 * **その面の上では `--text-tertiary` が 2.01 に落ちて 1.4.3 を割る**。
 * つまりホバー塗りを 3:1 まで上げた瞬間に、行の他の全部が壊れる。
 * 残る道は**枠の有無・グリフ・語**だけで、いちばん安いのが枠の有無。
 *
 * ⛔ **`design-rules` 節5 の「左端 3px の色バー」の再提案ではない。**
 * あちらの却下理由は「**位置が同じで色だけ違う**」（色覚特性下で存在しないのと同じ）。
 * こちらが分けているのは**有無**なので、色を知覚できなくても差が残る。
 *
 * ⭐ **この spec の中核は 3 番目の検査（描画位置が動かないこと）。**
 * 枠を足しただけなら「押せる行の中身が 2px 右へずれる」ので、
 * **一覧が押せる行と押せない行でガタつく**。`padding-left` を同じだけ削って
 * 相殺しているので、幅コストも描画位置の変化も 0px になる。
 * この検査が無いと、相殺を忘れた実装でも緑になる。
 */
test('S112 押せる行だけに左端の線が出て、押せない行と中身の位置は1pxも動かない', async () => {
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
  const { window, fixturesDir } = launched;

  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  // 既定の agents.json は aaaaaaaa-… (busy) と bbbbbbbb-… (idle) の2件。
  // **片方だけ**を tmux に生かすことで、同じ一覧の中に
  // 押せる行（recoverable = `<button>`）と押せない行（`<div>`）を並べる。
  // ⛔ 行を手で組み立てないこと（理由は `e2e/fixtures/tmuxLivePanes.ts` の冒頭）。
  writeFileSync(
    join(fixturesDir, 'tmux-live-panes.txt'),
    livePanesFile([
      {
        sessionName: 'aiterm-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        startCommand: 'claude --session-id aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        cwd: launched.workDir,
      },
    ]),
  );

  const clickableRow = window.locator('.task-item', { hasText: 'demo-project-busy' });
  const plainRow = window.locator('.task-item', { hasText: 'other-project-idle' });

  // ポーリングが tmux を読み直すまで待つ。ここが揃うまで測ると値が入れ替わる。
  await expect(clickableRow.locator('button.task-item__row')).toHaveCount(1, { timeout: 20_000 });
  await expect(plainRow.locator('button.task-item__row')).toHaveCount(0);
  await expect(plainRow.locator('.task-item__row')).toHaveCount(1);

  const box = (row: Locator) => row.locator('.task-item__row');
  const styleOf = (row: Locator) =>
    box(row).evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        borderLeftWidth: s.borderLeftWidth,
        borderLeftStyle: s.borderLeftStyle,
        borderLeftColor: s.borderLeftColor,
        paddingLeft: s.paddingLeft,
      };
    });

  // --- 1. 押せる行には線がある（肯定側） --------------------------------------
  const clickableStyle = await styleOf(clickableRow);
  expect(clickableStyle.borderLeftWidth, '押せる行に左端の線が出ていない').toBe('2px');
  expect(clickableStyle.borderLeftStyle).toBe('solid');
  // --border-control: #7a7a7a。⛔ ここに別の値を焼き込まない（トークンが唯一の正）。
  expect(clickableStyle.borderLeftColor).toBe('rgb(122, 122, 122)');

  // --- 2. 押せない行には線が無い（否定側） ------------------------------------
  // これが無いと「全行に線を引く」実装でも 1 が緑になり、
  // **手がかりが「押せる」を1つも意味しなくなる**。
  const plainStyle = await styleOf(plainRow);
  expect(plainStyle.borderLeftWidth, '押せない行にまで左端の線が出ている').toBe('0px');

  // --- 3. ⭐ 中身の描画位置が1pxも動かない ------------------------------------
  // 線のぶんだけ padding-left を削っているので、
  // 「線の幅 + 内側の余白」は押せる行と押せない行で等しい。
  const inset = (s: { borderLeftWidth: string; paddingLeft: string }) =>
    parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft);
  expect(inset(clickableStyle), '線を足したぶん中身が右へずれている').toBeCloseTo(
    inset(plainStyle),
    1,
  );

  // 計算値だけでなく、実際に描かれた位置でも見る（`box-sizing` が変わっても落ちる）。
  const dotX = async (row: Locator) => {
    const rect = await row.locator('.task-item__status-dot').boundingBox();
    if (!rect) throw new Error('状態ドットが描画されていない');
    return rect.x;
  };
  expect(await dotX(clickableRow), '押せる行の中身だけが横にずれている').toBeCloseTo(
    await dotX(plainRow),
    1,
  );

  // --- 4. 行の外形は同じ幅のまま（幅コスト 0px） ------------------------------
  const rowWidth = async (row: Locator) => {
    const rect = await box(row).boundingBox();
    if (!rect) throw new Error('行が描画されていない');
    return rect.width;
  };
  expect(await rowWidth(clickableRow), '押せる行だけ幅が変わっている').toBeCloseTo(
    await rowWidth(plainRow),
    1,
  );
});
