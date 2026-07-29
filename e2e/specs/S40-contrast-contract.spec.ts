import { test, expect } from '@playwright/test';
import { launchApp, closeApp, openSettingsWindow, type LaunchedApp } from '../fixtures/harness';
import { measureContrast, type ContrastTarget } from '../fixtures/contrast';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * 画面に実際に描かれている色のコントラスト比を測り、**数値そのものを固定する**。
 *
 * なぜ要るか。Issue #20 の Phase 1 は配色の値を変える作業だが、
 * **その良し悪しを判定する関門がこれまで存在しなかった**:
 *
 * - `make e2e` の他 39 本は、`--text-tertiary` を #000000 にしても全部 green になる
 *   （色をアサートしているのは S12 の状態ドット・S21 の theme・S31 のフォントサイズだけで、
 *   いずれも据え置く値か spec 独自の値を使っている）
 * - `docs/images/` は存在しか検査されない（`scripts/lint-e2e.mjs` の check9）。
 *   中身が古くなっても機械では検出できない
 * - **手で書いたコントラストの表は、このリポジトリで2周続けて誤った**。
 *   Issue #20 の A-3 と、その A-3 を引き写した PR 5 の初版。どちらも
 *   「現状」の欄に別の面の値が紛れていた
 *
 * そこで、表を人間が書き写す運用をやめてここに移す。
 *
 * **このテストは characterization テストである。** 期待値は「あるべき値」ではなく
 * **「いまそうなっている値」**で、多くは WCAG を満たしていない。満たしていないことを
 * 承知で固定する。値を変える PR では、このファイルの diff に `3.93 -> 5.68` のような
 * 変化が現れる。**12 枚の PNG を目で見るより、この数行のほうがレビューできる。**
 *
 * 配色の是正が全部終わったら、期待値の固定をやめて閾値（テキスト 4.5 / 非テキスト 3.0）の
 * assert に切り替える。`WCAG` の欄はそのための記録で、いまは判定に使っていない。
 */

/** テキスト = WCAG 1.4.3 で 4.5:1、非テキスト = 1.4.11 で 3:1 */
const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3.0;

