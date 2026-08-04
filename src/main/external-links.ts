// 外部リンクの逃がし先（Issue #178 周1 / 統合元 #174）。
//
// **`setWindowOpenHandler` を設置しないと、Electron は `window.open()` に対して
// 新しい `BrowserWindow` を自前で作る。** そこにはアドレスバーも戻るボタンも無く、
// メニューの `Cmd+W`（`close-pane`）は Renderer 側の実装なのでその窓には届かない。
// 結果、信号機をマウスで押すまで剥がせない窓がターミナルの上に居座る。
//
// ターミナルに出た URL は「このアプリで表示したいもの」ではなく
// 「ブラウザへ渡したいもの」なので、**アプリ内には一切窓を作らず**
// （`{ action: 'deny' }`）、既定ブラウザへ投げる。
//
// **ウィンドウ生成点ごとに書かず、この1関数に集約する。** 生成点は本体
// （`index.ts` の `createWindow`）と設定（`settings-window.ts` の
// `openSettingsWindow`）の2つあり、片方への付け忘れがそのまま穴になる。

import { shell, type BrowserWindow } from 'electron';

/**
 * `shell.openExternal` に渡してよいスキーム。
 *
 * **allowlist にする理由**（鉄則5。外から来る値は絞り込む）。渡ってくる URL は
 * PTY 出力 = 外部由来で、`shell.openExternal` は**ブラウザ専用の API ではない**。
 * `file:` は Finder を、独自スキームは登録済みの任意のアプリを起動できるので、
 * 「開けるものは全部開く」実装にすると、端末に文字列を出せる側が
 * macOS のアプリ起動をトリガできてしまう。
 */
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:', 'mailto:']);

/**
 * 既定ブラウザへ渡してよい URL か。
 *
 * **純粋関数として切り出してある。** 開いた先（本物のブラウザ）は Playwright から
 * 観測できないので、スキームの網羅は `test/unit/external-links.test.ts` が固定する
 * （`shouldSendResize` / `passesModifierGate` などと同じ扱い）。
 */
export function isSafeExternalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // 相対 URL や壊れた文字列。`new URL()` はここで必ず投げる。
    return false;
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol);
}

/**
 * そのウィンドウから開こうとしたリンクを、既定ブラウザへ逃がす。
 *
 * **ウィンドウを作った直後に必ず呼ぶ。** 呼び忘れたウィンドウだけが
 * 「アドレスバーの無い窓が開く」挙動に戻る。
 */
export function attachExternalLinkHandler(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    // 弾いた URL は黙って捨てない。開かない理由が分からないと、
    // 「クリックしても何も起きない」不具合と区別できなくなる。
    if (isSafeExternalUrl(url)) {
      void shell.openExternal(url);
    } else {
      console.warn('[external-links] 対応していないスキームなので開きませんでした:', url);
    }
    // **どちらの場合も deny。** アプリ内に窓を作る経路をここで断ち切る。
    return { action: 'deny' };
  });
}
