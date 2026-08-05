// xterm.js の Terminal インスタンスをタブごとに1つ生成・管理するフック。
//
// - PTY 出力は加工せず term.write() にそのまま渡す（CLAUDE.md の鉄則）。
// - 自分の ptyId 宛のイベントだけを処理する（全タブが同じ push イベントを受け取るため）。
// - WebGL アドオンは初期化に失敗する環境があるので try/catch し、失敗しても続行する。
// - unicode-graphemes アドオンで日本語・絵文字の文字幅を正しく計算する。
// - attachCustomKeyEventHandler で、アプリのショートカットキーが端末入力として
//   吸われないようにする（実際のアクション実行はウィンドウ側のグローバルリスナーが行う。
//   ここでは「xterm に処理させない」ことだけを保証する二重の安全策）。

import { useEffect, useRef, type RefObject } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';
import { SearchAddon } from '@xterm/addon-search';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { PtyExitEvent, TerminalTheme } from '@shared/ipc';
import { matchShortcut } from '../lib/shortcuts';
import type { PaneCellMetrics } from '../tabs/paneTree';
import { subscribePty } from './ptyStream';
import { shouldSendResize, type ResizeDims } from './resizeGate';
import { shouldActivateLink } from './linkActivation';
import { searchSeedFromSelection } from './searchSeed';

/** unicode-graphemes アドオンが登録する Unicode バージョン文字列 */
const GRAPHEME_UNICODE_VERSION = '15-graphemes';

export interface TerminalHandle {
  focus(): void;
  /** コンテナのサイズに合わせて fit し、PTY にも resize を伝える */
  fit(): void;
  /**
   * 表示中のバッファとスクロールバックを消す（Cmd+K）。
   * PTY には何も送らない。**シェルの状態は変えず、見えているものだけを消す**のが
   * iTerm2 / Terminal.app の Cmd+K と同じ挙動。
   */
  clear(): void;
  toggleSearch(): void;
  closeSearch(): void;
  /**
   * 検索語の更新。検索入力欄の onChange から呼ぶ。
   * findNext / findPrevious はここで最後に渡された値を使うため、
   * グローバルショートカット（Cmd+G 等）から入力欄のフォーカスなしに呼べる。
   */
  setSearchTerm(term: string): void;
  findNext(): void;
  findPrevious(): void;
  /**
   * 分割の可否判定（`paneTree.ts` の `canSplitPane` / `splitPane`）に渡す実測値。
   *
   * xterm.js は実セル幅・実セル高さを公開 API として持たない（`allowProposedApi`
   * でも出ていない）ため、コンテナの実ピクセルサイズを現在の `cols` / `rows` で
   * 割って逆算する。fit 済みであれば `container.clientWidth / term.cols` は
   * 実セル幅そのものと一致する（xterm 自身がその関係になるようフォントを
   * レイアウトしているため）。
   *
   * コンテナや Terminal がまだ無い、または `cols` / `rows` が 0（マウント直後で
   * 未フィット）の異常時は全フィールド 0 を返す。`canSplitPane` /
   * `clampSplitRatio` はいずれも `widthPx`/`heightPx` <= 0 を「メトリクス取得不可」
   * として比率だけのフォールバックに倒すため、ここで例外を投げる必要は無い。
   */
  getCellMetrics(): PaneCellMetrics;
  /**
   * 右クリックメニューを出してよい状況かと、そのときの選択の有無（Issue #135）。
   *
   * **マウス報告モード中は出さない。** `vim`（`set mouse=a`）/ `htop` /
   * **既定で tmux にラップされるエージェントタブ**は、右ボタンを自分で受け取って
   * 自前のメニューや操作に使う。そこへアプリのメニューを被せると、
   * **いちばん使う画面でいちばん壊れる**（tmux 3.x の `MouseDown3Pane` は
   * 既定で `display-menu`）。判定材料は xterm の公開 API
   * （`term.modes.mouseTrackingMode`）にある。
   *
   * Terminal がまだ無い異常時は「出さない」に倒す（鉄則5）。
   */
  getContextMenuState(): { allowed: boolean; hasSelection: boolean };
}

