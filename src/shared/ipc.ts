/**
 * Main <-> Renderer 間の IPC 契約。
 *
 * このファイルがチャンネル名と payload 型の単一の正。
 * Main / preload / Renderer のいずれもここから import し、文字列リテラルを各所に散らさない。
 */

import type { TerminalContextMenuState } from './context-menu';

// ---------------------------------------------------------------------------
// ターミナル / PTY
// ---------------------------------------------------------------------------

/** PTY セッションの種別 */
export type PtyKind = 'shell' | 'claude' | 'gemini';

/** PTY を起動するときのリクエスト */
export interface SpawnPtyRequest {
  kind: PtyKind;
  /** 作業ディレクトリ。省略時はホームディレクトリ */
  cwd?: string;
  /** 初期の桁数 / 行数 */
  cols: number;
  rows: number;
  /**
   * claude を resume するときに指定するセッション ID。
   * kind === 'claude' のときのみ意味を持つ。
   */
  resumeSessionId?: string;
  /**
   * gemini を resume するときのセッション指定（"latest" もしくは index）。
   * kind === 'gemini' のときのみ意味を持つ。
   */
  geminiResumeTarget?: string;
  /**
   * gemini を resume するときの、そのセッションの内部 UUID
   * （`SessionHistoryEntry.stableId` と同じ値）。kind === 'gemini' のときのみ意味を持つ。
   *
   * **用途は tmux セッション名を安定させることだけ**（`SpawnPtyResult.agentSessionId`
   * に入り、`buildTmuxSessionName()` が使う）。
   *
   * ⛔ **`--resume` に渡してはいけない。** `--resume` は index を受け取る
   * インターフェースで、**数字始まりの UUID（全体の約 62%）は index として解釈され、
   * 別セッションを作ったうえで既存のセッションファイルを失う**（2026-08-06 実測 /
   * Gemini CLI 0.53.0 / 2回再現）。`--resume` へ渡すのは常に `geminiResumeTarget` のほう。
   * **だからこのフィールドの名前に `Resume` を入れていない**（Issue #155 の design-review で
   * 「`geminiResumeStableId` は `--resume` に渡す値と読まれる」と2人が指摘した）。
   */
  geminiAgentSessionId?: string;
}

/** PTY 起動の結果 */
export interface SpawnPtyResult {
  /** アプリ内でこの PTY を識別する ID */
  ptyId: string;
  /**
   * その CLI セッションを一意に識別する安定 ID。
   * 新規起動時は --session-id で渡した UUID、resume 時は既存のセッション ID が
   * そのまま入る（resume で新たに採番することはない）。
   * つまり「同じ CLI セッションに対しては常に同じ値になる」キー。
   *
   * **用途は2つあり、claude と gemini で数が違う。**
   * 1. tmux セッション名（src/main/pty/tmux.ts）の種。**claude / gemini とも**
   * 2. `claude agents --json` の結果との突き合わせ。**claude のときだけ**
   *    （gemini には実行中タスク一覧に相当するコマンドが無い。src/main/agents/gemini.ts）
   *
   * resume でも埋まるため、Renderer 側では resume で開いたタブもタスク一覧の行から
   * 選べる（src/renderer/src/App.tsx の canFocusTaskTab が参照する）。
   *
   * ⚠ **gemini で undefined になる場合がある**（Issue #155）。CLI が 0.53.0 未満で
   * `--session-id` を渡せないとき、または resume 元の履歴から UUID を取れなかったとき。
   * そのとき tmux セッション名は ptyId 由来になり、閉じると回収できない
   * （Renderer 側はこの undefined を「回収できない」の判定に使う。closeTabCopy.ts）。
   */
  agentSessionId?: string;
  /** tmux でラップして起動したか */
  wrappedInTmux: boolean;
  /**
   * 実際に起動したシェルの実行ファイル名（`fish` / `bash` / `zsh`。basename）。
   *
   * **`kind === 'shell'` のときだけ埋まる。** 決定順は Main の `buildShellPlan()`
   * （`config.shell -> $SHELL -> /bin/zsh`）で、そこが唯一の正。Renderer は
   * `AppConfig.shell` を読んでも既定が `undefined` なので `$SHELL` を知りえず、
   * これを返さないと画面に `zsh` をハードコードするしかなくなる（Issue #137）。
   *
   * **claude / gemini では埋めない。** それらは tmux でラップされうるので、
   * ラップ後の `plan.command` は `tmux` になる。「起動したコマンド名」を
   * 汎用フィールドにすると、そこに `tmux` が載る事故が起きる。
   *
   * **フルパスではなく basename。** 画面の幅が足りない（ペインヘッダの実幅は
   * 最小ペインで約 148.6px）ほか、読み上げでも `/opt/homebrew/bin/fish` は
   * `fish` の 1.87 倍の時間がかかる（Issue #137 の design-review で実測）。
   */
  shellName?: string;
}

