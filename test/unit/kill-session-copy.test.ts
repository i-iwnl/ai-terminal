// タスク一覧の行から AI を終了する確認ダイアログの文言（Issue #244 周6-a）。
//
// e2e/specs/S114-list-row-terminate-busy-confirm.spec.ts が本文に「作業中」
// 「やり直しになります」の2語を逐語で検査している。ここでその2語を単体テストでも
// 固定し、崩れたら vitest の時点で分かるようにする。

import { describe, expect, it } from 'vitest';
import { killSessionCopy } from '../../src/renderer/src/sidebar/killSessionCopy';

describe('killSessionCopy', () => {
  it('本文に「作業中」を含む（S114 が逐語で検査する語）', () => {
    expect(killSessionCopy().body).toContain('作業中');
  });

  it('本文に「やり直しになります」を含む（S114 が逐語で検査する語）', () => {
    expect(killSessionCopy().body).toContain('やり直しになります');
  });

  // ⛔ 「取り消せます」と言わない。何が戻らないかを言う（closeTabCopy.ts と同じ原則）。
  it('「取り消せます」とは言わない', () => {
    expect(killSessionCopy().body).not.toContain('取り消せます');
  });

  // ⛔ tmux を主語にしない（ユーザーが有効にしたのは設定の項目名であって tmux ではない）。
  it('tmux を主語にしない', () => {
    expect(killSessionCopy().body).not.toContain('tmux');
    expect(killSessionCopy().title).not.toContain('tmux');
  });

  it('実行ボタンのラベルは「終了する」（何も終了しないなら「終了する」と言わない、が今回は常に終了する）', () => {
    expect(killSessionCopy().confirmLabel).toBe('終了する');
  });
});
