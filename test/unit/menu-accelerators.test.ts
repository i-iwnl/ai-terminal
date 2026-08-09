// `src/main/menu.ts` の accelerator 付きメニュー項目が、必ず
// `registerAccelerator: false` を伴っていることをテキストとして検査する（Issue #144）。
//
// **なぜ実行時に見られないのか。** メニューとキーボードの二重発火（Main の
// ネイティブメニューと Renderer の `matchShortcut()` が同じキーを両方拾い、
// `Cmd+T` 一回でタブが2枚開く）は、E2E では**構造上観測できない**:
//
// - Playwright の `keyboard.press()` は Renderer に合成キーイベントを送るだけで、
//   ネイティブメニューの accelerator 経路を通らない
// - `MenuItem` インスタンスから `registerAccelerator` は読めない（実測で全項目 undefined）。
//   `Menu.getApplicationMenu()` を歩いても判定材料にならない
//
// そこで**ソースをテキストとして読む**。`readme-commands.test.ts` / `css-tokens.test.ts`
// と同じ型で、**Electron を起動しない**（起動しても上のとおり読めないので意味がない）。
//
// 実際に踏んだ事故: `role: 'zoomIn' / 'zoomOut' / 'resetZoom'` は `actionItem()` を
// 通らないため `registerAccelerator: false` が付かず、`Cmd+-` / `Cmd+0` が
// Renderer 全体の拡大率を変え、しかも `config.json` に保存されないので次回起動で
// 戻っていた（Issue #120 周1 で `role` を外して `AppConfig.fontSize` に付け替えた）。
//
// **`role:` が暗黙に持つ accelerator は、この検査の対象外。** ソースに
// `accelerator:` の文字が現れないので原理的に拾えない。そちらは
// `e2e/specs/S36-application-menu.spec.ts` の `roles` ブラックリストが担当する。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MENU_PATH = resolve(import.meta.dirname, '../../src/main/menu.ts');
const MENU = readFileSync(MENU_PATH, 'utf8');

/**
 * `actionItem()` を通さずに `accelerator:` を直接書いてよい項目と、その理由。
 *
 * **黙って飛ばさない。** 許可した項目も `registerAccelerator: false` の検査は受ける
 * （下の `it` を参照）。ここに載っているのは「`actionItem()` を通さない理由がある」
 * という意味であって、「二重発火を気にしなくてよい」という意味ではない。
 */
const ALLOWED_RAW_ACCELERATOR_LABELS: ReadonlyMap<string, string> = new Map([
  [
    '設定...',
    '設定は独立ウィンドウなので Main 側で完結する（AppAction を Renderer へ送らないため actionItem() を使えない）',
  ],
  // Issue #135: ターミナル面の右クリックメニュー。項目表は
  // `src/shared/context-menu.ts` が決め、ここは変換して popup するだけ。
  // ラベルもアクセラレータも実行時に決まるので `actionItem()` には通せない。
  // **どちらも `registerAccelerator: false` を明示している**（下の it が検査する）。
  [
    '動的ラベル: item.label',
    'コンテキストメニューの変換部（項目表は src/shared/context-menu.ts が正。ラベルが実行時に決まるので actionItem() を通せない）',
  ],
]);

/**
 * **`registerAccelerator: false` を免除してよい項目**（Issue #244）。
 *
 * ⛔ **ここに足すのは、Electron のネイティブ role で、かつ Renderer が同じキーを
 * 1つも拾わないと単体テストで証明できている場合だけ。**
 * ネイティブ role は OS 側がキーを処理するので、`registerAccelerator: false` にすると
 * **メニューをクリックする以外に到達手段が無くなる**（キーが表示だけの飾りになる）。
 *
 * 二重発火の心配が無いことの根拠は `test/unit/renderer-lib.test.ts` に置く
 * （`matchShortcut` がそのキーで `null` を返すことを assert している）。
 * **免除の根拠を「たぶん被らない」で書かないこと。**
 */
const ALLOWED_NATIVE_ROLE_ACCELERATOR_LABELS: ReadonlyMap<string, string> = new Map([
  [
    'ウィンドウを閉じる',
    'role: close はネイティブ。既定の accelerator が Cmd+W（= ペインを閉じる）と衝突するので ' +
      'Cmd+Shift+W へ明示的に振り替えている。Renderer が Cmd+Shift+W を拾わないことは ' +
      'renderer-lib.test.ts が固定している',
  ],
]);

/**
 * コメントと文字列の中身を同じ長さの `_` で潰す。
 *
 * **長さを保つ**ので、返り値のインデックスは元のソースのインデックスと一致する。
 * ブレースの対応を数えるとき、`` `${appName} について` `` のような
 * テンプレートリテラルの `${` に釣られないようにするために要る。
 */
