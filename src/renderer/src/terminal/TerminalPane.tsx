// タブ1枚分の xterm.js ターミナルを表示するコンポーネント。
//
// 非表示のタブでも Terminal インスタンスは破棄せず、CSS の visibility だけで
// 表示/非表示を切り替える（タブ切り替えでスクロールバックが失われないようにするため）。

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type { PtyExitEvent, TerminalTheme } from '@shared/ipc';
import { useTerminal, type TerminalHandle } from './useTerminal';
import { buildDropInsertion, pathsFromUriList } from '../lib/dropPath';
import { createFocusEchoGate } from './focusEcho';

export interface TerminalPaneProps {
  ptyId: string;
  /**
   * このタブが現在表示されているか（タブ切り替えの可視性）。
   * `.terminal-pane--hidden`（visibility: hidden）を切り替える。
   * 分割（Issue #56 PR 4）前は `active` と同じ意味だったが、1タブに複数ペインが
   * 並ぶようになったため、「タブが見えているか」（この prop）と「このペインが
   * フォーカス中か」（`active`）を分離した。同じタブの中の非アクティブなペインも
   * `visible` は true のまま（**分割の意味そのもの**。両方の xterm-screen が
   * 同時に見えていないと分割にならない）。
   */
  visible: boolean;
  /**
   * このペインがタブの中でフォーカス中（`TabState.activePaneId`）か。
   * `.terminal-pane.is-active` の唯一の hook（design-review.md の PR 4 関門）。
   * xterm へのフォーカス・fit のやり直し・screenReaderMode の対象もこれで決める
   * （S37 が固定する「露出している .xterm-accessibility は常に1個」を保つため、
   * screenReaderMode は呼び出し側で `visible && active` 相当の値だけを渡すこと）。
   */
  active: boolean;
  /**
   * このペインを指す DOM の id。タブバーの `role="tab"` が `aria-controls` で参照する。
   * ARIA 仕様は tab に対応する tabpanel を要求するので、対にして初めて role が嘘にならない。
   * **木のルート（分割していないタブ、またはツリーのルートを描画する側）だけが渡す。**
   * 分割で入れ子になった leaf は渡さない（1つのタブに複数の role="tabpanel" を
   * 作らないため。App.tsx 側の描画がツリーのルートを判定して渡し分ける）。
   */
  panelId?: string;
  /** このペインを説明する `role="tab"` の要素の id（`aria-labelledby` に使う）。panelId と同様、ルートだけが渡す。 */
  labelledBy?: string;
  /**
   * このペインの種別 + cwd を説明する文字列（`tabs/paneHeader.ts`）。
   * ペインヘッダの表示テキストと、`role="group"`（木のルートでない leaf）の
   * aria-label の両方に使う（design-review.md 提案 G / PR 5「aria 名」）。
   * ルートの leaf は role="tabpanel" + aria-labelledby が既に名前を持っている
   * （aria-labelledby が aria-label より優先されるため、両方渡しても壊れない）。
   */
  label: string;
  /**
   * この PTY が tmux でラップされて起動したか（`PaneLeaf.wrappedInTmux`）。
   *
   * **検索バーを開いたときにだけ使う**（Issue #121 A-3 / 周2。design-review の
   * 5ペルソナレビューで採った案）。tmux は代替画面バッファへ切り替えるため
   * （実測: PTY のバイト列に `ESC [ ? 1049 h` が出る。2026-08-03 / tmux 3.7b）、
   * 流れていった行は xterm 側のスクロールバックに入らず、検索の対象も
   * 「いま見えている画面」だけになる。
   *
   * **常時のバッジにはしない。** tmux ラップは既定 ON でエージェントタブでは
   * ほぼ常に true になり、タブバーに出しても情報を運ばないため
   * （レビューで5人が独立に却下）。困っている瞬間 = 検索バーが開いている瞬間に
   * だけ出す。
   */
  wrappedInTmux?: boolean;
  /**
   * ペインヘッダ（高さ18px）を出すか。**分割中のタブだけ true**
   * （呼び出し側 `PaneTreeView` が木の根が split かどうかで決める）。
   * 通常の flex フローに入れて描画する（`position: absolute` の重ね描きに
   * しない。styles.css の `.pane-header` コメント参照。重ね描きだと不透明な
   * ヘッダが xterm の最初の行を隠してしまうため、フローに入れて
   * `.terminal-pane__container` を実際に押し下げる。分割は必ず幅か高さの
   * どちらかを変えるため、`pty:resize` の発火回数は実測でも変わらない）。
   */
  showHeader: boolean;
  fontFamily: string;
  fontSize: number;
  theme: TerminalTheme;
  screenReaderMode: boolean;
  onExit: (event: PtyExitEvent) => void;
  /**
   * このペインに DOM フォーカスが入ったときに呼ばれる（クリックでの
   * ペイン切り替え）。省略可（テスト等で不要な場合のため）。
   * 呼び出し側は、これを見て `TabState.activePaneId` を更新する
   * （矢印キーでのペイン間移動は別 PR。ここはマウス操作の最小限の配線）。
   */
  onActivate?: () => void;
}

