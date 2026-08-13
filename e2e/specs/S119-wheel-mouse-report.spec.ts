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
 * PTY へ届いたバイト列を画面に出すための一連のコマンド。
 *
 * - `stty -echo`: 端末ドライバのエコーを止める。**止めないと、送り込んだエスケープが
 *   そのまま xterm に解釈されてしまい、何が届いたのかを読めない。**
 * - 行編集（カノニカルモード）は**残す**。Enter を押した時点で1行ぶんが `head` へ渡るので、
 *   `stty raw` を使わずに「届いたバイト列」を確定できる。
 * - `head -1 | cat -v`: 1行だけ読んで `cat -v` に渡す。ESC が `^[` として可視化される。
 */
const PROBE_COMMAND = [
  'stty -echo',
  // 代替画面バッファへ入る。ここではマウス報告を要求しない。
  "printf '\\033[?1049h'",
  // 代替画面は入った時点で消去されるので、この目印が見えたら「入り終わった」と言える。
  "printf 'PHASE1\\n'",
  'head -1 | cat -v',
  "printf 'PHASE2\\n'",
  // マウス報告（VT200 + SGR）を要求する。claude / gemini が起動時に出すのと同じ組み合わせ。
  "printf '\\033[?1000h\\033[?1006h'",
  'head -1 | cat -v',
  // ⛔ **代替画面から抜ける後始末を書かない。** `?1049l` を出した瞬間に通常バッファへ
  // 戻り、**今まさに測ろうとしている出力ごと画面から消える**（それで一度落とした）。
  // 端末の後始末は `afterEach` のアプリ終了が引き受ける。
].join('; ');

test('S119 マウス報告を要求している画面では、ホイールを矢印キーに置き換えずマウス報告として送る', async () => {
  const { window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.type(PROBE_COMMAND, { delay: 5 });
  await window.keyboard.press('Enter');

  // 代替画面に入り終わるまで待つ。
  await expect(screen).toContainText('PHASE1', { timeout: 20_000 });

  const box = await screen.boundingBox();
  expect(box, 'ターミナルの矩形を取得できない').not.toBeNull();
  if (!box) return;
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  // --- 否定側: マウス報告を要求していない代替画面 -------------------------------
  // ここが緑にならないなら、ホイールがそもそも端末に届いていないか、#238 の変換ごと
  // 消えている。**この確認が無いと、下の肯定側は「何も送っていない」でも通ってしまう。**
  await window.mouse.move(centerX, centerY);
  await window.mouse.wheel(0, 100);
  await window.keyboard.press('Enter');

  // 矢印キーが**複数本**届く。DECCKM の状態で CSI 形（`^[[B`）と SS3 形（`^[OB`）の
  // どちらもありうるので両方を数える。
  //
  // ⛔ **「1本以上」で見ない。** カスタムハンドラを丸ごと外しても、xterm 自身の
  // フォールバック（スクロールバックを持たないバッファなら矢印を**1個**送る）が
  // 効くため、1本以上では緑のままになる（実際にそれで空振りした）。
  // #238 が直したのは「1ノッチで矢印1個」なので、**2本以上**が逆戻りの分かれ目。
  const countArrows = (text: string): number => (text.match(/\^\[(\[|O)[AB]/g) ?? []).length;

  await expect
    .poll(async () => countArrows(await screen.innerText()), {
      message:
        'マウス報告を要求していない代替画面で、ホイールが行数ぶんの矢印キーに変換されていない',
      timeout: 15_000,
    })
    .toBeGreaterThan(1);

  // --- 肯定側: マウス報告を要求している代替画面（Issue #251） --------------------
  await expect(screen).toContainText('PHASE2', { timeout: 15_000 });

  await window.mouse.move(centerX, centerY);
  await window.mouse.wheel(0, 100);
  await window.keyboard.press('Enter');

  // PHASE2 より後ろ = マウス報告を要求してから届いたバイト列だけを見る。
  const afterPhase2 = async (): Promise<string> => {
    const text = await screen.innerText();
    const index = text.lastIndexOf('PHASE2');
    return index === -1 ? '' : text.slice(index + 'PHASE2'.length);
  };

  // SGR 拡張のホイール報告（`ESC [ < 64|65 ; col ; row M`）。64 が上、65 が下。
  await expect
    .poll(async () => /\^\[\[<6[45];\d+;\d+M/.test(await afterPhase2()), {
      message:
        'マウス報告を要求している画面にホイールを送ったのに、SGR マウス報告が PTY へ届いていない',
      timeout: 15_000,
    })
    .toBe(true);

  // ⭐ **矢印を「も」送っていないこと。** 直す前はマウス報告の代わりに矢印だけが流れ、
  // CLI 側が「ホイールが矢印キーを送っている」と判定していた（Issue #251）。
  expect(countArrows(await afterPhase2()), 'マウス報告を要求している画面に、矢印キーが送られている').toBe(
    0,
  );
});
