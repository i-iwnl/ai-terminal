// 実行中タスク一覧（Phase 3）。
// window.api.agents.onTasks の push 購読 + 初回の list() 呼び出しで一覧を表示する。
// 「今どれが自分を待っているか」が一目でわかることを最優先にする。
//
// Issue #20 B（PR 8: タスク行の再設計）:
// - 状態語は行の左（走査は左から右）。色相の違いは手がかりに数えない、という
//   原則に従い、色（ドット）・形（見出しの区切り）・語（状態ラベル）の3つが
//   独立に同じ情報を運ぶようにする。
// - グループ見出しで区切る。ソートだけでは境界が視覚以外に伝わらないため見出しは必須。
// - 「待たせている時間」はセッション起動からの通算（formatElapsed）ではなく、
//   あなたの番になった時刻（yourTurnSince）からの経過にする。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentTask, AgentTasksEvent, LiveAgentSession } from '@shared/ipc';
// 状態の意味・グループ分け・見出し文言の単一の正。表示・通知・Dock バッジが同じ判定を使う。
import {
  toTaskState,
  groupTasksForDisplay,
  formatGroupHeading,
  describeWaitingFor,
  TASK_STATE_LABEL,
} from '@shared/agent-status';
// 行の一意キー。Main の遷移検知（通知）と同じ規則で「同じ1本か」を決める。
import { taskIdentity } from '@shared/taskIdentity';
import { basename, formatElapsed, formatWaitingSince } from '../lib/format';
import {
  liveSessionDisplayName,
  liveSessionProviderLabel,
  resolveTaskRowAction,
  selectRecoverableSessions,
  taskSessionKey,
  taskRowActionLabel,
} from './taskRow';
// 「設定は有効なのに tmux が使えない」パネルの文言（Issue #244 周7）。
import { tmuxUnavailableCopy } from './tmuxUnavailableCopy';
// タスク一覧の購読はここで直接 window.api.agents を呼ばず、共有ハブに委ねる
// （App.tsx の Cmd+J も同じスナップショットを見る必要があるため。lib/agentTasksStore.ts 参照）。
import { subscribeAgentTasks, recheckAgentTasks } from '../lib/agentTasksStore';

/**
 * 「claude が PATH に無い」を検知してから見出しを赤字で目立たせる長さ（Issue #20 I-3）。
 * 本番のポーリング既定（pollIntervalMs 3000ms）と同じ値にしてある
 * （＝「次の1周期ぶんは目立ち、そのあとは黙る」という直感と一致させるため）。
 */
const LOUD_DURATION_MS = 3_000;

export interface TaskListProps {
  /** ownedByApp なタスクをクリックしたときに、対応するタブへフォーカスする */
  onFocusTab: (agentSessionId: string) => void;
  /** そのタスクに対応するタブが存在するか（無ければクリック不可にする） */
  canFocus: (agentSessionId: string) => boolean;
  /** 空状態の「起動」ボタン用（Issue #20 I-3）。Cmd+Shift+C と同じ操作 */
  onLaunchClaude: () => void;
  /**
   * 一覧を「このアプリを起動したフォルダ」に絞り込んでいるか（`AppConfig.scopeAgentsToCwd`）。
   * **スコープ行の文言にしか使わない**（絞り込みそのものは Main の poller が行う）。
   * 既定は false = マシン全体で、その事実がこれまで画面のどこにも出ていなかった。
   */
  scopedToCwd: boolean;
  /** 「タブに戻せる AI」の行を押したとき。tmux セッションへアタッチするタブを開く。 */
  onRecoverSession: (agentSessionId: string, provider: 'claude' | 'gemini') => void;
  /**
   * 押せる行を右クリックしたとき、または DOM フォーカスを受けたときに、
   * その行の agentSessionId を親（App.tsx）へ知らせる（Issue #244 周6-a）。
   *
   * ⭐ **右クリックとフォーカスの両方から同じコールバックを呼ぶ。** App.tsx 側は
   * これを「最後に終了対象として指し示された AI セッション」として1つだけ保持し、
   * 右クリックメニュー「この AI を終了」、およびメニューバー「選択中の AI を終了」
   * （Issue #244 周6-b）が飛んできたときに使う。その「選択中」は**最後にフォーカスした行**
   * と決まっている。ここで経路を分けると、2つ目の似た state が生える。
   *
   * ⭐ **対象が一覧から消えたら `null` を通知する。** 下の「終了後のフォーカス後始末」の
   * `useEffect`（`focusedRowRef` 冒頭コメント）が、対象の行が消えた瞬間を既に捉えている
   * ので、そこで新しい対象（または `null`）をあわせて通知する。ここに2つ目の監視機構
   * （別の `useEffect` や差分検出）は作らない。
   *
   * ⚠ **これをしないと、メニュー「選択中の AI を終了」が「もう存在しない AI」を
   * 指したまま有効に見え続ける**（Issue #244 周6-b）。
   */
  onTargetSession: (agentSessionId: string | null) => void;
}

