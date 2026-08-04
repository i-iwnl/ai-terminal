// ターミナル面の右クリックメニューの項目表（純粋関数）。Issue #135。
//
// **なぜ純粋関数に切り出すか。** メニューを出すのは Main の `Menu.popup()` で、
// 実際に画面へ出たかを Playwright から観測する手段は無い（`app.dock.bounce` と同じ）。
// そこで**項目・並び・有効/無効・語**をここで決めて `test/unit/` で固定し、
// Main 側は受け取った表を `MenuItemConstructorOptions` に変換するだけにする。
// `closeTabCopy.ts` / `paneHeader.ts` と同じ作法。
//
// **なぜ Renderer の HTML メニューではなくネイティブか**（design-review の5人中3人が B を推した）:
//
// - **HTML メニューは切られる。** `.terminal-stack` と `.pane-split__cell` が
//   `overflow: hidden` を持つので、ペインの下端・右端で右クリックすると
//   メニューが見切れる（人がターミナルでクリックするのは主にプロンプト行 = 下端）。
//   祖先の overflow を脱出するには `position: fixed` + 画面端での反転を自前で書くことになり、
//   それは NSMenu の再実装
// - **HTML メニューは DOM フォーカスを奪う。** WAI-ARIA APG のメニューは開いたら
//   最初の項目に `focus()` するが、xterm の textarea が blur すると
//   DECSET 1004（フォーカス報告）が立っている端末に `ESC [ O` が飛ぶ。
//   tmux / vim / claude は 1004 を立てるのが普通なので、**メニューを開いただけで
//   子プロセスに「ウィンドウが非アクティブになった」と嘘をつく**
// - **コピー / ペーストが動かなくなる。** xterm は `copy` / `paste` を
//   `term.element` のリスナで処理する。フォーカスがメニューのボタンへ移ると
//   その経路が死ぬ。自前で `navigator.clipboard` を叩くと、ペーストが
//   **bracketed paste を通らなくなり複数行の貼り付けが行ごとに実行される**
// - ネイティブなら `role: 'copy'` / `role: 'paste'` の1行で、xterm 本来の経路に乗る
//
// **「ネイティブは E2E で検証できない」は誤りだった。** `Menu.prototype.popup` は
// JS 側にあるので `app.evaluate()` から差し替えられ、`menu.items` の
// label / type / role / enabled が読め、`items[n].click()` でアクションも発火できる
// （Electron 43 で実測。design-review で2人が独立に指摘し、こちらでも再現した）。

import type { AppAction } from './ipc';

/** メニューを組み立てるのに要る、そのペインの状況。 */
export interface TerminalContextMenuState {
  /** そのタブのペイン数。1 なら「ペイン」という語を出さない（下記）。 */
  paneCount: number;
  /** いま xterm に選択があるか。無ければ「コピー」を無効にする。 */
  hasSelection: boolean;
}

/**
 * メニュー項目1つ。**`role` と `action` は排他**。
 * `role` は Electron のネイティブ role（`copy` / `paste`）で、
 * `action` は既存の `AppAction` をそのまま Renderer へ送り返すもの。
 */
export type TerminalContextMenuItem =
  | { kind: 'separator' }
  | { kind: 'role'; label: string; role: 'copy' | 'paste'; accelerator: string; enabled: boolean }
  | { kind: 'action'; label: string; action: AppAction; accelerator?: string };

/**
 * ターミナル面の右クリックメニューの項目表。
 *
 * **並びの規約**（macOS の慣習。Terminal.app の `_contextualMenuForSelection` も同型）:
 *
 * 1. **クリップボードが先頭。** ターミナルで右クリックする理由の第1位。
 *    ここに無いと「ネイティブの右クリックのつもりで開いて空振り」になる
 * 2. 作る操作（分割）
 * 3. その端末を見る操作（消去・検索）
 * 4. **分割中だけの操作**（最大化・ペイン名）
 * 5. **破壊的な操作は最後で、セパレータの向こう**。カーソルの真下に置かない
 *
 * **語はアプリメニュー（`src/main/menu.ts`）と一字一句そろえる。** 右クリックで
 * 覚えた語がメニューバーで同じなら、そこでショートカットキーを見つけられる。
 * （「+ ▾」メニューが語を縮めているのは、トリガーとメニュー自身の `aria-label` が
 * 文脈を運んでいるからで、右クリックにはその文脈が無い。条件が違うので結論も違う）
 *
 * **1ペインのタブでは「ペイン」という語を1つも出さない。** ペインヘッダと
 * アクセント線は分割中しか出ないので、1枚のときは「ペイン」に指示対象が画面上に無い。
 * 加えて「ペインを最大化」は1枚では押しても画面が1pxも動かない
 * （何も起きないまま終わらせない、という規約に反する）。
 * 「閉じる」は1枚だと実際にタブが閉じるので、語もそう出す。
 */
export function terminalContextMenuItems(
  state: TerminalContextMenuState,
): TerminalContextMenuItem[] {
  const split = state.paneCount > 1;
  const items: TerminalContextMenuItem[] = [
    { kind: 'role', label: 'コピー', role: 'copy', accelerator: 'Cmd+C', enabled: state.hasSelection },
    { kind: 'role', label: 'ペースト', role: 'paste', accelerator: 'Cmd+V', enabled: true },
    { kind: 'separator' },
    { kind: 'action', label: '右に分割', action: { type: 'split-pane', dir: 'row' }, accelerator: 'Cmd+D' },
    {
      kind: 'action',
      label: '下に分割',
      action: { type: 'split-pane', dir: 'column' },
      accelerator: 'Cmd+Shift+D',
    },
    { kind: 'separator' },
    { kind: 'action', label: '画面を消去', action: { type: 'clear-terminal' }, accelerator: 'Cmd+K' },
    {
      kind: 'action',
      label: 'ターミナル内を検索',
      action: { type: 'toggle-search' },
      accelerator: 'Cmd+F',
    },
  ];

  if (split) {
    items.push(
      { kind: 'separator' },
      {
        kind: 'action',
        label: 'ペインを最大化',
        action: { type: 'toggle-maximize-pane' },
        accelerator: 'Cmd+Shift+Enter',
      },
      // アプリメニューと同じくアクセラレータを持たない（頻度の低い操作に
      // `Cmd+英数字` の名前空間を払わない）。
      { kind: 'action', label: 'ペイン名を変更...', action: { type: 'rename-active-pane' } },
    );
  }

  items.push(
    { kind: 'separator' },
    {
      kind: 'action',
      // 1枚しか無ければ、この操作は結果としてタブを閉じる（`closeActivePane`）。
      // 語と結果を一致させる。**ペイン数でラベルを出し分ける前例**は
      // `src/main/menu.ts` の `updateCloseTabLabel`。
      label: split ? 'ペインを閉じる' : 'タブを閉じる',
      action: { type: 'close-pane' },
      accelerator: 'Cmd+W',
    },
  );

  return items;
}