/** PTY からの出力（Main -> Renderer の push） */
export interface PtyDataEvent {
  ptyId: string;
  /** ANSI エスケープを含む生の文字列。加工しない */
  data: string;
}

/** PTY の終了通知（Main -> Renderer の push） */
export interface PtyExitEvent {
  ptyId: string;
  exitCode: number;
  signal?: number;
}

/** Renderer からの入力 */
export interface PtyInputRequest {
  ptyId: string;
  data: string;
}

/**
 * PTY プロセスの現在の作業ディレクトリ。
 *
 * シェルタブで `cd` した先を追跡するために使う。Renderer は Node API に触れないので、
 * プロセスの cwd を読むのは Main の仕事（src/main/pty/cwd.ts）。
 * 取得できなかった場合は `cwd: undefined` を返す（呼び出し側は直前の値を維持する）。
 */
export interface PtyCwdResult {
  ptyId: string;
  cwd?: string;
}

/** ウィンドウリサイズに伴う PTY のリサイズ */
export interface PtyResizeRequest {
  ptyId: string;
  cols: number;
  rows: number;
}

// ---------------------------------------------------------------------------
// エージェント（実行中タスク一覧）
// ---------------------------------------------------------------------------

/**
 * `claude agents --json` の1要素を、アプリ内で扱う形に正規化したもの。
 * CLI の出力形式が変わりうるため、必須は id 系のみで他は optional にしてある。
 */
export interface AgentTask {
  /** claude 側の sessionId。一覧の一意キー */
  sessionId: string;
  pid?: number;
  cwd?: string;
  /** 'interactive' など。CLI が返した値をそのまま持つ */
  kind?: string;
  /** 'busy' | 'idle' など。CLI が返した値をそのまま持つ */
  status?: string;
  /** 表示名 */
  name?: string;
  /** 起動時刻（epoch ミリ秒） */
  startedAt?: number;
  /** このアプリ自身が起動したセッションか */
  ownedByApp: boolean;
  /**
   * タブを閉じた（またはアプリを再起動した）あとでも、**そのセッションに戻せるか**。
   *
   * `aiterm-<sessionId>` の tmux セッションが生きていれば true。
   * `tmux new-session -A` が既存セッションにアタッチするので、**新しいプロセスを
   * 作らずに元の画面へ戻れる**（`src/main/pty/tmuxSessions.ts`）。
   *
   * ⭐ **なぜ要るか。** タブの構成はどこにも永続化していないので、アプリを再起動すると
   * 走っているセッションは全部「一覧には出るが押せない行」になっていた。
   *
   * ⛔ **未取得・失敗は false に倒す。** 「生きていないのに押せる」（押すと新しい
   * プロセスが生える）側へ倒さないため。
   */
  recoverable?: boolean;
  /**
   * 「あなたの番」になった時刻（epoch ミリ秒）。
   *
   * `src/main/agents/poller.ts` が busy -> 非busy の遷移を検知した瞬間の
   * `Date.now()` を保持し、ここに載せて渡す。`startedAt` はセッション起動からの
   * 通算でしかなく「何分待たせているか」には使えないため、この値を別に持つ。
   *
   * 次のいずれかの場合は undefined になる（縮退表示: 待たせている時間を出さないだけで、
   * 一覧自体は表示する）:
   * - 現在の状態が working（作業中）または unknown（不明）
   * - このアプリの起動後、まだこのセッションの遷移を1度も観測していない
   *   （起動時から既に「あなたの番」だった、直前にアプリ / Main プロセスが
   *   再起動して遷移の記憶が失われた等）
   */
  yourTurnSince?: number;
}

/** タスク一覧のスナップショット（Main -> Renderer の push） */
/**
 * tmux で生きている、このアプリ由来のセッション1本の要約。
 *
 * **`claude agents --json` とは出自が違う。** こちらは tmux が答えるので、
 * **`--list-sessions` に出ない gemini セッション（会話0往復）も入る**
 * （`.claude/workspace/issue-180/known-issues.md` の 12番）。
 *
 * ⛔ **起動コマンドの文字列は載せない。** 採番した UUID が生で入るため
 * （`src/main/pty/tmuxSessions.ts`）。provider は Main が確定してから渡す。
 */
export interface LiveAgentSession {
  agentSessionId: string;
  provider: 'claude' | 'gemini';
  cwd?: string;
}

