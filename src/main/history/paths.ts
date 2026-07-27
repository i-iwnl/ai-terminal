// Claude Code のセッション履歴ディレクトリの命名規則に関するパス操作のみを担当する。
// ファイル I/O は一切含めない（テストしやすくするため純粋関数のみ置く）。

import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Claude Code が `~/.claude/projects/` 配下のディレクトリ名として使う
 * エンコード規則：作業ディレクトリの絶対パスの "/" を "-" に単純置換するだけ。
 *
 * 注意：元のディレクトリ名にハイフンが含まれる場合と区別できないため、
 * この変換は非可逆。逆変換で元のパスを復元しようとしてはいけない。
 * cwd 側から同じ変換をかけて「照合」する用途にのみ使うこと。
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

/** 指定した作業ディレクトリに対応する Claude のセッション履歴ディレクトリの絶対パス。 */
export function projectHistoryDir(cwd: string): string {
  return join(homedir(), '.claude', 'projects', encodeProjectDir(cwd));
}
