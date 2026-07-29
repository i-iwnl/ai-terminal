// デザイントークンの宣言が、現行の CSS リテラルと 1:1 であることを確認する。
//
// Issue #20 の Phase 1 は「置換（PR 3-4）」と「値の変更（PR 5）」を分けるのが設計そのもの。
// その前提は **トークンの宣言値が、置換先で使われている実値と一致していること**。
// ここがずれていると、PR 3-4 が「値据え置き」を名乗ったまま見た目を変えてしまい、
// 画像が変わった理由を追えなくなる（置換ミスか意図した変更かが分離できない）。
//
// 目視では守れない（33種類の近い色がある）ので、機械で押さえる。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME, SURFACE } from '@shared/defaults';

const CSS = readFileSync(
  resolve(import.meta.dirname, '../../src/renderer/src/styles.css'),
  'utf8',
);

/**
 * トークンの宣言部と、それ以外を分けて返す。
 *
 * **`:root` は1つではない。** `@media (prefers-contrast: more)` の中にも
 * 上書き用の `:root` がある。あれは「本体に色を直書きした」のではなく
 * **トークンの宣言**なので、リテラル混入の検査から外す必要がある。
 *
 * - `root`: 先頭の `:root`（トークンの値の唯一の正。値の突き合わせはこれを見る）
 * - `rest`: **すべての** `:root` ブロックを取り除いた残り（= var() で書くべき場所）
 */
function splitRoot(css: string): { root: string; rest: string } {
  let first = '';
  let rest = '';
  let cursor = 0;
  for (;;) {
    const start = css.indexOf(':root {', cursor);
    if (start === -1) {
      rest += css.slice(cursor);
      break;
    }
    const end = css.indexOf('\n}', start);
    rest += css.slice(cursor, start);
    if (!first) first = css.slice(start, end);
    cursor = end + 2;
  }
  return { root: first, rest };
}

const { root, rest } = splitRoot(CSS);

/**
 * 同じ値を持つことを意図的に許すトークン。**「いま実際に衝突している」ものだけを並べる。**
 * 衝突が解消したら消すこと（消し忘れは下の「もう重複していない名前が残っていない」が捕まえる）。
 */
const INTENTIONAL_DUPLICATES = new Set<string>([
  // フォーカスリングと選択中タブの文字が、どちらも #ffffff。
  // **役割が違う**（前者は 2.4.11 のフォーカス表示、後者は選択状態の文字）。
  // どちらも「上限の色」であることに意味があるので、畳むと片方の根拠が消える。
  '--focus-ring',
  //
  // PR 5-2 で3件（--border-row / --surface-field / --surface-float）、
  // PR 5-3 で1件（--status-unknown。相方だった --text-faint が消えた）が
  // 衝突しなくなり、そのつど**下の自己検査が名前を指して落ちた**。
  // 従来の実装（許容リストを continue で読み飛ばすだけ）のままなら、
  // 消し忘れたまま永久に重複検査から外れていた。
]);

/** 色の表記ゆれ（#fff / #ffffff）を吸収して比較できる形にする */
function normalizeHex(hex: string): string {
  const body = hex.slice(1).toLowerCase();
  if (body.length === 3) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  }
  return `#${body}`;
}

/** コメントを落とす。コメント中の色や値を「使われている」と誤認しないため */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

function hexesIn(source: string): Set<string> {
  const found = stripComments(source).match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
  return new Set(found.map(normalizeHex));
}

/** CSS 本体（コメントを除く）から参照されているトークン名 */
function referencedTokens(): Set<string> {
  return new Set([...stripComments(rest).matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
}

/** :root で宣言されている色トークン（名前 -> 正規化した値） */
function colorTokens(): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of root.split('\n')) {
    const match = /^\s*(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,6})\s*;/.exec(line);
    if (match) out.set(match[1], normalizeHex(match[2]));
  }
  return out;
}

