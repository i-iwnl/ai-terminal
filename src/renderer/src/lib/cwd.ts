// アプリ全体で共有する「作業ディレクトリ」の単一の管理場所。
//
// MVP では「アプリ起動時のカレントディレクトリ」を全タブ共通の cwd として使う。
// Renderer は Node API（process.cwd() 等）に触れられないため、window.api.app.paths()
// （Main が process.cwd() / os.homedir() を返す）を起動時に一度だけ呼んで解決する。
//
// 取得に失敗した場合は home にフォールバックし、それも取れなければ undefined のままにする
// （PTY 起動時は undefined を渡せば Main 側がホームディレクトリにフォールバックする仕様。
// src/shared/ipc.ts 参照）。いずれの場合もアプリを壊さない。
//
// 将来「ユーザーが cd した先を追跡する」機能を実装する際は、このファイルの中身
// （resolveSharedCwd の解決方法と setSharedCwd の呼び出し元）だけを差し替えれば全箇所に波及する。

let sharedCwd: string | undefined = undefined;
let resolved = false;
let inFlight: Promise<string | undefined> | null = null;
const listeners = new Set<(cwd: string | undefined) => void>();

export function getSharedCwd(): string | undefined {
  return sharedCwd;
}

/** cwd の解決が完了しているか（未解決の間は履歴取得などを待たせるために使う） */
export function isSharedCwdResolved(): boolean {
  return resolved;
}

export function setSharedCwd(cwd: string | undefined): void {
  sharedCwd = cwd;
  resolved = true;
  for (const listener of listeners) listener(cwd);
}

/** cwd が解決された（または解決に失敗して確定した）タイミングで通知を受け取る。購読解除関数を返す。 */
export function subscribeSharedCwd(listener: (cwd: string | undefined) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * window.api.app.paths() を呼んで共有 cwd を解決する。
 * 起動時に一度だけ呼び出せばよい（複数回呼んでも安全: 進行中の解決を使い回す）。
 * 失敗時・空文字時は home、それも無ければ undefined にフォールバックする。
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
