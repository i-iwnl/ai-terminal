#!/usr/bin/env node
//
// lint-e2e.mjs - e2e/scenarios.yml（レジストリ）と e2e/specs/（実体）の 1:1 対応を
// 機械検査するハーネス。
//
// e2e/scenarios.yml がシナリオの唯一の正。ここに書かれたシナリオと e2e/specs/ の
// spec ファイルが 1:1 対応していること、test() のタイトルがレジストリと一致して
// いることを検査する。出力形式・思想は .claude/scripts/lint-skills.sh に揃えている。
//
// YAML パースは scripts/lib/scenarios.mjs に閉じ込めてある
// （verify-screenshots.mjs と共有する。台帳の書式を変えたときに直す場所を1箇所にする）。
//
// 検査項目:
//   check1  レジストリにあって spec ファイルが存在しない
//   check2  e2e/specs/ に spec があるのにレジストリに無い
//   check3  id の重複
//   check4  spec のファイル名の接頭辞が id と一致しない
//   check5  spec 内の test() のタイトルに id が含まれていない
//   check6  spec 内の test() のタイトルがレジストリの title と一致しない（<ID> <title> 形式）
//   check7  1つの spec ファイルに test() が複数（または0個）ある
//   check8  readme: true なのに screenshot が指定されていない
//   check9  screenshot が指定されているのに docs/images/<名前> が存在しない（WARN）
//   check10 e2e/ 配下の spec が、どの playwright config の testDir / testMatch にも入っていない
//
// 出力: チェックごとに [PASS] / [FAIL] / [WARN] 理由を1行ずつ、最後に合計を表示。
// 終了コード: FAIL が1件でもあれば 1、無ければ 0（WARN は exit code に影響しない）。
//
// このスクリプトはファイルを一切書き換えない。検査のみを行う。
//
// Usage:
//   node scripts/lint-e2e.mjs
//   make e2e-lint
//

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScenarios } from './lib/scenarios.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SCENARIOS_PATH = path.join(REPO_ROOT, 'e2e', 'scenarios.yml');
const SPECS_DIR = path.join(REPO_ROOT, 'e2e', 'specs');
const IMAGES_DIR = path.join(REPO_ROOT, 'docs', 'images');

let passCount = 0;
let failCount = 0;
let warnCount = 0;

function pass(msg) {
  console.log(`[PASS] ${msg}`);
  passCount += 1;
}

function fail(msg) {
  console.log(`[FAIL] ${msg}`);
  failCount += 1;
}

function warn(msg) {
  console.log(`[WARN] ${msg}`);
  warnCount += 1;
}

/**
 * spec ファイルの中身から test('...') / test("...") / test(`...`) のタイトルを抽出する。
 * test.beforeEach / test.afterEach / test.describe 等は「test(」という並びに
 * ならないので誤検出しない。
 *
 * @param {string} content
 * @returns {string[]}
 */
function extractTestTitles(content) {
  const titles = [];
  const re = /\btest\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g;
  let m = re.exec(content);
  while (m !== null) {
    titles.push(m[2]);
    m = re.exec(content);
  }
  return titles;
}

// --- 準備 --------------------------------------------------------------------

if (!existsSync(SCENARIOS_PATH)) {
  console.log(`[FAIL] scenarios.yml が見つからない: ${SCENARIOS_PATH}`);
  console.log('----------------------------------------------');
  console.log('合計: PASS=0 FAIL=1 WARN=0');
  process.exit(1);
}

const scenariosText = readFileSync(SCENARIOS_PATH, 'utf8');
const registry = parseScenarios(scenariosText);

let specFiles = [];
if (existsSync(SPECS_DIR)) {
  specFiles = readdirSync(SPECS_DIR).filter((f) => {
    const full = path.join(SPECS_DIR, f);
    return statSync(full).isFile() && f.endsWith('.spec.ts');
  });
}

// --- check1: レジストリにあって spec ファイルが存在しない --------------------
function check1() {
  for (const entry of registry) {
    const exists = entry.spec !== '' && specFiles.includes(entry.spec);
    if (exists) {
      pass(`check1: ${entry.id} の spec (${entry.spec}) は存在する`);
    } else {
      fail(
        `check1: ${entry.id} の spec (${entry.spec || '(未指定)'}) が e2e/specs/ に無い（未実装。e2e/specs/${entry.spec || '<id>-xxx.spec.ts'} を作成すること）`,
      );
    }
  }
}

