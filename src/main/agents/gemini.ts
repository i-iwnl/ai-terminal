// Gemini CLI 側の実行中タスク取得。
//
// 現時点（docs/PLAN.md 2-3 参照）で Gemini CLI に「実行中セッション一覧」を返す
// コマンドは確認されていない（`--list-sessions` は履歴一覧向けで、history/ 側の責務）。
// そのため MVP では実行中タスク一覧（左サイドバー）の対象外とする。
//
// TODO: 将来 Gemini 側に相当するコマンド・API が見つかった場合、ここに実装する。
// それまでは「未対応」を返すだけの器として最小限に留める。

export interface GeminiAgentsResult {
  supported: false;
  reason: string;
}

/**
 * Gemini の実行中タスク一覧は MVP では未対応。
 * 呼び出し側は tasks を持たない結果として扱うこと。
 */
export function listGeminiAgents(): GeminiAgentsResult {
  return {
    supported: false,
    reason: 'Gemini CLI に実行中セッション一覧のコマンドが確認されていないため未対応（MVP対象外）',
  };
}
