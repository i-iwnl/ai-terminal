#!/usr/bin/env node
//
// verify-screenshots.mjs - README 用スクリーンショット（docs/images/）の中身が
// 実装とずれていないことを、**画素で**検査する。
//
// Issue #121 B-2。それまで `scripts/lint-e2e.mjs` の check9 は
// 「`docs/images/<名前>` が**存在するか**」しか見ておらず、しかも WARN で
// exit code に影響しなかった。そのため **README が古い画面を配布し続けても
// 誰も気づかない**（実例: `S12-task-list.png` に「busy = 応答待ち」という
// 逆の説明が焼き込まれたまま配布されていた）。
//
// このスクリプトは `make e2e` が一時ディレクトリへ吐いた撮り立ての画像と、
// コミット済みの `docs/images/` を突き合わせる。
//
// 検査項目:
//   check1  readme: true + screenshot 指定のシナリオが、実際に撮影されている
//           （撮影 spec からシナリオが抜け落ちても検出できなかった穴を塞ぐ）
//   check2  コミット済みの docs/images/<名前> が存在する
//   check3  撮り立てとコミット済みで、画素が一致する（しきい値付き）
//
// **しきい値は実測で決めた。** 同じコードで3回撮って比べたところ、
// 13枚のうち差が出たのは S31 の**1画素・1階調だけ**（106 対 107）だった
// （2026-08-03 実測）。アンチエイリアスの丸め由来のノイズで、内容の差ではない。
// そこで「どの画素も、どのチャンネルも 2 を超えて違わないこと」を条件にする。
// 内容が変われば文字やアイコンの形が動くので、この閾値は軽々と超える。
//
// **バイト比較にしていない理由**: PNG の圧縮結果は同じ画素でも一致しないため、
// 素朴なバイト比較では毎回落ちる（Issue #91 に実例あり）。
//
// 依存を増やさないため、PNG のデコードは Node 標準の zlib だけで行う
// （Playwright が吐く 8bit/RGB(A)・非インターレースの PNG だけを対象にする）。
//
// このスクリプトはファイルを一切書き換えない。検査のみを行う。
//
// Usage:
//   node scripts/verify-screenshots.mjs [--dir <撮り立ての画像があるディレクトリ>]
//   make e2e-screenshots-check
//

import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseScenarios } from './lib/scenarios.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIOS_PATH = path.join(REPO_ROOT, 'e2e', 'scenarios.yml');
const COMMITTED_DIR = path.join(REPO_ROOT, 'docs', 'images');

/** 1画素・1チャンネルあたり、この値までの差は撮影ノイズとして許容する（実測は最大 1）。 */
const MAX_CHANNEL_DELTA = 2;

/**
 * 画素比較の対象から外す画像と、その理由。
 *
 * **黙って飛ばさない。** 除外したことは [SKIP] として必ず出力する
 * （「沈黙する分岐は関門の穴」。存在の検査 = check1 / check2 は除外しない）。
 *
 * ここに足すときは、**非決定の原因を実測で突き止めてから**書くこと。
 * 「なんとなく不安定」で足すと、この仕組み自体が意味を失う。
 *
 * **除外は借金であって、置き場ではない。** Issue #179 周1（#169）で
 * `S56-split-pane.png` を外し、この表は空になった。
 * **`docs/images` 13枚のうちペインヘッダが写るのはその1枚だけ**で、
 * 除外している間はペインヘッダの見た目に関門が1つも存在しなかった。
 *
 * **除外理由に書いてあった原因は、測り直したら違っていた。** 記録は
 * 「zsh が部分行マーカー（反転表示の `%`）を出す」= シェルの出力内容そのものが
 * 非決定、と読めるものだったが、8回ずつ撮って比べた結果は次のとおり（2026-08-04 実測）:
 *
 *   現状のまま                              -> 8枚が2種類
 *   `.zshrc` に `PROMPT_EOL_MARK=''` を足す -> 8枚が2種類（マーカーは消えるが変動は残る）
 *   撮影前の待ち合わせを強くする            -> 8枚が1種類
 *
 * **正体は素朴な競合で、待てば決まるものだった。** 対処は
 * `e2e/screenshots.spec.ts` の S56 で、2枚目のペインの先頭行が
 * プロンプトそのものになるまで待つこと（`docs/images` の画像は1画素も変わっていない）。
 *
 * **教訓: ここに書く理由は「なぜ待っても無駄なのか」まで含めて疑うこと。**
 * 「実測で突き止めてから書く」だけでは足りない。**書いた原因が正しいとは限らず、
 * 誤った原因は「直せないもの」として除外を永続化する。**
 */