export interface UseTerminalOptions {
  ptyId: string;
  fontFamily: string;
  fontSize: number;
  theme: TerminalTheme;
  /**
   * xterm の screenReaderMode。有効にすると読み上げ用の DOM が別に生える。
   * WebGL レンダラは canvas に描くため、これが false だと**支援技術からは
   * ターミナルの内容が1文字も見えない**。
   */
  screenReaderMode: boolean;
  /**
   * xterm の入力用 textarea に付ける名前（Issue #150）。
   *
   * **xterm の既定は英語の `Terminal input` で、しかも全ペイン共通。**
   * 分割すると支援技術のローターに同じ名前が並び、どちらの端末か区別できない。
   *
   * ⛔ **`Terminal.strings.promptLabel` は使えない。** あれは **static** なので
   * インスタンスごとに別の値を持てず、リネームや cwd の追従にも乗らない。
   * 名前の組み立ては `tabs/paneHeader.ts` の `terminalInputLabel` が唯一の正。
   */
  inputLabel: string;
  onExit: (event: PtyExitEvent) => void;
  /**
   * 検索バーの表示が変わったときに呼ばれる。
   *
   * 開くとき、xterm の選択範囲から引き継ぐ語があれば `seed` に入る（Issue #175）。
   * **`seed` が無いときは検索欄を触らないこと**（空にするのではない。判定の正は
   * `searchSeed.ts`）。閉じるときは常に `undefined`。
   */
  onSearchVisibilityChange: (visible: boolean, seed?: string) => void;
}

function toXtermTheme(theme: TerminalTheme): ITheme {
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    selectionBackground: theme.selectionBackground,
  };
}

/**
 * container に xterm.js の Terminal を1つ生成してぶら下げる。
 * container は非表示（visibility: hidden）になっても DOM から外さないこと
 * （タブ切り替えで内容を失わないため）。
 */
