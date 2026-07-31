import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * PR 19（Issue #20 H）の密度調整（`.tab-bar__tab` の `gap: 6px -> var(--sp-2)`、
 * `padding: 0 10px -> 0 var(--sp-3)`）が、タブの当たり判定に幾何変化を持ち込んだ。
 *
 * 選択用の `<button class="tab-bar__tab-button">` は、閉じるボタン
 * （`.tab-bar__close`。非アクティブ時は見た目も無く `pointer-events: none`）を
 * 依然として同じ flex の行の1アイテムとして扱っていたため、閉じるボタンの
 * 幅 + 前後の gap ぶんが「見えない・押せない・かつ選択もできない」死角として
 * 残っていた。密度調整前は padding が広く、その死角がタブの端に寄っていて
 * 中央のクリックとは重ならなかったため、この PR の変更まで気づかれなかった。
 *
 * `S44-target-size.spec.ts` は「小さいボタン自身が 24x24 以上あるか」を見ており、
 * **「タブという行全体の、押せるはずの領域が本当に押せるか」は別の観点**で
 * どの spec も見ていなかった（S47 は resume 経由の間接的な症状でしか
 * この壊れを検出できず、原因の特定に追跡が要った）。
 *
 * ここでは `document.elementFromPoint(中央)` で実際にヒットする要素が、
 * 選択用ボタン（`.tab-bar__tab-button`）かその子孫であることを直接確認する。
 * 座標は `boundingBox()` から計算し、決め打ちしない。
 */
test('S69 タブの中央をクリックすると、そのタブが選択される', async () => {
  const { window } = launched;

  // 1枚目のまま検証すると「起動直後から選択中」で意味が無いので、2枚目を足し、
  // 1枚目（非アクティブ・閉じるボタンが見えない状態）を対象にする。
  // Meta+t ではなく「+」ボタン経由で開く（キーボードショートカットは別 PR の
  // 担当ファイルに実装があり、この spec の関心事ではない）。
  await window.locator('.tab-bar__new').click();
  await window.locator('.tab-bar__new-menu-item', { hasText: '新しいシェル' }).click();
  const tabs = window.locator('.tab-bar__tab');
  await expect(tabs).toHaveCount(2, { timeout: 15_000 });

  // 直前のクリックでカーソルが tabs[0] の上に残っていると :hover が誤って
  // 効き、閉じるボタンが「見えている」状態のまま測ってしまう。タブ行から
  // 離れた場所へ動かしてから測る。
  await window.mouse.move(400, 400);

  const target = tabs.nth(0);
  await expect(target).not.toHaveClass(/is-active/);

  const box = await target.boundingBox();
  if (!box) throw new Error('タブの boundingBox が取得できなかった');
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  // 中央が実際にヒットする要素を確認する（クリックする前に。クリック後は
  // 選択状態が変わり、閉じるボタンの opacity/pointer-events も変わるため、
  // 「元の状態でどこに当たるか」を先に固定してから操作する）。
  const hitsSelectButton = await window.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el !== null && el.closest('.tab-bar__tab-button') !== null;
    },
    [centerX, centerY] as const,
  );
  expect(hitsSelectButton, 'タブ中央のクリックは選択用ボタンに当たるべき').toBe(true);

  // 実際にクリックして選択が切り替わることも確認する（当たり判定の確認だけでなく、
  // クリックの結果として意図した動作＝タブ選択が起きることまで見る）。
  await window.mouse.click(centerX, centerY);
  await expect(target).toHaveClass(/is-active/);
});
