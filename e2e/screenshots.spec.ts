import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { launchApp, closeApp, openSettingsWindow, type LaunchedApp } from './fixtures/harness';

/**
 * README の「使い方ガイド」用スクリーンショットの撮影スクリプト。
 *
 * e2e/scenarios.yml の readme: true な11シナリオについて、対応する spec と同じ
 * 手順でハーネス（隔離 HOME + 偽 CLI）越しにアプリの画面状態を作り、docs/images/
 * に screenshot: で指定されたファイル名で保存する。
 *
 * 通常の `make e2e`（testDir: ./e2e/specs）には含まれない。実行は
 * `make e2e-screenshots`（e2e/screenshots.playwright.config.ts 経由）。
 *
 * 注釈は画像処理ライブラリを使わず、撮影直前に page.evaluate() で DOM
 * オーバーレイ（角丸四角の番号バッジ・対象を囲む枠線・日本語キャプション）を
 * 注入し、撮影後に取り除く方式。
 */

// package.json が "type": "module" のため __dirname は使えない
const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const IMAGES_DIR = join(REPO_ROOT, 'docs', 'images');
// README に貼る画像の統一横幅。撮影環境が Retina だと screenshot() は
// devicePixelRatio 分だけ大きいピクセル数になるため、撮影後に縮小する。
const TARGET_WIDTH = 1200;

mkdirSync(IMAGES_DIR, { recursive: true });

/** 注釈1件分。対象要素は selector + index、または selector + text（部分/完全一致）で指定する */
interface Annotation {
  selector: string;
  /** selector にマッチする要素が複数あるとき、何番目を対象にするか（既定0） */
  index?: number;
  /** 指定すると、selector にマッチする要素の中から textContent がこれを含む（exact なら完全一致）ものを探す */
  text?: string;
  exact?: boolean;
  /** バッジに出す番号 */
  number: number;
  /** 日本語キャプション（対象を隠さないよう短い1〜2行にする） */
  caption: string;
  /**
   * キャプションを対象のどちら側に置くか。
   * 同じ画面に複数の注釈があるとき、対象そのものや隣の注釈を覆わないよう
   * 呼び出し側でレイアウトを見て選ぶ（既定 'below'）。
   */
  side?: 'right' | 'below' | 'above';
}

/**
 * 撮影直前に呼ぶ。DOM に注釈オーバーレイを注入し、スクリーンショットを撮り、
 * 注釈を取り除いてから、ファイルを横幅 TARGET_WIDTH に縮小する。
 */
