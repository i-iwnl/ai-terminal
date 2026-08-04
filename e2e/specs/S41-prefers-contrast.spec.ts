import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';
import { measureContrast, type ContrastTarget } from '../fixtures/contrast';
import {
  focusRingBand,
  gapPx,
  providerBand,
  ringTouchesProviderBand,
} from '../../src/renderer/src/tabs/tabBandGeometry';

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

  // --- Issue #164（#179 周2）: 3件を「前景が動くもの / 天井に張り付いたもの」で分ける ---
  //
  // **以前はここが3件を一律に扱い、全件へ `high > normal` を課していた。**
  // #164 で選択中タブの文字とバッジが `--text-bright`（白）になった結果、
  // このループは**必ず落ちるようになった**。白は輝度の天井なので、面が
  // `#2e2e2e` -> `#525252` と明るくなれば比は 13.58 -> 7.81 と必ず下がる。
  // **前景が天井に達した項目に「高コントラストで上がる」を要求することはできない。**
  //
  // ⛔ **ここを「一律に緩める」で通してはいけない。** 緩めると、まだ本当に
  // 追随が要る項目（終了マークの塗り。前景が `--status-exited` で実際に動く）の
  // 番人まで一緒に消える。分けて、それぞれに正しい不変条件を課す。
  // （周2 の design-review で、この4つ目の番人の存在を2人が独立に指摘した。
  //   周1 が数えた「番人3箇所」は4箇所だった）

  // (a) 前景が `--status-exited` で実際に動く項目 -> 向きと閾値の両方を要求する
  const movesWithMedia = '終了マークの塗り（選択中タブ上）';
  expect(
    exitedHigh[movesWithMedia],
    `${movesWithMedia} が高コントラストで上がっていない（--status-exited の @media 上書きを確認すること）`,
  ).toBeGreaterThan(exitedNormal[movesWithMedia]);
  // `#f0b8b8` 対 `#525252` は 4.56 で、4.5 に対する余裕が +1.3% しかない。
  // 固定値だけだと「上がったが足りない」に赤くならない。
  // （なお非テキストなので 1.4.11 の要求は 3:1 だが、この四角は
  //   終了を運ぶ唯一の色なので、あえて厳しい 4.5 側で見張り続ける）
  expect(
    exitedHigh[movesWithMedia],
    `${movesWithMedia} が高コントラストで 4.5:1 を満たしていない`,
  ).toBeGreaterThanOrEqual(4.5);

  // (b) 前景が白（天井）に張り付いた項目 -> 向きは要求できない。
  //     **代わりに「両方の面で 4.5 以上」と「実際に白であること」を要求する。**
  //     白であることまで見るのは、`--text-bright` 以外の明るい色に差し替えられて
  //     比だけ通る、という抜け方を塞ぐため。
  const atCeiling = ['終了したタブの文字（選択中）', '終了バッジの文字（選択中）'];
  const bright = await window.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--text-bright').trim(),
  );
  expect(bright.toLowerCase()).toBe('#ffffff');
  for (const name of atCeiling) {
    expect(
      exitedNormal[name],
      `${name} が既定の面で 4.5:1 を満たしていない`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      exitedHigh[name],
      `${name} が高コントラストの面で 4.5:1 を満たしていない`,
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

  // --- Issue #179 周2: 面だけでなく「隣接色」も測る -----------------------------
  //
  // **周1 のここは、測る隣接色が1つでは足りなかった。** 1.4.11 が要求するのは
  // 「隣接**色**（複数）に対して 3:1」で、この 2px の帯には3方向の隣がある:
  //
  //   下   -> タブの塗り（高コントラストで #525252）  <- 周1 はここだけ測っていた
  //   下   -> フォーカスリング（白。**間に隙間 0px で接する**）
  //   左右 -> 隣のタブの帯（帯どうしの区別 = この線の存在理由そのもの）
  //
  // 周2 の design-review で、5人中4人が独立に「面との 3:1 だけを見て色を明るくすると、
  // 帯どうしの識別が壊れる」と指摘した。実際に案の色（#9ea2aa / #d99179 / #71a8d1）を
  // 測ると、面との比は 3.05〜3.08 に改善する一方で
  // **帯どうしが 1.06〜1.20 -> 1.00〜1.01（等輝度＝識別不能）**、
  // **フォーカスリングとの比が 3.25〜3.90 -> 2.54〜2.56（3:1 割れ）** に落ちる。
  //
  // しかも a11y レビューが示したとおり、**この2つは同時には満たせない**:
  //   対 #525252 で 3:1     -> L >= 0.3531
  //   対 #ffffff  で 3:1    -> L <= 0.3000
  // 区間が交わらないので、24bit の全色に解が無い。**輝度だけでは解けない。**
  //
  // したがって #165 後半は「色を明るくする」では終わらない。ここでは
  // **現在値を固定して、色を動かした瞬間にこの2つが見えるようにする**。
  const adjacentTargets: ContrastTarget[] = [
    // フォーカスリングは高コントラストでも白のまま（--focus-ring は @media で不変）
    {
      name: 'シェルタブの色相の枠 対 フォーカスリング',
      kind: 'non-text',
      selector: '.tab-bar__tab--shell',
      property: 'border-top-color',
      againstColor: '--focus-ring',
    },
    {
      name: 'claude タブの色相の枠 対 フォーカスリング',
      kind: 'non-text',
      selector: '.tab-bar__tab--claude',
      property: 'border-top-color',
      againstColor: '--focus-ring',
    },
    {
      name: 'gemini タブの色相の枠 対 フォーカスリング',
      kind: 'non-text',
      selector: '.tab-bar__tab--gemini',
      property: 'border-top-color',
      againstColor: '--focus-ring',
    },
    // 帯どうし。**この線の存在理由は「どのプロバイダか」を見せることなので、
    // ここが 1.00 に潰れたら、面との比をいくら上げても目的を達していない。**
    {
      name: '色相の枠どうし（シェル 対 claude）',
      kind: 'non-text',
      selector: '.tab-bar__tab--shell',
      property: 'border-top-color',
      againstColor: '--tab-provider-claude',
    },
    {
      name: '色相の枠どうし（シェル 対 gemini）',
      kind: 'non-text',
      selector: '.tab-bar__tab--shell',
      property: 'border-top-color',
      againstColor: '--tab-provider-gemini',
    },
    {
      name: '色相の枠どうし（claude 対 gemini）',
      kind: 'non-text',
      selector: '.tab-bar__tab--claude',
      property: 'border-top-color',
      againstColor: '--tab-provider-gemini',
    },
  ];

  const adjacentHigh = await measureContrast(window, adjacentTargets);

  console.log(
    '[S41] 高コントラスト時の隣接色:\n' +
      Object.entries(adjacentHigh)
        .map(([k, v]) => `  ${k}: ${v.toFixed(2)}`)
        .join('\n'),
  );

  expect(Object.keys(adjacentHigh).sort()).toEqual(adjacentTargets.map((t) => t.name).sort());

  // **いまの値**（プロバイダ色は @media で上書きされていないので既定と同じ）。
  // フォーカスリングとは3本とも 3:1 を満たしており、帯どうしは元から弱い。
  const ADJACENT_HIGH_NOW: Record<string, number> = {
    'シェルタブの色相の枠 対 フォーカスリング': 3.25,
    'claude タブの色相の枠 対 フォーカスリング': 3.9,
    'gemini タブの色相の枠 対 フォーカスリング': 3.46,
    '色相の枠どうし（シェル 対 claude）': 1.2,
    '色相の枠どうし（シェル 対 gemini）': 1.06,
    '色相の枠どうし（claude 対 gemini）': 1.13,
  };
  for (const [name, ratio] of Object.entries(ADJACENT_HIGH_NOW)) {
    expect(adjacentHigh[name], `${name} の比が記録から動いている`).toBeCloseTo(ratio, 1);
  }

  // --- Issue #179 周2.5: フォーカスリングとの 3:1 は「接しているとき」だけ要求する -----
  //
  // **周2 のここは、幾何に対して盲目だった。** 帯とリングの色の比しか測っていないので、
  // リングを内側へずらして面を挟んでも数値が1桁も動かない。
  //
  // 1.4.11 の「隣接色」は**接している**ものを指す。1px でも面が挟まれば、その面が
  // 隣接色になるので、帯とリングの間に 3:1 を要求する理由が無くなる。
  // そこで**実際の隙間を測り、接しているときだけ 3:1 を要求する**。
  //
  // ⛔ **`outlineOffset` の文字列を突き合わせない。** それは CSS の宣言を言い換えただけで、
  // `contrast.ts` の冒頭が「宣言値ではなく解決された実効値を見る」と言って捨てた形と同型。
  // 算術は `tabBandGeometry.ts`（符号と向きを閉じた純粋関数）に任せ、ここでは
  // `getComputedStyle` の実測値を流し込むだけにする（**同じ計算を2箇所に書かない**）。

  // 本物の `:focus-visible` を作る（S51 と同じ手順。クリックでは出ない）
  await window.locator('.tab-bar__new').focus();
  await window.keyboard.press('Shift+Tab');

  const measured = await window.evaluate(() => {
    const button = document.querySelector('.tab-bar__tab-button:focus-visible');
    if (!button) return null;
    const tab = button.closest('.tab-bar__tab');
    if (!tab) return null;
    const bs = getComputedStyle(button);
    const ts = getComputedStyle(tab);
    return {
      borderTopWidth: Number.parseFloat(ts.borderTopWidth),
      outlineWidth: Number.parseFloat(bs.outlineWidth),
      outlineOffset: Number.parseFloat(bs.outlineOffset),
      // 純粋関数が前提にしている `align-self: stretch` を実測で検算するための2値
      tabTop: tab.getBoundingClientRect().top,
      buttonTop: button.getBoundingClientRect().top,
    };
  });

  expect(measured, 'Shift+Tab でタブのボタンが :focus-visible になっていない').not.toBeNull();
  if (!measured) throw new Error('unreachable');

  // **純粋関数の前提を実測で検算する。** `.tab-bar__tab-button` の border-box 上端が
  // タブの content-box 上端に一致すること（= `align-self: stretch`）。
  // ここが崩れると tabBandGeometry の座標系が丸ごと嘘になるので、先に落とす。
  expect(
    measured.buttonTop - measured.tabTop,
    'ボタンの上端がタブの content-box 上端に無い（align-self: stretch が崩れた）',
  ).toBeCloseTo(measured.borderTopWidth, 1);

  const band = providerBand(measured.borderTopWidth);
  const ring = focusRingBand(measured.borderTopWidth, measured.outlineWidth, measured.outlineOffset);
  const gap = gapPx(band, ring);
  const touching = ringTouchesProviderBand(
    measured.borderTopWidth,
    measured.outlineWidth,
    measured.outlineOffset,
  );

  console.log(`[S41] 帯とフォーカスリングの隙間: ${gap}px（接している: ${touching}）`);

  // **隙間そのものを固定する。** 0 に戻ると、Issue #165 後半が詰んでいた状態に戻る。
  expect(
    gap,
    '帯とフォーカスリングの隙間が 2px を下回った。0 に戻すと「面との 3:1」と' +
      '「リングとの 3:1」が両立不能になり、#165 後半が解けなくなる' +
      '（対 #525252 で 3:1 には L>=0.3531、対 #ffffff で 3:1 には L<=0.3000）',
  ).toBeGreaterThanOrEqual(2);

  // **接しているときだけ 3:1 を要求する。**
  for (const name of Object.keys(ADJACENT_HIGH_NOW)) {
    if (!name.includes('フォーカスリング')) continue;
    if (!touching) continue;
    expect(
      adjacentHigh[name],
      `${name} が 3:1 を割った。帯とリングが接している以上、1.4.11 の隣接色になる`,
    ).toBeGreaterThanOrEqual(3.0);
  }

  // **逆向きの番人。** 上の `continue` は、幾何が変わると assert を静かに素通りさせる。
  // S40 の `staleFail` と同じ形で、**札と実態がずれたら落とす**:
  //   - 接しているのに 3:1 を割っている  -> 上のループが落とす
  //   - 接していないのに 3:1 を要求し続ける -> ここが落とす（要求しすぎ。#165 後半を
  //     「輝度だけでは両立しない」と誤って結論づけたまま固定してしまう）
  const ringNames = Object.keys(ADJACENT_HIGH_NOW).filter((n) => n.includes('フォーカスリング'));
  if (!touching) {
    const stillConstrained = ringNames.filter((n) => adjacentHigh[n] < 3.0);
    console.log(
      `[S41] 隙間があるので 3:1 の要求は外れている（3:1 未満の項目: ${stillConstrained.length}件。` +
        'これは違反ではない）',
    );
  }
  expect(
    ringNames.length,
    'フォーカスリングとの比を測る項目が消えた。幾何が変わっても、値そのものは記録し続ける',
  ).toBe(3);

  // **番人。** 上の固定値だけだと、直したときに数字を書き換えて終わりになり、
  // 「3:1 を満たすようになった」ことが以後どの閾値検査にも入らない
  // （S40 の staleFail とまったく同じ壊れ方を防ぐ）。
  // 直った瞬間にここが赤くなり、閾値 assert への切り替えを強制する。
  //
  // ⛔ **周1 はここに「`high > normal` の assert に切り替えること」と書いていたが、
  // それは誤りだった**（周2 の design-review で4人が独立に指摘）。
  // `providerTargets` は `againstColor: '--surface-tab-active'` で測っており、
  // **その面自体が #2e2e2e -> #525252 と動く**。normal と high は別の面の上の値なので、
  // 大小を比べても意味がない。実際、面が明るくなるぶん high は必ず下がる
  // （3:1 を回復させても 3.05 < 4.18 のまま）。
  // **`high > normal` が不変条件として意味を持つのは、面が動かない対象だけ。**
  const nowPassing = Object.keys(PROVIDER_HIGH_NOW).filter((name) => providerHigh[name] >= 3.0);
  expect(
    nowPassing,
    'プロバイダ色が高コントラストで 3:1 を満たすようになった。' +
      'PROVIDER_HIGH_NOW の固定をやめ、`toBeGreaterThanOrEqual(3.0)` に切り替えること。' +
      '**そのとき ADJACENT_HIGH_NOW（フォーカスリング / 帯どうし）も必ず見直す。** ' +
      '面との 3:1 とフォーカスリングとの 3:1 は輝度だけでは両立しないので、' +
      '位置か形の軸が要る（Issue #165 後半 / #179 周2 の design-review）',
  ).toEqual([]);

  await window.emulateMedia({ contrast: null });

  // **Issue #164（#179 周2）で是正済み。** ここは長らく「既定側はまだ 4.5 を割っている
  // （テキスト2件が 4.47）」を固定していた箇所で、値ではなく結合状態の規則で解く、という
  // design-review の結論どおりに直った（`.tab-bar__tab.is-exited` に `:not(.is-active)` を
  // 付けて詳細度を上げ、バッジは `color` の宣言を落として継承させた）。
  // **--status-exited の値は1つも変えていない。**
  expect(exitedNormal['終了したタブの文字（選択中）']).toBeCloseTo(13.58, 1);
  expect(exitedNormal['終了バッジの文字（選択中）']).toBeCloseTo(13.58, 1);
});
