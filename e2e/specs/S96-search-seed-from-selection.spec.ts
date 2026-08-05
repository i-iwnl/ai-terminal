import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

/**
 * Issue #175（Issue #179 の周6）。
 *
 * macOS には「Use Selection for Find」（`Cmd+E`）があるが、このアプリは `Cmd+E` を
 * **直前のタブへ戻る**に割り当てている（`shortcuts.ts`）。**奪ったまま代替が無かった**。
 *
 * 選択 -> `Cmd+C` -> `Cmd+F` -> `Cmd+V` -> Enter の **5手**が、
 * 選択 -> `Cmd+F` -> Enter の **2手**になる。⛔ **新しいキーは足さない**（#175 の明示指定）。
 *
 * ## この spec が見る2つのこと
 *
 * 1. **選択があれば検索欄に入る**（本題）
 * 2. **選択が無ければ検索欄を触らない**（= 空にしない）
 *
 * 2 のほうが壊しやすい。端末の行は右端まで空白で埋まっているので、
 * **行末の余白を撫でただけで空白の塊が取れる**。それで前回の検索語を上書きすると、
 * `Cmd+F` が「前回の語をもう一度探す」用途に使えなくなる。
 * 語の判定そのものは `test/unit/search-seed.test.ts` が網羅する（空白だけ・複数行・日本語）。
 * ここでは**実際の xterm の選択が、実際の検索欄まで届くこと**だけを見る。
 */

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

test('S96 Cmd+F は xterm の選択を検索欄に引き継ぎ、選択が無いときは前回の語を消さない', async () => {
  const { window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  // 選択できる文字列を1行出す（S25 と同じ作り方）。
  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.type('echo S96-SEED-ME', { delay: 20 });
  await window.keyboard.press('Enter');
  await expect(screen).toContainText('S96-SEED-ME', { timeout: 15_000 });

  const searchInput = window.locator('.terminal-search input');

  // --- 1. 選択が無い状態で開くと、検索欄は空のまま ------------------------------
  //
  // ここを先に見ておかないと、あとで「入った」と言えなくなる
  // （最初から何か入っていたのかもしれない、を否定できない）。
  await window.keyboard.press('Meta+f');
  await expect(searchInput).toBeVisible();
  await expect(searchInput, '選択が無いのに何か入っている').toHaveValue('');
  await window.keyboard.press('Escape');
  await expect(searchInput).toHaveCount(0);

  // --- 2. 出力行をドラッグで選択して開くと、その語が入る（本題）------------------
  const row = window
    .locator('.terminal-pane__container .xterm-rows > div')
    .filter({ hasText: 'S96-SEED-ME' })
    .last();
  const box = await row.boundingBox();
  expect(box, '選択対象の行の矩形を取得できない').not.toBeNull();
  if (!box) return;

  const y = box.y + box.height / 2;
  await window.mouse.move(box.x + 2, y);
  await window.mouse.down();
  await window.mouse.move(box.x + box.width - 2, y, { steps: 15 });
  await window.mouse.up();

  await window.keyboard.press('Meta+f');
  await expect(searchInput).toBeVisible();
  await expect(
    searchInput,
    '選択した語が検索欄に入っていない（Cmd+E を奪ったままの代替が働いていない）',
  ).toHaveValue(/S96-SEED-ME/);

  // **行末の余白は落ちていること。** 端末の行は右端まで空白で埋まっているので、
  // ここを落とさないと検索語が空白付きになって一致しなくなる。
  const seeded = await searchInput.inputValue();
  expect(seeded, '検索語の前後に空白が残っている').toBe(seeded.trim());

  // 引き継いだ語でそのまま検索できる（= 2手目の Enter が働く）。
  // 検索の成否は S20 が見るので、ここでは**押しても壊れないこと**までにとどめる。
  await window.keyboard.press('Enter');
  await expect(searchInput).toHaveValue(/S96-SEED-ME/);

  // --- 3. 選択を解いて開き直すと、手で打った語が残っている ----------------------
  //
  // ⛔ 「選択が無い = 検索欄を空にする」ではない。
  //
  // ⛔ **ここで見張る語は、選択から来る語と別のものでなければならない。**
  // 初版は「S96-SEED-ME が残っていること」を見ていたが、それだと
  // **選択が解けていなかった場合も同じ値になる**ので、何も区別していない
  // （`spec-writing-traps.md` の「測る対象そのものが違う」と同じ形）。
  // 選択からは絶対に出てこない語を手で入れてから測る。
  await searchInput.fill('S96-TYPED-BY-HAND');
  await window.keyboard.press('Escape');
  await expect(searchInput).toHaveCount(0);

  // 端末をクリックすると xterm が選択を解く。
  await window.mouse.click(box.x + 2, y);

  await window.keyboard.press('Meta+f');
  await expect(searchInput).toBeVisible();
  await expect(
    searchInput,
    '選択が無いのに検索欄が書き換わった。空にした（消した）か、' +
      '選択が解けていないまま引き継いだ（= この検査が意味を持つ条件を踏んでいない）',
  ).toHaveValue('S96-TYPED-BY-HAND');
});
