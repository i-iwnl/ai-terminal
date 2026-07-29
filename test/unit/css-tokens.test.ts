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

const CSS = readFileSync(
  resolve(import.meta.dirname, '../../src/renderer/src/styles.css'),
  'utf8',
);

/** `:root { ... }` の中身と、それ以外を分けて返す */
function splitRoot(css: string): { root: string; rest: string } {
  const start = css.indexOf(':root {');
  const end = css.indexOf('\n}', start);
  return {
    root: css.slice(start, end),
    rest: css.slice(0, start) + css.slice(end + 2),
  };
}

const { root, rest } = splitRoot(CSS);

/** 色の表記ゆれ（#fff / #ffffff）を吸収して比較できる形にする */
function normalizeHex(hex: string): string {
  const body = hex.slice(1).toLowerCase();
  if (body.length === 3) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`;
  }
  return `#${body}`;
}

function hexesIn(source: string): Set<string> {
  const found = source.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
  return new Set(found.map(normalizeHex));
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

  it('宣言したトークンのうち、色は最終的にすべて参照される', () => {
    // 置換が進むまでは未参照のトークンが残るため、いまは件数だけを見る。
    // PR 4 が終わったら「未参照ゼロ」に強める。
    const referenced = new Set([...rest.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
    expect(referenced.size).toBeGreaterThan(10);
  });
});

describe('デザイントークンの宣言', () => {
  it('色トークンが1つ以上宣言されている', () => {
    expect(colorTokens().size).toBeGreaterThan(20);
  });

  it('宣言した色は、未置換ならリテラルが実在し、置換済みなら参照されている', () => {
    // 置換は段階的に進む（PR 3 で面と境界、PR 4 で残り）ので、この2つの状態を許す。
    //
    // - 未置換: 宣言した値と同じリテラルが CSS 本体にある（= 値が現行と 1:1）
    // - 置換済み: var() で参照されている
    //
    // どちらでもないトークンは、**値を間違えたか、消し忘れたか**のどちらか。
    // 置換が全部終わったら、この検査は「すべて参照されている」に強められる。
    const used = hexesIn(rest);
    const referenced = new Set([...rest.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]));
    const orphans = [...colorTokens()].filter(
      ([name, value]) => !used.has(value) && !referenced.has(name),
    );
    expect(orphans).toEqual([]);
  });

  it('同じ値に対してトークンが1つだけである（重複宣言を作らない）', () => {
    // 同じ色に2つ名前が付くと、置換のときにどちらを使うかで揺れる。
    // 用途が違って同じ値なのは構わないが、その場合は片方を PR 5 で畳む前提なので
    // **意図的な重複だけを許す**（下の許容リストに理由付きで並べる）。
    const intentionalDuplicates = new Set([
      // 行間の区切りと設定ウィンドウの面が偶然どちらも #232323。
      // PR 5 で面のほうが #2b2b2b に動くので、そこで解消される。
      '--border-row',
      // 履歴のボタン枠とインライン編集の入力欄が偶然どちらも #333333。
      '--surface-field',
      // 既定のステータスドットとタブ無し表示が偶然どちらも #666666。
      '--status-unknown',
      // 検索バーの浮いた面と区切り線が偶然どちらも #2a2a2a。
      // 用途が違うので別トークンにしてある（PR 5 で面のほうが動く）。
      '--surface-float',
    ]);

    const byValue = new Map<string, string[]>();
    for (const [name, value] of colorTokens()) {
      if (intentionalDuplicates.has(name)) continue;
      byValue.set(value, [...(byValue.get(value) ?? []), name]);
    }
    const collisions = [...byValue].filter(([, names]) => names.length > 1);
    expect(collisions).toEqual([]);
  });
});