test('S40 画面のコントラスト比が、記録した値から動いていない', async () => {
  const { window } = launched;

  // --- 本体ウィンドウ -----------------------------------------------------

  // タスク一覧を出す（偽 claude が busy / idle の2件を返す）
  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();
  await expect(window.locator('.task-list .task-item')).toHaveCount(2, { timeout: 15_000 });

  // タブを1枚足す。**起動直後は1枚しか無く、それは選択中なので
  // 「非選択タブの文字」が測れない**（測れない項目は下のキー検査で落ちる）
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.tab-bar__tab')).toHaveCount(2, { timeout: 15_000 });

  // 検索バーを開く（浮いた面と枠を測るため）
  await window.keyboard.press('Meta+f');
  await expect(window.locator('.terminal-search input')).toBeVisible();

  const mainTargets: ContrastTarget[] = [
    {
      name: 'メタ情報の文字（サイドバー上）',
      kind: 'text',
      selector: '.task-item__meta',
      property: 'color',
    },
    {
      name: '状態ラベルの文字（あなたの番 / 作業中）',
      kind: 'text',
      selector: '.task-item__state',
      property: 'color',
    },
    {
      name: 'CLI の生の値の文字（busy / idle）',
      kind: 'text',
      selector: '.task-item__raw-status',
      property: 'color',
    },
    {
      name: '一覧の主タイトルの文字',
      kind: 'text',
      selector: '.task-item__name',
      property: 'color',
    },
    {
      name: '非選択タブの文字',
      kind: 'text',
      selector: '.tab-bar__tab:not(.is-active) .tab-bar__title',
      property: 'color',
    },
    {
      name: '選択中タブの塗り（対タブバー）',
      kind: 'non-text',
      selector: '.tab-bar__tab.is-active',
      property: 'background-color',
      against: '.tab-bar',
    },
    {
      name: '検索欄の枠（唯一の境界）',
      kind: 'non-text',
      selector: '.terminal-search input',
      property: 'border-top-color',
    },
    {
      // 一覧の先頭は busy = 作業中（緑）。ホバーしたときの面と比べる
      // （行はホバーで --surface-2 に変わるので、最悪ケースはそちら）
      name: '作業中のドット（対ホバー面）',
      kind: 'non-text',
      selector: '.task-item__status-dot',
      property: 'background-color',
      againstColor: '--surface-2',
    },
  ];

  const main = await measureContrast(window, mainTargets);

  // --- 設定ウィンドウ -----------------------------------------------------
  // **最も明るい面の上が一番厳しい。** 暗い面だけで測ると見落とす。

  const dialog = await openSettingsWindow(launched, () =>
    window.locator('button[aria-label="設定を開く"]').click(),
  );
  await expect(dialog.locator('.settings__note').first()).toBeVisible();

  const settingsTargets: ContrastTarget[] = [
    {
      name: '設定の入力欄の枠（唯一の境界）',
      kind: 'non-text',
      selector: '.settings__text',
      property: 'border-top-color',
    },
    {
      name: '設定の注記の文字',
      kind: 'text',
      selector: '.settings__note',
      property: 'color',
    },
    {
      name: '設定の見出しの文字',
      kind: 'text',
      selector: '.settings__heading',
      property: 'color',
    },
    {
      name: '設定の値の文字',
      kind: 'text',
      selector: '.settings__row',
      property: 'color',
    },
  ];

  const settings = await measureContrast(dialog, settingsTargets);

  await dialog.keyboard.press('Escape').catch(() => undefined);

  // --- 記録した値との突き合わせ -------------------------------------------
  //
  // 期待値は「いまそうなっている値」。WCAG 欄は現時点の判定で、assert には使っていない。
  // **値を変える PR では、ここの数字を更新するのが作業の一部になる。**

  const expected: Record<string, { ratio: number; wcag: 'pass' | 'fail' }> = {
    // 本体ウィンドウ
    // サイドバーが #191919 -> #141414 に沈んだ分、上に乗る文字が軒並み改善している
    'メタ情報の文字（サイドバー上）': { ratio: 4.11, wcag: 'fail' }, // 3.93 から。まだ 4.5 に届かない（PR 5-3）
    '状態ラベルの文字（あなたの番 / 作業中）': { ratio: 9.6, wcag: 'pass' },
    'CLI の生の値の文字（busy / idle）': { ratio: 5.7, wcag: 'pass' },
    '一覧の主タイトルの文字': { ratio: 13.56, wcag: 'pass' },
    // タブバーが #1a1a1a -> --surface-1 #1e1e1e に畳まれた分わずかに下がる
    '非選択タブの文字': { ratio: 5.85, wcag: 'pass' },
    // **Issue #20 の核心。選択状態が塗りだけで表現され、その塗りが見えない。**
    // PR 5-2 で 1.15 -> 1.23 に改善したが、3:1 には遠い。**下線を足すのが本当の解**（次周）
    '選択中タブの塗り（対タブバー）': { ratio: 1.23, wcag: 'fail' },
    '検索欄の枠（唯一の境界）': { ratio: 1.51, wcag: 'fail' }, // 枠の色は PR 5-4 で直す
    '作業中のドット（対ホバー面）': { ratio: 5.72, wcag: 'pass' },
    // 設定ウィンドウ（最も明るい面）
    //
    // **PR 5-2 で面が #232323 -> #282828 に明るくなった分、ここの4項目は一時的に下がる。**
    // 上に乗る文字と枠の色は PR 5-3 / PR 5-4 で直す。
    // 下がったのは元から未達だった2項目と、余裕のある2項目だけで、
    // **閾値を跨いで pass から fail に落ちた項目は無い**（下のループが機械で見張っている）。
    '設定の入力欄の枠（唯一の境界）': { ratio: 1.3, wcag: 'fail' }, // 1.38 から
    '設定の注記の文字': { ratio: 3.29, wcag: 'fail' }, // 3.51 から
    '設定の見出しの文字': { ratio: 5.17, wcag: 'pass' }, // 5.52 から
    '設定の値の文字': { ratio: 9.18, wcag: 'pass' }, // 9.79 から
  };

  const measured = { ...main, ...settings };

  // 期待値を較正するときに読む。落ちたときに「いくつだったか」が
  // レポートに残るので、記録の更新が推測にならない。
  console.log(
    '[S40] 実測:\n' +
      Object.entries(measured)
        .map(([k, v]) => `  ${k}: ${v.toFixed(2)}`)
        .join('\n'),
  );

  // 測れなかった項目を「合格」にしない。セレクタが変わって要素が見つからなくても
  // 静かに素通りする、という壊れ方を防ぐ。
  expect(Object.keys(measured).sort()).toEqual(Object.keys(expected).sort());

  for (const [name, { ratio }] of Object.entries(expected)) {
    // 小数第2位まで一致を要求する（丸め差だけを吸収する）
    expect(measured[name], `${name} のコントラスト比が記録から動いている`).toBeCloseTo(ratio, 1);
  }

  // 現時点で満たしているものが、こっそり悪化して閾値を割らないこと。
  // 満たしていないものは上の固定値で見張っているので、ここでは対象にしない。
  for (const [name, { ratio, wcag }] of Object.entries(expected)) {
    if (wcag !== 'pass') continue;
    const min =
      name.includes('塗り') || name.includes('枠') || name.includes('ドット')
        ? NON_TEXT_MIN
        : TEXT_MIN;
    expect(measured[name], `${name} が WCAG の閾値を割った`).toBeGreaterThanOrEqual(min);
    expect(ratio).toBeGreaterThanOrEqual(min);
  }
});