async function annotateAndShoot(
  window: Page,
  fileName: string,
  annotations: Annotation[],
  /**
   * 保存時の横幅。既定は本体ウィンドウ用の 1200。
   * 設定ウィンドウのように元が狭い画面は、1200 に合わせると引き伸ばしになって
   * 文字がぼやけるため、実寸に近い値を明示する。
   */
  targetWidth: number = TARGET_WIDTH,
): Promise<void> {
  // xterm.js が本来オフスクリーン/不可視の想定で使う内部要素が、
  // --disable-gpu の DOM レンダラでは可視状態のまま描画されてしまうことがある。
  // - .xterm-width-cache-measure-container（unicode-graphemes の幅計測用）:
  //   "%%%%..." のような文字の並びが terminal 領域の先頭に写り込む。
  // - .xterm-helper-textarea（IME/キー入力を拾うための隠しテキストエリア）:
  //   position: static のままブラウザ既定の枠付きボックスとして描画され、
  //   小さな四角として写り込む。
  // どちらもアプリのコードは一切変更せず、撮影直前だけ visibility を隠して撮り、
  // 撮影後に元へ戻す（注釈レイヤーの注入・撤去と同じ方式）。
  await window.evaluate(() => {
    const nodes = document.querySelectorAll<HTMLElement>(
      '.xterm-width-cache-measure-container, .xterm-helper-textarea',
    );
    nodes.forEach((node) => {
      node.dataset.e2eHiddenForScreenshot = '1';
      // visibility: hidden ではなく opacity: 0 を使う。
      //
      // visibility: hidden を当てた要素はフォーカスを保持できず、ブラウザが
      // 非同期に blur する。.xterm-helper-textarea は IME の入力を受ける要素なので、
      // blur されると composition が終了し、.composition-view から変換中の文字列が
      // 消える。実際に S22 の画像は「枠の中が空」の状態で撮れていた（Issue #10）。
      // 実測では hide 直後はまだ残っており、数百ミリ秒後に display: none になる。
      // opacity: 0 ならフォーカスを保ったまま画像から消せる。
      node.style.opacity = '0';
    });
  });

  await window.evaluate((items) => {
    const ACCENT = '#5b9dff';
    const FONT = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif';

    const layer = document.createElement('div');
    layer.id = '__e2e_annotation_layer__';
    Object.assign(layer.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483000',
      pointerEvents: 'none',
    });
    document.body.appendChild(layer);

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const BADGE_SIZE = 22;
    const GAP = 4;

    type Box = { left: number; top: number; right: number; bottom: number };
    const overlaps = (a: Box, b: Box): boolean =>
      !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);

    // 1パス目: 全項目の対象要素と矩形を先に解決しておく。
    // 端末の行は行間なく詰んで並ぶ（行の高さ15pxに対しバッジは22px角）ため、
    // 隣接する行を指す2つの注釈のバッジが同じ「対象の上」に配置されると
    // 重なって片方が完全に隠れてしまう（実測で確認済み）。
    // バッジを置く位置を選ぶとき、他の注釈の対象矩形・既に置いたバッジと
    // 衝突しない位置を選べるよう、先に全対象の矩形を集めておく。
    // 対象の直前・直後の兄弟要素で、実際に文字を持つものの矩形。
    // 端末の行やリスト項目は隙間なく並ぶため、above/below のどちら側に
    // バッジを置いても常に隣接要素の帯と数px重なる（行の高さ15pxに対し
    // バッジは22px角）。隣接要素が空行なら重なっても実害はないが、文字を
    // 持つ隣接要素（別の行のテキストやリストの次項目）に重なると、その
    // 文字を隠してしまう（S09 で FAKE CLAUDE READY が、S01 でタスク項目の
    // 時刻表示が隠れる形で実測）。そのため文字を持つ隣接要素だけを
    // バッジ配置の衝突対象として扱う。
    const hasVisibleText = (el: Element | null): el is HTMLElement =>
      el !== null && (el.textContent ?? '').trim().length > 0;

    const resolved: Array<{ item: (typeof items)[number]; rect: DOMRect; neighbors: Box[] }> = [];
    for (const item of items) {
      const candidates = Array.from(document.querySelectorAll(item.selector)) as HTMLElement[];
      let target: HTMLElement | undefined;
      if (item.text !== undefined) {
        target = candidates.find((node) => {
          const text = (node.textContent ?? '').trim();
          return item.exact ? text === item.text : text.includes(item.text as string);
        });
      } else {
        const index = item.index ?? 0;
        // 負のインデックスは末尾から数える（-1 = 最後の要素）
        target = candidates[index < 0 ? candidates.length + index : index];
      }
      if (!target) continue;
      const neighbors: Box[] = [target.previousElementSibling, target.nextElementSibling]
        .filter(hasVisibleText)
        .map((el) => el.getBoundingClientRect());
      resolved.push({ item, rect: target.getBoundingClientRect(), neighbors });
    }

    const targetBoxes: Box[] = resolved.map(({ rect }) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    }));
    const placedBadgeBoxes: Box[] = [];

    for (let i = 0; i < resolved.length; i += 1) {
      const { item, rect, neighbors } = resolved[i];

      // 対象を囲む角丸の枠線（ビューポート端で切れないようクランプする）
      const outlineLeft = Math.max(2, rect.left - 4);
      const outlineTop = Math.max(2, rect.top - 4);
      const outlineRight = Math.min(viewportWidth - 2, rect.right + 4);
      const outlineBottom = Math.min(viewportHeight - 2, rect.bottom + 4);
      const outline = document.createElement('div');
      Object.assign(outline.style, {
        position: 'fixed',
        left: `${outlineLeft}px`,
        top: `${outlineTop}px`,
        width: `${outlineRight - outlineLeft}px`,
        height: `${outlineBottom - outlineTop}px`,
        border: `2px solid ${ACCENT}`,
        borderRadius: '6px',
        boxShadow: '0 0 0 3px rgba(91, 157, 255, 0.25)',
        boxSizing: 'border-box',
      });
      layer.appendChild(outline);

      // 番号バッジ（角丸の四角。丸囲み数字は機種依存文字なので使わない）
      const badge = document.createElement('div');
      badge.textContent = String(item.number);
      Object.assign(badge.style, {
        position: 'fixed',
        width: '22px',
        height: '22px',
        background: ACCENT,
        color: '#0b1220',
        fontFamily: FONT,
        fontWeight: '700',
        fontSize: '12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '5px',
        boxShadow: '0 2px 6px rgba(0, 0, 0, 0.6)',
      });
      // バッジは対象の文字を隠さないよう、対象の外側に置く。
      // 呼び出し側が指定した side（キャプションをどちらに置くか）を優先候補にする。
      // 行間なく詰んだ端末の行に対して常に「上」を優先すると、side: 'below' の
      // つもりの注釈でも対象のさらに上（＝別の行のテキスト）に被ってしまう
      // （S09 で FAKE CLAUDE READY 行が隠れる形で実測）。
      // 加えて、他の注釈の対象矩形や既に置いたバッジと重ならない候補を選ぶ
      // （隣接する行を指す注釈同士でバッジが重なって片方が消えるのを防ぐ）。
      type BadgePlace = 'above' | 'left' | 'right' | 'below';
      const placeMakers: Record<BadgePlace, () => { left: number; top: number } | undefined> = {
        above: () =>
          rect.top - GAP - BADGE_SIZE >= 2
            ? {
                left: Math.max(2, Math.min(rect.left, viewportWidth - BADGE_SIZE - 2)),
                top: rect.top - GAP - BADGE_SIZE,
              }
            : undefined,
        left: () =>
          rect.left - GAP - BADGE_SIZE >= 2
            ? {
                left: rect.left - GAP - BADGE_SIZE,
                top: Math.max(2, Math.min(rect.top, viewportHeight - BADGE_SIZE - 2)),
              }
            : undefined,
        // 右は常にビューポート内にクランプして置ける（ビューポート左端に接する要素向けの最終手段）
        right: () => ({
          left: Math.min(rect.right + GAP, viewportWidth - BADGE_SIZE - 2),
          top: Math.max(2, Math.min(rect.top, viewportHeight - BADGE_SIZE - 2)),
        }),
        below: () =>
          rect.bottom + GAP + BADGE_SIZE <= viewportHeight - 2
            ? {
                left: Math.max(2, Math.min(rect.left, viewportWidth - BADGE_SIZE - 2)),
                top: rect.bottom + GAP,
              }
            : undefined,
      };

      const effectiveSide = item.side ?? 'below';
      const placeOrder: BadgePlace[] =
        effectiveSide === 'below'
          ? ['below', 'above', 'left', 'right']
          : effectiveSide === 'right'
            ? ['right', 'above', 'left', 'below']
            : ['above', 'left', 'right', 'below'];

      const candidatePositions: Array<{ left: number; top: number; place: BadgePlace }> = [];
      for (const place of placeOrder) {
        const pos = placeMakers[place]();
        if (pos) candidatePositions.push({ ...pos, place });
      }

      const blockers = [
        ...targetBoxes.filter((_, index) => index !== i),
        ...placedBadgeBoxes,
        ...neighbors,
      ];
      const chosen =
        candidatePositions.find((pos) => {
          const box: Box = {
            left: pos.left,
            top: pos.top,
            right: pos.left + BADGE_SIZE,
            bottom: pos.top + BADGE_SIZE,
          };
          return !blockers.some((blocker) => overlaps(box, blocker));
        }) ?? candidatePositions[0];

      const badgeLeft = chosen.left;
      const badgeTop = chosen.top;
      const badgePlace = chosen.place;
      placedBadgeBoxes.push({
        left: badgeLeft,
        top: badgeTop,
        right: badgeLeft + BADGE_SIZE,
        bottom: badgeTop + BADGE_SIZE,
      });
      badge.style.left = `${badgeLeft}px`;
      badge.style.top = `${badgeTop}px`;
      layer.appendChild(badge);

      // キャプション。呼び出し側が指定した side に沿って、対象を覆わない位置に置く。
      const caption = document.createElement('div');
      caption.textContent = item.caption;
      Object.assign(caption.style, {
        position: 'fixed',
        visibility: 'hidden',
        maxWidth: '220px',
        background: '#12172a',
        color: '#eaf1ff',
        border: `1px solid ${ACCENT}`,
        borderRadius: '6px',
        padding: '5px 8px',
        fontFamily: FONT,
        fontSize: '11px',
        lineHeight: '1.5',
        whiteSpace: 'nowrap',
        boxShadow: '0 4px 10px rgba(0, 0, 0, 0.5)',
      });
      layer.appendChild(caption);
      const captionRect = caption.getBoundingClientRect();

      const side = item.side ?? 'below';
      let captionLeft: number;
      let captionTop: number;
      if (side === 'right') {
        // バッジが（衝突回避の結果）対象の左側や上側に回ったときでも、
        // キャプションが対象そのものに被らないよう、バッジと対象のうち
        // より右にある方を基準にする。
        captionLeft = Math.max(badgeLeft + BADGE_SIZE, rect.right) + GAP + 2;
        captionTop = badgeTop;
        if (captionLeft + captionRect.width > viewportWidth - 8) {
          // 右に入らない場合は下に回す
          captionLeft = Math.max(8, Math.min(rect.left, viewportWidth - captionRect.width - 8));
          captionTop = rect.bottom + 10;
        }
      } else if (side === 'above') {
        captionLeft = Math.max(8, Math.min(rect.left, viewportWidth - captionRect.width - 8));
        // バッジも対象の上に置かれている場合、対象の上端基準だと行の高さが
        // 小さいときにキャプションとバッジが重なる（バッジが隠れる）ことがある。
        // その場合はバッジのさらに上に積む。
        captionTop =
          badgePlace === 'above'
            ? badgeTop - captionRect.height - GAP
            : rect.top - captionRect.height - 10;
      } else {
        captionLeft = Math.max(8, Math.min(rect.left, viewportWidth - captionRect.width - 8));
        // 同様に、バッジが対象の下に置かれている場合はバッジのさらに下に積む。
        captionTop = badgePlace === 'below' ? badgeTop + BADGE_SIZE + GAP : rect.bottom + 10;
      }
      captionTop = Math.max(8, Math.min(captionTop, viewportHeight - captionRect.height - 8));
      caption.style.left = `${captionLeft}px`;
      caption.style.top = `${captionTop}px`;
      caption.style.visibility = 'visible';
    }
  }, annotations);

  const filePath = join(IMAGES_DIR, fileName);
  await window.screenshot({ path: filePath });

  await window.evaluate(() => {
    document.getElementById('__e2e_annotation_layer__')?.remove();
    const nodes = document.querySelectorAll<HTMLElement>(
      '[data-e2e-hidden-for-screenshot="1"]',
    );
    nodes.forEach((node) => {
      node.style.opacity = '';
      delete node.dataset.e2eHiddenForScreenshot;
    });
  });

  // Retina 環境では devicePixelRatio 分だけ大きいピクセル数で保存されるため、
  // 画像処理ライブラリを追加せず、macOS 標準の sips で横幅を統一する
  // （ファイルサイズも比例して小さくなる）。
  execFileSync('sips', ['--resampleWidth', String(targetWidth), filePath], { stdio: 'ignore' });
}

