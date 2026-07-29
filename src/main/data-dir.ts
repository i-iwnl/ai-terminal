// アプリのデータ保存先（~/.ai-terminal 配下: config.json / memos.json /
// session-titles.json）の決定を1箇所に集める。
//
// dev 起動（make dev）と安定版（パッケージ済み .app）を同時に使っても互いの
// 設定・メモを壊さないよう、非パッケージ実行では `-dev` サフィックスの別
// ディレクトリへ分離する。安定版が既存の ~/.ai-terminal を引き継ぐ向きに
// 揃えてある（壊れてよいのは dev 側）。
//
// E2E は out/ を electron バイナリで起動するため isPackaged が false になり、
// この分岐だけだと一時 HOME に敷いたフィクスチャを読めなくなる。そこで
// AI_TERMINAL_DATA_DIR による絶対パス指定を最優先にし、ハーネス側は
// 環境変数1つで保存先を固定する（e2e/fixtures/harness.ts）。

import { app } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 保存先の決定規則。入力から出力が閉じた純粋関数（test/unit/data-dir.test.ts）。 */
export function resolveDataDir(input: {
  isPackaged: boolean;
  envOverride: string | undefined;
  home: string;
}): string {
  if (input.envOverride) return input.envOverride;
  return join(input.home, input.isPackaged ? '.ai-terminal' : '.ai-terminal-dev');
}

/** 実行中のプロセスにおけるデータ保存先ディレクトリの絶対パス。 */
export function dataDir(): string {
  return resolveDataDir({
    isPackaged: app.isPackaged,
    envOverride: process.env.AI_TERMINAL_DATA_DIR,
    home: homedir(),
  });
}