// --- check2: e2e/specs/ に spec があるのにレジストリに無い --------------------
function check2() {
  for (const file of specFiles) {
    const found = registry.some((e) => e.spec === file);
    if (found) {
      pass(`check2: e2e/specs/${file} はレジストリに登録されている`);
    } else {
      fail(
        `check2: e2e/specs/${file} が存在するが scenarios.yml に対応するエントリが無い（scenarios.yml に id/title/spec を追加すること）`,
      );
    }
  }
}

// --- check3: id の重複 ---------------------------------------------------------
function check3() {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const entry of registry) {
    counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  }
  const duplicated = [...counts.entries()].filter(([, count]) => count > 1);
  if (duplicated.length === 0) {
    pass('check3: id の重複なし');
  } else {
    for (const [id, count] of duplicated) {
      fail(`check3: id "${id}" が scenarios.yml 内で ${count} 回重複している`);
    }
  }
}

// --- check4: spec のファイル名の接頭辞が id と一致しない -----------------------
function check4() {
  for (const entry of registry) {
    if (entry.spec === '') {
      fail(`check4: ${entry.id} の spec が未指定`);
      continue;
    }
    const prefixMatch = entry.spec.match(/^([^-]+)-/);
    const prefix = prefixMatch ? prefixMatch[1] : undefined;
    if (prefix === entry.id) {
      pass(`check4: ${entry.id} と spec ファイル名の接頭辞が一致`);
    } else {
      fail(
        `check4: ${entry.id} の spec ファイル名 "${entry.spec}" の接頭辞(${prefix ?? '不明'}) が id(${entry.id}) と不一致`,
      );
    }
  }
}

// --- check5〜7: spec ファイルの中身を見る検査 ----------------------------------
function checkSpecContents() {
  for (const file of specFiles) {
    const entry = registry.find((e) => e.spec === file);
    const content = readFileSync(path.join(SPECS_DIR, file), 'utf8');
    const titles = extractTestTitles(content);

    // check7: 1 spec = 1 シナリオの原則（test() が複数、または0個）
    if (titles.length === 1) {
      pass(`check7: e2e/specs/${file} の test() は1個`);
    } else if (titles.length === 0) {
      fail(`check7: e2e/specs/${file} に test() が見つからない`);
    } else {
      fail(
        `check7: e2e/specs/${file} に test() が ${titles.length} 個ある（1 spec = 1 シナリオの原則に反する。ファイルを分割すること）`,
      );
    }

    // id の由来: ファイル名の接頭辞（レジストリの id 不一致は check4 で検出済みなので、
    // ここではファイル名そのものから機械的に取り出す）
    const idFromFilenameMatch = file.match(/^([^-]+)-/);
    const idFromFilename = idFromFilenameMatch ? idFromFilenameMatch[1] : undefined;

    // check5: タイトルに id が含まれているか
    if (titles.length === 0) {
      fail(`check5: e2e/specs/${file} は test() が無いため id の検査ができない`);
    } else if (!idFromFilename) {
      fail(`check5: e2e/specs/${file} のファイル名から id を特定できない`);
    } else {
      let allContainId = true;
      titles.forEach((title, i) => {
        if (!title.includes(idFromFilename)) {
          allContainId = false;
          fail(
            `check5: e2e/specs/${file} の test() タイトル[${i}] "${title}" に id(${idFromFilename}) が含まれていない`,
          );
        }
      });
      if (allContainId) {
        pass(`check5: e2e/specs/${file} の test() タイトルに id が含まれている`);
      }
    }

    // check6: タイトルが "<ID> <title>" 形式でレジストリと一致するか
    if (!entry) {
      // レジストリに対応エントリが無い場合は check2 で既に FAIL 済みなので、
      // ここでは比較対象が無いためスキップする（二重報告を避ける）。
      continue;
    }
    if (titles.length === 0) {
      fail(`check6: e2e/specs/${file} は test() が無いためタイトル比較ができない`);
      continue;
    }
    const expected = `${entry.id} ${entry.title}`;
    const matched = titles.some((t) => t === expected);
    if (matched) {
      pass(`check6: e2e/specs/${file} の test() タイトルがレジストリの title と一致`);
    } else {
      fail(
        `check6: e2e/specs/${file} の test() タイトル ${JSON.stringify(titles)} がレジストリの期待値 "${expected}" と一致しない`,
      );
    }
  }
}

