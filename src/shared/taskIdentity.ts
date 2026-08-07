// 前回・今回のポーリング結果を突き合わせるときの「同じ1本か」の判定キー。
//
// **`sessionId` は一意ではない。** `claude` は CLI 内の `/resume` で自分の sessionId を
// 切り替えるため、`claude agents --json` は**同じ `sessionId` を持つ別プロセスを複数返す**
// ことがある（実機で観測。`sessionMatch.ts` 冒頭の表と同じ現象）:
//
// ```
// sessionId 82dae66a-…  pid 47307  status "waiting"
// sessionId 82dae66a-…  pid 80821  status "busy"
// ```
//
// このとき `new Map(tasks.map((t) => [t.sessionId, t]))` は**後勝ちで1件に潰れる**。
// 潰れた側と別の行を比べることになり、**一覧が1ミリも変わっていないのに
// 「busy から waiting へ遷移した」と誤検知して毎ポーリング通知が出る**
// （Issue #241。既定の 3000ms 間隔で通知音が鳴り続ける）。
//
// **pid は CLI 側の `/resume` を跨いで変わらない**（`sessionMatch.ts` で実測済み）ので、
// 「同じ1本のプロセス」を指すキーとしては pid のほうが強い。
//
// **`src/shared/` に置くのは Renderer からも同じキーで数えるため。** Main の「同じ1本の
// プロセスか」（通知の遷移検知）と Renderer の「同じ1行か」（React の key）が別々の規則で
// 決まると、**通知が2件と数えるものを一覧が1行に潰す**形が構造的に残る。
// `src/main` は `tsconfig.web.json` の include に無いので、Renderer からは import できない。

/** 突き合わせに使う最小限の形。`AgentTask` のうち sessionId と pid だけを見る。 */
export interface IdentifiableTask {
  sessionId: string;
  pid?: number;
}

/**
 * タスクの同一性キーを返す（純粋関数）。
 *
 * pid が取れていればそれを使い、取れていなければ `sessionId` へ落とす。
 *
 * ⛔ **どちらの側も必ず前置する。** `pid` 側だけを `pid:` にして `sessionId` を素で返すと、
 * **`sessionId` が文字列 `"pid:42"` だったときに衝突する**（実装した直後に
 * `task-identity.test.ts` が実際に見つけた）。`sessionId` は UUID の想定だが、
 * その想定はこちらでは持てない（鉄則5: 外部フォーマットを信用しない）。
 *
 * ⛔ **pid が undefined のものを同じキーにまとめないこと。** `sessionMatch.ts` と同じ理由で、
 * `undefined === undefined` の一致は全部を1本へ吸い寄せる。ここでは pid が無いものを
 * `session:` 側の名前空間へ逃がすことでそれを避けている。
 */
export function taskIdentity(task: IdentifiableTask): string {
  return task.pid === undefined ? `session:${task.sessionId}` : `pid:${task.pid}`;
}

/**
 * タスクの列を同一性キーの索引に畳む（純粋関数）。
 *
 * **同じキーが2件以上あったら、そのキーは索引に入れない。** Map の後勝ちに任せると
 * 「どちらか一方」と比べることになり、比較結果が配列の並び順に依存する
 * （Issue #241 の無限ループはこれが原因）。**曖昧なものは「前回が不明」として扱い、
 * 遷移を検知しない**ほうが安全。誤って通知を1回落とすことはあっても、
 * 何も起きていないのに鳴り続けることは無くなる。
 *
 * pid が取れていれば重複は起きないので、この保険が効くのは
 * pid まで取れなかった異常時だけ。**それでも外さないこと**（pid が取れる保証は
 * `claude agents --json` 側にあり、こちらでは持てない。鉄則5）。
 */
export function indexByIdentity<T extends IdentifiableTask>(
  tasks: readonly T[],
): Map<string, T> {
  const index = new Map<string, T>();
  const ambiguous = new Set<string>();

  for (const task of tasks) {
    const identity = taskIdentity(task);
    if (index.has(identity)) ambiguous.add(identity);
    index.set(identity, task);
  }

  for (const identity of ambiguous) index.delete(identity);
  return index;
}