const KNOWN_NONDETERMINISTIC = {};

let passCount = 0;
let failCount = 0;

function pass(msg) {
  console.log(`[PASS] ${msg}`);
  passCount += 1;
}

function fail(msg) {
  console.log(`[FAIL] ${msg}`);
  failCount += 1;
}

/**
 * PNG を最小限デコードして { width, height, channels, data } を返す。
 * 8bit・カラータイプ 2(RGB) / 6(RGBA)・非インターレースのみ対応する
 * （Playwright の screenshot() が吐くのはこの形）。
 *
 * @param {Buffer} buf
 * @param {string} label エラーメッセージ用のファイル名
 */
function decodePng(buf, label) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < signature.length; i += 1) {
    if (buf[i] !== signature[i]) throw new Error(`${label}: PNG のシグネチャが不正`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;

    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      const bitDepth = buf[dataStart + 8];
      const colorType = buf[dataStart + 9];
      const interlace = buf[dataStart + 12];
      if (bitDepth !== 8) throw new Error(`${label}: bitDepth ${bitDepth} は未対応（8 のみ）`);
      if (colorType !== 2 && colorType !== 6) {
        throw new Error(`${label}: colorType ${colorType} は未対応（2 / 6 のみ）`);
      }
      if (interlace !== 0) throw new Error(`${label}: インターレース PNG は未対応`);
      channels = colorType === 2 ? 3 : 4;
    } else if (type === 'IDAT') {
      idat.push(buf.subarray(dataStart, dataStart + length));
    } else if (type === 'IEND') {
      break;
    }

    offset = dataStart + length + 4; // データ本体 + CRC
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  // フィルタの解除（PNG 仕様 9.2）。
  let rawPos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawPos];
    rawPos += 1;
    const line = raw.subarray(rawPos, rawPos + stride);
    rawPos += stride;
    const outLine = out.subarray(y * stride, (y + 1) * stride);
    const prevLine = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? outLine[x - channels] : 0; // 左
      const b = prevLine ? prevLine[x] : 0; // 上
      const c = prevLine && x >= channels ? prevLine[x - channels] : 0; // 左上
      const value = line[x];
      let restored;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + a;
          break;
        case 2:
          restored = value + b;
          break;
        case 3:
          restored = value + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          restored = value + pred;
          break;
        }
        default:
          throw new Error(`${label}: 未知のフィルタ種別 ${filter}`);
      }
      outLine[x] = restored & 0xff;
    }
  }

  return { width, height, channels, data: out };
}

/**
 * 2枚を比べ、しきい値を超えた画素の情報を返す。
 * サイズが違えば即座に「違う」とする。
 */
function comparePng(a, b) {
  if (a.width !== b.width || a.height !== b.height) {
    return { sizeMismatch: true, overCount: 0, maxDelta: 255, firstAt: null };
  }
  let overCount = 0;
  let maxDelta = 0;
  let firstAt = null;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const ia = (y * a.width + x) * a.channels;
      const ib = (y * b.width + x) * b.channels;
      // アルファは比べない（不透明な PNG 同士で、RGB の差だけを見る）。
      let delta = 0;
      for (let c = 0; c < 3; c += 1) {
        delta = Math.max(delta, Math.abs(a.data[ia + c] - b.data[ib + c]));
      }
      if (delta > maxDelta) maxDelta = delta;
      if (delta > MAX_CHANNEL_DELTA) {
        overCount += 1;
        if (!firstAt) firstAt = { x, y, delta };
      }
    }
  }
  return { sizeMismatch: false, overCount, maxDelta, firstAt };
}

