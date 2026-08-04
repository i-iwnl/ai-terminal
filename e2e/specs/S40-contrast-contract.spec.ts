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

/** 正規表現の特殊文字をエスケープする（workDir のディレクトリ名をそのままパターン化するため）。
 *  S07 / S08 と同じ理由（zsh のログインシェル起動直後の前置きメッセージに早期マッチしない）。 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('S40 画面のコントラスト比が、記録した値から動いていない', async () => {
  const { window, workDir } = launched;
  const cwdName = workDir.split('/').pop() as string;
  const promptPattern = new RegExp(`${escapeRegExp(cwdName)}\\s*[%#]`);

  // --- 本体ウィンドウ -----------------------------------------------------

  // タスク一覧を出す（偽 claude が busy / idle の2件を返す）
  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();
  await expect(window.locator('.task-list .task-item')).toHaveCount(2, { timeout: 15_000 });

  // タブを1枚足す。**起動直後は1枚しか無く、それは選択中なので
  // 「非選択タブの文字」が測れない**（測れない項目は下のキー検査で落ちる）
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.tab-bar__tab')).toHaveCount(2, { timeout: 15_000 });

  // Issue #20 PR 10（差し戻し後）: 終了マーク（.tab-bar__state-slot--exited）を
  // 測るため、いま追加した2枚目のタブのシェルを実際に終了させる。
  // 1枚目（起動時の最初のタブ）は「非選択タブの文字」測定がそのまま拾うので、
  // ここで終了させるのは2枚目に限る（1枚目が exited になると
  // `.tab-bar__tab.is-exited` の色に上書きされ、既存の測定値が変わってしまう）。
  const newShellScreen = window
    .locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-screen')
    .first();
  await expect(newShellScreen).toContainText(promptPattern, { timeout: 20_000 });
  await window.locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-helper-textarea').focus();
  await window.keyboard.type('exit');
  await window.keyboard.press('Enter');
  await expect(window.locator('.tab-bar__tab.is-exited')).toHaveCount(1, { timeout: 15_000 });

  // Issue #20 PR 10（差し戻し後）: プロバイダの色相アクセント
  // （.tab-bar__tab--claude / --gemini）を測るため、claude と gemini のタブも開く。
  // 1枚目（シェル・非選択・非終了）が `.tab-bar__tab--shell` の測定を拾う。
  await window.keyboard.press('Meta+Shift+C');
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(1, { timeout: 15_000 });
  await window.keyboard.press('Meta+Shift+E');
  await expect(window.locator('.tab-bar__tab--gemini')).toHaveCount(1, { timeout: 15_000 });

  // 検索バーを開く（浮いた面と枠を測るため）
  await window.keyboard.press('Meta+f');
  await expect(window.locator('.terminal-search input')).toBeVisible();

  // Issue #20 PR 11: 通知バナーの severity 化（配列化 + 情報/エラー）。
  // 2枚目のタブを `exit`（終了コード 0）させた時点で、実は severityForExit が
  // 「情報」と判定した通知バナーが既に右上に1件出ている（上の「終了マーク」の
  // 準備で使ったのと同じ操作。正常終了なので info 側に分類される）。
  // ここではさらに1枚シェルタブを足し、0 以外のコードで終了させて
  // error severity の通知も出す。info と error を同時に乗せた状態で両方の色を測る
  // （役割が違う通知が同時に出ても互いを潰さないことは、この spec ではなく
  // e2e/specs/S55-notice-severity.spec.ts の担当）。
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.tab-bar__tab')).toHaveCount(5, { timeout: 15_000 });
  const errorShellScreen = window
    .locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-screen')
    .first();
  await expect(errorShellScreen).toContainText(promptPattern, { timeout: 20_000 });
  await window.locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-helper-textarea').focus();
  await window.keyboard.type('exit 7');
  await window.keyboard.press('Enter');
  await expect(window.locator('.notice-banner--error')).toBeVisible({ timeout: 15_000 });
  await expect(window.locator('.notice-banner--info')).toBeVisible();

  // Issue #56 PR 7: スプリッタの線（.pane-splitter）を測るため、1枚シェルタブを
  // 足して分割する。**このタブを選択したまま測る（5枚目の exit-7 タブへは戻さない）。**
  // アクティブペインのアクセント線は「分割中だけ」しか出ない（PR 5 の実装漏れの
  // 是正。`.terminal-pane--split` が無いと box-shadow が付かない。styles.css 参照）ため、
  // 「分割していない1枚ペインを測る」という以前の前提はもう成立しない。むしろ
  // このタブが選択中のまま（＝分割後にアクティブなペインが `visible && is-active`
  // を両方持つ状態）でいることが、アクセント線を測るための必須条件になった。
  // `getComputedStyle` は `visibility: hidden` でも実効値を返すため、スプリッタの
  // 色はこのタブが選択中のままでも問題なく測れる。
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.tab-bar__tab')).toHaveCount(6, { timeout: 15_000 });
  await window.keyboard.press('Meta+d');
  await expect(window.locator('.pane-splitter')).toHaveCount(1, { timeout: 15_000 });
  await expect(window.locator('.terminal-pane.is-active.terminal-pane--split')).toHaveCount(1, {
    timeout: 5_000,
  });

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
    // --- Issue #20 H（PR 19）: サイドバーのセグメンテッドコントロール ---
    //
    // 下線タブから macOS のセグメンテッドコントロールへ（K-6）。トラックと
    // 選択中ピルがそれぞれ不透明な背景を新しく持つようになったため、
    // その上の文字色はこれまで測っていた値（対 --surface-0 のサイドバー地）とは
    // 別のコントラストになる。新しく足す視覚要素は測ってから固定する
    // （design-rules.md 3「数値の正は表ではなく実測」）。
    {
      name: '非選択セグメントの文字（対トラック）',
      kind: 'text',
      selector: '.sidebar__tabs button:not(.is-active)',
      property: 'color',
    },
    {
      name: '選択中セグメントの文字（対ピル）',
      kind: 'text',
      selector: '.sidebar__tabs button.is-active',
      property: 'color',
    },
    {
      // 塗り自体は非透明（自分自身と比較すると 1.0 になる）ので、
      // 「選択中タブの塗り（対タブバー）」と同じ理由で against が要る。
      name: '選択中セグメントの塗り（対トラック）',
      kind: 'non-text',
      selector: '.sidebar__tabs button.is-active',
      property: 'background-color',
      against: '.sidebar__tabs',
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
      // Issue #134 の design-review で見つかった穴: **S40 は --status-your-turn を
      // 1件も測っていなかった**（`grep your-turn` が0件）。「無視してよい状態」
      // （終了）には契約が2本あるのに、**このアプリの存在理由そのものである
      // 「行動が必要な状態」には0本**、という非対称だった。
      // 下の「作業中のドット」と同じ理由でホバー面（--surface-2）と比べる。
      name: 'あなたの番のドット（対ホバー面）',
      kind: 'non-text',
      selector: '.task-item--your-turn .task-item__status-dot',
      property: 'background-color',
      againstColor: '--surface-2',
    },
    {
      // Issue #20 B（PR 8）で一覧は「あなたの番」グループが先頭になり、
      // busy（作業中）の行はもう先頭とは限らない。`.task-item--working` で
      // 明示的に絞り込み、DOM の並び順に依存しないようにする。
      // ホバーしたときの面と比べる（行はホバーで --surface-2 に変わるので、最悪ケースはそちら）
      name: '作業中のドット（対ホバー面）',
      kind: 'non-text',
      selector: '.task-item--working .task-item__status-dot',
      property: 'background-color',
      againstColor: '--surface-2',
    },
    // --- Issue #20 PR 10（差し戻し後）: プロバイダの色相アクセントと終了マーク ---
    //
    // border-top-color は `contrast.ts` の既定挙動どおり（border 系のプロパティは
    // 自分の背景ではなく親の実効背景と比べる）で、明示的な against は要らない。
    // 親を辿ると `.tab-bar__tablist` / `.tab-bar__tabs` はどちらも背景を持たず、
    // `.tab-bar`（--surface-1）に行き着く。1枚目のタブ（シェル・非選択・非終了）は
    // `.tab-bar__tab--shell` にも一致するので、そちらを測る
    // （claude / gemini は起動順の都合でこの時点でも非選択とは限らないが、
    // border-top-color は is-active の影響を受けないため計測値は変わらない）。
    {
      // 末尾を「枠」にしてあるのは装飾語ではなく、下の「記録した値との
      // 突き合わせ」にある非テキスト/テキストの閾値振り分け（名前に
      // '塗り'/'枠'/'ドット' を含むかで判定する簡易ヒューリスティック）を
      // 正しく非テキスト（3:1）側に倒すため。text 側（4.5:1）に倒れると、
      // このアクセントの実測値（4.5 未満のものがある）で誤って落ちる。
      name: 'シェルタブの色相の枠（対タブバー）',
      kind: 'non-text',
      selector: '.tab-bar__tab--shell',
      property: 'border-top-color',
    },
    {
      name: 'claude タブの色相の枠（対タブバー）',
      kind: 'non-text',
      selector: '.tab-bar__tab--claude',
      property: 'border-top-color',
    },
    {
      name: 'gemini タブの色相の枠（対タブバー）',
      kind: 'non-text',
      selector: '.tab-bar__tab--gemini',
      property: 'border-top-color',
    },
    {
      // 終了マーク（先頭スロット）は塗り（background-color）なので border 系とは
      // 扱いが違う。既定の実効背景解決は「自分自身から」始まり、この要素は
      // 自分の塗りそのものが非透明なので**自分自身と比較する 1.0 になってしまう**
      // （「選択中タブの塗り」と同じ理由で against が要る）。このマーク（2枚目の
      // タブ）は claude / gemini を開いたあとで非選択になっているため、
      // 実際に見えている背景は `.tab-bar` と同じ --surface-1。
      name: '終了マークの塗り（先頭スロット・対タブバー）',
      kind: 'non-text',
      selector: '.tab-bar__state-slot--exited',
      property: 'background-color',
      against: '.tab-bar',
    },
    // --- Issue #20 PR 11: 通知バナーの severity（情報 / エラー） ---
    //
    // 通知の入れ物（.notice-list）自体は背景を持たない透明な絶対配置なので、
    // border 系の実効背景は祖先を遡って body（--surface-1）に行き着く
    // （contrast.ts の既定挙動どおりで、明示的な against は要らない）。
    {
      name: '通知バナー（情報）の文字',
      kind: 'text',
      selector: '.notice-banner--info .notice-banner__message',
      property: 'color',
    },
    {
      name: '通知バナー（情報）の枠（対 --surface-1）',
      kind: 'non-text',
      selector: '.notice-banner--info',
      property: 'border-top-color',
    },
    {
      name: '通知バナー（情報）のアイコン文字',
      kind: 'text',
      selector: '.notice-banner--info .notice-banner__icon',
      property: 'color',
    },
    {
      name: '通知バナー（エラー）の文字',
      kind: 'text',
      selector: '.notice-banner--error .notice-banner__message',
      property: 'color',
    },
    {
      name: '通知バナー（エラー）の枠（対 --surface-1）',
      kind: 'non-text',
      selector: '.notice-banner--error',
      property: 'border-top-color',
    },
    {
      name: '通知バナー（エラー）のアイコン文字',
      kind: 'text',
      selector: '.notice-banner--error .notice-banner__icon',
      property: 'color',
    },
    // Issue #56 PR 5: アクティブペインのアクセント線（design-review.md 提案 C'）。
    // box-shadow は getComputedStyle 上も "rgb(...) <offsets> inset" という
    // 文字列で返るが、measureContrast の parse は文字列中の最初の rgba?(...) を
    // 拾うだけなので、そのまま渡してよい（border-top-color 等と同じ扱い）。
    // ペインヘッダは通常フローに入れてあり .terminal-pane__container の上には
    // 重ならない（レビュー指摘で重ね描きをやめた）ため、乗る面（対 --surface-1）は
    // 分割の有無に関わらず変わらない。**ただしこの線自体は「分割中だけ」しか
    // 出ない**（`.terminal-pane--split` が無いレイヤーには box-shadow が付かない。
    // PR 5 はこの条件を欠いており単一ペインでも常時表示されていた実装漏れを、
    // ペインヘッダと同じ「分割中のみ」の条件に揃えて是正した）。そのため
    // ここで測るのは、直前に作った6枚目のタブを分割した直後の、分割中のアクティブペイン。
    {
      name: 'アクティブペインの枠線（対 --surface-1）',
      kind: 'non-text',
      selector: '.terminal-pane.is-active .terminal-pane__container',
      property: 'box-shadow',
    },
    // Issue #56 PR 7: スプリッタ（design-review.md 提案 D'）の表示 1px。
    // ドラッグの当たり判定（8px、::before の絶対配置）と違い、この線自体は
    // 分割中は常時見えている持続的な視覚要素（ドラッグ中だけのゴースト線とは
    // 別。ゴーストは drop-target ハイライトと同じ「操作中だけ見える」表現なので
    // S40 の対象に含めない。S58 の前例と同じ切り分け）。**新しいトークンは
    // 作らず --border-control をそのまま使う**（design-review.md「5人中4人が
    // --border-control にせよと書いた」の結論）。
    {
      // .pane-splitter 自身の塗り（background-color）は非透明なので、against を
      // 省略すると「選択中タブの塗り」と同じ理由で自分自身と比較して 1.0 になる
      // （contrast.ts の既定挙動。値が要る背景は明示的に渡す必要がある）。
      // 実際に乗っているのは .terminal-stack の --surface-1。
      name: 'スプリッタの枠線（対 --surface-1）',
      kind: 'non-text',
      selector: '.pane-splitter',
      property: 'background-color',
      against: '.terminal-stack',
    },
  ];

  const main = await measureContrast(window, mainTargets);

  // --- Issue #134（周1 characterization）: 「選択中かつ終了」のタブ --------------
  //
  // **上の mainTargets とは別のバッチにしてある。** ここで測りたい状態
  // （終了したタブが選択されたまま）を作るには新しいタブを1枚足して選択を移すしかなく、
  // それをすると直前に測ったスプリッタ・アクティブペインの枠線の前提
  // （6枚目の分割タブが選択中であること）が崩れる。
  //
  // **既に終了させた2枚目では測れない。** あちらは claude / gemini を開いた時点で
  // 非選択になっており、乗っている面は `.tab-bar`（--surface-1）。ここで問題に
  // なっているのは **--surface-tab-active（#2e2e2e）の上**の値。
  //
  // `TabBar.tsx` は `is-active` と `is-exited` を同じ要素に並べて付け、両者は
  // 詳細度が同じ (0,2,0) なので**後勝ちで `.is-exited` の color が
  // `--text-bright` を上書きする**。つまり「選択中かつ終了」は実際に起きる状態で、
  // そのときタブの文字と終了バッジの2箇所が --status-exited になる。
  //
  // **どちらも 4.47 で、テキストの 4.5:1 をわずかに割っている**（wcag: 'fail'）。
  // いま値は直さない（周3 の担当）。ここでやるのは、直す前の値を固定して
  // **値が動いたら必ず赤くなる状態を先に作る**こと。
  // `styles.css` の `.tab-bar__state-slot--exited` 直上のコメントは、この 4.47 を
  // 「テキストの 4.5:1 も満たす」と誤記している。それも周3 で直す。
  await window.keyboard.press('Meta+t');
  await expect(window.locator('.tab-bar__tab')).toHaveCount(7, { timeout: 15_000 });
  const exitedActiveScreen = window
    .locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-screen')
    .first();
  await expect(exitedActiveScreen).toContainText(promptPattern, { timeout: 20_000 });
  await window.locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-helper-textarea').focus();
  await window.keyboard.type('exit');
  await window.keyboard.press('Enter');
  // **選択されたまま終了していること**を先に固定する。ここが崩れると、下の2件は
  // 別の面（--surface-1）の上を測ってしまい、静かに違う値を記録する。
  await expect(window.locator('.tab-bar__tab.is-active.is-exited')).toHaveCount(1, {
    timeout: 15_000,
  });

  const exitedActive = await measureContrast(window, [
    {
      // 要素自身が --surface-tab-active の不透明な塗りを持つので against は要らない
      // （effectiveBackground は自分自身から始まる）。
      name: '終了したタブの文字（選択中・対 --surface-tab-active）',
      kind: 'text',
      selector: '.tab-bar__tab.is-active.is-exited',
      property: 'color',
    },
    {
      // バッジ自身は背景を持たないので、祖先（選択中のタブ）まで遡って
      // --surface-tab-active に行き着く。
      name: '終了バッジの文字（選択中・対 --surface-tab-active）',
      kind: 'text',
      selector: '.tab-bar__tab.is-active .tab-bar__exit-badge',
      property: 'color',
    },
    {
      // Issue #134 の design-review で見つかった、**一度も測られていなかった箇所**。
      // 上の「終了マークの塗り（先頭スロット・対タブバー）」は against が
      // `.tab-bar`（--surface-1）で、しかも対象は claude / gemini を開いたあとに
      // 非選択になった2枚目。**同じセレクタが、タブの選択状態で別の面に乗る**。
      // 選択中タブの上では --surface-tab-active が実効背景になる。
      // 高コントラストでは 2.57 まで落ちて**非テキストの 3:1 すら割っていた**
      // （S41 が高コントラスト側を担当する）。
      name: '終了マークの塗り（選択中タブ上・対 --surface-tab-active）',
      kind: 'non-text',
      selector: '.tab-bar__tab.is-active .tab-bar__state-slot--exited',
      property: 'background-color',
      against: '.tab-bar__tab.is-active',
    },
  ]);

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

  // **フォーカスは、枠を測り終えてから当てる。**
  // .settings__text:focus は border-color をアクセントに変えるので、
  // 先にフォーカスすると「通常の枠」ではなくフォーカス時の枠を測ってしまう。
  await dialog.locator('.settings__text').first().focus();
  const focused = await measureContrast(dialog, [
    {
      // 2.4.11 は「フォーカスの有無で 3:1 の差」を求める。
      // リングの色を、フォーカスしていないときの枠の色と比べる。
      name: 'フォーカスリング（対 通常の枠）',
      kind: 'non-text',
      selector: '.settings__text:focus',
      property: 'outline-color',
      againstColor: '--border-control',
    },
  ]);

  await dialog.keyboard.press('Escape').catch(() => undefined);

  // --- 記録した値との突き合わせ -------------------------------------------
  //
  // 期待値は「いまそうなっている値」。WCAG 欄は現時点の判定で、assert には使っていない。
  // **値を変える PR では、ここの数字を更新するのが作業の一部になる。**

  const expected: Record<string, { ratio: number; wcag: 'pass' | 'fail' }> = {
    // 本体ウィンドウ
    // PR 5-3 で文字を3段に整理した。**全段が4面すべてで 4.5:1 を満たす**
    'メタ情報の文字（サイドバー上）': { ratio: 6.07, wcag: 'pass' }, // 4.11 から。ようやく AA
    '状態ラベルの文字（あなたの番 / 作業中）': { ratio: 14.76, wcag: 'pass' },
    'CLI の生の値の文字（busy / idle）': { ratio: 6.07, wcag: 'pass' },
    一覧の主タイトルの文字: { ratio: 14.76, wcag: 'pass' },
    '非選択セグメントの文字（対トラック）': { ratio: 6.69, wcag: 'pass' },
    '選択中セグメントの文字（対ピル）': { ratio: 14.74, wcag: 'pass' },
    // **選択中タブの塗り（下の項目）と同じ、既知の限界。** --surface-2 と
    // --surface-3 は隣接する面の段なので、塗りだけでは 1.4.11 の 3:1 に届かない
    // （非選択との違いは主に文字色（6.69 -> 14.74）が担っている）。
    // 下線タブの選択状態と同じ「本当の解は塗り以外の手がかりを足すこと」が
    // ここにも当てはまるが、この PR のスコープ（K-6: 下線 -> セグメンテッド
    // コントロールへの置き換え）を超えるため次周の課題として残す。
    '選択中セグメントの塗り（対トラック）': { ratio: 1.08, wcag: 'fail' },
    非選択タブの文字: { ratio: 7.01, wcag: 'pass' },
    // **選択状態は、この塗りではなく Issue #119 周5 で足した下辺の線が担う。**
    // 塗りをどう選んでも 3:1 には届かない（明るくするとタブの文字が読めなくなる）ので、
    // 構造で解いた。白（--focus-ring）2px の `box-shadow: inset 0 -2px 0`。
    // **その線は S40 では測れない**（measureContrast は単一プロパティを色として
    // 解決する実装で、`box-shadow` は色以外の成分を持つ）。
    // `e2e/specs/S78-tab-state-and-selection.spec.ts` が線の色・形・比を固定している。
    // ここは「塗りだけでは足りない」という事実の記録として残す。
    '選択中タブの塗り（対タブバー）': { ratio: 1.23, wcag: 'fail' },
    '検索欄の枠（唯一の境界）': { ratio: 3.43, wcag: 'pass' }, // 1.51 から（PR 5-4）
    'あなたの番のドット（対ホバー面）': { ratio: 7.85, wcag: 'pass' },
    '作業中のドット（対ホバー面）': { ratio: 5.72, wcag: 'pass' },
    // Issue #20 PR 10（差し戻し後）: プロバイダの色相アクセントと終了マーク。
    //
    // **Issue #120（周6）で較正済み。** この4件はもともと WCAG の相対輝度式で
    // 手計算した値で、実機の getComputedStyle 実測に置き換わっていなかった。
    // 実際に走らせて確認したところ、**4件とも小数第2位まで手計算値と一致**した
    // （shell 5.13 / claude 4.27 / gemini 4.82 / 終了マーク 5.49）。
    //
    // **較正のために意図的に落とす必要は無い。** 下の console.log は
    // 成否に関わらず毎回実測値を出す（`issue-119/known-issues.md` は
    // 「落ちて初めて実測値がログに出る仕組み」と書いていたが、それは誤り）。
    // 期待値を更新したいときは、`--reporter=list` で走らせてログを読めばよい。
    //
    // 色は対 --surface-1（#1e1e1e）: shell #8a8f98, claude #c96442,
    // gemini #4a90c4, 終了マーク #d47b7b
    // （終了マークの色 --status-exited は既存トークンの値をそのまま使っている）。
    'シェルタブの色相の枠（対タブバー）': { ratio: 5.13, wcag: 'pass' },
    'claude タブの色相の枠（対タブバー）': { ratio: 4.27, wcag: 'pass' },
    'gemini タブの色相の枠（対タブバー）': { ratio: 4.82, wcag: 'pass' },
    '終了マークの塗り（先頭スロット・対タブバー）': { ratio: 5.49, wcag: 'pass' },
    // Issue #134（周1 characterization）: 同じ --status-exited #d47b7b でも、
    // **乗る面が --surface-tab-active #2e2e2e に変わると 5.49 -> 4.47 に落ちる。**
    // テキスト用途なので閾値は 4.5 で、**わずかに割っている**（`wcag: 'fail'`）。
    // 高コントラスト側はもっと悪い（#525252 の上で 2.57。S41 が固定している）。
    // **周3 で --status-exited を上げると、ここの2行が動く。**
    '終了したタブの文字（選択中・対 --surface-tab-active）': { ratio: 4.47, wcag: 'fail' },
    '終了バッジの文字（選択中・対 --surface-tab-active）': { ratio: 4.47, wcag: 'fail' },
    // **同じセレクタが、タブの選択状態で別の面に乗る**（非選択なら --surface-1 で
    // 5.49、選択中なら --surface-tab-active で 4.47）。非テキストなので既定側は
    // 3:1 を満たしているが、**高コントラストでは 2.57 まで落ちて割っていた**
    // （Issue #134 の本体の1つ。周3 で直した。S41 が高コントラスト側を測る）。
    '終了マークの塗り（選択中タブ上・対 --surface-tab-active）': { ratio: 4.47, wcag: 'pass' },
    // Issue #20 PR 11: 通知バナーの severity（情報 / エラー）。
    // 色相はエラー（赤系）と変えつつ、明度構成（暗い塗り・明るい文字・中間の枠）は
    // 揃えてある（design-rules.md の色覚シミュレーションの結論どおり、
    // 色相の変更だけでは1型/2型色覚下の区別に寄与しないため）。
    '通知バナー（情報）の文字': { ratio: 9.81, wcag: 'pass' },
    '通知バナー（情報）の枠（対 --surface-1）': { ratio: 6.45, wcag: 'pass' },
    '通知バナー（情報）のアイコン文字': { ratio: 7.12, wcag: 'pass' },
    '通知バナー（エラー）の文字': { ratio: 7.31, wcag: 'pass' },
    '通知バナー（エラー）の枠（対 --surface-1）': { ratio: 5.36, wcag: 'pass' },
    '通知バナー（エラー）のアイコン文字': { ratio: 5.92, wcag: 'pass' },
    // Issue #56 PR 5: アクティブペインのアクセント線（design-review.md 提案 C'）。
    // 既定は --accent をそのまま使う（--pane-active-accent が var(--accent) を
    // 参照しているだけなので、値は「選択中タブの色相アクセント」等と同じ #5b9cff）。
    'アクティブペインの枠線（対 --surface-1）': { ratio: 6.07, wcag: 'pass' },
    // Issue #56 PR 7: スプリッタの線。新しいトークンは作らず --border-control
    // をそのまま使う（design-review.md 提案 D'）。--surface-1 に対して 3:1 を
    // 満たす（他の --border-control 使用箇所と同じ設計判断）。
    'スプリッタの枠線（対 --surface-1）': { ratio: 3.88, wcag: 'pass' },
    // 設定ウィンドウ（最も明るい面）
    '設定の入力欄の枠（唯一の境界）': { ratio: 3.43, wcag: 'pass' }, // 1.30 から（PR 5-4）
    // 2.4.11。**アクセント色では 1.70 で満たせない**（PR 5-4 で枠を明るくしたため）
    'フォーカスリング（対 通常の枠）': { ratio: 4.29, wcag: 'pass' },
    設定の注記の文字: { ratio: 4.86, wcag: 'pass' }, // 3.29 から。**ここが一番厳しい面**
    設定の見出しの文字: { ratio: 11.81, wcag: 'pass' }, // 5.17 から（見出しを一段上げた）
    設定の値の文字: { ratio: 11.81, wcag: 'pass' }, // 9.18 から
  };

  const measured = { ...main, ...exitedActive, ...settings, ...focused };

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
  const thresholdFor = (name: string): number =>
    name.includes('塗り') || name.includes('枠') || name.includes('ドット')
      ? NON_TEXT_MIN
      : TEXT_MIN;

  for (const [name, { ratio, wcag }] of Object.entries(expected)) {
    if (wcag !== 'pass') continue;
    const min = thresholdFor(name);
    expect(measured[name], `${name} が WCAG の閾値を割った`).toBeGreaterThanOrEqual(min);
    expect(ratio).toBeGreaterThanOrEqual(min);
  }

  // **逆向きの検査。`wcag: 'fail'` の札が腐るのを防ぐ**（Issue #134 の design-review）。
  //
  // 上のループは `if (wcag !== 'pass') continue;` なので、値を直したときに
  // `ratio` だけ更新して `wcag: 'fail'` を残すと、**その項目は緑のまま
  // 閾値検査の外に出たきり戻ってこない**。是正したのに是正が守られない、という
  // 一番気づきにくい壊れ方をする。
  //
  // 「fail と書いてあるのに実測が閾値を満たしている」= 札の更新漏れ、として落とす。
  const staleFail = Object.entries(expected)
    .filter(([name, { wcag }]) => wcag === 'fail' && measured[name] >= thresholdFor(name))
    .map(([name]) => name);
  expect(
    staleFail,
    'WCAG を満たすようになったのに `wcag: \'fail\'` のままの項目がある。' +
      "'pass' に更新すること（そうしないと、この項目は以後どの閾値検査にも入らない）",
  ).toEqual([]);
});