export interface AgentTasksEvent {
  tasks: AgentTask[];
  /**
   * tmux で生きている、このアプリ由来のセッション。
   * **`tasks` とは別の出自**なので、重複は受け取り側（Renderer）が
   * `agentSessionId` で突き合わせて落とす。取得できなければ空。
   */
  liveSessions?: LiveAgentSession[];
  /** 取得に失敗した場合の理由。成功時は undefined */
  error?: string;
  /**
   * error の機械判定用。'not-found' は claude が PATH に無い（ENOENT）ことを表す。
   * Issue #20 I-3: この種別だけ Renderer（TaskList.tsx）が専用の空状態パネル
   * （見出し + 手順 + 再確認ボタン）に出し分ける。他の理由（timeout / failed）は
   * 従来どおり赤字の一行エラーのまま（打つ手がある／一時的な失敗であるため）。
   */
  errorKind?: 'not-found' | 'timeout' | 'failed';
  /** 取得時刻（epoch ミリ秒） */
  fetchedAt: number;
}

/** タスク一覧の取得スコープ */
export interface ListAgentsRequest {
  /** 指定すると claude agents --cwd で絞り込む。省略時はマシン全体 */
  cwd?: string;
}

// ---------------------------------------------------------------------------
// 履歴 / resume
// ---------------------------------------------------------------------------

/** どの CLI の履歴か */
export type HistoryProvider = 'claude' | 'gemini';

/**
 * 履歴一覧の1件。
 * JSONL のパースに失敗しても sessionId と updatedAt だけで縮退表示できるよう、
 * プレビュー系のフィールドはすべて optional。
 */
export interface SessionHistoryEntry {
  provider: HistoryProvider;
  /** claude は UUID、gemini は index 由来の識別子 */
  sessionId: string;
  /** 最終更新時刻（epoch ミリ秒）。claude はファイルの mtime */
  updatedAt: number;
  cwd?: string;
  /** セッションのタイトル。取得できなければ undefined */
  title?: string;
  /** 最初のユーザープロンプトの冒頭。取得できなければ undefined */
  firstPrompt?: string;
  gitBranch?: string;
  /** プレビューのパースに失敗した場合の理由 */
  parseError?: string;
  /**
   * タイトル上書きの保存キー。claude は sessionId と同じ。
   * gemini は --list-sessions 行末の内部 UUID（取れなければ undefined = 編集不可）。
   * sessionId は gemini では行番号由来で並び替わりに弱いため、保存キーには使わない。
   */
  stableId?: string;
}

export interface ListHistoryRequest {
  provider: HistoryProvider;
  /** claude の場合、このパスを ~/.claude/projects の命名規則に変換して探索する */
  cwd: string;
  /** 取得件数の上限 */
  limit?: number;
  /**
   * true なら cwd の絞り込みを外し、~/.claude/projects 配下の全フォルダを横断して
   * 集計する（Issue #20 I-3「すべてのフォルダを見る」）。
   *
   * claude のみ対応。gemini は `--list-sessions` の実行 cwd 自体がスコープを決めており、
   * どのディレクトリを横断すればよいか列挙する手段が無いため、この指定は無視される
   * （listGeminiHistory は cwd を無視しない）。
   */
  allFolders?: boolean;
}

export interface ListHistoryResult {
  entries: SessionHistoryEntry[];
  /** 一覧取得そのものに失敗した場合の理由 */
  error?: string;
}

/**
 * 履歴タイトルの上書き。CLI 側のファイル（JSONL 等）は書き換えず、
 * アプリ側の ~/.ai-terminal/session-titles.json に保存して表示時に重ねる。
 */
export interface SetSessionTitleRequest {
  provider: HistoryProvider;
  /** SessionHistoryEntry.stableId と同じ値 */
  stableId: string;
  /** 上書きするタイトル。trim 後に空なら上書きを解除する */
  title: string;
}

// ---------------------------------------------------------------------------
// アプリのパス
// ---------------------------------------------------------------------------

/**
 * Renderer は Node API に触れないため、基準となる絶対パスを Main から受け取る。
 * 履歴一覧の探索キー（cwd）と PTY 起動時の作業ディレクトリの既定値に使う。
 */
export interface AppPaths {
  /** アプリを起動したときのカレントディレクトリ */
  cwd: string;
  /** ホームディレクトリ */
  home: string;
}

// ---------------------------------------------------------------------------
// メモ
// ---------------------------------------------------------------------------

/**
 * メモの種別。
 * - global: アプリ全体で1枚だけのスクラッチパッド
 * - session: 履歴セッション（provider + stableId）に紐付くメモ
 */
export type MemoScope = 'global' | 'session';

/**
 * メモ1件。
 * scope === 'global' のときは provider / stableId / title を持たない。
 */
