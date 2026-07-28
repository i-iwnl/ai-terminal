// 通知音の探索規則。
//
// 「設定した音が鳴らない」は無音になるだけで例外を出さない設計なので、
// 規則が壊れても気づけない。どこを・どの順で探すかをここで固定する。
//
// fs に触る resolveSoundPath / listSounds そのものは対象外（vitest の対象は
// 外部に触れない純粋関数だけ）。存在確認の手前までを切り出した
// soundCandidatePaths / toSoundNames を検証し、実在する音源に依存する分岐は
// E2E（S31 の試聴）と手動確認（Issue #9）に委ねる。

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOUND_ID,
  soundCandidatePaths,
  toSoundNames,
} from '../../src/main/notify/sound';

describe('soundCandidatePaths', () => {
  it('既定（空文字）はどこも探さない', () => {
    // 候補が空 = resolveSoundPath が undefined を返す = OS 既定に任せる
    expect(soundCandidatePaths(DEFAULT_SOUND_ID)).toEqual([]);
    expect(DEFAULT_SOUND_ID).toBe('');
  });

  it('/ 始まりは絶対パスとしてそのまま1件だけ返す', () => {
    // 拡張子を補ったり探索先と結合したりしない
    expect(soundCandidatePaths('/Users/me/Sounds/bell.wav')).toEqual([
      '/Users/me/Sounds/bell.wav',
    ]);
    // 拡張子が無くても補完しない（ユーザーが書いたパスを尊重する）
    expect(soundCandidatePaths('/tmp/bell')).toEqual(['/tmp/bell']);
  });

  it('音源名は探索先ごとに拡張子違いを総当たりする', () => {
    const candidates = soundCandidatePaths('Glass', ['/A', '/B']);

    // 先に渡したディレクトリの候補が先に来る（~/Library/Sounds がシステムに優先する）
    expect(candidates[0].startsWith('/A/')).toBe(true);
    expect(candidates.at(-1)?.startsWith('/B/')).toBe(true);

    expect(candidates).toContain('/A/Glass.aiff');
    expect(candidates).toContain('/A/Glass.wav');
    expect(candidates).toContain('/B/Glass.aiff');
    // 拡張子は afplay が扱えるものだけ
    expect(candidates.some((p) => p.endsWith('.txt'))).toBe(false);
    expect(candidates).toHaveLength(new Set(candidates).size);
  });

  it('探索先が空なら候補も空になる', () => {
    expect(soundCandidatePaths('Glass', [])).toEqual([]);
  });
});

describe('toSoundNames', () => {
  it('扱えない拡張子を落とし、拡張子を外して昇順に並べる', () => {
    expect(toSoundNames(['Submarine.aiff', 'Glass.aiff', 'README.txt', 'Ping.wav'])).toEqual([
      'Glass',
      'Ping',
      'Submarine',
    ]);
  });

  it('拡張子は大文字でも受け付ける', () => {
    expect(toSoundNames(['Glass.AIFF'])).toEqual(['Glass']);
  });

  it('同じ名前は拡張子が違っても1件に畳む', () => {
    // ~/Library/Sounds と /System/Library/Sounds に同名があっても一覧が重複しない
    expect(toSoundNames(['Glass.aiff', 'Glass.wav', 'Glass.m4a'])).toEqual(['Glass']);
  });

  it('拡張子が無いファイルは一覧に出さない', () => {
    expect(toSoundNames(['Glass', '.DS_Store'])).toEqual([]);
  });

  it('空の入力は空の一覧になる', () => {
    expect(toSoundNames([])).toEqual([]);
  });
});
