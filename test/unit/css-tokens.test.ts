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
import {
  BAR_HEIGHT_PX,
  TRAFFIC_LIGHT_SIZE_PX,
  trafficLightCenterY,
  trafficLightY,
} from '@shared/windowChrome';

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
    //
    // **--lh-tight と --sp-6 は PR 19（Issue #20 H・#92）で使用箇所ができたので、
    // ここから外した。** 使われている以上、この許容リストに残すこと自体が
    // 「まだ未参照である」という嘘になる（css-tokens.test.ts 自身の
    // 「重複の許容リストに、もう重複していない名前が残っていない」と同じ理由）。
    const allowedUnused = new Set<string>([]);

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

describe('ウィンドウ上端の帯の高さ（Issue #119 周1）', () => {
  // タブバーの高さは2箇所で必要になる。`.tab-bar` 自身の `height` と、その直下へ
  // 絶対配置する `.notice-list` の `top`。以前は両方に `36px` がリテラルで
  // 書かれていた。
  //
  // **片方だけ動かすと、通知バナーがタブバーに重なる。** そのとき隠れるのは
  // 「キーボードでフォーカス中のタブ」なので、WCAG 2.4.11（Focus Not Obscured,
  // AA）の違反になる。E2E は通知バナーを出すのに実際のユーザー操作から到達できず
  // （S44 の note が同じ制約を記録している）、この重なりを検出できない。
  // ここで CSS の記述そのものを見る。

  function ruleBody(selector: string): string {
    const start = rest.indexOf(`\n${selector} {`);
    expect(start, `${selector} の規則が見つからない`).toBeGreaterThan(-1);
    const end = rest.indexOf('\n}', start);
    return rest.slice(start, end);
  }

  it('--bar-height が宣言されている', () => {
    expect(root).toMatch(/--bar-height:\s*\d+px;/);
  });

  // CSS 変数は Main プロセスから読めないので、帯の高さは styles.css と
  // src/shared/windowChrome.ts の2箇所に存在する。**構造的に統一できない**
  // （SURFACE と同じ状況）。機械で突き合わせる。
  it('CSS の --bar-height と BAR_HEIGHT_PX が一致する', () => {
    const declared = /--bar-height:\s*(\d+)px;/.exec(root);
    expect(declared, '--bar-height の宣言が読めていない').not.toBeNull();
    expect(Number(declared?.[1])).toBe(BAR_HEIGHT_PX);
  });

  it('.sidebar__drag-region の高さも --bar-height を参照している（段差を作らない）', () => {
    // 周5 まで 40px のリテラルで、タブバー（36px）と 4px の段差があった
    // （#20 の K-4「継ぎ目が折れている」）。
    expect(ruleBody('.sidebar__drag-region')).toMatch(/height:\s*var\(--bar-height\)/);
  });

  it('信号機の光学中心が帯の中心と一致する', () => {
    // **これは実行時には観測できない。** 信号機はネイティブの NSButton で
    // DOM に存在せず、Electron には trafficLightPosition を読み戻す API も無い
    // （`getTrafficLightPosition` は Electron 43 に存在しない。E2E で実際に
    // 呼んで確認した）。だから導出を windowChrome.ts に集めてここで固定する。
    expect(trafficLightCenterY(BAR_HEIGHT_PX)).toBe(BAR_HEIGHT_PX / 2);
    // `#20` の「44px にすれば光学中心 22 と合う」は二重に誤りだった。
    // (1) `{ y: 16 }` のときの中心は `16 + 14/2 = 23`（22 ではない）
    // (2) trafficLightPosition は自由に動かせるので、帯を信号機に合わせる必要が無い
    expect(16 + TRAFFIC_LIGHT_SIZE_PX / 2).toBe(23);
    expect(trafficLightY(36)).toBe(11);
  });

  it('.tab-bar の height が --bar-height を参照している', () => {
    expect(ruleBody('.tab-bar')).toMatch(/height:\s*var\(--bar-height\)/);
  });

  it('.notice-list の top が --bar-height を参照している（リテラルの複製を作らない）', () => {
    const body = ruleBody('.notice-list');
    expect(body).toMatch(/top:\s*calc\(var\(--bar-height\)/);
    // 「calc の中に --bar-height はあるが、別の場所に 36px も残っている」を防ぐ。
    expect(body).not.toMatch(/\b36px\b/);
  });

  // --- ペインヘッダの高さ（Issue #138。#160 の周5）-----------------------------
  //
  // 分割中だけ出る帯の高さが 18px のリテラルで3箇所に散っていた。
  // **タブバーの --bar-height とは別のトークンにする**（用途が違い、揃える理由が無い。
  // 値を共有すると片方を動かしたときにもう片方が黙って動く）。
  //
  // **この検査が無いと、リテラルへの逆戻りを誰も見ない。** `make css-substitution-check`
  // は「置換で値が変わっていないこと」を証明するが、**次に誰かが 18px を
  // 直接書き戻しても値は同じなので PASS する**。
  it('--pane-header-height が宣言されている', () => {
    expect(root).toMatch(/--pane-header-height:\s*\d+px;/);
  });

  it('.pane-header の高さが --pane-header-height を参照している（リテラルを残さない）', () => {
    const body = ruleBody('.pane-header');
    expect(body).toMatch(/flex:\s*0 0 var\(--pane-header-height\)/);
    expect(body).toMatch(/height:\s*var\(--pane-header-height\)/);
    expect(body).not.toMatch(/\b18px\b/);
  });

  it('ヘッダの下へ検索バーを逃がす top も同じトークンを参照している', () => {
    // ここが取り残されると、ヘッダの高さを変えたときに検索バーだけがずれる
    // （**同じ値に依存しているのに、依存が明示されていない**箇所だった）。
    const body = ruleBody('.pane-header ~ .terminal-search');
    expect(body).toMatch(/top:\s*calc\(var\(--sp-2\) \+ var\(--pane-header-height\)\)/);
    expect(body).not.toMatch(/\b18px\b/);
  });

  it('`.notice-banner__icon` の 18px は別物なので、置換の対象にしない', () => {
    // #138 の完了条件は「styles.css に 18px が残っていない」と書かれていたが、
    // **達成不能**（アイコンの寸法は帯の高さとは無関係で、たまたま同じ値）。
    // 「`.pane-header` 系の規則に残っていない」へ読み替えた、という判断をここに固定する。
    // **たまたま同じ数値というだけの箇所を同じトークンに畳むと、意味の無い依存が生まれる。**
    expect(ruleBody('.notice-banner__icon')).toMatch(/\b18px\b/);
  });
});

describe('パネルの「範囲」と「区切り」の見た目（Issue #119 周3）', () => {
  // サイドバーの3パネルには2種類の見出しがある。
  //
  // - `.panel-scope` … パネル全体の**範囲**（`このマシン全体の Claude` 等）。1パネルに1つ
  // - `.task-group__heading` … パネル内の**区切り**（`あなたの番 2件`）。1パネルに n 個
  //
  // 周3 より前は、この2つが**宣言レベルで完全に一致していた**
  // （`.history-list__heading` と `.task-group__heading`）。履歴パネルには
  // グループ見出しが無かったので問題にならなかったが、タスクパネルは両方を持つ。
  // 同じ見た目のまま範囲の行を足すと、**同じ体裁の見出しが3つ縦に並び、
  // 1つ目だけ意味が違う**状態になる。
  //
  // 区別の手がかりは (1) 大文字化とトラッキングの有無、(2) 下線の有無 の2つ。
  // **`text-transform: uppercase` は日本語には効かない**ので、(1) が効くのは
  // 英字が混じるときだけ（`このフォルダの Claude` の `Claude`）。
  // したがって主な手がかりは (2) の下線で、そこが消えると区別が無くなる。

  function ruleBody(selector: string): string {
    const start = rest.indexOf(`\n${selector} {`);
    expect(start, `${selector} の規則が見つからない`).toBeGreaterThan(-1);
    const end = rest.indexOf('\n}', start);
    return rest.slice(start, end);
  }

  it('.panel-scope と .task-group__heading の宣言が同一ではない', () => {
    const declarations = (selector: string): string[] =>
      ruleBody(selector)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.endsWith(';'))
        .sort();

    const scope = declarations('.panel-scope');
    expect(scope.length, '.panel-scope の宣言が読めていない').toBeGreaterThan(0);
    expect(declarations('.task-group__heading')).not.toEqual(scope);
  });

  it('.panel-scope は下線を持ち、大文字化とトラッキングを持たない', () => {
    const scope = ruleBody('.panel-scope');
    // 日本語では uppercase が効かないので、下線が主な区別の手がかりになる。
    expect(scope).toMatch(/border-bottom:\s*1px solid/);
    expect(scope).not.toMatch(/text-transform/);
    expect(scope).not.toMatch(/letter-spacing/);
  });

  it('.task-group__heading は大文字化とトラッキングを持ち、下線を持たない', () => {
    const group = ruleBody('.task-group__heading');
    expect(group).toMatch(/text-transform:\s*uppercase/);
    expect(group).toMatch(/letter-spacing:\s*var\(--tracking-wide\)/);
    // グループの区切りに線を引かない理由は styles.css のコメントに書いてある
    // （サイドバーの面の上では --border-subtle が 1.31 で見えないため、
    // 「線は引いてある」と誤解したまま余白だけで区切られる状態になる）。
    expect(group).not.toMatch(/border/);
  });

  it('.memo-panel__heading はどちらとも別物のまま', () => {
    // 「同じに見えるから畳む」を防ぐ。畳むと全体メモ／セッションのメモの
    // 見出しの色と下余白が変わる。
    const memo = ruleBody('.memo-panel__heading');
    expect(memo).toMatch(/color:\s*var\(--text-primary\)/);
    expect(memo).toMatch(/margin:\s*0 0 var\(--sp-2\)/);
    expect(ruleBody('.panel-scope')).toMatch(/color:\s*var\(--text-secondary\)/);
  });
});
