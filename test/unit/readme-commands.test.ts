// README の「コマンド チートシート」が Makefile から遅れていないことを確認する。
//
// **この検査を足した理由。** このリポジトリでは「ドキュメントの記述が実装から
// 遅れる」事故が繰り返し起きている。README だけでも実際に次が見つかった:
//
// - E2E のシナリオ数が「全39」と書かれていた（実際は 82）
// - `make e2e-screenshots-check` / `make css-substitution-check` が載っていなかった
// - tmux の説明が実測と**逆**だった（Issue #121）
// - 同じ項目が「`Cmd+Option+W`」と「（キー無し）」の2行に矛盾して載っていた
//
// **人が思い出すことに賭ける対策は機能しない**（Issue #120 D-1 で実証済み）ので、
// 機械で押さえる。`css-tokens.test.ts` と同じく、ソースのファイルを読んで突き合わせる型。
//
// **検査するのは「載っているか」だけで、説明文の正しさは見ない。** 説明の劣化までは
// 機械で判定できないので、そこは人が読む。ここが守るのは「Makefile に増えたのに
// README に無い」という、いちばん起きやすくて気づきにくいずれ。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MAKEFILE = readFileSync(resolve(import.meta.dirname, '../../Makefile'), 'utf8');
const README = readFileSync(resolve(import.meta.dirname, '../../README.md'), 'utf8');

/**
 * Makefile から「`## 説明` が付いたターゲット」を拾う。
 * `make` が引数なしで出すヘルプと同じ集合（Makefile の help ターゲットが
 * この形を前提に生成している）。
 */
function documentedTargets(makefile: string): string[] {
  const targets: string[] = [];
  let described = false;
  for (const line of makefile.split('\n')) {
    if (line.startsWith('## ')) {
      described = true;
      continue;
    }
    const match = line.match(/^([a-z][a-z0-9-]*):/);
    if (match) {
      if (described) targets.push(match[1]);
      described = false;
      continue;
    }
    // 空行やコメント以外が挟まったら、直前の `##` はそのターゲットの説明ではない。
    if (line.trim() !== '' && !line.startsWith('#')) described = false;
  }
  return targets;
}

/** README のチートシートの節（見出しから次の h2 まで）。 */
function cheatSheetSection(readme: string): string {
  const start = readme.indexOf('## コマンド チートシート');
  expect(start, 'README に「## コマンド チートシート」の節が無い').toBeGreaterThan(-1);
  const rest = readme.slice(start + 1);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

describe('README のコマンド チートシート', () => {
  const targets = documentedTargets(MAKEFILE);
  const sheet = cheatSheetSection(README);

  it('Makefile から説明付きターゲットを拾えている（パーサ自体の健全性）', () => {
    // パーサが壊れて 0 件になると、下の検査が全部素通りする。
    expect(targets.length).toBeGreaterThan(20);
    expect(targets).toContain('check');
    expect(targets).toContain('e2e');
  });

  it('説明付きターゲットがすべてチートシートに載っている', () => {
    // help は「`make` を引数なしで実行すると出る」と本文で説明しているので対象外。
    const missing = targets.filter((t) => t !== 'help' && !sheet.includes(`make ${t}\``));
    expect(
      missing,
      `Makefile に説明付きで存在するのに README のチートシートに無い: ${missing.join(', ')}\n` +
        '（README の「## コマンド チートシート」に `make <名前>` の形で足すこと）',
    ).toEqual([]);
  });

  it('チートシートに、実在しないコマンドを載せていない', () => {
    const listed = Array.from(sheet.matchAll(/`make ([a-z][a-z0-9-]*)`/g)).map((m) => m[1]);
    const unknown = Array.from(new Set(listed)).filter((name) => !targets.includes(name));
    expect(
      unknown,
      `README のチートシートに載っているが Makefile に無い: ${unknown.join(', ')}`,
    ).toEqual([]);
  });
});
