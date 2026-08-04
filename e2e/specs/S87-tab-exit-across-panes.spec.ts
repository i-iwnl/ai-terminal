import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/** 正規表現の特殊文字をエスケープする（workDir のディレクトリ名をそのままパターン化するため） */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Issue #142（#160 の周1 で関門として作り、周2 で期待値を反転させた）。
 *
 * タブの終了表示（4箇所）が、分割したタブの中で**どのペインが終了しているか**に
 * どう反応するかを固定する。**確定仕様は `every`**
 * （`.claude/workspace/issue-56/design-review.md:81`「タブの終了バッジは
 * 全 leaf が終了したときだけ出す」）。
 *
 * | 状態 | 直す前（`tabLeaf(tab).exit` = アクティブな leaf） | いま（`tabAllPanesExited`） |
 * |---|---|---|
 * | 終了したペインがアクティブ / もう1枚は生きている | 終了を出す | **出さない** |
 * | 生きているペインがアクティブ / もう1枚が終了 | 出さない | 出さない |
 * | 両方とも終了 | 出す | 出す |
 *
 * 直す前の挙動は `every` でも `some` でもない**第三の挙動**で、木の中身が1つも
 * 変わらないのに `Cmd+]` を押すだけで表示が付いたり消えたりしていた。
 *
 * **この spec は #142 を直す前に書いた**（#160 の周1）。実測したところ
 * 「片方だけ exit / 両方 exit」を見るテストは e2e にも unit にも1本も無く、
 * `every` に変えても `some` に変えても `make e2e` は全部 green のままだった。
 * **関門が無い状態で挙動を変えても、通ったことが何の担保にもならない**
 * （loop.md「壊してみて赤くなるか」）。周1 の時点でケース1 は逆の期待値で green、
 * `every` 化した瞬間に赤くなることを実測してから、この周で反転させている。
 *
 * 3つのケースを全部書くのが要点で、これで**3つの挙動が互いに区別できる**:
 *
 * - ケース1 は `every`（0枚）と直す前・`some`（1枚）を分ける
 * - ケース2 は `some`（1枚）と直す前・`every`（0枚）を分ける
 * - ケース3 は3者とも1枚で、**「常に出さない」に倒れていない**ことを見る
 *
 * `some` にしてはいけない理由は `TabBar.tsx` のコメントが持っている
 * （終了を優先するので、「claude があなたの番 + 隣の zsh を exit した」タブから
 * 「あなたの番」のドットが消える）。ケース2 がその退行に赤くなる。
 *
 * 4箇所すべてを見るのは、判定の参照が `TabBar.tsx` に4つあり、
 * **一部だけ直すと同じ画面の中で表示が食い違う**ため。
 */