let launched: LaunchedApp;

test.afterEach(async () => {
  if (launched) await closeApp(launched);
});

test('screenshots S01 起動直後の画面', async () => {
  launched = await launchApp();
  const { window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await annotateAndShoot(window, 'S01-launch.png', [
    {
      selector: '.sidebar__tabs',
      number: 1,
      caption: 'サイドバー: タスクと履歴を切り替え',
      side: 'below',
    },
    {
      selector: '.tab-bar__tabs',
      number: 2,
      caption: 'タブバー: シェルや AI のタブを切り替え',
      side: 'right',
    },
    {
      selector: '.terminal-pane__container .xterm-rows > div',
      index: 0,
      number: 3,
      caption: 'ターミナル: ふつうのシェルとして使える',
      side: 'below',
    },
  ]);
});

test('screenshots S03 コマンド入力と出力', async () => {
  launched = await launchApp();
  const { window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.type('echo hello-e2e');
  await window.keyboard.press('Enter');
  // 'echo hello-e2e' という入力行にも 'hello-e2e' は部分一致してしまうため、
  // toContainText('hello-e2e') だけだと出力行の描画を待たずに撮影してしまう
  // （S04 の実測でこの取り違えが起きていた）。出力行だけに完全一致する行を
  // 明示的に待つことで、実際に結果が描画されてから撮影する。
  const outputRow = window
    .locator('.terminal-pane__container .xterm-rows > div')
    .filter({ hasText: /^hello-e2e$/ });
  await expect(outputRow).toHaveCount(1, { timeout: 10_000 });

  await annotateAndShoot(window, 'S03-shell-echo.png', [
    {
      selector: '.terminal-pane__container .xterm-rows > div',
      text: 'echo hello-e2e',
      number: 1,
      caption: '入力したコマンド',
      side: 'above',
    },
    {
      selector: '.terminal-pane__container .xterm-rows > div',
      text: 'hello-e2e',
      exact: true,
      number: 2,
      caption: '実行結果がそのまま表示される',
      side: 'below',
    },
  ]);
});

test('screenshots S04 日本語と絵文字の文字幅', async () => {
  launched = await launchApp();
  const { window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await window.locator('.xterm-helper-textarea').first().focus();
  await window.keyboard.type('echo 日本語テスト🎉');
  await window.keyboard.press('Enter');
  await expect(screen).toContainText('日本語テスト🎉', { timeout: 10_000 });

  await window.keyboard.type('echo AB日本CD');
  await window.keyboard.press('Enter');
  const outputRow = window
    .locator('.terminal-pane__container .xterm-rows > div')
    .filter({ hasText: /^AB日本CD$/ });
  await expect(outputRow).toHaveCount(1, { timeout: 10_000 });

  await annotateAndShoot(window, 'S04-wide-chars.png', [
    {
      selector: '.terminal-pane__container .xterm-rows > div',
      text: '日本語テスト',
      number: 1,
      caption: '日本語・絵文字も幅がずれない',
      side: 'above',
    },
    {
      selector: '.terminal-pane__container .xterm-rows > div',
      text: 'AB日本CD',
      exact: true,
      number: 2,
      caption: '全角は半角の2倍幅で描画される',
      side: 'below',
    },
  ]);
});

test('screenshots S06 タブを増やす', async () => {
  launched = await launchApp();
  const { window } = launched;

  const tabs = window.locator('.tab-bar__tabs > .tab-bar__tab');
  await expect(tabs).toHaveCount(1);

  await window.keyboard.press('Meta+t');
  await expect(tabs).toHaveCount(2);

  await window.locator('button[aria-label="新しいシェルタブ"]').click();
  await expect(tabs).toHaveCount(3);
  await expect(tabs.last()).toHaveClass(/is-active/);

  await annotateAndShoot(window, 'S06-new-tab.png', [
    {
      selector: '.tab-bar__tabs',
      number: 1,
      caption: 'Cmd+T でタブが増える（独立したシェル）',
      side: 'right',
    },
    {
      selector: 'button[aria-label="新しいシェルタブ"]',
      number: 2,
      caption: '+ ボタンでも開ける',
      side: 'right',
    },
  ]);
});

test('screenshots S09 claude を起動する', async () => {
  launched = await launchApp();
  const { window } = launched;

  const initialScreen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(initialScreen).toContainText(/[$%#>]/, { timeout: 20_000 });

  await window.keyboard.press('Meta+Shift+C');
  await expect(window.locator('.tab-bar__title').filter({ hasText: 'claude' })).toBeVisible();

  const activeRows = window.locator('.terminal-pane:not(.terminal-pane--hidden) .xterm-rows').first();
  await expect(activeRows).toContainText('FAKE CLAUDE READY', { timeout: 20_000 });
  await expect(activeRows).toContainText(/ARGS:.*--session-id/);

  await annotateAndShoot(window, 'S09-launch-claude.png', [
    {
      selector: '.tab-bar__tab.is-active .tab-bar__title',
      number: 1,
      caption: 'Cmd+Shift+C で claude が新しいタブに起動',
      side: 'right',
    },
    {
      selector: '.terminal-pane:not(.terminal-pane--hidden) .xterm-rows > div',
      text: 'ARGS:',
      number: 2,
      caption: '--session-id が自動で渡る',
      side: 'below',
    },
  ]);
});

test('screenshots S11 CLI が見つからないとき', async () => {
  launched = await launchApp({ withoutCli: true });
  const { window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000, useInnerText: true });

  const taskError = window.locator('.task-list .panel-message--error');
  await expect(taskError).toBeVisible({ timeout: 15_000 });
  await expect(taskError).toContainText('claude コマンドが見つかりません');

  await annotateAndShoot(window, 'S11-cli-missing.png', [
    {
      selector: '.task-list .panel-message--error',
      number: 1,
      caption: 'claude が無いと日本語でエラー表示',
      side: 'below',
    },
    {
      selector: '.terminal-pane__container .xterm-rows > div',
      index: 0,
      number: 2,
      caption: 'シェルは動き続ける。アプリも落ちない',
      side: 'below',
    },
  ]);
});

test('screenshots S12 実行中タスク一覧', async () => {
  launched = await launchApp();
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: 'タスク' }).click();
  const items = window.locator('.task-list .task-item');
  await expect(items).toHaveCount(2, { timeout: 15_000 });

  await annotateAndShoot(window, 'S12-task-list.png', [
    // 番号と配置は行の並び順に合わせる（フィクスチャは busy の行が先）。
    // 意味と番号を優先して入れ替えると、吹き出しが下の行に重なって隠す。
    {
      selector: '.task-item--working',
      number: 1,
      caption: '作業中: エージェントが動いているタスク',
      side: 'right',
    },
    {
      selector: '.task-item--your-turn',
      number: 2,
      caption: 'あなたの番: 入力を待っているタスク（強調される側）',
      side: 'below',
    },
  ]);
});

test('screenshots S16 履歴の並び順', async () => {
  launched = await launchApp();
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();
  const items = window.locator('.history-item');
  await expect(items).toHaveCount(3);

  await annotateAndShoot(window, 'S16-history-order.png', [
    {
      selector: '.history-item',
      index: 0,
      number: 1,
      caption: '更新が最も新しい',
      side: 'right',
    },
    { selector: '.history-item', index: 1, number: 2, caption: '2番目に新しい', side: 'right' },
    { selector: '.history-item', index: 2, number: 3, caption: '最も古い', side: 'right' },
  ]);
});

test('screenshots S18 壊れた履歴の縮退表示', async () => {
  launched = await launchApp();
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();
  await expect(window.locator('.history-item')).toHaveCount(3);
  const broken = window.locator('.history-item', { hasText: '33333333' });
  await expect(broken).toHaveCount(1);

  await annotateAndShoot(window, 'S18-history-broken.png', [
    {
      selector: '.history-item',
      text: '33333333',
      number: 1,
      caption: '壊れても一覧から消えない',
      side: 'right',
    },
    {
      selector: '.history-item__error',
      number: 2,
      caption: '解析エラーの表示',
      side: 'right',
    },
  ]);
});

test('screenshots S19 履歴から resume する', async () => {
  launched = await launchApp();
  const { window } = launched;

  await window.locator('.sidebar__tabs button', { hasText: '履歴' }).click();
  const normal = window.locator('.history-item', { hasText: 'サイドバーのレイアウト修正' });
  await expect(normal).toHaveCount(1);
  const countBefore = await window.locator('.tab-bar__tab').count();
  await normal.click();
  await expect(window.locator('.tab-bar__tab')).toHaveCount(countBefore + 1);

  const screen = window.locator('.terminal-pane__container .xterm-screen').last();
  await expect(screen).toContainText('FAKE CLAUDE READY', { timeout: 20_000 });
  await expect(screen).toContainText(/ARGS:.*--resume/, { timeout: 20_000 });

  await annotateAndShoot(window, 'S19-history-resume.png', [
    {
      selector: '.tab-bar__tab .tab-bar__title',
      index: -1,
      number: 1,
      caption: '履歴クリックで新しいタブが開く',
      side: 'right',
    },
    {
      selector: '.terminal-pane:not(.terminal-pane--hidden) .xterm-rows > div',
      text: '--resume',
      number: 2,
      caption: '--resume 付きで続きから再開',
      side: 'below',
    },
  ]);
});

test('screenshots S22 IME の変換中表示', async () => {
  launched = await launchApp();
  const { window, app } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  // タスク一覧が埋まるまで待ってから撮る。待たないと最初のポーリングに間に合わず、
  // サイドバーだけ空状態の画像になることがある（他の画像と揃わない）。
  // composition を作る前に済ませる。あとから待つと焦点が動く余地を作ってしまう。
  await expect(window.locator('.task-list .task-item')).toHaveCount(2, { timeout: 15_000 });

  await window.locator('.xterm-helper-textarea').first().focus();
  const cdp = await app.context().newCDPSession(window);
  await cdp.send('Input.imeSetComposition', {
    text: 'にほんご',
    selectionStart: 4,
    selectionEnd: 4,
  });

  const composition = window.locator('.composition-view').first();
  await expect(composition).toHaveClass(/active/);
  await expect(composition).toContainText('にほんご');

  await annotateAndShoot(window, 'S22-ime-composition.png', [
    {
      selector: '.composition-view',
      number: 1,
      caption: '変換中（未確定）の文字列がその場に表示',
      side: 'below',
    },
  ]);

  // 撮影を通しても composition が生きていること。
  // 撮影の副作用で helper textarea が blur されると変換が終了し、
  // 「枠の中が空」の画像が撮れてしまう（Issue #10 で実際に起きた）。
  // 画像の中身は機械で見られないので、撮影後の状態で代わりに担保する。
  await expect(composition).toHaveClass(/active/);
  await expect(composition).toContainText('にほんご');
});

test('screenshots S31 設定パネル', async () => {
  launched = await launchApp({
    config: {
      // ハーネスの既定は notifySound: false。そのまま撮るとサウンド欄が
      // 無効表示（灰色）になり、注釈を付けた要素が使えない欄に見える。
      notifySound: true,
      // 撮影用に Webhook 欄を埋めておく（実在しないホストなので送信はしない）。
      // 空欄のまま撮ると「何を入れる欄なのか」が画像から読み取れない。
      slack: { enabled: true, url: 'https://hooks.slack.com/services/T000/B000/xxxx' },
      discord: { enabled: false, url: '' },
    },
  });
  const { window } = launched;

  const screen = window.locator('.terminal-pane__container .xterm-screen').first();
  await expect(screen).toContainText(/[$%#>]/, { timeout: 20_000 });

  // 設定は本体とは別のウィンドウ（Issue #25）。撮影対象もそちらになる。
  const settings = await openSettingsWindow(launched, () =>
    window.locator('button[aria-label="設定を開く"]').click(),
  );

  await annotateAndShoot(settings, 'S31-settings-panel.png', [
    {
      selector: '.settings__select',
      number: 1,
      caption: '通知音を選んでその場で試聴',
      side: 'right',
    },
    {
      selector: 'input[aria-label="Slack の Webhook URL"]',
      number: 2,
      caption: 'Slack / Discord へ完了通知を転送',
      // below だと直下の「テスト送信」ボタンを覆ってしまう
      side: 'right',
    },
  ],
  // 設定ウィンドウは幅 520px。1200 に引き伸ばすとぼやけるので実寸に寄せる。
  620);
});
