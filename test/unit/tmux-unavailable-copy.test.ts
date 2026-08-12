// タスクパネルの「押せない理由」文言（Issue #244 周7）。
//
// e2e/specs/S117-tmux-unavailable-panel-message.spec.ts が、画面に出た文言に
// PERSIST_SETTING_LABEL の一部（「アプリを閉じても AI の作業を続ける」）を含み、
// `tmux` という語を含まないことを検査する。ここでその条件を単体テストでも固定する。

import { describe, expect, it } from 'vitest';
import { tmuxUnavailableCopy } from '../../src/renderer/src/sidebar/tmuxUnavailableCopy';
import { PERSIST_SETTING_LABEL } from '../../src/renderer/src/tabs/closeTabCopy';

describe('tmuxUnavailableCopy', () => {
  it('設定の項目名（PERSIST_SETTING_LABEL）を埋め込む', () => {
    expect(tmuxUnavailableCopy().heading).toContain(PERSIST_SETTING_LABEL);
  });

  // ⛔ tmux を主語にしない（closeTabCopy.ts / killSessionCopy.ts と同じ明文の規約）。
  it('tmux を主語にしない（見出し・本文のどちらにも tmux という語を出さない）', () => {
    const copy = tmuxUnavailableCopy();
    expect(copy.heading).not.toMatch(/tmux/i);
    expect(copy.body).not.toMatch(/tmux/i);
  });

  it('次に何をすればいいか（設定を確認する）が本文に分かる', () => {
    expect(tmuxUnavailableCopy().body).toContain('設定');
  });

  it('本文は空文字ではない', () => {
    expect(tmuxUnavailableCopy().body.length).toBeGreaterThan(0);
  });
});