export function useTerminal(
  containerRef: RefObject<HTMLDivElement | null>,
  options: UseTerminalOptions,
): TerminalHandle {
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const searchOpenRef = useRef(false);
  // 検索入力欄の最新値。findNext / findPrevious をフォーカス無しで呼べるようにするための控え。
  const searchTermRef = useRef('');

  // 最新の options を effect 外からも参照できるようにする（Terminal の再生成を避けるため）。
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // 直前に PTY へ送った cols/rows。同値なら resize IPC を送らない（resizeGate.ts）。
  // インスタンススコープの ref に持つこと（ペインが増えても他インスタンスと混ざらない）。
  const lastResizeRef = useRef<ResizeDims | null>(null);

  /**
   * コンテナのサイズに合わせて fit し、値が変わっていれば PTY にも resize を伝える。
   * ResizeObserver / 初回 RAF（内部呼び出し）と TerminalHandle.fit（外部呼び出し）の
   * 唯一の実体。ref 経由でしか状態を読まないため、マウント時に作った関数のまま
   * ずっと使い回せる（TerminalHandle 側は初回レンダーで一度だけ生成されるため）。
   */
  const fit = (): void => {
    const container = containerRef.current;
    const term = termRef.current;
    const fitAddon = fitAddonRef.current;
    if (!container || !term || !fitAddon) return;
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    try {
      fitAddon.fit();
    } catch {
      return;
    }
    const dims: ResizeDims = { cols: term.cols, rows: term.rows };
    if (!shouldSendResize(lastResizeRef.current, dims)) return;
    lastResizeRef.current = dims;
    window.api.pty.resize({ ptyId: optionsRef.current.ptyId, cols: dims.cols, rows: dims.rows });
  };

  // Terminal 本体の生成はマウント時に一度だけ行う（ptyId が変わることは実運用上ない）。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: optionsRef.current.fontFamily,
      fontSize: optionsRef.current.fontSize,
      theme: toXtermTheme(optionsRef.current.theme),
      allowProposedApi: true,
      cursorBlink: true,
      scrollback: 5000,
      screenReaderMode: optionsRef.current.screenReaderMode,
    });
    termRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    term.loadAddon(new UnicodeGraphemesAddon());

    const searchAddon = new SearchAddon();
    searchAddonRef.current = searchAddon;
    term.loadAddon(searchAddon);

    term.loadAddon(new ClipboardAddon());

    // リンクは **Cmd+クリックでだけ**開く（Issue #178 周2。iTerm2 / Ghostty と同じ作法）。
    // `@xterm/addon-web-links` は修飾キーを見ずにハンドラを呼ぶので、門はここで作る
    // （判定の正は `linkActivation.ts`）。
    //
    // `window.open` の行き先は Main の `setWindowOpenHandler` が横取りし、
    // **アプリ内に窓を作らず**既定ブラウザへ渡す（`src/main/external-links.ts`）。
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (!shouldActivateLink(event)) return;
        window.open(uri, '_blank', 'noopener,noreferrer');
      }),
    );

    term.open(container);
    term.unicode.activeVersion = GRAPHEME_UNICODE_VERSION;

    // WebglAddon は term.open() の**後**に読み込む（xterm.js のドキュメント通りの順序）。
    // 先に loadAddon すると DOM 未生成の Terminal にアドオンが載る。
    // 実測では先に読み込んでも描画は壊れなかったが、依存する保証が無いので順序を守る。
    try {
      const webgl = new WebglAddon();
      // **コンテキストを失ったら DOM レンダラへ落とす**（Issue #167）。
      //
      // このアプリは全タブ・全ペインを同時にマウントしたまま（`visibility` だけで
      // 切り替える）なので、**WebGL コンテキストがペイン数ぶん同時に生きる**。
      // Chromium の1レンダラあたりの上限は16前後で、超えると古いものから黙って失われる。
      //
      // 放置すると**そのペインは真っ白なキャンバスになるが、a11y の DOM は生き残る**。
      // 支援技術には読めていて、**晴眼の利用者にだけ主コンテンツが消える**という
      // 珍しい向きの壊れ方をする。
      //
      // `dispose()` すると xterm がコアの既定レンダラ（DOM）へ差し替えて
      // `handleResize` まで面倒を見る（`WebglAddon.activate` の `toDisposable`）。
      // **文字が出続けることが最優先**なので、WebGL に戻す試みはしない。
      //
      // 発火は `webglcontextlost` の**3秒後**（アドオンが `webglcontextrestored` を
      // 待つ猶予。`WebglRenderer.ts`）。復帰したら発火しない。
      webgl.onContextLoss(() => {
        console.warn('[terminal] WebGL コンテキストを失いました。DOM レンダラへ切り替えます。');
        webgl.dispose();
      });
      term.loadAddon(webgl);
    } catch (err) {
      // WebGL レンダラが使えない環境では黙って DOM レンダラにフォールバックする。
      console.warn('[terminal] WebGL レンダラの初期化に失敗しました。無視して続行します。', err);
    }

    // アプリのショートカットキーは xterm に処理させない。
    // 実際のアクションはウィンドウのグローバル keydown リスナー（capture フェーズ）が
    // 先に処理して stopPropagation するため、通常はここまで届かないが、
    // 何らかの理由で届いた場合でも端末入力として吸われないようにする二重の安全策。
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      return matchShortcut(event) === null;
    });

    const ptyId = optionsRef.current.ptyId;

    const onDataDisposable = term.onData((data) => {
      window.api.pty.input({ ptyId, data });
    });

    // 直接 window.api.pty.onData を購読すると、spawn 直後から購読開始までの
    // 出力を取りこぼす（AI CLI の起動バナーが消える）。ハブ経由で購読し、
    // 購読前に届いていた分をフラッシュしてもらう。
    const unsubscribeStream = subscribePty(
      ptyId,
      (data: string) => {
        // PTY 出力は加工しない。そのまま書き込む。
        term.write(data);
      },
      (e: PtyExitEvent) => {
        const label = e.signal
          ? `シグナル ${e.signal} で終了しました`
          : `終了しました（コード ${e.exitCode}）`;
        term.write(`\r\n\x1b[2m[プロセスは${label}]\x1b[0m\r\n`);
        optionsRef.current.onExit(e);
      },
    );

    const resizeObserver = new ResizeObserver(() => fit());
    resizeObserver.observe(container);
    // 初回レイアウト確定後に一度フィットさせる。
    const initialFitId = window.requestAnimationFrame(fit);

    return () => {
      window.cancelAnimationFrame(initialFitId);
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      unsubscribeStream();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
    // 依存配列は containerRef のみ（意図的）。options の変更は下の別 effect で反映し、
    // Terminal 自体の再生成は避ける。
  }, [containerRef]);

  // フォント・テーマは Terminal を再生成せずに反映する（設定が後から読み込まれるケースに対応）。
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = options.fontFamily;
    term.options.fontSize = options.fontSize;
    term.options.theme = toXtermTheme(options.theme);
    term.options.screenReaderMode = options.screenReaderMode;
  }, [options.fontFamily, options.fontSize, options.theme, options.screenReaderMode]);

  // 入力用 textarea の名前（Issue #150）。**別の effect にしてある。**
  // 上の effect はフォント・テーマの変更で走るが、名前はリネームや cwd の追従で
  // 別のタイミングに変わるので、依存配列を混ぜると片方のたびに両方を書き直すことになる。
  //
  // `term.textarea` は `term.open()` のあとに生える。ここは Terminal の生成 effect の
  // **あと**に走るので、初回から掴める（掴めなかった場合は既定の英語ラベルのまま
  // 縮退する。名前が付かないだけで入力は動く）。
  useEffect(() => {
    termRef.current?.textarea?.setAttribute('aria-label', options.inputLabel);
  }, [options.inputLabel]);

  /**
   * 検索バーを開くときに、xterm の選択範囲から引き継ぐ語を決める（Issue #175）。
   *
   * 引き継ぐと決めたら `searchTermRef` にも入れる。**`Cmd+G` は入力欄ではなく
   * この ref を見る**ので、ここを更新しないと「検索欄には語が出ているのに
   * `Cmd+G` は前回の語を探す」というズレができる。
   */
  const seedSearchFromSelection = (): string | undefined => {
    const seed = searchSeedFromSelection(termRef.current?.getSelection());
    if (seed === null) return undefined;
    searchTermRef.current = seed;
    return seed;
  };

  const openSearchBar = (): void => {
    if (searchOpenRef.current) return;
    searchOpenRef.current = true;
    optionsRef.current.onSearchVisibilityChange(true, seedSearchFromSelection());
  };

  /**
   * 検索バーが閉じている状態で Cmd+G / Cmd+Shift+G が押されたときの挙動の決定。
   *
   * **バーを開くだけにし、検索は実行しない。** 前回の検索語をそのまま検索してしまうと、
   * 検索欄自体が非表示のまま（＝画面のどこにも「何を検索したか」の手がかりが無いまま）
   * ヒット箇所だけが動くことになる。`clear()` が「見えているものだけを消す」保守的な
   * 挙動を選んだ（Cmd+K のコメント参照）のと同じ理由で、検索語が見えていない状態からの
   * 検索実行は避け、まず検索欄を出してユーザーに確認してもらう。
   */
  const findInDirection = (direction: 'next' | 'previous'): void => {
    if (!searchOpenRef.current) {
      openSearchBar();
      return;
    }
    const term = searchTermRef.current;
    if (!term) return;
    if (direction === 'next') {
      searchAddonRef.current?.findNext(term, { incremental: true });
    } else {
      searchAddonRef.current?.findPrevious(term);
    }
  };

  const handleRef = useRef<TerminalHandle>({
    focus: () => termRef.current?.focus(),
    fit,
    clear: () => {
      // xterm の clear() は「現在行を残して、それ以外とスクロールバックを消す」。
      // PTY には触らないので、実行中のプロセスもシェルの状態も影響を受けない。
      termRef.current?.clear();
    },
    toggleSearch: () => {
      searchOpenRef.current = !searchOpenRef.current;
      // 開くときだけ選択範囲を引き継ぐ（閉じるときに読むと、閉じた後の状態に
      // 依存した語が次に開いたとき出てくる）。
      optionsRef.current.onSearchVisibilityChange(
        searchOpenRef.current,
        searchOpenRef.current ? seedSearchFromSelection() : undefined,
      );
      if (!searchOpenRef.current) searchAddonRef.current?.clearDecorations();
    },
    closeSearch: () => {
      if (searchOpenRef.current) {
        searchOpenRef.current = false;
        optionsRef.current.onSearchVisibilityChange(false);
      }
      searchAddonRef.current?.clearDecorations();
    },
    setSearchTerm: (term: string) => {
      searchTermRef.current = term;
    },
    findNext: () => findInDirection('next'),
    findPrevious: () => findInDirection('previous'),
    getContextMenuState: (): { allowed: boolean; hasSelection: boolean } => {
      const term = termRef.current;
      if (!term) return { allowed: false, hasSelection: false };
      return {
        allowed: term.modes.mouseTrackingMode === 'none',
        hasSelection: term.hasSelection(),
      };
    },
    getCellMetrics: (): PaneCellMetrics => {
      const container = containerRef.current;
      const term = termRef.current;
      if (!container || !term || term.cols <= 0 || term.rows <= 0) {
        return { widthPx: 0, heightPx: 0, cellWidthPx: 0, cellHeightPx: 0 };
      }
      return {
        widthPx: container.clientWidth,
        heightPx: container.clientHeight,
        cellWidthPx: container.clientWidth / term.cols,
        cellHeightPx: container.clientHeight / term.rows,
      };
    },
  });

  return handleRef.current;
}
