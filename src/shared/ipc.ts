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
   * claude を起動した場合の、そのセッションを一意に識別する ID。
   * 新規起動時は --session-id で渡した UUID、resume 時は --resume に渡した
   * 既存のセッション ID がそのまま入る（resume で新たに採番することはない）。
   * これを使って claude agents --json の結果と突き合わせたり、tmux セッション名
   * （src/main/pty/tmux.ts）を組み立てたりする。
   * resume でも埋まるため、Renderer 側では resume で開いたタブもタスク一覧の行から
   * 選べる（src/renderer/src/App.tsx の canFocusTaskTab が参照する）。
   * gemini には安定した ID が無いため常に undefined。
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
   * xterm の screenReaderMode。ターミナルの内容を支援技術から読める DOM として
   * 露出させる。既定 false。
   *
   * 既定で有効にしない理由は描画コスト（行が追加されるたびに live region を
   * 更新する）。VoiceOver の起動が検知できたときは、この値に関わらず有効にする。
   */
  screenReaderMode: boolean;
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
export type AppAction =
  | { type: 'new-shell-tab' }
  | { type: 'close-tab' }
  | { type: 'switch-tab'; index: number }
  | { type: 'new-claude-tab' }
  | { type: 'new-gemini-tab' }
  | { type: 'toggle-search' }
  | { type: 'toggle-settings' }
  | { type: 'clear-terminal' };

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
    /** 支援技術の起動・終了の購読。購読解除関数を返す */
    onAccessibilitySupportChanged(listener: (enabled: boolean) => void): () => void;
    /**
     * ドロップされた File の絶対パスを返す。取得できなければ空文字。
     *
     * **`File.path` は Electron 32 で削除された。** 代替の `webUtils.getPathForFile()` は
     * preload でしか呼べない（Renderer に `webUtils` を渡すと contextIsolation の前提が崩れる）ので、
     * ここだけ IPC を経由しない同期 API になっている。
     */
    pathForFile(file: File): string;
  };
  menu: {
    /** メニューから選ばれた操作の購読。購読解除関数を返す */
    onAction(listener: (action: AppAction) => void): () => void;
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
