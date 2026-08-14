// 起動元の AI CLI セッションから継承した env の除去（Issue #253 / 2026-08-14）。
//
// **何を守っているか。** `.app` を Claude Code セッションの中から起動すると、
// 親セッションの状態を表す env がアプリに焼き付き、`buildPtyEnv` が全タブの
// 子プロセスへ配る。受け取った `claude` は自分を「子セッション」と判定して
// `~/.claude/sessions/<pid>.json` を書かなくなるため、`claude agents --json` に
// 出ず、一覧にも履歴にも現れない（実測は inherited-agent-env.ts 冒頭）。
//
// 実際の起動（`process.env` の書き換えと `ensureLoginShellPath()` との順序）は
// E2E（S120）が端から端まで見る。ここは「何を落として何を残すか」の定義を固定する。

import { describe, expect, it } from 'vitest';
import {
  INHERITED_AGENT_SESSION_KEYS,
  purgeInheritedAgentSession,
  stripInheritedAgentSession,
} from '../../src/main/inherited-agent-env';

describe('stripInheritedAgentSession', () => {
  // これが本題。子セッションのマーカーが残っていると、CLI 側が縮退した動きをする。
  it('親セッションの状態キーを落とす', () => {
    const stripped = stripInheritedAgentSession({
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
      CLAUDE_PID: '65984',
      CLAUDE_CODE_SESSION_ID: 'f26029d0-ba2a-4549-a6ca-72e78d172c3f',
      CLAUDE_CODE_BRIDGE_SESSION_ID: 'session_01TpJFTFCx5RQSZMw5cK86YJ',
      CLAUDE_CODE_MESSAGING_SOCKET: '/tmp/cc-socks/65984.sock',
      CLAUDE_CODE_MESSAGING_TOKEN: 'dummy-token',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_EXECPATH: '/Users/x/.local/share/claude/versions/2.1.232',
      CLAUDE_EFFORT: 'high',
    });
    expect(stripped).toEqual({});
  });

  // ⛔ 前方一致で消さない理由。ここが消えると利用者の設定が壊れる。
  it('利用者自身の設定は残す（CLAUDE で始まっていても落とさないものがある）', () => {
    const stripped = stripInheritedAgentSession({
      CLAUDE_CONFIG_DIR: '/Users/x/.claude-work',
      ANTHROPIC_API_KEY: 'dummy',
      CLAUDE_CODE_CHILD_SESSION: '1',
    });
    expect(stripped.CLAUDE_CONFIG_DIR).toBe('/Users/x/.claude-work');
    expect(stripped.ANTHROPIC_API_KEY).toBe('dummy');
    expect(stripped.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
  });

  it('無関係なキーはそのまま残る', () => {
    const stripped = stripInheritedAgentSession({ PATH: '/usr/bin', HOME: '/Users/x' });
    expect(stripped).toEqual({ PATH: '/usr/bin', HOME: '/Users/x' });
  });

  // Dock から起動した .app（launchd 由来の env にはこれらが無い）で、
  // 余計なキーを増やさないこと。
  it('該当キーが無ければ何も変わらない', () => {
    const base = { PATH: '/usr/bin' };
    expect(stripInheritedAgentSession(base)).toEqual(base);
  });

  it('入力を書き換えない（新しいオブジェクトを返す）', () => {
    const base = { CLAUDE_CODE_CHILD_SESSION: '1' };
    stripInheritedAgentSession(base);
    expect(base.CLAUDE_CODE_CHILD_SESSION).toBe('1');
  });

  // 空文字も「設定されている」。CLI 側が「値がある」と読む可能性を残さない。
  it('値が空文字でも落とす', () => {
    expect(stripInheritedAgentSession({ CLAUDECODE: '' }).CLAUDECODE).toBeUndefined();
  });
});

describe('purgeInheritedAgentSession', () => {
  // process.env そのものを触るので、テストでは器を渡して確かめる。
  it('渡された env を直接書き換え、落としたキーを返す', () => {
    const env: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_CHILD_SESSION: '1',
    };
    const removed = purgeInheritedAgentSession(env);
    expect(env).toEqual({ PATH: '/usr/bin' });
    expect(removed.sort()).toEqual(['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION'].sort());
  });

  it('該当キーが無ければ空配列を返す（何も落としていないことを区別できる）', () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
    expect(purgeInheritedAgentSession(env)).toEqual([]);
    expect(env).toEqual({ PATH: '/usr/bin' });
  });
});

describe('INHERITED_AGENT_SESSION_KEYS', () => {
  // この一覧が「この不具合の中心」を含んだままであることを、名指しで固定する。
  // 実測で症状に直結すると分かっているのはこのキー（画面にもこの名前で出る）。
  it('子セッションのマーカーを含む', () => {
    expect(INHERITED_AGENT_SESSION_KEYS).toContain('CLAUDE_CODE_CHILD_SESSION');
  });

  it('重複が無い', () => {
    expect(new Set(INHERITED_AGENT_SESSION_KEYS).size).toBe(INHERITED_AGENT_SESSION_KEYS.length);
  });
});
