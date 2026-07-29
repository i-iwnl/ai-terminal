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
import { subscribePty } from './ptyStream';

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
  findNext(term: string): void;
  findPrevious(term: string): void;
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
  onExit: (event: PtyExitEvent) => void;
  onSearchVisibilityChange: (visible: boolean) => void;
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

  // 最新の options を effect 外からも参照できるようにする（Terminal の再生成を避けるため）。
  const optionsRef = useRef(options);
  optionsRef.current = options;

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

    term.loadAddon(
      new WebLinksAddon((_event, uri) => {
        window.open(uri, '_blank', 'noopener,noreferrer');
      }),
    );

    term.open(container);
    term.unicode.activeVersion = GRAPHEME_UNICODE_VERSION;

    // WebglAddon は term.open() の**後**に読み込む（xterm.js のドキュメント通りの順序）。
    // 先に loadAddon すると DOM 未生成の Terminal にアドオンが載る。
    // 実測では先に読み込んでも描画は壊れなかったが、依存する保証が無いので順序を守る。
    try {
      term.loadAddon(new WebglAddon());
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

    const doFit = (): void => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      try {
        fitAddon.fit();
      } catch {
        return;
      }
      window.api.pty.resize({ ptyId, cols: term.cols, rows: term.rows });
    };

    const resizeObserver = new ResizeObserver(() => doFit());
    resizeObserver.observe(container);
    // 初回レイアウト確定後に一度フィットさせる。
    const initialFitId = window.requestAnimationFrame(doFit);

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

  const handleRef = useRef<TerminalHandle>({
    focus: () => termRef.current?.focus(),
    fit: () => {
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
      window.api.pty.resize({ ptyId: optionsRef.current.ptyId, cols: term.cols, rows: term.rows });
    },
    clear: () => {
      // xterm の clear() は「現在行を残して、それ以外とスクロールバックを消す」。
      // PTY には触らないので、実行中のプロセスもシェルの状態も影響を受けない。
      termRef.current?.clear();
    },
    toggleSearch: () => {
      searchOpenRef.current = !searchOpenRef.current;
      optionsRef.current.onSearchVisibilityChange(searchOpenRef.current);
      if (!searchOpenRef.current) searchAddonRef.current?.clearDecorations();
    },
    closeSearch: () => {
      if (searchOpenRef.current) {
        searchOpenRef.current = false;
        optionsRef.current.onSearchVisibilityChange(false);
      }
      searchAddonRef.current?.clearDecorations();
    },
    findNext: (term: string) => {
      if (!term) return;
      searchAddonRef.current?.findNext(term, { incremental: true });
    },
    findPrevious: (term: string) => {
      if (!term) return;
      searchAddonRef.current?.findPrevious(term);
    },
  });

  return handleRef.current;
}
