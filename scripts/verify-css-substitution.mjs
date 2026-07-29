#!/usr/bin/env node
//
// トークンへの「置換」が値を変えていないことを証明する。
//
// Issue #20 の Phase 1 は「置換（PR 3-4）」と「値の変更（PR 5）」を分けるのが設計そのもの。
// その前提は、置換 PR で**見た目が1ピクセルも変わらない**こと。
//
// 目視では守れない（33種類の近い色がある）し、E2E も画像も
// 「色が少し違う」を検出しない。ここでは styles.css のトークンを機械的に展開し、
// 比較対象（既定は HEAD）の CSS と文字列として一致するかを見る。
//
// Usage:
//   node scripts/verify-css-substitution.mjs [比較対象のリビジョン]
//
// 終了コード: 0 = 一致（置換のみ）、1 = 不一致（値が変わっている）
//
// **値を変える PR では、このスクリプトは当然落ちる。** そのときは止めるのではなく、
// 落ちた出力（下の `-` / `+` の行差分）を PR 本文に貼って、意図した変更の表と突き合わせる。
// 「表に無い `+` 行が1本でもあれば意図しない変更」という機械的な受け入れ基準になる。
// 展開後の全宣言を行単位で出すので、スクリーンショットより精度が高い。
//
// **比較対象の既定は `origin/main`。** 以前は `HEAD` だったが、コミットしてから
// ローカルで叩くと**自分自身と比較して必ず PASS する**（何も検証していないのに緑になる）。
// 作業中の未コミットの変更を見たいときだけ `REV=HEAD` を明示すること。

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const CSS_PATH = 'src/renderer/src/styles.css';
const BASE_REV = process.argv[2] ?? 'origin/main';

function stripRoot(css) {
  const start = css.indexOf(':root {');
  if (start === -1) return css;
  const end = css.indexOf('\n}\n', start) + 3;
  return css.slice(0, start) + css.slice(end);
}

function rootBlock(css) {
  const start = css.indexOf(':root {');
  if (start === -1) return '';
  return css.slice(start, css.indexOf('\n}\n', start));
}

/** var(--x) をすべて宣言値へ展開する（入れ子も解けるまで回す） */
function expandTokens(css) {
  const tokens = new Map(
    [...rootBlock(css).matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]),
  );
  let out = stripRoot(css);
  for (let i = 0; i < 5 && out.includes('var(--'); i += 1) {
    out = out.replace(/var\((--[a-z0-9-]+)\)/g, (whole, name) => tokens.get(name) ?? whole);
  }
  return out;
}

/** 色の表記ゆれ（#fff / #ffffff）と空行・末尾空白・コメントを吸収する
 *
 * コメントを比較対象から外すのは、**置換に伴ってコメントを直せなくなる**ため。
 * 「既定色 #666 のまま」のような記述は、置換した瞬間に嘘になる。
 * コメントは描画に影響しないので落として構わない。
 * **宣言をコメントアウトして消す改変は、宣言の行そのものが消えるので従来どおり検出できる。**
 */
function normalize(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/#[0-9a-fA-F]{3,6}\b/g, (hex) => {
      const body = hex.slice(1).toLowerCase();
      return `#${body.length === 3 ? [...body].map((c) => c + c).join('') : body}`;
    })
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}

const current = normalize(expandTokens(readFileSync(CSS_PATH, 'utf8')));
const baseCss = execFileSync('git', ['show', `${BASE_REV}:${CSS_PATH}`], { encoding: 'utf8' });
const base = normalize(expandTokens(baseCss));

if (current.length === base.length && current.every((line, i) => line === base[i])) {
  console.log(`[PASS] トークンを展開すると ${BASE_REV} の CSS と一致する（置換のみで値は据え置き）`);
  process.exit(0);
}

console.log(`[FAIL] トークンを展開した結果が ${BASE_REV} と一致しない（値が変わっている）`);

// **出現回数まで見る。** 集合で比べると「4箇所あった 10px が1箇所になった」のように
// 既に存在する値へ寄せた変更が1行も出ない（相手の値が base にも current にもあるため）。
// 値を変える PR ではこれが主な変更の形なので、集合比較では受け入れ基準として使えない。
const countBy = (lines) => {
  const out = new Map();
  for (const line of lines) out.set(line, (out.get(line) ?? 0) + 1);
  return out;
};
const baseCount = countBy(base);
const currentCount = countBy(current);
for (const line of new Set([...baseCount.keys(), ...currentCount.keys()])) {
  const b = baseCount.get(line) ?? 0;
  const c = currentCount.get(line) ?? 0;
  if (b === c) continue;
  if (c === 0) console.log(`  - ${line} (${b}箇所 -> 0)`);
  else if (b === 0) console.log(`  + ${line} (0 -> ${c}箇所)`);
  else console.log(`  ~ ${line} (${b}箇所 -> ${c}箇所)`);
}
process.exit(1);
