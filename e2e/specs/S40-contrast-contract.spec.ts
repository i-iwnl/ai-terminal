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
    '一覧の主タイトルの文字': { ratio: 14.76, wcag: 'pass' },
    '非選択タブの文字': { ratio: 7.01, wcag: 'pass' },
    // **PR 5-4 の時点で、閾値を満たしていない項目はこの1つだけになった。**
    // 選択状態が塗りだけで表現されており、塗りをどう選んでも 3:1 には届かない
    // （面を離すと他のトークンの余裕が飛ぶ）。**下線を足すのが本当の解**で、次周の必須項目。
    '選択中タブの塗り（対タブバー）': { ratio: 1.23, wcag: 'fail' },
    '検索欄の枠（唯一の境界）': { ratio: 3.43, wcag: 'pass' }, // 1.51 から（PR 5-4）
    '作業中のドット（対ホバー面）': { ratio: 5.72, wcag: 'pass' },
    // Issue #20 PR 10（差し戻し後）: プロバイダの色相アクセントと終了マーク。
    // **この4件は WCAG の相対輝度式で手計算した値であり、実機の
    // getComputedStyle 実測ではない。** このファイルの他の値と同じ運用
    // （このテストを実際に一度走らせ、失敗時にログへ出る実測値へ更新する）
    // での較正がまだ済んでいない。次に S40 を実行する人は、ここを
    // 実測値へ置き換えること。
    // 対 --surface-1（#1e1e1e）での手計算: shell #8a8f98 = 5.13,
    // claude #c96442 = 4.27, gemini #4a90c4 = 4.82, 終了マーク #d47b7b = 5.49
    // （終了マークの色 --status-exited は既存トークンの値をそのまま使っている）。
    'シェルタブの色相の枠（対タブバー）': { ratio: 5.13, wcag: 'pass' },
    'claude タブの色相の枠（対タブバー）': { ratio: 4.27, wcag: 'pass' },
    'gemini タブの色相の枠（対タブバー）': { ratio: 4.82, wcag: 'pass' },
    '終了マークの塗り（先頭スロット・対タブバー）': { ratio: 5.49, wcag: 'pass' },
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
    '設定の注記の文字': { ratio: 4.86, wcag: 'pass' }, // 3.29 から。**ここが一番厳しい面**
    '設定の見出しの文字': { ratio: 11.81, wcag: 'pass' }, // 5.17 から（見出しを一段上げた）
    '設定の値の文字': { ratio: 11.81, wcag: 'pass' }, // 9.18 から
  };

  const measured = { ...main, ...settings, ...focused };

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