describe('デザイントークンの参照', () => {
  it('var() が参照しているトークンは、すべて宣言されている', () => {
    // 置換のときのタイプミス（var(--surface-O) など）は、CSS では黙って無視され
    // **その宣言だけが効かなくなる**。ビルドも E2E も通ってしまうので、ここで押さえる。
    const declared = new Set([...root.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));
    const referenced = new Set([...rest.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
    const undeclared = [...referenced].filter((name) => !declared.has(name));
    expect(undeclared).toEqual([]);
  });

  it('宣言した色トークンは、すべて CSS 本体から参照されている', () => {
    // PR 4 で置換が完了したので、「件数が増えた」ではなく **未参照ゼロ** を要求する。
    // 未参照の色トークンが1つでもあるということは、
    // **その色をどこかで直接リテラルで書いている**（＝ PR 5 で値を変えても反映されない）か、
    // 消し忘れのどちらかである。
    const referenced = referencedTokens();
    const unused = [...colorTokens().keys()].filter((name) => !referenced.has(name));
    expect(unused).toEqual([]);
  });

  it('色以外の未参照トークンは、理由を書いたものだけに限る', () => {
    // 尺（サイズ・余白・行間）は、段を飛ばさないために使用箇所が無くても宣言を残すことがある。
    // ただし **黙って増やせないように**、ここに名前を書かないと落ちるようにしておく。
    const allowedUnused = new Set([
      // 行間を詰めている箇所が現行に1つも無い。PR 5 の密度調整で使う。
      '--lh-tight',
      // 24px の余白が現行に1つも無い。4/8/12/16/24 の段を飛ばさないために残す。
      '--sp-6',
    ]);

    const colors = new Set(colorTokens().keys());
    const referenced = referencedTokens();
    const unused = [...root.matchAll(/^\s*(--[a-z0-9-]+):/gm)]
      .map((m) => m[1])
      .filter((name) => !colors.has(name) && !referenced.has(name) && !allowedUnused.has(name));
    expect(unused).toEqual([]);
  });
});

describe('デザイントークンの宣言', () => {
  it('色トークンが1つ以上宣言されている', () => {
    expect(colorTokens().size).toBeGreaterThan(20);
  });

  it('CSS 本体に色のリテラルが1つも残っていない', () => {
    // PR 4 で置換が完了した。以降、本体に hex を直接書くと**トークンを迂回する**ことになり、
    // PR 5 で値を変えてもその箇所だけ取り残される。リテラルの再混入をここで止める。
    //
    // 上の「宣言した色トークンはすべて参照されている」と対になっている。
    // あちらは「宣言したのに使っていない」、こちらは「宣言を使わずに直書きした」を捕まえる。
    expect([...hexesIn(rest)]).toEqual([]);
  });

  it('同じ値に対してトークンが1つだけである（重複宣言を作らない）', () => {
    // 同じ色に2つ名前が付くと、置換のときにどちらを使うかで揺れる。
    // 用途が違って同じ値なのは構わないが、その場合は片方を PR 5 で畳む前提なので
    // **意図的な重複だけを許す**（下の許容リストに理由付きで並べる）。
    const intentionalDuplicates = INTENTIONAL_DUPLICATES;

    const byValue = new Map<string, string[]>();
    for (const [name, value] of colorTokens()) {
      if (intentionalDuplicates.has(name)) continue;
      byValue.set(value, [...(byValue.get(value) ?? []), name]);
    }
    const collisions = [...byValue].filter(([, names]) => names.length > 1);
    expect(collisions).toEqual([]);
  });

  it('重複の許容リストに、もう重複していない名前が残っていない', () => {
    // 上の検査は許容リストの名前を `continue` で読み飛ばすだけなので、
    // **トークンを畳んで衝突が解消したあとも、古い名前が残ったまま通ってしまう**。
    // 一度免除された名前は以後永久に重複検査から外れる = 検査が黙って腐る。
    //
    // 許容リストは「今まさに衝突している」ものだけであるべきなので、
    // 宣言が消えた名前・衝突が解消した名前をここで落とす。
    const tokens = colorTokens();
    const stale = [...INTENTIONAL_DUPLICATES].filter((name) => {
      const value = tokens.get(name);
      if (value === undefined) return true; // 宣言ごと消えた
      // 自分以外に同じ値のトークンが無いなら、もう衝突していない
      return ![...tokens].some(([other, v]) => other !== name && v === value);
    });
    expect(stale).toEqual([]);
  });
});

describe('CSS と TypeScript の面の値', () => {
  // CSS 変数は Main プロセスから読めないので、面の色は styles.css と
  // src/shared/defaults.ts の2箇所に存在する。**構造的に統一できない。**
  //
  // このリポジトリは以前、同じ状況を「揃えてある」というコメントだけで守ろうとして失敗している
  // （Issue #20 の A-1）。機械で突き合わせる。

  it('CSS の --surface-* と SURFACE が一致する', () => {
    const tokens = colorTokens();
    expect(tokens.get('--surface-0')).toBe(normalizeHex(SURFACE.sidebar));
    expect(tokens.get('--surface-1')).toBe(normalizeHex(SURFACE.base));
    expect(tokens.get('--surface-2')).toBe(normalizeHex(SURFACE.hover));
    expect(tokens.get('--surface-3')).toBe(normalizeHex(SURFACE.raised));
  });

  it('ターミナルの背景と前景が、CSS の面・文字色と一致する', () => {
    // ずれると .terminal-pane__container の padding の分だけ、
    // xterm が塗る領域の外周に色の違う帯が出る（Issue #20 の A-2）。
    const tokens = colorTokens();
    expect(normalizeHex(DEFAULT_THEME.background)).toBe(tokens.get('--surface-1'));
    expect(normalizeHex(DEFAULT_THEME.foreground)).toBe(tokens.get('--text-terminal'));
  });
});
