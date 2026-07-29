// 「いまアクティブなタブの作業ディレクトリ」を、サイドバー（履歴一覧・タスク一覧）へ
// 配るための単一の管理場所。
//
// タブごとの実際の cwd（PTY プロセスの実 cwd。cd への追従込み）を持つのは
// tabs/useTabs.ts の TabState.cwd。ここで持つのはその中から「今表示すべき1つ」——
// アクティブなタブの cwd だけ。タブ切り替えの検知・cd への追従のポーリングは
// useTabs.ts が行い、変化を検知するたびに setSharedCwd() を呼んで反映する。
//
// Renderer は Node API（process.cwd() 等）に触れられないため、起動直後の初回解決だけは
// window.api.app.paths()（Main が process.cwd() / os.homedir() を返す）に頼る
// （resolveSharedCwd）。それ以降の更新はすべて setSharedCwd() 経由で行われる。
//
// 取得に失敗した場合は home にフォールバックし、それも取れなければ undefined のままにする
// （PTY 起動時は undefined を渡せば Main 側がホームディレクトリにフォールバックする仕様。
// src/shared/ipc.ts 参照）。いずれの場合もアプリを壊さない。

let sharedCwd: string | undefined = undefined;
let resolved = false;
let inFlight: Promise<string | undefined> | null = null;
const listeners = new Set<(cwd: string | undefined) => void>();

/** いまアクティブなタブの cwd（未解決なら undefined） */
export function getSharedCwd(): string | undefined {
  return sharedCwd;
}

/** 共有 cwd の解決が一度でも完了しているか（未解決の間は履歴取得などを待たせるために使う） */
export function isSharedCwdResolved(): boolean {
  return resolved;
}

/**
 * 共有 cwd（＝アクティブなタブの cwd）を更新する。useTabs.ts がタブ切り替えの検知・
 * cd 追従のポーリングの両方から呼ぶ。
 *
 * cd への追従は2秒間隔のポーリングで駆動する（tabs/useTabs.ts 参照）ため、
 * 値が変わっていないのに毎回通知すると、購読している履歴一覧・タスク一覧が
 * 2秒ごとに再取得され続けてしまう。解決済みかつ前回と同じ値なら何もしない。
 */
export function setSharedCwd(cwd: string | undefined): void {
  if (resolved && cwd === sharedCwd) return;
  sharedCwd = cwd;
  resolved = true;
  for (const listener of listeners) listener(cwd);
}

/** 共有 cwd が変化した（初回解決を含む）タイミングで通知を受け取る。購読解除関数を返す。 */
export function subscribeSharedCwd(listener: (cwd: string | undefined) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * window.api.app.paths() を呼んで、起動時点の共有 cwd を一度だけ解決する。
 * 複数回呼んでも安全（idempotent: 進行中の解決を使い回し、解決済みならそれを返す）。
 * 失敗時・空文字時は home、それも無ければ undefined にフォールバックする。
 *
 * これは起動直後の初回解決専用。以降、アクティブなタブの切り替えや cd による更新は
 * useTabs.ts が setSharedCwd() を直接呼んで反映する（このファイルは通知経路を提供するだけ）。
 */
export function resolveSharedCwd(): Promise<string | undefined> {
  if (resolved) return Promise.resolve(sharedCwd);
  if (inFlight) return inFlight;

  inFlight = window.api.app
    .paths()
    .then((paths) => {
      const cwd = paths.cwd || paths.home || undefined;
      setSharedCwd(cwd);
      return cwd;
    })
    .catch((err: unknown) => {
      console.warn('[cwd] 作業ディレクトリの取得に失敗しました。既定値のまま続行します。', err);
      setSharedCwd(undefined);
      return undefined;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
