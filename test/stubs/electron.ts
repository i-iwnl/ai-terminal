// vitest から Main プロセスのモジュールを読むための `electron` の差し替え。
//
// テスト対象は純粋関数だが、それが同居するモジュールはトップレベルで
// `electron` を import している（ipcMain.handle の登録があるため）。
// Electron の実体は Node からは読めないので、import が通るだけの最小の形を置く。
//
// ここに実装を足さないこと。振る舞いを差し替えたくなったら、それは
// 「テストしたい関数が副作用と同居している」というサインなので、
// 対象側を純粋関数として切り出す。

/** ipcMain.handle / ipcMain.on の登録を受けるだけで何もしない。 */
export const ipcMain = {
  handle(): void {},
  on(): void {},
};

/** 通知は出せない環境として振る舞う。 */
export const Notification = {
  isSupported(): boolean {
    return false;
  },
};

/**
 * external-links.ts / menu.ts がトップレベルで import する。
 * **単体テストの対象はスキーム判定の純粋関数 `isSafeExternalUrl` だけ**で、
 * 実際に開く経路は E2E（S92）が `shell.openExternal` を差し替えて観測する。
 */
export const shell = {
  openExternal(): Promise<void> {
    return Promise.resolve();
  },
};

/**
 * data-dir.ts がトップレベルで参照する最小の値。関数は持たせない
 * （保存先の決定規則そのものは純粋関数 resolveDataDir で検証する）。
 */
export const app = {
  isPackaged: false,
};
