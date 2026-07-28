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
