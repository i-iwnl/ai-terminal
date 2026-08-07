// `claude agents --json` の出力パース（src/main/agents/claude.ts）。
//
// **このファイルには長く単体テストが1本も無かった。** `parseAgentsJson` / `toAgentTask` が
// 非 export で、テストから到達する手段そのものが無かったため。
// `completionNotice.ts` の切り出し前とまったく同じ死角で、実際に
// `status: "waiting"` / `waitingFor` を CLI が返し始めても誰も気づかなかった（Issue #241）。
//
// CLAUDE.md 鉄則5（外部フォーマットのパース失敗でアプリを落とさない）を、ここで固定する。

import { describe, expect, it } from 'vitest';

import { parseAgentsJson } from '../../src/main/agents/claude';

/** 実機（claude 2.1.224）で観測した1件をそのまま使う。 */
const REAL_WAITING_ENTRY = {
  pid: 47307,
  cwd: '/Users/example/work/project',
  kind: 'interactive',
  startedAt: 1786089581160,
  sessionId: '82dae66a-371b-45da-9b99-9cc309a938ab',
  name: 'project-15',
  status: 'waiting',
  waitingFor: 'permission prompt',
};

describe('parseAgentsJson - 正常系', () => {
  it('実機の出力（waiting + waitingFor）をそのまま読める', () => {
    const result = parseAgentsJson(JSON.stringify([REAL_WAITING_ENTRY]));

    expect(result.error).toBeUndefined();
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({
      pid: 47307,
      sessionId: '82dae66a-371b-45da-9b99-9cc309a938ab',
      status: 'waiting',
      waitingFor: 'permission prompt',
      ownedByApp: false,
    });
  });

  it('実機で観測した重複 sessionId を、2件のまま落とさずに読む', () => {
    // CLI 内の /resume で同じ sessionId を持つ別プロセスが返る（Issue #241 の原因）。
    // ここで1件に潰すと、生きているプロセスの片方が一覧から消える。
    const json = JSON.stringify([
      { ...REAL_WAITING_ENTRY, pid: 47307, status: 'waiting' },
      { ...REAL_WAITING_ENTRY, pid: 80821, status: 'busy', waitingFor: undefined },
    ]);

    const result = parseAgentsJson(json);

    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.map((t) => t.pid)).toEqual([47307, 80821]);
  });

  it('waitingFor が無い（busy / idle）ものは undefined になる', () => {
    const result = parseAgentsJson(
      JSON.stringify([{ sessionId: 'a', status: 'busy' }, { sessionId: 'b', status: 'idle' }]),
    );

    expect(result.tasks.map((t) => t.waitingFor)).toEqual([undefined, undefined]);
  });

  it('未知の waitingFor も、絞り込まずにそのまま持つ', () => {
    // ⛔ 実測した3値のユニオンに絞ると、4つ目が来た瞬間に落とすことになる（鉄則5）。
    const result = parseAgentsJson(
      JSON.stringify([{ sessionId: 'a', status: 'waiting', waitingFor: 'something new' }]),
    );

    expect(result.tasks[0].waitingFor).toBe('something new');
  });

  it('未知の status も、丸めずにそのまま持つ', () => {
    const result = parseAgentsJson(JSON.stringify([{ sessionId: 'a', status: 'hibernating' }]));

    expect(result.tasks[0].status).toBe('hibernating');
  });
});

describe('parseAgentsJson - 防御的パース（鉄則5）', () => {
  it('空の出力はエラーではなく空配列として扱う', () => {
    // 実行中セッションが無いだけの可能性が高い。ここをエラーにすると
    // poller.ts が「取得エラー」と見なして、完了通知の判定ごと止まる。
    for (const stdout of ['', '   ', '\n\n']) {
      const result = parseAgentsJson(stdout);
      expect(result.tasks).toEqual([]);
      expect(result.error).toBeUndefined();
    }
  });

  it('JSON として壊れていても例外を投げず、error に理由を入れる', () => {
    const result = parseAgentsJson('{ not json');

    expect(result.tasks).toEqual([]);
    expect(result.error).toContain('JSON');
  });

  it('配列でなければ error にする（オブジェクトを返し始めても落ちない）', () => {
    const result = parseAgentsJson(JSON.stringify({ sessions: [] }));

    expect(result.tasks).toEqual([]);
    expect(result.error).toContain('配列');
  });

  it('1要素の失敗を他要素に波及させない', () => {
    const json = JSON.stringify([
      { sessionId: 'ok-1', status: 'busy' },
      null,
      'string ではない要素',
      { pid: 1 }, // sessionId が無い
      { sessionId: '', status: 'idle' }, // 空文字は採用しない
      { sessionId: 42 }, // 文字列でない
      { sessionId: 'ok-2', status: 'idle' },
    ]);

    const result = parseAgentsJson(json);

    expect(result.tasks.map((t) => t.sessionId)).toEqual(['ok-1', 'ok-2']);
    expect(result.error).toBeUndefined();
  });

  it('型の合わないフィールドは undefined にして、その要素自体は採用する', () => {
    // 「1つおかしいから丸ごと捨てる」にすると、CLI の小さな変更で一覧が空になる。
    const result = parseAgentsJson(
      JSON.stringify([
        {
          sessionId: 'a',
          pid: '4321', // 数値でない
          cwd: 123, // 文字列でない
          startedAt: 'yesterday', // 数値でない
          waitingFor: { kind: 'permission' }, // 文字列でない
        },
      ]),
    );

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({
      sessionId: 'a',
      pid: undefined,
      cwd: undefined,
      startedAt: undefined,
      waitingFor: undefined,
    });
  });

  it('ownedByApp は常に false を仮置きする（確定させるのは poller.ts）', () => {
    const result = parseAgentsJson(
      JSON.stringify([{ sessionId: 'a', status: 'busy', ownedByApp: true }]),
    );

    expect(result.tasks[0].ownedByApp).toBe(false);
  });
});
