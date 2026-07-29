/**
 * 画面に実際に描かれている色から、WCAG 2.2 のコントラスト比を測る。
 *
 * **`styles.css` の宣言値ではなく、ブラウザが解決した実効色を見る。**
 * 宣言を読むだけだと、上書き・継承・トークンの参照ミスで実際の描画が変わっていても気づけない。
 *
 * 背景は「透明でない最初の祖先」まで遡って解決する。ボタンの多くは
 * `background: transparent` なので、自分自身の背景色を読むと rgba(0,0,0,0) になる。
 */

import type { Page } from '@playwright/test';

export interface ContrastTarget {
  /** 結果のキー。spec 側の期待値表と突き合わせる */
  name: string;
  /** テキスト（4.5:1）か非テキスト（3:1）か。判定には使わず記録用 */
  kind: 'text' | 'non-text';
  /** 測る要素 */
  selector: string;
  /** 測る色のプロパティ（color / background-color / border-top-color） */
  property: string;
  /** 背景として使う要素。省略時は「透明でない最初の祖先」 */
  against?: string;
  /** 背景を CSS 変数から取る（ホバーなど、実際には出ていない面と比べたいとき） */
  againstColor?: string;
}

/**
 * 対象を測って { name: 比 } を返す。
 *
 * 計算はページ内で行う。色の解決を `getComputedStyle` に任せたいので、
 * rgb 文字列を Node 側へ持ち出して再パースするより素直になる。
 */
export async function measureContrast(
  page: Page,
  targets: ContrastTarget[],
): Promise<Record<string, number>> {
  return page.evaluate((items) => {
    const parse = (color: string): [number, number, number, number] | null => {
      const m = /rgba?\(([^)]+)\)/.exec(color);
      if (!m) return null;
      const parts = m[1].split(',').map((s) => Number.parseFloat(s.trim()));
      if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
      return [parts[0], parts[1], parts[2], parts[3] ?? 1];
    };

    const luminance = ([r, g, b]: [number, number, number, number]): number => {
      const lin = [r, g, b].map((v) => {
        const c = v / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    };

    /** 透明でない最初の祖先の背景色を返す */
    const effectiveBackground = (el: Element): [number, number, number, number] => {
      let node: Element | null = el;
      while (node) {
        const parsed = parse(getComputedStyle(node).backgroundColor);
        if (parsed && parsed[3] > 0) return parsed;
        node = node.parentElement;
      }
      // 祖先まで全部透明なら body の色に落ちる。ここに来るのは想定外なので白で目立たせる
      return [255, 255, 255, 1];
    };

    const out: Record<string, number> = {};

    for (const item of items) {
      const el = document.querySelector(item.selector);
      if (!el) continue; // 見つからない項目は返さない（spec 側でキーの過不足を検査する）

      const fgRaw = getComputedStyle(el).getPropertyValue(item.property);
      const fg = parse(fgRaw);
      if (!fg) continue;

      let bg: [number, number, number, number] | null = null;
      if (item.againstColor) {
        const value = getComputedStyle(document.documentElement)
          .getPropertyValue(item.againstColor)
          .trim();
        // CSS 変数は hex で宣言されているので、一度要素に流して rgb へ解決させる
        const probe = document.createElement('div');
        probe.style.backgroundColor = value;
        document.body.appendChild(probe);
        bg = parse(getComputedStyle(probe).backgroundColor);
        probe.remove();
      } else if (item.against) {
        const bgEl = document.querySelector(item.against);
        if (bgEl) bg = effectiveBackground(bgEl);
      } else {
        // 自分自身が透明なら祖先へ遡る。border を測るときは自分の背景ではなく
        // 「その border が乗っている面」= 親の背景と比べたいので、親から始める。
        const start =
          item.property.startsWith('border') && el.parentElement ? el.parentElement : el;
        bg = effectiveBackground(start);
      }
      if (!bg) continue;

      const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
      out[item.name] = (l1 + 0.05) / (l2 + 0.05);
    }

    return out;
  }, targets);
}