// --- check8: readme: true なのに screenshot が指定されていない ----------------
function check8() {
  for (const entry of registry) {
    if (!entry.readme) {
      pass(`check8: ${entry.id} は readme: false（対象外）`);
      continue;
    }
    if (entry.screenshot) {
      pass(`check8: ${entry.id} は readme: true で screenshot も指定済み`);
    } else {
      fail(
        `check8: ${entry.id} は readme: true だが screenshot が未指定（README 掲載には画像が必要。screenshot を追加すること）`,
      );
    }
  }
}

// --- check9: screenshot 指定はあるが docs/images/<名前> が無い（WARN） --------
function check9() {
  for (const entry of registry) {
    if (!entry.screenshot) continue;
    const imagePath = path.join(IMAGES_DIR, entry.screenshot);
    if (existsSync(imagePath)) {
      pass(`check9: ${entry.id} の screenshot (${entry.screenshot}) は docs/images/ に存在する`);
    } else {
      warn(
        `check9: ${entry.id} の screenshot (${entry.screenshot}) が docs/images/ に無い（スクリーンショット生成は後工程のため WARN。実装が進んだら生成すること）`,
      );
    }
  }
}

// --- check10: e2e/ 配下の spec が、どのレーンにも入っていない ------------------
//
// Issue #120 D-1 の根本原因は「セレクタが壊れたこと」ではなく
// **spec ファイルの所在がどの config の testDir にも入っていなかったこと**。
// `e2e/screenshots.spec.ts` は `e2e/` 直下にあり、`playwright.config.ts` の
// `testDir: './e2e/specs'` から外れていたため、`make e2e` が全 green のまま
// 壊れた状態がマージされた（PR #86）。
//
// クラス名の静的検査ではこの事故は防げない（そのとき壊れたのは入れ子構造で、
// クラス名は両方とも実装に残っていた）。**ファイルがどのレーンに属するかを
// 直接数える**ほうが、原因に対応していて誤検知も無い。
function check10() {
  const configs = [
    { file: 'playwright.config.ts', label: '通常レーン + 撮影レーン' },
    { file: 'e2e/screenshots.playwright.config.ts', label: '撮影レーン（単独実行用）' },
    { file: 'e2e/packaged.playwright.config.ts', label: 'パッケージ版スモーク' },
  ];
  // config は TypeScript なので実行せずにテキストとして読む。
  // testDir / testMatch の値を機械的に拾えれば十分（この3本は全て文字列リテラル）。
  const configText = configs
    .map(({ file }) => {
      const full = path.join(REPO_ROOT, file);
      return existsSync(full) ? readFileSync(full, 'utf8') : '';
    })
    .join('\n');

  const specPaths = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // 生成物は対象外（.gitignore 済みのもの）
      if (entry.name === 'report' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(full, relPath);
      else if (entry.name.endsWith('.spec.ts')) specPaths.push(relPath);
    }
  };
  walk(path.join(REPO_ROOT, 'e2e'), '');

  for (const relPath of specPaths) {
    // どこかの config が、この spec を含むディレクトリか、この spec の
    // ファイル名そのものを名指ししていれば、いずれかのレーンに入っている。
    const dir = path.dirname(relPath);
    const base = path.basename(relPath);
    const coveredByDir = dir !== '.' && configText.includes(`e2e/${dir}`);
    const coveredByName = configText.includes(base);
    if (coveredByDir || coveredByName) {
      pass(`check10: e2e/${relPath} はいずれかのレーンに入っている`);
    } else {
      fail(
        `check10: e2e/${relPath} がどの playwright config の testDir / testMatch にも入っていない` +
          `（このファイルは1度も実行されない。config 側に足すか、既存のレーンのディレクトリへ移すこと）`,
      );
    }
  }
}

// --- 実行 --------------------------------------------------------------------
check1();
check2();
check3();
check4();
checkSpecContents();
check8();
check9();
check10();

console.log('----------------------------------------------');
console.log(`合計: PASS=${passCount} FAIL=${failCount} WARN=${warnCount}`);

process.exit(failCount > 0 ? 1 : 0);