test('S87 分割したタブの終了表示が、どのペインが終了しているかで決まる', async () => {
  const { window, workDir } = launched;

  const cwdName = workDir.split('/').pop() as string;
  const promptPattern = new RegExp(`${escapeRegExp(cwdName)}\\s*[%#]`);

  const tabs = window.locator('.tab-bar__tab');
  const panes = window.locator('.terminal-pane');
  const activeScreen = window.locator('.terminal-pane.is-active .xterm-screen');
  const activeHelper = window.locator('.terminal-pane.is-active .xterm-helper-textarea');

  // タブ側の「終了」の出方4箇所（TabBar.tsx の leaf.exit 参照と1:1）。
  const exitedTab = window.locator('.tab-bar__tab.is-exited');
  const abnormalTab = window.locator('.tab-bar__tab.is-exited-abnormal');
  const exitedSlot = window.locator('.tab-bar__state-slot--exited');
  const exitedBadge = window.locator('.tab-bar__exit-badge');
  const exitedInLabel = window.locator('.tab-bar__tab-button[aria-label*="終了"]');

  /**
   * 終了表示の出方を、**枚数で**見る。
   *
   * Issue #166 で severity が入り、**層ごとに出る条件が変わった**:
   *
   * | 層 | 正常終了 | 異常終了 |
   * |---|---|---|
   * | `.is-exited`（文字色の門）/ バッジ / 読み上げ | 出る | 出る |
   * | `.is-exited-abnormal`（赤）/ 状態スロットの四角 | **出ない** | 出る |
   *
   * 「揃って 0 / 揃って 1」ではなくなったので、**どの層が何枚かを個別に渡す**。
   * 四角を正常終了でも出す実装に戻すと `slot` が合わなくなって落ちる。
   */
  const expectExitCounts = async (
    what: string,
    counts: { exited: number; abnormal: number },
  ): Promise<void> => {
    await expect(exitedTab, `${what}: 終了したタブ（.is-exited）`).toHaveCount(counts.exited, {
      timeout: 15_000,
    });
    await expect(abnormalTab, `${what}: 異常終了したタブ（.is-exited-abnormal）`).toHaveCount(
      counts.abnormal,
    );
    await expect(exitedSlot, `${what}: 状態スロットの四角（異常終了だけ）`).toHaveCount(
      counts.abnormal,
    );
    await expect(exitedBadge, `${what}: 可視の終了バッジ`).toHaveCount(counts.exited);
    await expect(exitedInLabel, `${what}: 読み上げ（aria-label）`).toHaveCount(counts.exited);
  };

  const expectExitShown = async (shown: boolean, what: string): Promise<void> => {
    // 正常終了（この spec のケース1〜3 はすべて `exit` = コード 0）。
    await expectExitCounts(what, { exited: shown ? 1 : 0, abnormal: 0 });
  };

  // --- 起動直後: 1タブ1ペイン。終了はどこにも出ていない -----------------------
  await expect(tabs).toHaveCount(1);
  await expect(panes).toHaveCount(1);
  await expect(activeScreen).toContainText(promptPattern, { timeout: 20_000 });
  await expectExitShown(false, '起動直後');

  // --- Cmd+D で分割。アクティブは新しいペイン（B）------------------------------
  await window.keyboard.press('Meta+d');
  await expect(panes).toHaveCount(2);
  await expect(tabs).toHaveCount(1);
  await expect(activeScreen).toContainText(promptPattern, { timeout: 20_000 });

  // --- ケース1: アクティブなペイン（B）だけを終了させる ------------------------
  //
  // **もう1枚（A）のシェルは生きていて、タブを押せば入力できる。** だから
  // タブに「終了」を出してはいけない。直す前はアクティブな leaf しか
  // 見ていなかったので「出す」だった（周1 はその値で green だった）。
  await activeHelper.focus();
  await window.keyboard.type('exit');
  await window.keyboard.press('Enter');
  // ペインの終了行（S55 が文言そのものを固定している）が出るまで待つ。
  // タブ側の表示だけを poll すると、まだ exit が届いていない状態を
  // 「出ていない」と読み違える。
  await expect(activeScreen).toContainText('[プロセスは', { timeout: 20_000 });
  await expect(panes).toHaveCount(2);
  await expectExitShown(false, 'ケース1: 終了したペインがアクティブ・もう1枚は生存');

  // --- ケース2: 生きているペイン（A）へ移る -----------------------------------
  //
  // 木の中身は1つも変わらず、**アクティブなペインが変わっただけ**。
  // ケース1 と同じ答え（出さない）になることが、判定がアクティブなペインに
  // 依存していないことの証拠。直す前はここで表示が消えていた（同じ木なのに
  // `Cmd+]` で表示が変わる）。
  // `some`（いずれかが終了したら出す）にすると、ここが1枚になって赤くなる。
  await window.keyboard.press('Meta+]');
  await expect(window.locator('.terminal-pane.is-active .xterm-screen')).not.toContainText(
    '[プロセスは',
    { timeout: 15_000 },
  );
  await expectExitShown(false, 'ケース2: 生きているペインがアクティブ・もう1枚が終了');

  // --- ケース3: 残りのペイン（A）も終了させる ---------------------------------
  //
  // 全 leaf が終了した状態。**直す前・`some`・`every` のどれでも「出す」**なので、
  // ここは周2 の前後で動かない（`every` 化が「常に出さない」に倒れていないことの検査）。
  await activeHelper.focus();
  await window.keyboard.type('exit');
  await window.keyboard.press('Enter');
  await expect(activeScreen).toContainText('[プロセスは', { timeout: 20_000 });
  await expect(panes).toHaveCount(2);
  await expectExitShown(true, 'ケース3: 両方のペインが正常終了');

  // --- ケース4: 新しいタブを分割し、片方だけ異常終了させる（Issue #166）--------
  //
  // **`some` 集約の関門。** 全ペインが終了していて、そのうち1枚でも異常なら
  // タブは異常終了になる。`every` にすると `abnormal` が 0 のままになって落ちる。
  //
  // あわせて**層ごとの出方の差**もここで固定される: 終了したタブは2枚あるのに
  // 状態スロットの四角は1つしか無い（正常終了は塗らない）。
  //
  // ⛔ ここから先はタブが2枚になるので、`.terminal-pane.is-active` は使えない。
  // `visible` はタブ単位・`active` はペイン単位なので、**非表示タブの中にも
  // `.is-active` なペインが1枚ある**（PaneTreeView.tsx の `visible={props.tabVisible}`）。
  // 「いま画面に出ているアクティブなペイン」は `:not(--hidden)` と併せて特定する。
  const shownActive = window.locator('.terminal-pane:not(.terminal-pane--hidden).is-active');
  const shownActiveScreen = shownActive.locator('.xterm-screen');
  const shownActiveHelper = shownActive.locator('.xterm-helper-textarea');

  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(2);
  await expect(shownActiveScreen).toContainText(promptPattern, { timeout: 20_000 });

  await window.keyboard.press('Meta+d');
  // ⛔ **分割が DOM に反映されるまで待つ。** これが無いと、`Meta+d` の直後は
  // まだ分割前のペインが `.is-active` のままで、`shownActiveScreen` の
  // プロンプト待ちが**そちらで即座に通ってしまう**。その状態で focus + type すると
  // 入力は分割前のペインに入り、あとで `.is-active` が新しいペインへ移った時点で
  // 「打ったはずの文字がどこにも無い」ように見える（実際にそれで落ちた）。
  await expect(window.locator('.terminal-pane:not(.terminal-pane--hidden)')).toHaveCount(2, {
    timeout: 15_000,
  });
  await expect(shownActiveScreen).toContainText(promptPattern, { timeout: 20_000 });

  // アクティブなペイン（新しい側）を **0 以外のコード**で終了させる。
  await shownActiveHelper.focus();
  await window.keyboard.type('exit 7');
  await window.keyboard.press('Enter');
  await expect(shownActiveScreen).toContainText('[プロセスは', { timeout: 20_000 });
  // まだ片方が生きているので、タブには何も出ない（ケース1 と同じ形）。
  // 1枚目のタブ（ケース3 で正常終了済み）のぶんだけが数えられる。
  await expectExitCounts('ケース4a: 片方が異常終了・もう1枚は生存', { exited: 1, abnormal: 0 });

  // 残りのペインを**正常に**終了させる。全 leaf が終了し、うち1枚が異常。
  await window.keyboard.press('Meta+]');
  await expect(shownActiveScreen).not.toContainText('[プロセスは', { timeout: 15_000 });
  await shownActiveHelper.focus();
  await window.keyboard.type('exit');
  await window.keyboard.press('Enter');
  await expect(shownActiveScreen).toContainText('[プロセスは', { timeout: 20_000 });
  await expectExitCounts('ケース4b: 正常終了と異常終了が同居したタブ', {
    exited: 2,
    abnormal: 1,
  });
});
