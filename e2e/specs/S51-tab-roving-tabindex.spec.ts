import { test, expect, type Locator } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * Issue #20 PR 9: タブが `<div onClick>` のままで、role も tabindex も無く、
 * キーボード（Tab）では到達できなかった。
 *
 * このシナリオが検証したいのは4点。
 *
 * 1. `role="tablist"` / `role="tab"` が正しい親子関係で付いていること
 *    （tablist の直接の子は tab だけ。「+」ボタンは含めない）。
 * 2. **実際に Tab キーで到達でき、停止点が1つだけであること。**
 *    xterm.js はターミナル本体で Tab キーを自分で処理してしまうため、
 *    ターミナルにフォーカスがある間は Tab で外へ出られない
 *    （design-rules.md 参照）。ここではタブバー内の別のボタン（「+」新規
 *    タブボタン）を起点にし、そこからキーボードだけでタブへ辿り着ける
 *    ことを見る。閉じるボタン（.tab-bar__close）が tabIndex={-1} で
 *    停止点から外れていること（レビューで検出: 外していないとタブの枚数
 *    だけ余分な停止点ができ、roving tabindex の意味が無くなる）も合わせて見る。
 * 3. **矢印キーは manual activation。** 移動はフォーカスだけを動かし、
 *    選択（aria-selected・is-active）は変えない。**これが今回の本題**:
 *    以前は automatic activation（移動 = 選択）で実装したが、選択が
 *    変わるたびに TerminalPane.tsx がフォーカスを端末側へ奪い、xterm が
 *    Tab を自前で処理するせいでキーボードだけではタブリストへ戻れず、
 *    矢印キーでの移動が実質1ホップに制限されていた（レビューで指摘）。
 *    ここでは**矢印キーを2回以上連続で押せる**（選択を変えずに移動し
 *    続けられる）ことを見る。
 * 4. 実際に選択が切り替わるのは **Enter / Space**（ネイティブの
 *    `<button>` の標準動作）だけであること。加えて、閉じるボタンが Tab の
 *    停止点から外れた代わりに、role="tab" にフォーカスがある状態で
 *    Delete / Backspace を押すとそのタブが閉じること（キーボードだけで
 *    タブを閉じられることの証明。**選択中でなくフォーカスしているだけの
 *    タブ**を閉じても選択が乱れないことも合わせて見る）。
 */
