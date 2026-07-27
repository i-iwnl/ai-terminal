/**
 * Main <-> Renderer 間の IPC 契約。
 *
 * このファイルがチャンネル名と payload 型の単一の正。
 * Main / preload / Renderer のいずれもここから import し、文字列リテラルを各所に散らさない。
 */

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
}

/** PTY 起動の結果 */
export interface SpawnPtyResult {
  /** アプリ内でこの PTY を識別する ID */
  ptyId: string;
  /**
   * claude を起動した場合に --session-id で渡した UUID。
   * これを使って claude agents --json の結果と突き合わせる。
   */
  agentSessionId?: string;
  /** tmux でラップして起動したか */
  wrappedInTmux: boolean;
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
}

/** タスク一覧のスナップショット（Main -> Renderer の push） */
export interface AgentTasksEvent {
  tasks: AgentTask[];
  /** 取得に失敗した場合の理由。成功時は undefined */
  error?: string;
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
}

export interface ListHistoryRequest {
  provider: HistoryProvider;
  /** claude の場合、このパスを ~/.claude/projects の命名規則に変換して探索する */
  cwd: string;
  /** 取得件数の上限 */
  limit?: number;
}

export interface ListHistoryResult {
  entries: SessionHistoryEntry[];
  /** 一覧取得そのものに失敗した場合の理由 */
  error?: string;
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
// 設定
// ---------------------------------------------------------------------------

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
  /** サイドバーを現在のディレクトリに絞り込むか（false ならマシン全体） */
  scopeAgentsToCwd: boolean;
  /** xterm のテーマ色 */
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

// ---------------------------------------------------------------------------
// チャンネル定義
// ---------------------------------------------------------------------------

/** Renderer -> Main（invoke / 戻り値あり） */
export const IpcInvoke = {
  ptySpawn: 'pty:spawn',
  ptyKill: 'pty:kill',
  agentsList: 'agents:list',
  historyList: 'history:list',
  configGet: 'config:get',
  configSet: 'config:set',
  notifyShow: 'notify:show',
  appPaths: 'app:paths',
} as const;

/** Renderer -> Main（send / 戻り値なし・高頻度） */
export const IpcSend = {
  ptyInput: 'pty:input',
  ptyResize: 'pty:resize',
} as const;

/** Main -> Renderer（push） */
export const IpcEvent = {
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  agentTasks: 'agents:tasks',
} as const;

/**
 * preload の contextBridge で `window.api` として露出する API の形。
 * Renderer 側はこの型だけを見て実装する。
 */
export interface RendererApi {
  pty: {
    spawn(req: SpawnPtyRequest): Promise<SpawnPtyResult>;
    kill(ptyId: string): Promise<void>;
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
  };
  config: {
    get(): Promise<AppConfig>;
    set(patch: Partial<AppConfig>): Promise<AppConfig>;
  };
  notify: {
    show(req: NotifyRequest): Promise<void>;
  };
  app: {
    paths(): Promise<AppPaths>;
  };
}
