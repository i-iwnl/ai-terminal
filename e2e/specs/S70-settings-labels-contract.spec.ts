import { test, expect } from '@playwright/test';
import { launchApp, closeApp, openSettingsWindow, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * 設定ウィンドウの**セクション見出しと項目ラベルの文字列そのもの**を、
 * DOM の出現順ごと固定する。
 *
 * なぜ要るか。設定ウィンドウの情報設計（セクション構成と文言）を変える作業に、
 * **判定できる関門が1本も無かった**:
 *
 * - セクション見出し（当時は `表示` / `通知` / `Slack / Discord への転送` /
 *   `アクセシビリティ` / `動作`）を assert している spec は 0 本
 * - 項目ラベルのうち `tmux が使えるなら AI CLI をラップする` と
 *   `ポーリング間隔(ms)` を引いている spec は 0 本
 * - `toBeDisabled()` / `aria-disabled` を見る spec も e2e 全体で 0 本
 *
 * つまり**見出しを改名しても、セクションを丸ごと消しても、フル実行は green のまま
 * main に入る**。S40（コントラスト比）が配色に対してやっているのと同じことを、
 * 文言と構成に対してやる。
 *
 * **このテストは characterization テストである。** 期待値は「あるべき文言」ではなく
 * **「いまそうなっている文言」**。文言を変える PR では、このファイルの diff に
 * `'動作' -> '動作中の AI'` のような変化が現れ、**それがレビュー資料になる**
 * （PR 13-b が実際にこの形で、節の改名・並べ替え・文言差し替えを1本の diff にした）。
 * 情報設計をやり直す周では、ここの配列を更新するのが作業の一部になる。
 *
 * S40 から持ち込んだ設計:
 * **測れなかった項目を「合格」にしない。** 見出しの集合の一致を先に検査してから
 * 順序と中身を見る。セレクタが変わって0件になったとき、静かに素通りするのが
 * 最悪の壊れ方（`for` ループが1回も回らずに green になる）。
 */

/** 1セクション分の測定結果。heading は `.settings__heading`、labels は行の見出し文字。 */
interface SettingsSection {
  heading: string;
  labels: string[];
}

test('S70 設定ウィンドウの見出しと項目ラベルが、記録した文字列から動いていない', async () => {
  const { window } = launched;

  // 設定は独立した BrowserWindow。開き方は S31 / S32 と同じ手順に揃える。
  const dialog = await openSettingsWindow(launched, () =>
    window.locator('button[aria-label="設定を開く"]').click(),
  );
  await expect(dialog.locator('.settings__section').first()).toBeVisible();

  // DOM の出現順のまま読み出す。
  //
  // 「項目ラベル」として拾うのは `.settings__row` の直下の <span>。この DOM では
  // 2種類あり、どちらもその行が何の設定かを示す文字になっている:
  //   - ラベル + 入力欄の行 -> `.settings__label`（例: フォント / 更新間隔（ミリ秒））
  //   - チェックボックスの行 -> クラスの無い <span>（例: 音を鳴らす）
  // 節の説明文（`.settings__note`）は <p> なので、ここには入らない
  // （通知トグルへの依存を書いた注記は項目ラベルではない）。
  // `.settings__status`（テスト送信の結果表示）だけは設定項目ではないので除く
  // （このシナリオでは送信しないので出ないが、除外を明示して意図を残す）。
  const measured = await dialog.locator('.settings--window').evaluate((root): SettingsSection[] =>
    Array.from(root.querySelectorAll('.settings__section')).map((section) => ({
      heading: section.querySelector('.settings__heading')?.textContent?.trim() ?? '',
      labels: Array.from(
        section.querySelectorAll('.settings__row > span:not(.settings__status)'),
      ).map((el) => el.textContent?.trim() ?? ''),
    })),
  );

  // 記録した文字列。**「あるべき値」ではなく「いまそうなっている値」。**
  const expected: SettingsSection[] = [
    { heading: '外観', labels: ['フォント', 'サイズ'] },
    {
      heading: '動作中の AI',
      labels: [
        'アプリを閉じても AI の作業を続ける（tmux が必要）',
        'このフォルダのものだけ表示する',
        '更新間隔（ミリ秒）',
      ],
    },
    {
      heading: '通知',
      labels: ['タスクの完了時に通知する', '音を鳴らす', '音の種類'],
    },
    {
      heading: 'Slack / Discord への転送',
      labels: ['Slack に送る', 'Discord に送る'],
    },
    {
      heading: 'アクセシビリティ',
      labels: ['ターミナルの内容をスクリーンリーダーから読めるようにする'],
    },
  ];

  // 記録を更新するときに読む。落ちたときに「実際は何だったか」がレポートに残るので、
  // 期待値の書き換えが推測にならない（S40 と同じ運用）。
  console.log(
    '[S70] 実測:\n' +
      measured.map((s) => `  ${s.heading}: ${s.labels.join(' / ')}`).join('\n'),
  );

  const measuredHeadings = measured.map((s) => s.heading);
  const expectedHeadings = expected.map((s) => s.heading);

  // 1. 見出しの集合が一致すること。**順序より先にこれを見る。**
  //    セクションが1つ消えた / 改名された / セレクタが変わって0件になった、の
  //    いずれでも必ずここで落ちる（測れなかった項目が合格に化けない）。
  expect(
    [...measuredHeadings].sort(),
    'セクション見出しの集合が記録と違う（追加・削除・改名、またはセレクタの変更）',
  ).toEqual([...expectedHeadings].sort());

  // 2. 出現順まで一致すること。並べ替えは見た目の情報設計そのものなので固定する。
  expect(measuredHeadings, 'セクション見出しの出現順が記録から動いている').toEqual(
    expectedHeadings,
  );

  // 3. 各セクションの項目ラベル。ここも先にキー集合を突き合わせてから中身を見る。
  const measuredByHeading = Object.fromEntries(measured.map((s) => [s.heading, s.labels]));
  const expectedByHeading = Object.fromEntries(expected.map((s) => [s.heading, s.labels]));
  expect(Object.keys(measuredByHeading).sort()).toEqual(Object.keys(expectedByHeading).sort());

  for (const [heading, labels] of Object.entries(expectedByHeading)) {
    expect(
      measuredByHeading[heading],
      `「${heading}」の項目ラベルが記録から動いている`,
    ).toEqual(labels);
  }

  // 4. 数値入力の2つが、**ラベルの文字で一意に引けること。**
  //
  //    `input[type="number"]` は「サイズ」と「更新間隔（ミリ秒）」の2つあり、
  //    `.first()` で引くと DOM の順序に依存する（S31 が実際にそうなっていた）。
  //    順序に依存しないロケータが成立する条件は「行の <label> が入力欄を内包して
  //    いること」で、これは DOM 構造の性質であって上の文字列比較では守れない
  //    （`.settings__row` を <label> から <div> に変えても、文字列だけなら一致する）。
  //    ラベルとの関連付けが切れたら、ここで落ちる。
  await expect(dialog.getByLabel('サイズ')).toHaveAttribute('type', 'number');
  await expect(dialog.getByLabel('更新間隔（ミリ秒）')).toHaveAttribute('type', 'number');
});