export default function TaskList({
  onFocusTab,
  canFocus,
  onLaunchClaude,
  scopedToCwd,
  onRecoverSession,
  onTargetSession,
}: TaskListProps) {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveAgentSession[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [errorKind, setErrorKind] = useState<AgentTasksEvent['errorKind']>(undefined);
  // Issue #244 周7: 設定は有効なのに tmux が使えない、というパネル単位のメッセージ。
  // 判定は Main（poller.ts）が確定済みで、ここでは受け取った値をそのまま表示する
  // （`liveSessions.length === 0` 等から Renderer が推測しない。鉄則5の逆になる）。
  const [tmuxUnavailable, setTmuxUnavailable] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Issue #20 I-3「claude が PATH に無い」: ポーリングは pollIntervalMs（既定3秒）ごとに
  // 同じ ENOENT を検知し続けるが、ユーザーへ伝える価値があるのは最初だけ。
  // 「一度出したら黙る」= 検知したら LOUD_DURATION_MS のあいだだけ見出しを
  // 赤字にし、そのあとは静かな表示に落とす。
  //
  // **意図的にポーリング周期（pollIntervalMs）そのものには連動させていない。**
  // 「次のポーリング結果が来るまで目立たせる」という素朴な実装だと、初回検知の
  // 直後に（cwd 解決前後の初回フェッチと購読中の push が競合するなどで）
  // ほぼ同時に2件目の結果が届いた場合、React のバッチングにより「目立つ」
  // 状態が1度も画面に描画されないまま静かな状態へ上書きされてしまう
  // （実測でこの事故を作り込んだ）。固定時間のタイマーにすることで、
  // 何回どんな順序で結果が届いても「検知してから最低 LOUD_DURATION_MS は
  // 必ず目立つ」ことを保証する。
  const notFoundActiveRef = useRef(false);
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notFoundLoud, setNotFoundLoud] = useState(false);

  const clearQuietTimer = useCallback((): void => {
    if (quietTimerRef.current !== null) {
      clearTimeout(quietTimerRef.current);
      quietTimerRef.current = null;
    }
  }, []);

  const applyEvent = useCallback(
    (e: AgentTasksEvent, opts?: { manualRecheck?: boolean }): void => {
      setTasks(e.tasks);
      setLiveSessions(e.liveSessions ?? []);
      setError(e.error);
      setErrorKind(e.errorKind);
      // errorKind の loud/quiet 判定（下）とは独立の値なので、早期 return の前に必ず反映する。
      setTmuxUnavailable(e.tmuxUnavailable === true);

      if (e.errorKind !== 'not-found') {
        // 解消した（または別種のエラーになった）ので、次に not-found が来たら
        // また「初回」として扱えるようにリセットする。
        clearQuietTimer();
        notFoundActiveRef.current = false;
        setNotFoundLoud(false);
        return;
      }

      // 「再確認」ボタン経由は、ユーザーの問いへの直接の応答なので必ず
      // 目立たせ直す（タイマーもやり直す）。それ以外（自動ポーリングでの
      // 再検知）は、既にタイマーが動いている間は何もしない。
      if (!opts?.manualRecheck && notFoundActiveRef.current) return;

      clearQuietTimer();
      notFoundActiveRef.current = true;
      setNotFoundLoud(true);
      quietTimerRef.current = setTimeout(() => {
        quietTimerRef.current = null;
        setNotFoundLoud(false);
      }, LOUD_DURATION_MS);
    },
    [clearQuietTimer],
  );

  // 「再確認」ボタンから呼ぶ手動チェック。共有ハブ（agentTasksStore）に取り直しを
  // 依頼するだけで、window.api.agents は直接叩かない。結果は必ず目立たせたいので、
  // 「次に届く1件は手動再確認由来である」ことを ref に立てておき、購読側の
  // コールバックで読む（結果は onTasks の push と同じ経路で届くため、ここでは
  // Promise を直接 await しない）。
  const manualRecheckPendingRef = useRef(false);
  const recheck = useCallback((): void => {
    manualRecheckPendingRef.current = true;
    recheckAgentTasks();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeAgentTasks((e: AgentTasksEvent) => {
      applyEvent(e, { manualRecheck: manualRecheckPendingRef.current });
      manualRecheckPendingRef.current = false;
    });

    return () => {
      unsubscribe();
      // アンマウント後に setTimeout のコールバックが setState を呼ばないようにする。
      clearQuietTimer();
    };
  }, [applyEvent, clearQuietTimer]);

  // 経過時間の表示を更新するためだけの軽い再描画トリガー（10秒間隔で十分）。
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  // 終了後のフォーカス後始末（Issue #244 周6-a。差し戻し分の再設計）。
  //
  // ⚠ AI セッションの終了に成功すると、一覧から消えるのは**フォーカス中の要素
  // そのもの**（右クリックでメニューを開く前に下の onContextMenu が対象を
  // 掴んでいるので、その行は既にフォーカスされている）。明示的に次のフォーカス先へ
  // 移さないと、フォーカスが `<body>` へ落ちる（実機で観測。周6-a 初版はこれを
  // 「前レンダーとのスナップショット差分」で検出していたが、差分の基準となる
  // スナップショットの更新タイミングが常に効果の実行タイミングと噛み合う保証が
  // 無く、崩れる余地があった）。
  //
  // **いま何節にいるかは、消える前にしか分からない情報ではない。** 対象を
  // 掴む瞬間（onFocus / onContextMenu）に、行そのものの `sessionKey` に加えて
  // **どの節にいるか**（状態グループなら `TaskState`、「タブに戻せる AI」節なら
  // 固定の `'recoverable'`）も一緒に憶えておけば、消えたかどうかは**そのレンダーで
  // 確定している最新の `groups` / `recoverable` だけ**を見れば判定できる。
  // 前レンダーとの差分を取る必要が無いぶん、効果が何回・どんな順序で走っても
  // 同じ結論になる（idempotent）。
  const focusedRowRef = useRef<{ key: string; sectionKey: string } | null>(null);
  const rowElementRefs = useRef(new Map<string, HTMLButtonElement>());
  // 節がまるごと空になったときの最終フォールバック先。**節自身の見出し
  // （`.task-group__heading`）には逃がせない** — あれは「その節に1件以上ある」
  // ときしか描画されない（`groupTasksForDisplay` が0件のグループを結果から
  // 除外し、「タブに戻せる AI」節も `recoverable.length > 0` の条件レンダリング）。
  // つまり最後の1行が消えるのと同じコミットで見出し自身も消えるため、
  // 「節の見出しへ」という逃がし先はそもそも存在しない。常に描画されている
  // パネル見出し（`<h2 className="panel-scope">`）を最終フォールバックにする。
  const panelHeadingRef = useRef<HTMLHeadingElement | null>(null);

  // 表示順（グループ単位）の唯一の正は groupTasksForDisplay（src/shared/agent-status.ts）。
  // 「あなたの番」を先頭に固定し、未知の状態は3つ目のグループとして末尾に置く
  // （「あなたの番」に混ぜない。CLI が新しい status 値を返し始めても誤って人間を急かさないため）。
  const groups = groupTasksForDisplay(tasks);

  // 上の状態グループにも、開いているタブにも無いものだけを別の節へ回す。
  //
  // ⛔ **`t.sessionId` で突き合わせないこと。** CLI 内の `/resume` で sessionId が
  // ずれると重複排除が素通りし、**同じ1本のプロセスが状態グループとこの節に
  // 二重に並ぶ**（実機で観測）。突き合わせキーの正は `taskSessionKey`。
  const recoverable = selectRecoverableSessions(
    liveSessions,
    new Set(tasks.map((t) => taskSessionKey(t))),
    new Set(liveSessions.filter((s) => canFocus(s.agentSessionId)).map((s) => s.agentSessionId)),
  );

  /** `focusedRowRef` が指す節の、いまの行キー一覧（このレンダーの `groups` / `recoverable` から直接引く）。 */
  const keysInSection = (sectionKey: string): string[] => {
    if (sectionKey === 'recoverable') return recoverable.map((s) => s.agentSessionId);
    const group = groups.find((g) => (g.state as string) === sectionKey);
    return group ? group.tasks.map((t) => taskSessionKey(t)) : [];
  };

  // 上の focusedRowRef 冒頭コメントの実装本体。
  // **依存は `[tasks, liveSessions]`**（`groups` / `recoverable` は毎レンダー新しい
  // 配列参照になるため、依存に入れると `now` の10秒ティックのたびに無駄に走る）。
  // 効果の中身はこのレンダーで確定した `groups` / `recoverable`（クロージャ、
  // `keysInSection` 経由）を読む。**前レンダーの状態を一切参照しない**ので、
  // 呼ばれる回数やタイミングがずれても結論は変わらない。
  useEffect(() => {
    const focused = focusedRowRef.current;
    if (focused === null) return;

    const currentKeys = keysInSection(focused.sectionKey);
    if (currentKeys.includes(focused.key)) return; // まだ居る。何もしない。

    const nextKey = currentKeys[0];
    if (nextKey !== undefined) {
      // 同じ節に行が残っている。先頭（表示順の最初）へ。
      rowElementRefs.current.get(nextKey)?.focus();
      focusedRowRef.current = { key: nextKey, sectionKey: focused.sectionKey };
      // 「最後に指し示された行」を新しいフォーカス先に合わせる（TaskListProps.onTargetSession
      // 冒頭コメント参照）。移った先の行の onFocus でも同じ呼び出しが起きるが、
      // それに頼らずここで明示的に呼ぶ（呼ばれる順序に依存しない）。
      onTargetSession(nextKey);
    } else {
      // 同じ節がまるごと消えた（残り0件。上の panelHeadingRef 冒頭コメント参照）。
      panelHeadingRef.current?.focus();
      focusedRowRef.current = null;
      // 対象そのものが一覧から消えた。**必ず null を通知する**（消さないと
      // メニュー「選択中の AI を終了」が「もう存在しない AI」を指したまま有効に見える）。
      onTargetSession(null);
    }
    // `groups` / `recoverable` / `keysInSection` を依存に含めない（このリポジトリに
    // react-hooks の exhaustive-deps lint は無い）。上のコメントのとおり毎レンダー
    // 新しい参照になるため、含めると `now` の10秒ティックのたびに無駄に走る。
  }, [tasks, liveSessions]);

  const renderTask = (task: AgentTask) => {
    // 押せるか / 押すと何が起きるかの唯一の正は resolveTaskRowAction（taskRow.ts）。
    // ⛔ ここで ownedByApp を重ねて見ないこと（Main のメモリで、再起動すると空になる）。
    // ⭐ ここに条件を書き足さないこと。判定そのものが不具合の本体だったので
    // 純粋関数へ出して単体で固定している。
    // ⛔ 渡すのは `task.sessionId` ではなく `taskSessionKey(task)`。CLI 内の `/resume` で
    // sessionId がずれると、**タブを開いている最中ですら**「開いていない」と判定される。
    const sessionKey = taskSessionKey(task);
    const action = resolveTaskRowAction(task, canFocus(sessionKey));
    const clickable = action !== 'none';
    const state = toTaskState(task.status);
    const name = task.name ?? `セッション ${task.sessionId.slice(0, 8)}`;
    const stateLabel = TASK_STATE_LABEL[state];

    // 「あなたの番」で遷移時刻が分かっているときだけ「待たせている時間」を出す。
    // それ以外（作業中・不明、または遷移時刻が未観測）はセッション起動からの
    // 通算（formatElapsed）に縮退する。無い情報を「待たせている時間」として
    // 捏造しない（鉄則5）。
    const elapsed =
      state === 'your-turn' && task.yourTurnSince !== undefined
        ? formatWaitingSince(task.yourTurnSince, now)
        : task.startedAt !== undefined
          ? formatElapsed(task.startedAt, now)
          : undefined;

    // 視覚的な並び（状態ラベル / 名前 / このアプリ / ディレクトリ名 / 生の status / 経過時間）を
    // そのまま読み上げの文にする。ボタン化に伴い aria-label が子要素のテキストより
    // 優先されるため、押せる行が何のセッションで今どの状態かはここだけで完結させる。
    // 状態語を先頭にするのは、視覚的な行の先頭（状態語）と同じ順にするため。
    //
    // ⭐ **`waitingFor` は視覚と読み上げの両方に出す。片方だけにしない。**
    // `aria-label` が付くのは押せる行（`<button>`）だけで、押せない行は `<div>` のまま
    // ＝ 名前が付かない。**読み上げにだけ足すと、押せない行では1文字も届かない**
    // （S106 が実際にこれを捕まえた）。逆に視覚だけに足すと、押せる行では
    // `aria-label` が子要素のテキストを上書きするので、やはり届かない。
    //
    // 届ける必要がある理由: 既定構成では `screenReaderMode` が false かつ WebGL
    // レンダラなので、**許可プロンプトの本文そのものは支援技術に原理的に届いていない**
    // （`terminal/useTerminal.ts` 冒頭）。この行が「何を待っているか」の唯一の窓口で、
    // 「実行許可待ち」と分かればターミナルの中身を読まずに次の行動を決められる。
    const waitingForLabel = describeWaitingFor(task.waitingFor);

    const ariaLabel = [
      stateLabel,
      name,
      task.ownedByApp ? 'このアプリが起動' : undefined,
      // 押したときに何が起きるかを、押せる行だけで言い分ける。
      // ⛔ 「回収」は内部語なので画面にも読み上げにも出さない。
      taskRowActionLabel(action),
      // 以下はメタ行と同じ順（視覚的な並びをそのまま読み上げの文にする）。
      waitingForLabel,
      basename(task.cwd),
      // CLI が返した生の値も読み上げに残す（鉄則4/5: CLI が言ったことを隠さない）。
      task.status !== undefined ? `CLI の生の状態は ${task.status}` : undefined,
      elapsed !== undefined ? elapsed : undefined,
    ]
      .filter((part): part is string => part !== undefined && part !== '')
      .join('、');

    // 見た目は行全体で1つ（アイコン + 本文）。押せる行だけ <button> にし、
    // 押せない行は非対話の <div> のまま保つ（Tab で止まって何も起きない、を避ける）。
    //
    // 状態語（stateLabel）は本文の先頭に置く。走査は左から右なので、
    // 色（ドット）だけでなく語も行の先頭で伝わるようにする（Issue #20 B）。
    const bodyContent = (
      <>
        <span className="task-item__status-dot" aria-hidden="true" />
        <div className="task-item__body">
          <div className="task-item__name">
            <span className="task-item__state">{stateLabel}</span>
            <span>{name}</span>
            {task.ownedByApp && <span className="task-item__badge">このアプリ</span>}
          </div>
          <div className="task-item__meta">
            {/* 何を待っているか（`status: waiting` のときだけ）。**メタ行の先頭に置く。**
                「あなたの番」に idle（返事を書く）と waiting（押すだけ）が混ざるので、
                どれが1文字も打たずに済むかがここで分かる。
                語は4〜5文字に揃えてある（`describeWaitingFor`）。260px のメタ行は既に
                折り返しており、長い語を混ぜるとその行だけ折り返し位置が変わる。
                ⛔ 名前行（`.task-item__name`）に足さないこと。名前が12文字を超えると
                「このアプリ」バッジが画面外へ消えた実測がある（styles.css）。 */}
            {waitingForLabel !== undefined && (
              <span className="task-item__waiting-for">{waitingForLabel}</span>
            )}
            <span>{basename(task.cwd)}</span>
            {/* CLI が返した生の値も残す。翻訳で潰すと、CLI 側の仕様変更に
                気づく手がかりが画面から消える（鉄則4/5） */}
            {task.status !== undefined && (
              <span className="task-item__raw-status">{task.status}</span>
            )}
            {elapsed !== undefined && <span className="task-item__elapsed">{elapsed}</span>}
          </div>
        </div>
      </>
    );

    return (
      <li
        // ⛔ `task.sessionId` を key にしない。CLI 内の `/resume` で**同じ `sessionId` を持つ
        // 別プロセスが2件返る**ことがある（`@shared/taskIdentity` に実測を記録）。
        // いまは状態が違えば `groupTasksForDisplay` が別グループの別 `<ul>` へ振り分けるので
        // 兄弟にならず表面化しないが、**同じ status で重複した瞬間に key が衝突する**。
        // Main 側の遷移検知と同じキーで数える（片方だけ潰れる形を作らない）。
        key={taskIdentity(task)}
        // 押せるかどうかは modifier クラスではなく要素の種類（button か div か）で
        // 表す。CSS もそちらを見ているので、クラスを残すと「どちらが正か」が
        // 2つになる。
        className={['task-item', `task-item--${state}`, task.ownedByApp ? 'task-item--owned' : '']
          .filter(Boolean)
          .join(' ')}
      >
        {clickable ? (
          <button
            type="button"
            className="task-item__row"
            aria-label={ariaLabel}
            onClick={() => onFocusTab(sessionKey)}
            // 「最後に終了対象として指し示された AI セッション」を親へ知らせる
            // （TaskListProps.onTargetSession 参照）。DOM フォーカスを受けた
            // 時点でも右クリックと同じ扱いにする。あわせて「終了後のフォーカス
            // 後始末」用に、いまどの節（状態グループ）にいるかも憶えておく
            // （`focusedRowRef` 冒頭コメント参照）。
            onFocus={() => {
              focusedRowRef.current = { key: sessionKey, sectionKey: state };
              onTargetSession(sessionKey);
            }}
            // 右クリックメニュー（Issue #244 周6-a）。**押せない行（<div>）には
            // 付けない。** 終了できる対象（生きている tmux セッション）がそもそも
            // 無いので、出すこと自体が誤りになる（S113 の否定側）。
            //
            // 項目表は `src/shared/context-menu.ts` の `taskContextMenuItems()` が
            // 決める。Main はそれを `MenuItemConstructorOptions` に変換して
            // `Menu.popup()` するだけ（`TerminalPane.tsx` の onContextMenu と同じ形）。
            onContextMenu={(e) => {
              e.preventDefault();
              // メニューを出す前に、対象をこの行へ揃える（`close-pane` が
              // 「アクティブなペイン」を先に onActivate?.() で揃えるのと同じ作法）。
              focusedRowRef.current = { key: sessionKey, sectionKey: state };
              onTargetSession(sessionKey);
              // ラベルの出し分け（実機不具合の差し戻し）。`action === 'focus'` は
              // 「そのセッションのタブがいま開いている」＝ resolveTaskRowAction() が
              // 唯一の正なので、ここで別の判定を作らずそのまま使う。
              window.api.menu.showTaskContextMenu({ hasOpenTab: action === 'focus' });
            }}
            ref={(el) => {
              if (el) rowElementRefs.current.set(sessionKey, el);
              else rowElementRefs.current.delete(sessionKey);
            }}
          >
            {bodyContent}
          </button>
        ) : (
          <div className="task-item__row">{bodyContent}</div>
        )}
      </li>
    );
  };

  return (
    <div className="task-list">
      {/* Issue #20 I-2 / #119 周3: いまどの範囲を見ているかを常設する。
          **0件でも消さない**（空状態でスコープが見えることが一番重要）。
          既定（scopeAgentsToCwd: false）はマシン全体で、他アプリから起動した
          claude も混ざる。その事実がこれまで画面のどこにも出ていなかった。 */}
      {/* ⛔ **プロバイダ名を焼き込まない。** 下の「タブに戻せる AI」節には
          gemini も入る（tmux から取るので `claude agents --json` に依らない）ので、
          「…の Claude」と名乗ると、その節が出た瞬間に見出しが嘘になる。 */}
      <h2
        className="panel-scope"
        // 終了後のフォーカス後始末（`panelHeadingRef` 冒頭コメント）の最終
        // フォールバック先。節そのものの見出しへは逃がせない（節は0件になると
        // 見出しごと消えるため）ので、常に描画されているこの見出しへ着地させる。
        // **`tabIndex="0"` にしない** — Tab は xterm が食うのでタブ順には入れないが、
        // `tabIndex={-1}` ならプログラム的な `.focus()` は効く
        // （`PaneSplitterHandle.tsx` と同じ考え方）。
        tabIndex={-1}
        ref={panelHeadingRef}
      >
        {scopedToCwd ? 'このフォルダの AI' : 'このマシン全体の AI'}
      </h2>
      {errorKind === 'not-found' ? (
        // Issue #20 I-3: 「claude が PATH に無い」専用の空状態パネル。
        // 赤字の生エラー文一行ではなく、見出し + 手順 + 再確認ボタンにする。
        // notFoundLoud が false のとき（自動ポーリングでの2回目以降の再検知）は
        // panel-empty--loud を外し、静かな見た目のまま情報だけ残す。
        <div className={`panel-message panel-empty${notFoundLoud ? ' panel-empty--loud' : ''}`}>
          <h3 className="panel-empty__heading">Claude CLI が見つかりません</h3>
          <p className="panel-empty__body">
            <code>claude</code> コマンドが PATH 上に見つかりません。ターミナルで{' '}
            <code>which claude</code> を実行し、インストール済みか・PATH が通っているかを確認してください。
          </p>
          <button type="button" className="panel-empty__action" onClick={recheck}>
            再確認
          </button>
        </div>
      ) : tmuxUnavailable ? (
        // Issue #244 周7: 設定「アプリを閉じても AI の作業を続ける」は有効なのに
        // tmux が使えず、全行が一斉に押せない状態。**パネルに1つだけ**出す
        // （行ごとに理由を出さない。tmuxUnavailableCopy.ts 冒頭参照）。
        <div className="panel-message panel-empty panel-empty--tmux-unavailable">
          <h3 className="panel-empty__heading">{tmuxUnavailableCopy().heading}</h3>
          <p className="panel-empty__body">{tmuxUnavailableCopy().body}</p>
        </div>
      ) : error ? (
        <div className="panel-message panel-message--error">
          タスク一覧の取得に失敗しました: {error}
        </div>
      ) : (
        tasks.length === 0 && (
          <div className="panel-message panel-empty">
            <p className="panel-empty__body">動いている AI はまだありません</p>
            <p className="panel-empty__hint">Cmd+Shift+C で Claude を起動できます</p>
            <button type="button" className="panel-empty__action" onClick={onLaunchClaude}>
              Claude を起動
            </button>
          </div>
        )
      )}
      {groups.map((group) => (
        <div className="task-group" key={group.state}>
          <h3 className="task-group__heading">
            {formatGroupHeading(group.state, group.tasks.length)}
          </h3>
          <ul>{group.tasks.map((task) => renderTask(task))}</ul>
        </div>
      ))}
      {/* 「タブに戻せる AI」= tmux で生きているが、タスク一覧にもタブにも無いもの。
          ⛔ **状態グループ（あなたの番 / 作業中 / 不明）に混ぜない。** tmux からは
          CLI の状態が取れないので全部「不明」に落ち、design-rules が
          「CLI が新しい status を返し始めたとき」用に予約している語が潰れる。
          ⛔ 見出しに「実行中」を使わない（禁止語。「コマンド実行中」と衝突）。
          **0件のときは節ごと出さない**（常設すると空状態が2段になる）。 */}
      {recoverable.length > 0 && (
        <div className="task-group">
          <h3 className="task-group__heading">タブに戻せる AI {recoverable.length}件</h3>
          <ul>
            {recoverable.map((session) => {
              const name = liveSessionDisplayName(session.agentSessionId);
              const providerLabel = liveSessionProviderLabel(session.provider);
              const dir = basename(session.cwd);
              // 色（帯・ドット）では分けない。プロバイダは語で伝える。
              const label = [providerLabel, name, dir, 'タブに戻す']
                .filter((part): part is string => part !== undefined && part !== '')
                .join('、');
              return (
                <li className="task-item task-item--unknown" key={session.agentSessionId}>
                  <button
                    type="button"
                    className="task-item__row"
                    aria-label={label}
                    onClick={() => onRecoverSession(session.agentSessionId, session.provider)}
                    // 「タブに戻せる AI」の行も終了できる対象（S113 の docstring・
                    // `taskContextMenuItems()` のコメント参照）。state 群の行と同じ
                    // 作法（onFocus / onContextMenu で対象を親へ知らせてからメニューを出す）。
                    onFocus={() => {
                      focusedRowRef.current = {
                        key: session.agentSessionId,
                        sectionKey: 'recoverable',
                      };
                      onTargetSession(session.agentSessionId);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      focusedRowRef.current = {
                        key: session.agentSessionId,
                        sectionKey: 'recoverable',
                      };
                      onTargetSession(session.agentSessionId);
                      // この節に出る行は定義上タブを開いていない
                      // （selectRecoverableSessions がタブが開いているものを除外する）。
                      window.api.menu.showTaskContextMenu({ hasOpenTab: false });
                    }}
                    ref={(el) => {
                      if (el) rowElementRefs.current.set(session.agentSessionId, el);
                      else rowElementRefs.current.delete(session.agentSessionId);
                    }}
                  >
                    <span className="task-item__status-dot" aria-hidden="true" />
                    <div className="task-item__body">
                      <div className="task-item__name">
                        <span className="task-item__state">{providerLabel}</span>
                        <span>{name}</span>
                      </div>
                      {dir !== undefined && dir !== '' && (
                        <div className="task-item__meta">{dir}</div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
