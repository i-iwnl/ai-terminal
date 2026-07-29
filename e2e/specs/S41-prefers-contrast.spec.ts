import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';
import { measureContrast, type ContrastTarget } from '../fixtures/contrast';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * macOS の「コントラストを上げる」に追従していることを検証する。
 *
 * **テストの無い `@media` は死にコードと変わらない。** 見た目の確認は
 * システム設定を切り替えないと再現できず、次に `--border-subtle` を消す人は
 * 高コントラスト時だけ壊れることに気づけない。
 *
 * S40（既定の配色）と対になっている。あちらは「記録した値から動いていないこと」、
 * こちらは「高コントラストを要求したときに実際に上がること」を見る。
 */
test('S41 コントラストを上げる設定に追従して、弱い色が強くなる', async () => {
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();
  await expect(window.locator('.task-list .task-item')).toHaveCount(2, { timeout: 15_000 });

  // 選択中タブの塗りを測るため、非選択のタブも作っておく
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.tab-bar__tab')).toHaveCount(2, { timeout: 15_000 });

  const targets: ContrastTarget[] = [
    {
      name: 'メタ情報の文字',
      kind: 'text',
      selector: '.task-item__meta',
      property: 'color',
    },
    {
      name: '選択中タブの塗り',
      kind: 'non-text',
      selector: '.tab-bar__tab.is-active',
      property: 'background-color',
      against: '.tab-bar',
    },
    {
      name: '一覧の行間の線',
      kind: 'non-text',
      selector: '.task-item',
      property: 'border-bottom-color',
    },
  ];

  const normal = await measureContrast(window, targets);

  await window.emulateMedia({ contrast: 'more' });
  const high = await measureContrast(window, targets);

  console.log(
    '[S41] 既定 -> 高コントラスト:\n' +
      Object.keys(normal)
        .map((k) => `  ${k}: ${normal[k].toFixed(2)} -> ${high[k].toFixed(2)}`)
        .join('\n'),
  );

  // 3項目とも測れていること（セレクタが変わって静かに素通りしないように）
  expect(Object.keys(high).sort()).toEqual(targets.map((t) => t.name).sort());

  // **どれも「上がる」こと。** 個別の数値は S40 が既定側を押さえているので、
  // ここでは向きと、最低限の上げ幅だけを見る。
  for (const name of Object.keys(normal)) {
    expect(high[name], `${name} が高コントラストで上がっていない`).toBeGreaterThan(normal[name]);
  }

  // 既定では 1.23 しかなく、この画面で唯一 1.4.11 を満たしていない箇所。
  // 高コントラストではせめて倍近くまで上がること。
  expect(high['選択中タブの塗り']).toBeGreaterThan(2);

  // 最も弱い文字は secondary と同じ段まで上がる（= tertiary の宣言が効いている）
  const secondary = await window.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim(),
  );
  const tertiary = await window.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim(),
  );
  expect(tertiary).toBe(secondary);
});