test('S51 タブに Tab キーで到達でき、矢印キーで roving tabindex が機能する', async () => {
  const { window } = launched;

  const tabs = window.locator('.tab-bar__tabs > .tab-bar__tablist > .tab-bar__tab');
  await expect(tabs).toHaveCount(1);

  // 3枚目まで開く（矢印キーを2回連続で押しても隣どまりにならないことを
  // 見るには最低3枚要る）。
  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(2);
  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(3);

  const tablist = window.locator('.tab-bar__tablist');
  await expect(tablist).toHaveAttribute('role', 'tablist');

  const tabButtons = window.locator('.tab-bar__tab-button');
  const closeButtons = window.locator('.tab-bar__close');
  await expect(tabButtons).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    await expect(tabButtons.nth(i)).toHaveAttribute('role', 'tab');
    // 閉じるボタンはタブが何枚あっても Tab の停止点にならない。
    await expect(closeButtons.nth(i)).toHaveAttribute('tabindex', '-1');
  }

  // tablist の直接の子は role="tab" の親 div（.tab-bar__tab）だけであること
  // （「+」新規タブボタンは tablist の外）。Issue #20 I-1（PR 12）で「+」は
  // 分割ボタン化され、.tab-bar__new-wrapper の中に入ったため、
  // .tab-bar__tabs から見ると直接の子ではなく孫になった。
  await expect(window.locator('.tab-bar__tablist > .tab-bar__new')).toHaveCount(0);
  await expect(window.locator('.tab-bar__tabs > .tab-bar__new-wrapper > .tab-bar__new')).toHaveCount(
    1,
  );

  // 3枚目（最後に開いたほう）が選択中のはず。
  await expect(tabButtons.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(tabButtons.nth(1)).toHaveAttribute('aria-selected', 'false');
  await expect(tabButtons.nth(0)).toHaveAttribute('aria-selected', 'false');
  // roving tabindex の初期位置は選択中のタブに一致する。
  await expect(tabButtons.nth(2)).toHaveAttribute('tabindex', '0');
  await expect(tabButtons.nth(1)).toHaveAttribute('tabindex', '-1');
  await expect(tabButtons.nth(0)).toHaveAttribute('tabindex', '-1');

  const isFocused = (loc: Locator): Promise<boolean> =>
    loc.evaluate((el) => el === document.activeElement).catch(() => false);

  // --- 2. 実際に Tab / Shift+Tab で到達でき、停止点が1つだけであること -----
  // 「+」ボタンを起点にする（クリックはここでの起点合わせだけで、そこから先は
  // キーボードだけで進む。S47 と同じ考え方）。
  await window.locator('.tab-bar__new').focus();
  await window.keyboard.press('Shift+Tab');

  expect(await isFocused(tabButtons.nth(2)), 'Shift+Tab 1回で選択中のタブに到達する').toBe(
    true,
  );
  // 閉じるボタンには止まっていないこと（レビュー指摘の直接的な検証）。
  expect(await isFocused(closeButtons.nth(2)), '閉じるボタンは Tab の停止点にならない').toBe(
    false,
  );

  // もう一度 Tab を押すと、非選択のタブ・閉じるボタンの両方を飛ばして
  // 「+」ボタンへ戻る（roving tabindex でタブリスト全体の停止点が1つだけ）。
  await window.keyboard.press('Tab');
  expect(
    await isFocused(window.locator('.tab-bar__new')),
    'Tab で「+」ボタンへ戻る（非選択タブ・閉じるボタンは停止点にならない）',
  ).toBe(true);

  // --- 3. 矢印キーは manual activation: 移動しても選択は変わらない --------
  await window.locator('.tab-bar__new').focus();
  await window.keyboard.press('Shift+Tab');
  expect(await isFocused(tabButtons.nth(2))).toBe(true);

  await window.keyboard.press('ArrowLeft');
  expect(await isFocused(tabButtons.nth(1)), '1回目の ArrowLeft で2枚目へフォーカスが移る').toBe(
    true,
  );
  // 選択（aria-selected・is-active）はまだ動いていないこと。
  await expect(tabs.nth(2)).toHaveClass(/is-active/);
  await expect(tabButtons.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(tabButtons.nth(1)).toHaveAttribute('aria-selected', 'false');
  // roving tabindex（フォーカス位置）だけが動く。選択中のタブとは独立。
  await expect(tabButtons.nth(1)).toHaveAttribute('tabindex', '0');
  await expect(tabButtons.nth(2)).toHaveAttribute('tabindex', '-1');

  // **ここが本題**: 続けてもう一度 ArrowLeft を押せる
  // （automatic activation だと、1回目でフォーカスが端末に奪われて
  // ここに到達できなかった）。
  await window.keyboard.press('ArrowLeft');
  expect(await isFocused(tabButtons.nth(0)), '2回連続で ArrowLeft を押し、1枚目へ到達する').toBe(
    true,
  );
  // 選択は依然として3枚目のまま（2回移動しても選択は一度も変わっていない）。
  await expect(tabs.nth(2)).toHaveClass(/is-active/);
  await expect(tabButtons.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(tabButtons.nth(0)).toHaveAttribute('aria-selected', 'false');
  await expect(tabButtons.nth(0)).toHaveAttribute('tabindex', '0');
  await expect(tabButtons.nth(2)).toHaveAttribute('tabindex', '-1');

  // --- 4a. Delete で「選択中ではないが、フォーカス中の」タブを閉じる -------
  // 選択（3枚目）を乱さずに閉じられることまで見る。
  await window.keyboard.press('Delete');
  await expect(tabs).toHaveCount(2, { timeout: 15_000 });
  // 残った2枚（元の2枚目・3枚目）のうち、3枚目だったほうが引き続き選択中。
  await expect(tabs.nth(1)).toHaveClass(/is-active/);
  await expect(tabButtons.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tabButtons.nth(0)).toHaveAttribute('aria-selected', 'false');

  // --- 4b. Enter で初めて選択が切り替わる ----------------------------------
  // フォーカスが消えたタブ（閉じた1枚目）にあったので、roving tabindex は
  // 選択中のタブ（現在の1枚目 = 元の3枚目）へ戻っているはず。
  // **Shift+Tab を押す前に roving tabindex が落ち着くのを待つ。**
  // タブを閉じると focusedTabId を選択中のタブへ戻す effect が走るが、それが
  // 反映されるまでの一瞬、どのタブボタンにも tabIndex=0 が無い状態がありうる。
  // その瞬間に Shift+Tab を押すとタブリストごと飛び越してしまい、テストが
  // 不安定になる（実際に1回落ちた）。toHaveAttribute は自動で再試行するので、
  // ここで待てば以降の Shift+Tab は決定的になる。
  await expect(tabButtons.nth(1)).toHaveAttribute('tabindex', '0');
  await window.locator('.tab-bar__new').focus();
  await window.keyboard.press('Shift+Tab');
  expect(await isFocused(tabButtons.nth(1)), '閉じた後は選択中のタブへ戻る').toBe(true);

  await window.keyboard.press('ArrowLeft');
  expect(await isFocused(tabButtons.nth(0))).toBe(true);
  // まだ選択は変わっていない（フォーカスが動いただけ）。
  await expect(tabs.nth(1)).toHaveClass(/is-active/);
  await expect(tabButtons.nth(0)).toHaveAttribute('aria-selected', 'false');

  await window.keyboard.press('Enter');
  await expect(tabs.nth(0)).toHaveClass(/is-active/);
  await expect(tabButtons.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(tabButtons.nth(1)).toHaveAttribute('aria-selected', 'false');
  // Enter で選択したタブのターミナルへ実際にフォーカスが移ること
  // （TerminalPane.tsx の既存の仕組み。クリックでの選択と同じ挙動）。
  const helperTextareas = window.locator('.xterm-helper-textarea');
  await expect(helperTextareas.nth(0)).toBeFocused({ timeout: 15_000 });

  // --- 4c. Space でも選択が切り替わる --------------------------------------
  await window.locator('.tab-bar__new').focus();
  await window.keyboard.press('Shift+Tab');
  expect(await isFocused(tabButtons.nth(0)), '直前に選択したタブへ到達する').toBe(true);

  await window.keyboard.press('ArrowRight');
  expect(await isFocused(tabButtons.nth(1))).toBe(true);
  await expect(tabButtons.nth(1)).toHaveAttribute('aria-selected', 'false');

  await window.keyboard.press(' ');
  await expect(tabs.nth(1)).toHaveClass(/is-active/);
  await expect(tabButtons.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(tabButtons.nth(0)).toHaveAttribute('aria-selected', 'false');

  // --- 4d. Backspace でもキーボードだけでタブを閉じられる -------------------
  await window.locator('.tab-bar__new').focus();
  await window.keyboard.press('Shift+Tab');
  expect(await isFocused(tabButtons.nth(1)), '直前に選択したタブへ到達する').toBe(true);
  await window.keyboard.press('Backspace');
  await expect(tabs).toHaveCount(1, { timeout: 15_000 });

  // --- 5. role="tab" と role="tabpanel" が実際に対になっていること ----------
  // ARIA 仕様は tab に aria-controls で対応する tabpanel を要求する。
  // 「id を組み立てる文字列が2箇所にある」形だと片方だけ書き換えても型が守って
  // くれないので、**実際にその id の要素が存在し、role が tabpanel であること**まで見る
  // （属性が付いていることだけを見ると、リンク切れを緑のまま見逃す）。
  const controlsId = await tabButtons.nth(0).getAttribute('aria-controls');
  expect(controlsId, 'role="tab" は aria-controls を持つ').toBeTruthy();

  const panel = window.locator(`#${controlsId}`);
  await expect(panel).toHaveCount(1);
  await expect(panel).toHaveAttribute('role', 'tabpanel');

  // 逆向きも見る。tabpanel の aria-labelledby が、その tab の id を指していること。
  const labelledBy = await panel.getAttribute('aria-labelledby');
  expect(labelledBy).toBe(await tabButtons.nth(0).getAttribute('id'));
});
