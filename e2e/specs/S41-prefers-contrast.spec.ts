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

  // アクティブペインのアクセント線は「分割中だけ」しか出ない（PR 5 の実装漏れの
  // 是正。styles.css の `.terminal-pane.is-active.terminal-pane--split` 参照）ため、
  // このタブを分割してから測る（分割していないと box-shadow が無く、計測が
  // 静かに欠落する。measureContrast は見つからない項目を素通りするだけなので、
  // 分割し忘れると下の「3項目とも測れていること」の突き合わせで気づく設計）。
  await window.keyboard.press('Meta+d');
  await expect(window.locator('.terminal-pane.is-active.terminal-pane--split')).toHaveCount(1, {
    timeout: 15_000,
  });

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
    // Issue #56 PR 5: アクティブペインのアクセント線（design-review.md 提案 C'）。
    // --pane-active-accent が --accent（#5b9cff）から --focus-ring（#ffffff）へ
    // 切り替わることを見る。--border-control（#7a7a7a）との比が 1.56 しか無く
    // 隣接して見分けが付かなくなるための切り替えなので、白のほうが対
    // --surface-1 でも明らかに強くなる（S40 の「全員一致の対案をそのまま
    // 実装しなかった箇所」参照）。この線は分割中だけ出るため、上でタブを
    // 分割してから測っている。
    {
      name: 'アクティブペインの枠線',
      kind: 'non-text',
      selector: '.terminal-pane.is-active .terminal-pane__container',
      property: 'box-shadow',
    },
    // Issue #134（周3）。**`--status-your-turn` を高コントラストで上げた。**
    // 理由は2つあり、どちらも独立に成り立つ:
    //
    // 1. 選択中タブの上では `--surface-tab-active` が #2e2e2e -> #525252 に
    //    明るくなるのに前景が据え置きで、**6.70 -> 3.86 と 42% 落ちていた**
    //    （「コントラストを上げる」を選んだ人にとって、このアプリで最も
    //    情報量のある表示が悪化していた）
    // 2. `--status-exited` を高コントラストで上げると、据え置きのままでは
    //    **終了マークがあなたの番のドットより明るくなる**（styles.css 冒頭の
    //    「強調するのは『あなたの番』の側」に反する）
    //
    // ここで測るのはサイドバーのドット（`--surface-0` の上）。この面は
    // 高コントラストで変わらないので、**前景が明るくなったぶんがそのまま比に出る**
    // = トークンの上書きが効いていることの直接の証拠になる。
    // 下の `against` は S40 と同じ理由（塗りが非透明なので自分自身と比べて 1.0 になる）。
    {
      name: 'あなたの番のドット',
      kind: 'non-text',
      selector: '.task-item--your-turn .task-item__status-dot',
      property: 'background-color',
      againstColor: '--surface-2',
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

  // 全項目とも測れていること（セレクタが変わって静かに素通りしないように）
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

  // --- Issue #134（周3）: 選択中タブの上の終了表示 -----------------------------
  //
  // **`@media (prefers-contrast: more)` は `--surface-tab-active` を
  // #2e2e2e -> #525252 と明るくする。その面に乗る前景を数え直さないと、
  // 「コントラストを上げる」がその箇所だけコントラストを下げる。**
  // 実際 `--status-exited` を据え置いていたときは 4.47 -> 2.57 で、
  // テキストの 4.5:1 どころか**非テキストの 3:1 すら割っていた**。
  //
  // **上の `targets` には入れられない。** この状態（終了したタブが選択されたまま）を
  // 作るには新しいタブを1枚足して選択を移すしかなく、それをすると
  // 「アクティブペインの枠線」が依存している前提（2枚目の分割タブが選択中）が崩れる。
  // 測り方は同じ（既定 -> 高コントラストで2回測って向きを見る）。
  //
  // **`.tab-bar__tab.is-active .tab-bar__state-slot--exited` をここに入れている。**
  // 周1 のコメントは「(対 --surface-1) は高コントラストで背景が変わらないので
  // 必ず割る」と書いていたが、**それは非選択タブに限った話だった**。
  // 同じセレクタが、タブの選択状態で別の面に乗る。選択中タブの上なら
  // `--surface-tab-active` が動くので `high > normal` を満たす。
  // （design-review で3人が独立に指摘した、周1 の予測の誤り）
  await window.emulateMedia({ contrast: null });

  await window.keyboard.press('Meta+t');
  await expect(window.locator('.tab-bar__tab')).toHaveCount(3, { timeout: 15_000 });
  const exitedScreen = window
    .locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-screen')
    .first();
  await expect(exitedScreen).toContainText(/[%#]/, { timeout: 20_000 });
  await window.locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-helper-textarea').focus();
  await window.keyboard.type('exit');
  await window.keyboard.press('Enter');
  await expect(window.locator('.tab-bar__tab.is-active.is-exited')).toHaveCount(1, {
    timeout: 15_000,
  });

  const exitedTargets: ContrastTarget[] = [
    {
      name: '終了したタブの文字（選択中）',
      kind: 'text',
      selector: '.tab-bar__tab.is-active.is-exited',
      property: 'color',
    },
    {
      name: '終了バッジの文字（選択中）',
      kind: 'text',
      selector: '.tab-bar__tab.is-active .tab-bar__exit-badge',
      property: 'color',
    },
    {
      name: '終了マークの塗り（選択中タブ上）',
      kind: 'non-text',
      selector: '.tab-bar__tab.is-active .tab-bar__state-slot--exited',
      property: 'background-color',
      against: '.tab-bar__tab.is-active',
    },
  ];

  const exitedNormal = await measureContrast(window, exitedTargets);
  await window.emulateMedia({ contrast: 'more' });
  const exitedHigh = await measureContrast(window, exitedTargets);

  console.log(
    '[S41] 終了色（既定 -> 高コントラスト）:\n' +
      Object.keys(exitedNormal)
        .map((k) => `  ${k}: ${exitedNormal[k].toFixed(2)} -> ${exitedHigh[k].toFixed(2)}`)
        .join('\n'),
  );

  // 3項目とも測れていること（セレクタが変わって静かに素通りしないように）
  expect(Object.keys(exitedHigh).sort()).toEqual(exitedTargets.map((t) => t.name).sort());

  for (const name of exitedTargets.map((t) => t.name)) {
    // **向きが正しいこと。** 上の targets と同じ不変条件を、この状態でも要求する。
    expect(
      exitedHigh[name],
      `${name} が高コントラストで上がっていない（--status-exited の @media 上書きを確認すること）`,
    ).toBeGreaterThan(exitedNormal[name]);

    // **閾値そのものも見る。** `#f0b8b8` 対 `#525252` は 4.56 で、4.5 に対する
    // 余裕が +1.3% しかない。固定値だけだと「上がったが足りない」に赤くならない。
    expect(
      exitedHigh[name],
      `${name} が高コントラストで 4.5:1 を満たしていない`,
    ).toBeGreaterThanOrEqual(4.5);
  }

  // --- Issue #179 周1（#165 前半）: 選択中タブの上のプロバイダ色 ------------------
  //
  // **`@media` は `--surface-tab-active` を明るくするのに、その面に乗る
  // `--tab-provider-*` 3本を1つも上書きしていない**（`--status-exited` と
  // まったく同じ壊れ方。周3 で終了色を直したときに、隣の3本が漏れた）。
  //
  // **上の `targets` には入れない。** あちらは全項目に `high > normal` を要求する
  // ループで、この3本は現時点で **下がる**（面だけ明るくなるので）。
  // 同じループに入れると周1 の時点で赤くなり、`make e2e` を緑に保てない。
  // ここは #160 と同じ作法で、**いまの値を characterization として固定し、
  // 直った瞬間に赤くなる番人を付ける**（下の stale ガード）。
  //
  // 測り方は S40 の同名項目と揃える（`againstColor` でトークンから面を引く）。
  // プロバイダ色は3種類あるのに選択中タブは1枚しか作れないため、
  // 実際にタブを選択して `against` で引くことはできない。
  await window.emulateMedia({ contrast: null });

  const providerTargets: ContrastTarget[] = [
    {
      name: 'シェルタブの色相の枠（選択中タブ上）',
      kind: 'non-text',
      selector: '.tab-bar__tab--shell',
      property: 'border-top-color',
      againstColor: '--surface-tab-active',
    },
    {
      name: 'claude タブの色相の枠（選択中タブ上）',
      kind: 'non-text',
      selector: '.tab-bar__tab--claude',
      property: 'border-top-color',
      againstColor: '--surface-tab-active',
    },
    {
      name: 'gemini タブの色相の枠（選択中タブ上）',
      kind: 'non-text',
      selector: '.tab-bar__tab--gemini',
      property: 'border-top-color',
      againstColor: '--surface-tab-active',
    },
  ];

  // claude / gemini のタブはこの spec ではまだ開いていない（S40 と違い、ここまで
  // シェルタブしか作っていない）。**開かないと2本が静かに欠落する。**
  await window.keyboard.press('Meta+Shift+C');
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(1, { timeout: 15_000 });
  await window.keyboard.press('Meta+Shift+E');
  await expect(window.locator('.tab-bar__tab--gemini')).toHaveCount(1, { timeout: 15_000 });

  const providerNormal = await measureContrast(window, providerTargets);
  await window.emulateMedia({ contrast: 'more' });
  const providerHigh = await measureContrast(window, providerTargets);

  console.log(
    '[S41] プロバイダ色 × 選択中タブの面（既定 -> 高コントラスト）:\n' +
      Object.keys(providerNormal)
        .map((k) => `  ${k}: ${providerNormal[k].toFixed(2)} -> ${providerHigh[k].toFixed(2)}`)
        .join('\n'),
  );

  // 3本とも測れていること（セレクタが変わって静かに素通りしないように）
  expect(Object.keys(providerHigh).sort()).toEqual(providerTargets.map((t) => t.name).sort());

  // 既定側は S40 が押さえているので、ここでは高コントラスト側だけを固定する。
  // **いまは3本とも非テキストの 3:1 を割っている**（Issue #165）。
  const PROVIDER_HIGH_NOW: Record<string, number> = {
    'シェルタブの色相の枠（選択中タブ上）': 2.4,
    'claude タブの色相の枠（選択中タブ上）': 2.0,
    'gemini タブの色相の枠（選択中タブ上）': 2.26,
  };
  for (const [name, ratio] of Object.entries(PROVIDER_HIGH_NOW)) {
    expect(providerHigh[name], `${name} の高コントラスト時の比が記録から動いている`).toBeCloseTo(
      ratio,
      1,
    );
  }

  // **番人。** 上の固定値だけだと、直したときに数字を書き換えて終わりになり、
  // 「3:1 を満たすようになった」ことが以後どの閾値検査にも入らない
  // （S40 の staleFail とまったく同じ壊れ方を防ぐ）。
  // 直った瞬間にここが赤くなり、閾値 assert への切り替えを強制する。
  const nowPassing = Object.keys(PROVIDER_HIGH_NOW).filter((name) => providerHigh[name] >= 3.0);
  expect(
    nowPassing,
    'プロバイダ色が高コントラストで 3:1 を満たすようになった。' +
      'PROVIDER_HIGH_NOW の固定をやめ、`toBeGreaterThanOrEqual(3.0)` と ' +
      '`high > normal` の assert に切り替えること（Issue #179 周2）',
  ).toEqual([]);

  await window.emulateMedia({ contrast: null });

  // 既定側は**まだ 4.5 を割っている**（テキスト2件が 4.47）。
  // ここは値ではなく結合状態の規則（`.tab-bar__tab.is-active.is-exited` に
  // `--text-bright` を戻す）で解くのが筋、という design-review の結論に従い
  // 別 Issue に切り出した。**割っている事実は固定しておく**（黙って腐らせない）。
  expect(exitedNormal['終了したタブの文字（選択中）']).toBeCloseTo(4.47, 1);
  expect(exitedNormal['終了バッジの文字（選択中）']).toBeCloseTo(4.47, 1);
});
