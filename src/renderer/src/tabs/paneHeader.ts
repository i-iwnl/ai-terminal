// ペインヘッダ（Issue #56 design-review.md 提案 G）に出す文字列を組み立てる純粋関数。
//
// 分割中のみ、各ペインの上に高さ18pxのヘッダを出す。
//
// **Issue #130 で判断が変わった。** それまでは「`leaf.title` は使わない」
// （ヘッダは常に `種別・cwd` を一定の形で出す）としていたが、次の2点で
// ヘッダが役に立っていなかった:
//
//   1. 分割で作るペインは**必ずシェルで、cwd を分割元から引き継ぐ**
//      （useTabs.ts の splitActivePane）。したがって分割した2枚のヘッダは
//      **100% 必ず `zsh・<同じディレクトリ>`** で衝突し、どちらがどちらか
//      文字からは永久に分からない。
//   2. ユーザーが名前を付けても、その名前はタブバー（しかもアクティブな
//      ペインのぶんだけ）にしか出ず、ペイン自身は名乗れなかった。
//
// そこで**単一スロットのまま分岐する**（`paneHeaderLabel`）。名前を付けて
// いなければ従来どおり `種別・cwd`、付けていればその名前だけを出す。
//
// **2要素（名前 + 種別・cwd）を横に並べない。** 分割の下限は
// `MIN_PANE_COLUMNS = 20`（paneTree.ts）で、そのときヘッダの文字に使える実幅は
// 約 148.6px。2要素の必要幅は実測 208.7px（再開版 242.4px）で 60〜94px 足りない。
// 加えて styles.css の `:root` が「`--text-secondary` と `--text-tertiary` は
// 対比 1.28 で段として見えないので、この2つが同じ行に隣接する箇所を作らない」と
// 明文で禁じており、`prefers-contrast: more` では両者が同色に畳まれる。
//
// 見えなくなった側は**捨てずに `paneAccessibleLabel` へ回す**。これが
// `title` 属性（ツールチップ）と `role="group"` の `aria-label` の両方になるので、
// 幅が足りずに省略されても全文が読め、視覚と読み上げが構造的に一致する
// （片方だけ更新して食い違う事故を防ぐ、という元の設計意図はここで保つ）。
//
// 語を必ず併記する（design-rules.md 原則2）。

import { basename } from '../lib/format';
import type { PaneLeaf } from './paneTree';

const PTY_KIND_LABEL: Record<PaneLeaf['ptyKind'], string> = {
  shell: 'zsh',
  claude: 'claude',
  gemini: 'gemini',
};

/**
 * そのペインで何が動いているかを表す文字列（例: `claude・my-repo` / `zsh・(不明)`）。
 *
 * **`leaf.title` を参照しない。** `title` はユーザーが書き換えられるので、
 * これを混ぜると「何が動いているか」を示すものが画面から消えうる。
 * `ptyKind` / `isResume` / `cwd` から独立に組み立てる。
 */
export function paneKindLabel(leaf: PaneLeaf): string {
  const kind = PTY_KIND_LABEL[leaf.ptyKind];
  const kindLabel = leaf.isResume ? `${kind} (再開)` : kind;
  return `${kindLabel}・${basename(leaf.cwd)}`;
}

/**
 * ヘッダに実際に描く文字列（可視・単一スロット）。
 *
 * ユーザーが名前を付けていれば**その名前だけ**、付けていなければ
 * `paneKindLabel`。判定は `leaf.renamed`（rename の経路でだけ立つフラグ）で行い、
 * **`title` の文字列比較はしない**（paneTree.ts の `renamed` コメント参照）。
 *
 * 名前が空白だけになる経路は `renamePane` 側が弾く（trim 後の空文字は無視）が、
 * 外部フォーマット由来の値が回り込む可能性を考えて、ここでも空なら
 * `paneKindLabel` へ縮退させる（鉄則5）。
 */
export function paneHeaderLabel(leaf: PaneLeaf): string {
  if (leaf.renamed === true && leaf.title.trim() !== '') return leaf.title;
  return paneKindLabel(leaf);
}

/**
 * そのペインを説明する完全な文字列。**`title` 属性（ツールチップ）と
 * `role="group"` の `aria-label` の両方に使う。**
 *
 * **可視テキストを先頭に置く**（WCAG 2.5.3 Label in Name）。`TabBar.tsx` の
 * `tabAccessibleLabel` が同じ問題に対して既に採っている組み立て方に揃えてある
 * （このアプリの中で名前の作り方が2通りにならないようにする）。
 *
 * 名前を付けていないペインでは可視テキスト = `paneKindLabel` なので、
 * 同じ文字列を2回並べない。
 *
 * **終了状態をここに入れる。** xterm は WebGL レンダラで canvas に描くため、
 * `screenReaderMode` が false のペイン（＝分割中の非アクティブなペイン全部）は
 * 支援技術から見て中身が空で、`useTerminal.ts` が終了時にスクロールバックへ
 * 書く `[プロセスは終了しました…]` の行が**読み上げには一切届いていない**。
 * ヘッダの文字列がその唯一の情報源になる。
 *
 * **live region は増やさない**（S37 / S48 が「露出している live region は1個」を
 * 固定している）。ここは要素の名前であって、変化を告知する仕組みではない。
 */
export function paneAccessibleLabel(leaf: PaneLeaf): string {
  const visible = paneHeaderLabel(leaf);
  const kind = paneKindLabel(leaf);
  return [visible, visible === kind ? undefined : kind, leaf.exit === undefined ? undefined : '終了']
    .filter((part): part is string => part !== undefined)
    .join('、');
}