export interface MemoEntry {
  scope: MemoScope;
  provider?: HistoryProvider;
  /** SessionHistoryEntry.stableId と同じ値（セッションメモの保存キー） */
  stableId?: string;
  /** メモ本文。未作成なら空文字 */
  body: string;
  /** 最終更新時刻（epoch ミリ秒）。未作成なら 0 */
  updatedAt: number;
  /**
   * セッションメモを一覧に出すときの表示名。
   * 履歴一覧を開かなくてもどのセッションのメモか分かるよう、保存時に一緒に控える。
   */
  title?: string;
}

export interface SetMemoRequest {
  scope: MemoScope;
  provider?: HistoryProvider;
  stableId?: string;
  /** trim 後に空ならそのメモを削除する */
  body: string;
  /** 省略時は保存済みの表示名を維持する */
  title?: string;
}

export interface ListMemosResult {
  /** 全体メモ。未作成でも空の MemoEntry を返す（呼び出し側で分岐させない） */
  global: MemoEntry;
  /** セッションメモ。updatedAt の降順 */
  sessions: MemoEntry[];
}

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------

/** Slack / Discord の Incoming Webhook 設定 */
export interface WebhookConfig {
  /** 送信を有効にするか */
  enabled: boolean;
  /** Webhook URL。空文字なら enabled でも送信しない */
  url: string;
}

export interface AppConfig {
  /** 起動するシェル。省略時は $SHELL */
  shell?: string;
  fontFamily: string;
  fontSize: number;
  /** タスク一覧のポーリング間隔（ミリ秒） */
  pollIntervalMs: number;
  /** tmux が利用可能なら AI CLI をラップするか */
  useTmux: boolean;
  /** タスク完了時に通知を出すか */
  notifyOnIdle: boolean;
  /** 通知時に音を鳴らすか */
  notifySound: boolean;
  /**
   * 鳴らす音の識別子（SoundOption.id）。空文字なら OS 既定の通知音に任せる。
   * notifySound が false のときは参照されない。
   */
  notifySoundId: string;
  /** タスク完了を Slack にも送るか */
  slack: WebhookConfig;
  /** タスク完了を Discord にも送るか */
  discord: WebhookConfig;
  /** サイドバーを現在のディレクトリに絞り込むか（false ならマシン全体） */
  scopeAgentsToCwd: boolean;
  /**
   * サイドバーの幅（CSS px）。ドラッグでの変更を跨いで保存する。
   *
   * **折りたたみ（`Opt+Cmd+S`）の状態は意図的に保存しない**（README 参照。
   * 畳んだ状態を覚えると、サイドバーの存在自体に気づけなくなる）。
   * 幅を保存するのは、畳んで開き直したときに「自分が決めた幅」へ戻るのが
   * 期待どおりだから。範囲の判定は
   * `src/renderer/src/sidebar/sidebarWidth.ts` の `clampSidebarWidth` が正。
   */
  sidebarWidth: number;
  /**
   * xterm の screenReaderMode。ターミナルの内容を支援技術から読める DOM として
   * 露出させる。既定 false。
   *
   * 既定で有効にしない理由は描画コスト（行が追加されるたびに live region を
   * 更新する）。VoiceOver の起動が検知できたときは、この値に関わらず有効にする。
   */
  screenReaderMode: boolean;
  /**
   * 選んだ配色プリセットの識別子（`src/shared/themes.ts` の `THEME_PRESETS`）。
   *
   * **空文字は「未設定」で、そのときは下の `theme`（4色）が勝つ。**
   * 既に `config.json` を手で書いている利用者の設定を、UI を足したことで
   * 黙って無視しないため。`'custom'` はプリセットから外れた状態を表す
   * 番人値で、**型に最初から入れてある**（あとから足すと `coerceConfig` を
   * 2回触ることになる）。
   *
   * 適用の優先順位は `themes.ts` の `resolveTheme` が唯一の正。
   */
  themeName: string;
  /**
   * xterm のテーマ色。
   *
   * `themeName` が有効なプリセットを指しているときは、そちらが優先される
   * （この4色は「プリセットを使っていないとき」と「custom」のための保存場所）。
   */
  theme: TerminalTheme;
}

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
}

// ---------------------------------------------------------------------------
// 通知
// ---------------------------------------------------------------------------

export interface NotifyRequest {
  title: string;
  body: string;
  /** 音を鳴らすか。省略時は設定に従う */
  sound?: boolean;
}

/** 通知音の選択肢1件 */
export interface SoundOption {
  /**
   * 保存・再生に使う識別子。
   * macOS のシステムサウンドは音源名（例: 'Glass'）、
   * ユーザー指定のファイルは絶対パス（'/' 始まり）。空文字は「OS 既定」を表す。
   */
  id: string;
  /** 一覧に出す表示名 */
  label: string;
}