/** ファイルドラッグ（Finder の files、または他アプリの text/uri-list）かどうか。 */
function isFileDrag(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes('Files') || dataTransfer.types.includes('text/uri-list');
}

/**
 * ドロップされた DataTransfer から絶対パスを取り出す。
 *
 * 経路は2本ある。Finder からのドラッグは両方を持っているので `files` を優先し、
 * そちらでパスが引けなかったときだけ `text/uri-list` へ落とす。
 * uri-list 側は他アプリからの URI ドラッグへの対応でもあり、
 * **合成 DataTransfer で E2E から検証できる唯一の経路**でもある。
 */
function extractDroppedPaths(dataTransfer: DataTransfer): string[] {
  const fromFiles = Array.from(dataTransfer.files)
    .map((file) => window.api.app.pathForFile(file))
    .filter((path) => path !== '');
  if (fromFiles.length > 0) return fromFiles;
  return pathsFromUriList(dataTransfer.getData('text/uri-list'));
}

const TerminalPane = forwardRef<TerminalHandle, TerminalPaneProps>(function TerminalPane(
  {
    ptyId,
    visible,
    active,
    panelId,
    labelledBy,
    label,
    wrappedInTmux,
    showHeader,
    fontFamily,
    fontSize,
    theme,
    screenReaderMode,
    onExit,
    onActivate,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  // ドロップ可能領域のハイライト（design-review.md 提案 H）。
  // xterm の canvas 等、このペイン内の子要素へ入るたびに dragenter/dragleave が
  // 発火する（ブラウザの仕様。React の onDragEnter/onDragLeave はバブリングで
  // 拾うのでこの div 1個に付けているが、子孫との出入りのたびに呼ばれることは
  // 変わらない）。素朴に「dragleave で消す」と実装すると、ペイン内でカーソルを
  // 動かしただけで枠が消える。enter で+1・leave で-1のカウンタを ref で持ち、
  // 0に戻ったときだけ枠を消す。drop 側でもカウンタが残る経路を必ず潰すため
  // 無条件に0へ戻す。
  const dragCounterRef = useRef(0);
  const [isDropTarget, setIsDropTarget] = useState(false);
  // プログラム的な focus() のこだまを飲み込む門番（Issue #120 C-1）。
  // ペインごとに1つ。`useRef` なのでレンダーをまたいで同一性が変わらない。
  const focusEchoGate = useRef(createFocusEchoGate()).current;

  const handle = useTerminal(containerRef, {
    ptyId,
    fontFamily,
    fontSize,
    theme,
    screenReaderMode,
    onExit,
    onSearchVisibilityChange: setSearchOpen,
  });

  useImperativeHandle(ref, () => handle, [handle]);

  // タブがアクティブになったタイミングでフォーカスとフィットをやり直す。
  //
  // Issue #120 C-1: **この `focus()` のこだまを `onActivate` に流さない。**
  // ここで focus するのは「このペインが既に active だから」なので、
  // 跳ね返ってくる focus イベントが運ぶ情報は常にゼロ。にもかかわらず、
  // 負荷下では React 18 の passive effect のフラッシュが遅れ、その間に入った
  // キーボード由来のアクティブ変更（`Cmd+]`）をこだまが上書きしていた。
  // 経緯と観測ログは `focusEcho.ts` のコメントが正。
  useEffect(() => {
    if (!active) return;
    focusEchoGate.run(() => handle.focus());
    handle.fit();
  }, [active, focusEchoGate, handle]);

  // ドラッグ中にブラウザ既定の「そのファイルを開く」挙動へ渡さないことが第一。
  // dropEffect を copy にすると、カーソルが `+` 付きになって落とせることが伝わる。
  const handleDragOver = (e: ReactDragEvent<HTMLDivElement>): void => {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  // カーソルがこのペインへ入った（または子要素へ入り直した）たびに呼ばれる。
  // カウンタを進め、1件目（0 -> 1）でだけ枠を表示する。
  const handleDragEnter = (e: ReactDragEvent<HTMLDivElement>): void => {
    if (!isFileDrag(e.dataTransfer)) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDropTarget(true);
  };

  // 子要素から出るたびにも呼ばれるため、カウンタが0に戻ったときだけ枠を消す。
  const handleDragLeave = (e: ReactDragEvent<HTMLDivElement>): void => {
    if (!isFileDrag(e.dataTransfer)) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDropTarget(false);
  };

  // ドロップされたパスは、**アクティブなペインではなくドロップされたこのペイン**の PTY へ送る。
  // 他のターミナルと同じ挙動で、分割表示でも自明に動く。
  const handleDrop = (e: ReactDragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    // dragleave が来ずにカウンタが残ったままになる経路（drop で確定する経路）を
    // 必ず潰す。drop が起きた以上、ドラッグは終わっているので無条件に0へ戻す。
    dragCounterRef.current = 0;
    setIsDropTarget(false);
    const data = buildDropInsertion(extractDroppedPaths(e.dataTransfer));
    if (data === '') return;
    window.api.pty.input({ ptyId, data });
    // 続けて打てるようにフォーカスを戻す（ドラッグ元のアプリから戻ってきた直後のため）
    handle.focus();
  };

  return (
    <div
      // `terminal-pane--split` は `showHeader` と同じ判定（呼び出し側 PaneTreeView が
      // `props.node.kind === 'split'` で決める。分割中は木の全 leaf で true）。
      // アクティブ表現の3層のうち2層目（アクセント線）は、3層目（ペインヘッダ）と
      // 同じく**分割中だけ**出す（design-review.md 提案 G「1ペインのときは出さない」）。
      // ペインが1枚しかないタブでは「どれがアクティブか」を伝える必要が無く、
      // 常時出ていて何も伝えないクロームは原則3に反する（レビュー指摘）。
      className={`terminal-pane${visible ? '' : ' terminal-pane--hidden'}${active ? ' is-active' : ''}${showHeader ? ' terminal-pane--split' : ''}${isDropTarget ? ' terminal-pane--drop-target' : ''}`}
      // タブバーの role="tab" と対になる tabpanel。ARIA 仕様は tab に aria-controls で
      // 対応する tabpanel を要求するので、片方だけ足すと role が嘘になる。
      // 非表示のタブは terminal-pane--hidden（visibility: hidden）で
      // アクセシビリティツリーから除かれるため、露出する tabpanel は常に1個。
      // panelId は木のルートを描画する側だけが渡す（分割で入れ子になった leaf は
      // 渡さない。TerminalPaneProps の panelId コメント参照）。
      // 木のルートでない leaf は tabpanel を名乗れないので role="group" にし、
      // このペインが何かを aria-label で説明する（PR 5「aria 名」）。
      // aria-labelledby がある（ルートの）場合はそちらが名前として優先されるため、
      // aria-label を両方に渡しても壊れない。
      id={panelId}
      role={panelId ? 'tabpanel' : 'group'}
      aria-labelledby={labelledBy}
      aria-label={label}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      // クリックでこのペインへフォーカスが入ったら、アプリ側の「アクティブなペイン」も
      // 追従させる（Cmd+F / Cmd+W 等のグローバル操作が正しいペインへ向かうため）。
      // xterm 自身のクリック処理が自分の隠し textarea を focus() するので、
      // capture フェーズで拾えば十分（子孫からのバブルも拾える）。
      //
      // Issue #120 C-1: ただし**自分で呼んだ `focus()` のこだまだけは捨てる**。
      // クリック・ドロップ由来の focus は本物の意思なので通す（門番が閉じるのは
      // 上の effect の `run()` の内側だけ）。理由は `focusEcho.ts` を参照。
      onFocusCapture={() => {
        if (!focusEchoGate.shouldActivate()) return;
        onActivate?.();
      }}
    >
      {showHeader && (
        // 通常の flex フローに入れて .terminal-pane__container を実際に押し下げる
        // （styles.css の .pane-header コメント参照。重ね描きにすると xterm の
        // 最初の行がヘッダの下に隠れてしまうため、レビューで position: absolute
        // をやめた。「幾何を分岐させない」という design-review 提案 G の要求は、
        // 分割そのものが常に幅か高さのどちらかを変えるため、フローに入れても
        // pty:resize の発火回数が増えないことを実測で確認した上で満たしている）。
        // 見た目の説明は aria-label（上の role="group"/"tabpanel"）と同じ
        // 文字列なので、読み上げの二重化を避けて aria-hidden にする。
        <div className="pane-header" aria-hidden="true">
          {label}
        </div>
      )}
      {searchOpen && (
        <div className="terminal-search">
          {/* 入力欄とボタンの行。**注記を足すために1枚包んでいる**（Issue #121 A-3）。
              `.terminal-search input` / `.terminal-search button` を使う spec
              （S20 / S40 / S44 / S45 / S56）は子孫セレクタなので、この入れ子で壊れない。 */}
          <div className="terminal-search__row">
          <input
            autoFocus
            aria-label="このペインを検索"
            // tmux ラップ時だけ、検索の対象範囲を説明する行を紐づける。
            // **live region を1つも増やさない**のが要点（S37 / S48 が固定している
            // 「露出している live region は1個」を触らずに、フォーカスが入った
            // 瞬間に1回だけ読まれる）。通知バナーに出す案は、`.notice-list` が
            // `.terminal-search` と同じ座標（top 44px）で z-index が上のため、
            // autoFocus した入力欄を完全に覆う（WCAG 2.4.11）ので採らなかった。
            aria-describedby={wrappedInTmux ? `${ptyId}-search-hint` : undefined}
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              // useTerminal 側にも控えておく。グローバルショートカット（Cmd+G 等）は
              // この入力欄にフォーカスが無い状態でも呼ばれるため、React state ではなく
              // handle が持つ最新値を見て検索する。
              handle.setSearchTerm(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                handle.closeSearch();
              } else if (e.key === 'Enter') {
                e.stopPropagation();
                if (e.shiftKey) handle.findPrevious();
                else handle.findNext();
              }
            }}
            placeholder="検索"
          />
          <button onClick={() => handle.findPrevious()} title="前を検索">
            前
          </button>
          <button onClick={() => handle.findNext()} title="次を検索">
            次
          </button>
          <button onClick={() => handle.closeSearch()} title="検索を閉じる">
            x
          </button>
          </div>
          {wrappedInTmux && (
            <p id={`${ptyId}-search-hint`} className="terminal-search__hint">
              いま見えている画面だけを検索します（tmux 管理下のため）
            </p>
          )}
        </div>
      )}
      <div className="terminal-pane__container" ref={containerRef} />
    </div>
  );
});

export default TerminalPane;
