/**
 * `claude agents --json` の status を、人間から見た意味に翻訳する。
 *
 * **このファイルが状態の意味の単一の正。** 表示（TaskList）・通知（poller）・
 * Dock バッジが同じ判定を使う。3箇所が別々に `status === 'busy'` を書くと、
 * CLI が新しい値を返し始めたときに片方だけが追従して食い違う
 * （実際に「UI は不明と出すが通知は作業完了と言う」状態が生まれかけた）。
 *
 * CLI の語と、人間から見た意味は逆になることに注意する:
 *   busy = エージェントが動いている  -> 人間は待たなくてよい
 *   idle = エージェントが止まっている -> 人間の入力待ち（あなたの番）
 *
 * 根拠は src/main/agents/poller.ts の遷移検知（busy -> 非busy を「作業完了」として通知している）。
 */

/** 人間から見た状態 */
export type TaskState =
  /** エージェントが作業中。人間は待たなくてよい */
  | 'working'
  /** 人間の入力待ち。あなたの番 */
  | 'your-turn'
  /** CLI が未知の値を返した、または値が無い */
  | 'unknown';

/**
 * CLI の status を状態へ翻訳する。
 *
 * **未知の値を既知の2値に丸めない。** `status` は「CLI が返した値をそのまま持つ」
 * （`src/shared/ipc.ts` の `AgentTask`）ため、二値分岐にすると CLI が
 * `waiting_for_input` のような値を返し始めた瞬間に全件がどちらか片側へ誤訳される。
 * 分からないものは 'unknown' にして、呼び出し側で生の値を併記する。
 */
export function toTaskState(status: string | undefined): TaskState {
  if (status === 'busy') return 'working';
  if (status === 'idle') return 'your-turn';
  return 'unknown';
}

/** 画面に出す日本語ラベル */
export const TASK_STATE_LABEL: Record<TaskState, string> = {
  working: '作業中',
  'your-turn': 'あなたの番',
  unknown: '不明',
};

/**
 * 「あなたの番」の件数。Dock バッジに出す数と、一覧のグループ見出しで共有する。
 * unknown は数えない（分からないものを人間の番として催促しない）。
 */
export function countYourTurn(tasks: ReadonlyArray<{ status?: string }>): number {
  return tasks.filter((task) => toTaskState(task.status) === 'your-turn').length;
}

/** 表示順（グループ単位）の唯一の正。 */
const DISPLAY_ORDER: readonly TaskState[] = ['your-turn', 'working', 'unknown'];

/** グループ化した表示用の1グループ分。 */
export interface TaskGroup<T> {
  state: TaskState;
  tasks: T[];
}

/**
 * タスク一覧の表示順を決める。
 *
 * **「あなたの番」を先頭に固定する。** CLI が返した順のままだと、あなたの番の行が
 * 一覧の下に沈んで見落とされる（Issue #20 B）。
 *
 * **未知の状態は「あなたの番」に混ぜず、3つ目のグループとして末尾に置く。**
 * CLI が `waiting_for_input` のような新しい値を返し始めても、そのグループが
 * 「あなたの番」の件数に紛れ込まない（誤って人間を急かさない）ようにするため。
 *
 * グループ内の並びは次の観点をそのまま使う:
 * - あなたの番: 待たせている時間が長い順（`yourTurnSince` が古いタスクほど先頭）。
 *   遷移時刻が不明なタスク（縮退表示）は既知のものより後ろへ送る。
 * - 作業中 / 不明: CLI が返した順を保つ（安定ソートなので並び替えない）。
 *
 * タスクが1件も無いグループは結果から除く（見出しだけの空グループを描かせない）。
 */
export function groupTasksForDisplay<T extends { status?: string; yourTurnSince?: number }>(
  tasks: readonly T[],
): TaskGroup<T>[] {
  const groups = new Map<TaskState, T[]>(DISPLAY_ORDER.map((state) => [state, []]));

  for (const task of tasks) {
    groups.get(toTaskState(task.status))?.push(task);
  }

  const yourTurn = groups.get('your-turn');
  if (yourTurn) {
    groups.set(
      'your-turn',
      [...yourTurn].sort((a, b) => {
        const aSince = a.yourTurnSince ?? Number.POSITIVE_INFINITY;
        const bSince = b.yourTurnSince ?? Number.POSITIVE_INFINITY;
        return aSince - bSince;
      }),
    );
  }

  return DISPLAY_ORDER.map((state) => ({ state, tasks: groups.get(state) ?? [] })).filter(
    (group) => group.tasks.length > 0,
  );
}

/**
 * グループ見出しの文言。「あなたの番 2件」のように件数を併記する。
 *
 * 色相の違いは手がかりに数えない、という原則（Issue #20 デザイン原則2）に従い、
 * グループの境界は色に頼らずこの見出しの語と件数だけで伝わるようにする。
 */
export function formatGroupHeading(state: TaskState, count: number): string {
  return `${TASK_STATE_LABEL[state]} ${count}件`;
}

/**
 * 「エージェントが作業を終えて人間の番になった」遷移か。
 * 通知・Dock バウンスの発火条件として使う。
 *
 * `unknown` への遷移も「作業が終わった」側に数える。CLI が新しい語を返し始めても
 * 通知が止まらないほうが安全（通知が来ないことには気づけない）。
 */
export function becameYourTurn(
  previousStatus: string | undefined,
  currentStatus: string | undefined,
): boolean {
  return toTaskState(previousStatus) === 'working' && toTaskState(currentStatus) !== 'working';
}
