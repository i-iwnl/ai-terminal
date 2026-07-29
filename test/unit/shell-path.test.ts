// ログインシェル PATH の切り出しとマージ。
//
// Finder 起動の .app は launchd の最小 PATH しか継承しない（Issue #40）。
// 切り出しは rc ファイルの echo ノイズに耐えること、マージは既存 PATH の
// 優先順位（E2E の偽 CLI 隔離を含む）を崩さないことが要件。

import { describe, expect, it } from 'vitest';
import {
  buildProbeCommand,
  extractDelimitedPath,
  mergePathEntries,
  shouldAttemptRetry,
} from '../../src/main/shell-path';

const D = '__AI_TERMINAL_PATH__';

describe('extractDelimitedPath', () => {
  it('目印に挟まれた PATH を取り出す', () => {
    expect(extractDelimitedPath(`${D}/usr/bin:/bin${D}`)).toBe('/usr/bin:/bin');
  });

  it('rc ファイルが前後に何を出力していても影響を受けない', () => {
    const stdout = `welcome banner\n${D}/opt/homebrew/bin:/usr/bin${D}\ntrailing noise`;
    expect(extractDelimitedPath(stdout)).toBe('/opt/homebrew/bin:/usr/bin');
  });

  it('目印が無い・片方しか無い場合は undefined', () => {
    expect(extractDelimitedPath('/usr/bin:/bin')).toBeUndefined();
    expect(extractDelimitedPath(`${D}/usr/bin:/bin`)).toBeUndefined();
  });

  it('中身が空なら undefined', () => {
    expect(extractDelimitedPath(`${D}${D}`)).toBeUndefined();
    expect(extractDelimitedPath(`${D}  ${D}`)).toBeUndefined();
  });
});

describe('mergePathEntries', () => {
  it('既存 PATH を先頭に保ち、ログインシェル由来の不足分だけを後ろに足す', () => {
    expect(mergePathEntries('/fake-bin:/usr/bin', '/Users/x/.local/bin:/usr/bin')).toBe(
      '/fake-bin:/usr/bin:/Users/x/.local/bin',
    );
  });

  it('既存 PATH の順序を変えない（先に見つかる方が勝つ状態を維持する）', () => {
    expect(mergePathEntries('/a:/b', '/b:/a:/c')).toBe('/a:/b:/c');
  });

  it('既存 PATH が未設定ならログインシェルの PATH をそのまま使う', () => {
    expect(mergePathEntries(undefined, '/usr/bin:/bin')).toBe('/usr/bin:/bin');
  });

  it('空エントリ（連続コロン等）を持ち込まない', () => {
    expect(mergePathEntries('/a::/b', '::/c')).toBe('/a:/b:/c');
  });
});

describe('buildProbeCommand', () => {
  it('$PATH の直後に目印を続けない（変数名として食われて空に展開される）', () => {
    // `"$PATH__目印__"` はシェルが PATH__目印__ という1つの未定義変数として解釈する。
    // 実際にパッケージ版の PATH 補完が全く効かない原因になった（Issue #40）。
    expect(buildProbeCommand('__D__')).not.toMatch(/\$PATH[A-Za-z0-9_]/);
  });

  it('目印で挟んだ PATH を printf で出力するコマンドになっている', () => {
    expect(buildProbeCommand('__D__')).toBe(`printf '%s' "__D__\${PATH}__D__"`);
  });
});

describe('shouldAttemptRetry', () => {
  const base = { attemptCount: 0, lastAttemptAt: 0, inFlight: false };

  it('最短間隔が空いていれば試行してよい', () => {
    expect(shouldAttemptRetry({ ...base, lastAttemptAt: 0 }, 15_000, 15_000, 5)).toBe(true);
  });

  it('最短間隔が空いていなければ試行しない', () => {
    expect(shouldAttemptRetry({ ...base, lastAttemptAt: 1_000 }, 15_999, 15_000, 5)).toBe(false);
  });

  it('実行中は重ねて試行しない', () => {
    expect(shouldAttemptRetry({ ...base, inFlight: true }, 100_000, 15_000, 5)).toBe(false);
  });

  it('上限回数に達したら試行しない', () => {
    expect(shouldAttemptRetry({ ...base, attemptCount: 5 }, 100_000, 15_000, 5)).toBe(false);
    expect(shouldAttemptRetry({ ...base, attemptCount: 4 }, 100_000, 15_000, 5)).toBe(true);
  });
});
