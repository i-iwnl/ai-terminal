/**
 * 画面のピクセルを数えるためのヘルパ。
 *
 * WebGL レンダラでは xterm.js が文字を canvas に描くため、DOM からテキストを読めない。
 * 「本当に描画されているか」を検証するにはピクセルを見るしかない。
 *
 * 画像ライブラリは追加しない。Electron の webContents.capturePage() が返す
 * NativeImage から getBitmap() で生のバイト列（BGRA・1チャンネル1バイト）を取れるので、
 * PNG のデコードそのものが不要になる。集計は Main プロセス側で済ませ、
 * ビットマップ本体を IPC 経由で運ばない（1画面で数 MB になるため）。
 */

import type { ElectronApplication } from '@playwright/test';

/** 検査する矩形（CSS ピクセル = DIP。ページ左上が原点） */
export interface CaptureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionStats {
  /** 検査したピクセル数 */
  total: number;
  /** 最頻色（= 背景とみなす）以外のピクセル数 */
  nonBackground: number;
  /** 出現した色の種類数 */
  distinctColors: number;
}

/**
 * 指定した矩形を撮影し、ピクセルの分布を返す。
 *
 * 「何かが描画されている」の判定には `nonBackground > 0` を使う。
 * 単色で塗り潰された画面（= 何も描画されていない）では最頻色が全ピクセルを占めるため
 * `nonBackground` が 0 になる。
 */
export async function captureRegionStats(
  app: ElectronApplication,
  rect: CaptureRect,
): Promise<RegionStats> {
  return app.evaluate(async ({ BrowserWindow }, r): Promise<RegionStats> => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('ウィンドウが見つかりません');

    const image = await win.webContents.capturePage({
      x: Math.round(r.x),
      y: Math.round(r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    });

    // BGRA が1ピクセル4バイトで並ぶ。アルファは合成済みで常に不透明なので見ない。
    const bitmap = image.getBitmap();
    const counts = new Map<number, number>();
    for (let i = 0; i < bitmap.length; i += 4) {
      const packed = (bitmap[i] << 16) | (bitmap[i + 1] << 8) | bitmap[i + 2];
      counts.set(packed, (counts.get(packed) ?? 0) + 1);
    }

    let mostCommon = 0;
    for (const count of counts.values()) {
      if (count > mostCommon) mostCommon = count;
    }

    const total = bitmap.length / 4;
    return {
      total,
      nonBackground: total - mostCommon,
      distinctColors: counts.size,
    };
  }, rect);
}
