// vitest から src/main/pty/manager.ts を読むための `node-pty` の差し替え。
//
// node-pty は Electron の ABI に合わせてビルドされたネイティブモジュールで、
// 素の Node からは読み込めない。manager.ts のコマンド組み立て（純粋関数）を
// テストするために、import が通るだけの形を置く。
//
// 実際に PTY を起動する経路は単体テストの対象外（E2E が担保する）。

export function spawn(): never {
  throw new Error('node-pty は単体テストでは使えません（PTY の起動は E2E の担当）');
}
