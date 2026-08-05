import { describe, expect, it } from 'vitest';
import { describeSpawnError } from '../../src/renderer/src/tabs/spawnErrorCopy';

/**
 * Issue #146（#180 周1）。
 *
 * **この判定は E2E から踏めない**（理由と実測は `spawnErrorCopy.ts` の冒頭）。
 * node-pty は exec の失敗を**子プロセス側で非同期に返す**ので、
 * 存在しないシェルを指定しても spawn は投げず「終了しました（コード 1）」になる。
 * だからここで直接固定する。
 */
describe('describeSpawnError', () => {
  it('claude / gemini が見つからないときは、次の行動になる文言を出す', () => {
    for (const kind of ['claude', 'gemini'] as const) {
      for (const message of [
        'spawn claude ENOENT',
        'Error: command not found: claude',
        'no such file or directory',
        // 大文字小文字を区別しない（node-pty / OS によって綴りが揺れる）
        'SPAWN GEMINI Enoent',
      ]) {
        expect(describeSpawnError(new Error(message), kind)).toBe(
          `${kind} コマンドが見つかりません。PATH を確認してください。`,
        );
      }
    }
  });

  it('シェルは「見つからない」でも PATH の話にしない', () => {
    // 決定順が `config.shell -> $SHELL -> /bin/zsh` なので、シェルが見つからないのは
    // PATH ではなく設定かシステムの問題。**PATH を確認させると外れた指示になる。**
    expect(describeSpawnError(new Error('spawn /bin/nope ENOENT'), 'shell')).toBe(
      '起動に失敗しました: spawn /bin/nope ENOENT',
    );
  });

  it('CLI 不在以外の失敗は、原因をそのまま見せる', () => {
    expect(describeSpawnError(new Error('forkpty(3) failed.'), 'claude')).toBe(
      '起動に失敗しました: forkpty(3) failed.',
    );
    expect(describeSpawnError(new Error('不正な pty:spawn リクエストです'), 'shell')).toBe(
      '起動に失敗しました: 不正な pty:spawn リクエストです',
    );
  });

  it('Error でないものを投げられても落ちない', () => {
    // Main からの reject は構造化クローンを通るので、必ずしも Error とは限らない。
    expect(describeSpawnError('文字列のエラー', 'shell')).toBe(
      '起動に失敗しました: 文字列のエラー',
    );
    expect(describeSpawnError(undefined, 'shell')).toBe('起動に失敗しました: undefined');
    expect(describeSpawnError({ code: 'ENOENT' }, 'claude')).toBe(
      // ⚠ **オブジェクトは `String()` で `[object Object]` になり、ENOENT を含まない。**
      // つまり **Main が Error 以外で reject すると、CLI 不在の分岐に入らない**。
      // いまの Main は必ず Error にして投げる（`manager.ts` の catch）ので実害は無いが、
      // そこを変えたらこのテストが落ちる。
      '起動に失敗しました: [object Object]',
    );
  });
});