export interface PlaySoundRequest {
  /** 省略時は設定中の notifySoundId を鳴らす */
  soundId?: string;
}

/** Webhook の送信先 */
export type WebhookTarget = 'slack' | 'discord';

export interface TestWebhookRequest {
  target: WebhookTarget;
  /**
   * 検証に使う URL。省略時は設定に保存済みの URL を使う。
   * 「保存する前に試す」ためのフィールド。
   */
  url?: string;
}

/** Webhook 送信の結果。失敗してもアプリは落とさず、理由だけを返す。 */
export interface WebhookSendResult {
  ok: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// アプリ操作（メニューとキーボードで共有する語彙）
// ---------------------------------------------------------------------------

/**
 * アプリに対する操作の語彙。
 *
 * **メニューとキーボードショートカットは、同じ操作を別の入口から呼ぶだけ**なので、
 * 語彙をここで1つにしておく。片方にだけ操作が増えると、メニューに載っていない
 * ショートカット（＝発見できない機能）や、キーが振られていないメニュー項目ができる。
 *
 * 実際に押されるキーの定義は Main 側のメニュー（`src/main/menu.ts`）が唯一の正。
 * Renderer 側の `matchShortcut()` は、メニューが載せていないキーだけを拾う。
 */
/**
 * ペインの分割方向。`tabs/paneTree.ts` の `SplitDirection` と同じ意味
 * （'row' = 左右分割、'column' = 上下分割）だが、**ここでは独立に定義する**。
 * `PaneNode` を含むペインの木そのものは `src/shared/` に置かない
 * （design-review.md の非目標。Main はペインの木を知る必要が無い）ため、
 * 型を import せず同じ形を再宣言してある。
 */
export type PaneSplitDirection = 'row' | 'column';

/**
 * スプリッタの分割比を調整する向き（Issue #56 PR 7・design-review.md 提案 D'）。
 *
 * `widen` / `narrow` はアクティブなペインの取り分を広げる/狭める、`reset` は
 * 50% に戻す。この3項目1組が **WCAG 2.5.7（ドラッグ動作）と 2.5.8（ターゲット
 * サイズ 24x24）を同時に満たす Equivalent 例外の根拠**になる（スプリッタの
 * 当たり判定は 8px しかなく、どちらの基準も単体では満たせない）。
 */
export type PaneRatioAdjustment = 'widen' | 'narrow' | 'reset';

/**
 * ペイン間移動の4方向（Issue #56 PR 8）。`tabs/paneTree.ts` の `MoveDirection` と
 * 同じ意味だが、`PaneSplitDirection` と同じ理由でここでは独立に再宣言する
 * （`PaneNode` を含む木そのものは `src/shared/` に置かない。design-review.md の非目標）。
 */
export type PaneMoveDirection = 'up' | 'down' | 'left' | 'right';

/**
 * 「あなたの番」のタブへジャンプする向き（`Cmd+J` / `Cmd+Shift+J`。Issue #20 J）。
 * forward が次、backward が逆順（Shift 付き）。
 */
export type YourTurnJumpDirection = 'forward' | 'backward';

export type AppAction =
  | { type: 'new-shell-tab' }
  | { type: 'close-tab' }
  | { type: 'switch-tab'; index: number }
  | { type: 'new-claude-tab' }
  | { type: 'new-gemini-tab' }
  | { type: 'toggle-search' }
  | { type: 'find-next' }
  | { type: 'find-previous' }
  | { type: 'toggle-settings' }
  | { type: 'clear-terminal' }
  /** 右／下にペインを分割する（Issue #56 PR 4）。'row' が右、'column' が下。 */
  | { type: 'split-pane'; dir: PaneSplitDirection }
  /**
   * アクティブなペインを閉じる。**`close-tab` とは意味が別**（design-review.md
   * 「確定している仕様」）。ペインが1枚しか無いタブでは、結果としてタブそのものが
   * 閉じる（呼び出し側 = useTabs.ts の closeActivePane が判断する）。
   */
  | { type: 'close-pane' }
  /**
   * アクティブなペインを含む分割の比率を調整する（Issue #56 PR 7）。
   * アクティブなペインが分割されていないタブでは何もしない（呼び出し側で
   * 通知を出す）。
   */
  | { type: 'adjust-split-ratio'; adjustment: PaneRatioAdjustment }
  /**
   * アクティブなペインの最大化トグル（Issue #56 PR 8・design-review.md 提案 I）。
   * 木（`ratio` / 構造）は一切変えない一時的な表示切り替えで、PTY も kill しない
   * （呼び出し側 = Renderer 側のレイアウトだけで完結する。Main はこの操作を
   * 一切知らない）。
   */
  | { type: 'toggle-maximize-pane' }
  /**
   * アクティブなペインの名前を変更する（Issue #130）。タブバーの名前欄を
   * 編集状態にして `.focus()` するところまでが Renderer の責務。
   *
   * **アクセラレータを割り当てない。** 想定頻度が低い操作に
   * `Cmd+英数字` の名前空間を払わない（design-rules.md）。`menu.ts` の
   * 「分割比を広げる / 狭める」と同じ形。
   *
   * **これがキーボードからの唯一の到達手段。** それまでリネームは
   * タブのダブルクリックだけで、`AppAction` にも `menu.ts` にも無く、
   * キーボードから1手も届かなかった（WCAG 2.1.1）。ペインヘッダを
   * クリック可能にする案は、18px が 2.5.8 の 24x24 を割ること・Tab を
   * xterm が食うこと・focus 効果と衝突して開いた瞬間に閉じることから
   * 5人のレビューで否定された。
   */
  | { type: 'rename-active-pane' }
  /** 平坦化した順で次/前のペインへフォーカスを移す（`Cmd+]` / `Cmd+[`。design-review.md 提案 B'）。 */
  | { type: 'next-pane' }
  | { type: 'previous-pane' }
  /**
   * 空間的な方向でペイン間を移動する（`Cmd+Option+矢印`。design-review.md 提案 B'）。
   * ガード（`shortcuts.ts` の `passesModifierGate`）は PR 1（#87）で既に矢印キーに
   * 限って altKey を許可済みなので、このアクションはそのまま発火する。
   */
  | { type: 'move-pane-focus'; direction: PaneMoveDirection }
  /**
   * 次の「あなたの番」のタブへジャンプする（`Cmd+J` / `Cmd+Shift+J`。Issue #20 J）。
   * 想定 100〜200回/日、1日 200〜600手の削減。探索・突き合わせの実体は
   * Renderer 側の純粋関数 `tabs/tabYourTurn.ts` の `findNextYourTurnTab` が持つ
   * （AppAction はキー/メニューからの語彙を運ぶだけ）。
   */
  | { type: 'jump-your-turn-tab'; direction: YourTurnJumpDirection }
  /**
   * 直前にアクティブだったタブへ戻る（`Cmd+E`。Issue #20 J）。ブラウザの「戻る」に
   * 近く、2回連続で押すと直近2枚のタブをトグルする（`tabs/tabHistory.ts` 参照）。
   */
  | { type: 'last-active-tab' }
  /**
   * タブの並び順で次/前のタブへ移動する（`Cmd+Shift+]` / `Cmd+Shift+[`。Issue #20 J。
   * iTerm2・Ghostty・Chrome 共通の筋肉記憶。`Cmd+]` / `Cmd+[`（`next-pane` /
   * `previous-pane`）はペイン移動に既に割り当て済みのため、タブ側は Shift 付きにして
   * 衝突を避けてある（`shortcuts.ts` 参照）。
   */
  | { type: 'next-tab' }
  | { type: 'previous-tab' }
  /**
   * サイドバー（タスク / 履歴 / メモ）の表示をトグルする（`Cmd+Option+S`。
   * Issue #20 K-1）。**既定は表示したまま**で、この操作は「一時的に畳んで
   * ターミナルを広げる」ための逃げ道（design-review.md の原則3「ターミナルが
   * 主役」）。既定を 0px にする案は、画像13枚と既存 spec の起点をすべて
   * 作り直すことになるため別 Issue に切ってある。
   *
   * 状態は Renderer（App.tsx）だけが持つ。Main はこの操作を知らない
   * （`toggle-maximize-pane` と同じく、レイアウトだけで完結する）。
   */
  | { type: 'toggle-sidebar' }
  /**
   * サイドバーの幅の増減（Issue #119 周4 / #20 の PR 16）。
   *
   * **ドラッグのキーボード代替**（WCAG 2.5.7 Dragging Movements）。
   * `adjust-split-ratio` と同じく、メニュー項目からのみ届く
   * （`accelerator` は持たない。幅調整は頻度が低く、`Cmd+英数字` の名前空間は
   * 100手/日級の操作のために空けておく）。
   */
  | { type: 'adjust-sidebar-width'; adjustment: 'wider' | 'narrower' | 'reset' }
  /**
   * ターミナルのフォントサイズ（Issue #120 周1）。
   *
   * **Electron の `role: 'zoomIn' / 'zoomOut' / 'resetZoom'` とは別物。**
   * あちらは Renderer 全体（サイドバー・タブバーを含む）の拡大率で、
   * `config.json` にも保存されない。こちらは `AppConfig.fontSize` を動かし、
   * **xterm の文字だけ**を変える。同じキーが2系統から発火しないよう、
   * `menu.ts` 側で zoom のアクセラレータを潰してある。
   */
  | { type: 'adjust-font-size'; adjustment: 'increase' | 'decrease' | 'reset' }
  /**
   * サイドバーのパネル切替（Issue #120 周2 / 旧 #111）。
   *
   * **`switch-tab` はタブバーのタブであってサイドバーではない。** 混同しないこと。
   *
   * 周2 まで、3パネル（タスク / 履歴 / メモ）はマウスでしか押せなかった。
   * `Tab` キーでも到達できない（xterm のヘルパー textarea が Tab を端末入力として
   * 消費するため、フォーカスがターミナルにある限り DOM のフォーカス順に出られない）。
   * WCAG 2.1.1（キーボード）。
   */
  | { type: 'switch-sidebar-panel'; panel: SidebarPanel };

/** サイドバーの3パネル。`Sidebar.tsx` の内部状態と `AppAction` の両方が使う。 */
export type SidebarPanel = 'tasks' | 'history' | 'memo';

// ---------------------------------------------------------------------------
// チャンネル定義
// ---------------------------------------------------------------------------

/** Renderer -> Main（invoke / 戻り値あり） */
export const IpcInvoke = {
  ptySpawn: 'pty:spawn',
  ptyKill: 'pty:kill',
  ptyCwd: 'pty:cwd',
  agentsList: 'agents:list',
  historyList: 'history:list',
  historySetTitle: 'history:set-title',
  memoList: 'memo:list',
  memoSet: 'memo:set',
  configGet: 'config:get',
  configSet: 'config:set',
  notifyShow: 'notify:show',
  notifyListSounds: 'notify:list-sounds',
  notifyPlaySound: 'notify:play-sound',
  notifyTestWebhook: 'notify:test-webhook',
  appPaths: 'app:paths',
  appAccessibilitySupport: 'app:accessibility-support',
} as const;

/** Renderer -> Main（send / 戻り値なし・高頻度） */
export const IpcSend = {
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
  settingsOpen: 'settings:open',
  settingsClose: 'settings:close',
  /**
   * アクティブなタブのペイン数を Main へ知らせる。
   * 「タブを閉じる（N ペイン）」メニュー項目のラベルを動的に更新するために使う
   * （design-review.md の確定仕様。何本の PTY が失われるかをメニューの時点で
   * 見せる）。ペインの木そのものは Renderer だけが持つため、Main は数だけを受け取る。
   */
  menuPaneCount: 'menu:pane-count',
  /**
   * ターミナル面の右クリックメニューを出す（Issue #135）。
   *
   * **Renderer は「状況」だけを送り、項目表は `src/shared/context-menu.ts` が決める。**
   * Main はそれを `MenuItemConstructorOptions` に変換して `Menu.popup()` するだけ。
   * ペインの木は Renderer だけが持つので、`menuPaneCount` と同じく数だけを渡す。
   */
  contextMenuShow: 'context-menu:show',
  /** ウィンドウタイトルの設定（Issue #119 周5 / #20 の K-10） */
  windowSetTitle: 'window:set-title',
} as const;

/** Main -> Renderer（push） */
export const IpcEvent = {
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  agentTasks: 'agents:tasks',
  menuAction: 'menu:action',
  accessibilitySupportChanged: 'app:accessibility-support-changed',
  focusSession: 'session:focus',
  configChanged: 'config:changed',
  /**
   * ウィンドウがフルスクリーンに入った / 出た（Issue #119 周5 / #20 の K-5）。
   *
   * フルスクリーン中は macOS が信号機ボタンを隠すので、その下敷きにしている
   * `.sidebar__drag-region` も畳む必要がある（残すと**何も無い帯だけが
   * ターミナルの上に居座る**）。Renderer からは `window.isFullScreen` のような
   * DOM API では取れない（あれは HTML5 の全画面 API で、macOS の
   * フルスクリーンとは別物）ため、Main から流す。
   */
  fullScreenChanged: 'window:full-screen-changed',
} as const;

/**
 * preload の contextBridge で `window.api` として露出する API の形。
 * Renderer 側はこの型だけを見て実装する。
 */
export interface RendererApi {
  pty: {
    spawn(req: SpawnPtyRequest): Promise<SpawnPtyResult>;
    kill(ptyId: string): Promise<void>;
    /**
     * その PTY プロセスがいま居るディレクトリ。
     * シェルタブの `cd` に追従するために、アクティブなタブへ定期的に問い合わせる。
     */
    cwd(ptyId: string): Promise<PtyCwdResult>;
    input(req: PtyInputRequest): void;
    resize(req: PtyResizeRequest): void;
    /** 購読解除関数を返す */
    onData(listener: (e: PtyDataEvent) => void): () => void;
    onExit(listener: (e: PtyExitEvent) => void): () => void;
  };
  agents: {
    list(req: ListAgentsRequest): Promise<AgentTasksEvent>;
    /** ポーリング結果の購読。購読解除関数を返す */
    onTasks(listener: (e: AgentTasksEvent) => void): () => void;
  };
  history: {
    list(req: ListHistoryRequest): Promise<ListHistoryResult>;
    setTitle(req: SetSessionTitleRequest): Promise<void>;
  };
  memo: {
    list(): Promise<ListMemosResult>;
    set(req: SetMemoRequest): Promise<ListMemosResult>;
  };
  config: {
    get(): Promise<AppConfig>;
    set(patch: Partial<AppConfig>): Promise<AppConfig>;
    /**
     * 設定が変わったときの購読。購読解除関数を返す。
     *
     * **設定ウィンドウは本体とは別の Renderer** なので、そちらでの変更は
     * 本体の state には自動では届かない。Main が全ウィンドウへ配信する。
     */
    onChange(listener: (config: AppConfig) => void): () => void;
  };
  notify: {
    show(req: NotifyRequest): Promise<void>;
    /** 選択できる通知音の一覧。環境によっては空配列 */
    listSounds(): Promise<SoundOption[]>;
    /** 通知音を試聴する */
    playSound(req: PlaySoundRequest): Promise<void>;
    /** Webhook にテストメッセージを送る */
    testWebhook(req: TestWebhookRequest): Promise<WebhookSendResult>;
  };
  app: {
    paths(): Promise<AppPaths>;
    /**
     * OS の支援技術（VoiceOver 等）が動いているか。
     * 設定を知らないユーザーでもターミナルが読める状態にするための自動検知に使う。
     */
    accessibilitySupport(): Promise<boolean>;
    /**
     * 支援技術の起動・終了の購読。購読解除関数を返す。
     *
     * **Main は全ウィンドウへ配信する**（Issue #149）。本体ウィンドウだけでなく
     * 設定ウィンドウもこれを受け取り、開いたまま支援技術を起動・終了しても追従する。
     */
    onAccessibilitySupportChanged(listener: (enabled: boolean) => void): () => void;
    /**
     * ドロップされた File の絶対パスを返す。取得できなければ空文字。
     *
     * **`File.path` は Electron 32 で削除された。** 代替の `webUtils.getPathForFile()` は
     * preload でしか呼べない（Renderer に `webUtils` を渡すと contextIsolation の前提が崩れる）ので、
     * ここだけ IPC を経由しない同期 API になっている。
     */
    pathForFile(file: File): string;
    /** macOS のフルスクリーンに入った / 出たの購読。購読解除関数を返す */
    onFullScreenChanged(listener: (fullScreen: boolean) => void): () => void;
    /**
     * ウィンドウのタイトルを設定する（Issue #119 周5 / #20 の K-10）。
     *
     * `titleBarStyle: 'hiddenInset'` なのでタイトルバーには出ないが、
     * **ウィンドウメニュー・Mission Control・App Exposé には出る。**
     * アクティブなタブの名前を流す。
     */
    setTitle(title: string): void;
  };
  menu: {
    /** メニューから選ばれた操作の購読。購読解除関数を返す */
    onAction(listener: (action: AppAction) => void): () => void;
    /**
     * アクティブなタブのペイン数を Main へ知らせる。
     * 「タブを閉じる（N ペイン）」のラベル更新にだけ使う（IpcSend.menuPaneCount 参照）。
     */
    reportPaneCount(count: number): void;
    /**
     * ターミナル面の右クリックメニューを出す（Issue #135。IpcSend.contextMenuShow 参照）。
     * 項目が選ばれた結果は既存の `onAction` 経由で戻ってくる（新しい経路を作らない）。
     */
    showContextMenu(state: TerminalContextMenuState): void;
  };
  session: {
    /**
     * 「このセッションのタブを前に出せ」という指示の購読。
     * OS 通知をクリックしたときに Main から飛んでくる。購読解除関数を返す。
     */
    onFocus(listener: (agentSessionId: string) => void): () => void;
  };
  settings: {
    /** 設定ウィンドウを開く（既に開いていれば前に出す） */
    open(): void;
    /** 設定ウィンドウを閉じる。設定ウィンドウ自身から呼ぶ */
    close(): void;
  };
}