function maskStringsAndComments(source: string): string {
  const out = source.split('');
  let i = 0;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== '\n') out[k] = '_';
    }
  };
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === ch) break;
        j += 1;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/**
 * `accelerator:` を持つオブジェクトリテラルを、元のソースの文字列として返す。
 *
 * `actionItem()` は accelerator を**位置引数**で受け取る（`accelerator,` の
 * ショートハンドで組み立てる）ので、ここには現れない。**現れるのは
 * `actionItem()` を通さずに直接書いた項目だけ**、というのがこの検査の要点。
 */
function objectLiteralsWithRawAccelerator(source: string): string[] {
  const masked = maskStringsAndComments(source);
  const literals: string[] = [];
  const seen = new Set<number>();

  for (const match of masked.matchAll(/\baccelerator\s*:/g)) {
    const at = match.index;

    // 囲っているオブジェクトリテラルの `{` まで後ろ向きに数える。
    let depth = 0;
    let start = -1;
    for (let k = at - 1; k >= 0; k -= 1) {
      if (masked[k] === '}') depth += 1;
      else if (masked[k] === '{') {
        if (depth === 0) {
          start = k;
          break;
        }
        depth -= 1;
      }
    }
    if (start === -1) continue;
    if (seen.has(start)) continue;
    seen.add(start);

    // 対応する `}` まで前向きに数える。
    let end = -1;
    depth = 0;
    for (let k = start; k < masked.length; k += 1) {
      if (masked[k] === '{') depth += 1;
      else if (masked[k] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = k + 1;
          break;
        }
      }
    }
    if (end === -1) continue;

    literals.push(source.slice(start, end));
  }
  return literals;
}

/**
 * リテラルから `label: '...'` を拾う。
 *
 * **ラベルが実行時に決まる項目**（`label: item.label` のような式）は
 * `動的ラベル: <式>` という安定した文字列に畳む。リテラルの冒頭をそのまま
 * 返すと、無関係な整形の変更で許可リストが壊れて意味の無い赤が出る。
 */
function labelOf(literal: string): string {
  const asString = /label\s*:\s*(['"`])([^'"`]*)\1/.exec(literal);
  if (asString) return asString[2];
  const asExpr = /label\s*:\s*([A-Za-z_$][\w$.]*)/.exec(literal);
  if (asExpr) return `動的ラベル: ${asExpr[1]}`;
  return literal.slice(0, 60).replace(/\s+/g, ' ');
}

describe('メニューの accelerator と registerAccelerator', () => {
  const raw = objectLiteralsWithRawAccelerator(MENU);

  it('パーサ自体が健全である（0件になって素通りしない）', () => {
    // このリポジトリの menu.ts には、`actionItem()` を通さない accelerator 付き項目が
    // 少なくとも1件（「設定...」）ある。0件になったらパーサが壊れている。
    expect(
      raw.length,
      'menu.ts から accelerator: を持つオブジェクトリテラルを1つも見つけられなかった。' +
        'maskStringsAndComments / objectLiteralsWithRawAccelerator を確認すること',
    ).toBeGreaterThan(0);
    // マスクが効いていること（テンプレートリテラルの `${` を数えていたら、
    // 囲みの特定がずれて label を拾えなくなる）。
    expect(raw.every((literal) => literal.startsWith('{') && literal.endsWith('}'))).toBe(true);
  });

  it('actionItem() 自身が registerAccelerator: false を付けている', () => {
    // 全項目の大半はここを通る。ここが外れると、下の検査は「対象0件」で
    // 全部素通りする（**この検査が無いと、いちばん効く壊れ方に赤くならない**）。
    const start = MENU.indexOf('function actionItem(');
    expect(start, 'menu.ts に actionItem() の定義が無い').toBeGreaterThan(-1);
    const body = MENU.slice(start, MENU.indexOf('\n}', start));
    expect(body).toContain('registerAccelerator: false');
    expect(body).toContain('accelerator,');
  });

  it('actionItem() を通さない accelerator 付き項目が、許可リストと一致する', () => {
    // 同じ形の変換部が2つある（role 用と action 用）ので重複を畳んでから比べる。
    const labels = Array.from(new Set(raw.map(labelOf))).sort();
    const allowed = [
      ...ALLOWED_RAW_ACCELERATOR_LABELS.keys(),
      ...ALLOWED_NATIVE_ROLE_ACCELERATOR_LABELS.keys(),
    ].sort();
    expect(
      labels,
      'accelerator を直接書いたメニュー項目が増減している。' +
        '新しく足したなら actionItem() を通すこと。通せない理由があるなら ' +
        'ALLOWED_RAW_ACCELERATOR_LABELS に理由付きで載せること',
    ).toEqual(allowed);
  });

  it('accelerator を直接書いた項目は、すべて registerAccelerator: false を書いている', () => {
    const missing = raw
      .filter((literal) => !ALLOWED_NATIVE_ROLE_ACCELERATOR_LABELS.has(labelOf(literal)))
      .filter((literal) => !/registerAccelerator\s*:\s*false/.test(literal));
    expect(
      missing.map(labelOf),
      'accelerator を持つのに registerAccelerator: false が無い。' +
        'Main と Renderer の両方が同じキーを拾い、1回の打鍵で2回発火する',
    ).toEqual([]);
  });
});