// --- 実行 -------------------------------------------------------------------

const dirArgIndex = process.argv.indexOf('--dir');
const freshDir = path.resolve(
  REPO_ROOT,
  dirArgIndex >= 0 ? process.argv[dirArgIndex + 1] : path.join('e2e', '.screenshots-out'),
);

if (!existsSync(SCENARIOS_PATH)) {
  console.log(`[FAIL] scenarios.yml が見つからない: ${SCENARIOS_PATH}`);
  process.exit(1);
}
if (!existsSync(freshDir)) {
  console.log(`[FAIL] 撮り立ての画像のディレクトリが無い: ${freshDir}`);
  console.log('       先に `make e2e`（または make e2e-screenshots）を実行すること。');
  process.exit(1);
}

const scenarios = parseScenarios(readFileSync(SCENARIOS_PATH, 'utf8'));
const targets = scenarios.filter((s) => s.readme && s.screenshot);

if (targets.length === 0) {
  console.log('[FAIL] readme: true かつ screenshot 指定のシナリオが1件も無い');
  process.exit(1);
}

for (const s of targets) {
  const freshPath = path.join(freshDir, s.screenshot);
  const committedPath = path.join(COMMITTED_DIR, s.screenshot);

  // check1: 台帳に載っているのに、撮影されていない。
  if (!existsSync(freshPath)) {
    fail(
      `check1: ${s.id} は readme: true だが ${s.screenshot} が撮影されていない` +
        `（e2e/screenshots.spec.ts にこのシナリオの撮影が無いか、撮影が失敗している）`,
    );
    continue;
  }
  pass(`check1: ${s.id} は撮影されている`);

  // check2: コミット済みの画像が無い。
  if (!existsSync(committedPath)) {
    fail(`check2: docs/images/${s.screenshot} が存在しない（撮り直してコミットすること）`);
    continue;
  }
  pass(`check2: docs/images/${s.screenshot} が存在する`);

  // check3: 画素の一致。
  const skipReason = KNOWN_NONDETERMINISTIC[s.screenshot];
  if (skipReason) {
    console.log(`[SKIP] check3: ${s.screenshot} は画素比較の対象外。理由: ${skipReason}`);
    continue;
  }

  let fresh;
  let committed;
  try {
    fresh = decodePng(readFileSync(freshPath), s.screenshot);
    committed = decodePng(readFileSync(committedPath), s.screenshot);
  } catch (err) {
    fail(`check3: ${s.screenshot} のデコードに失敗した: ${err.message}`);
    continue;
  }

  const result = comparePng(fresh, committed);
  if (result.sizeMismatch) {
    fail(
      `check3: ${s.screenshot} の画像サイズが違う` +
        `（撮り立て ${fresh.width}x${fresh.height} / コミット済み ${committed.width}x${committed.height}）`,
    );
  } else if (result.overCount > 0) {
    fail(
      `check3: ${s.screenshot} の中身がコミット済みの画像とずれている` +
        `（しきい値 ${MAX_CHANNEL_DELTA} を超えた画素が ${result.overCount} 個、` +
        `最大差 ${result.maxDelta}、最初の位置 (${result.firstAt.x}, ${result.firstAt.y})）。` +
        ` **画面を意図的に変えたなら make e2e-screenshots で撮り直すこと。**`,
    );
  } else {
    pass(`check3: ${s.screenshot} の画素が一致する（最大差 ${result.maxDelta}）`);
  }
}

console.log('----------------------------------------------');
console.log(`合計: PASS=${passCount} FAIL=${failCount}`);
process.exit(failCount > 0 ? 1 : 0);
