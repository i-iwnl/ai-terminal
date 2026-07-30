// タブのプロバイダラベル（src/renderer/src/tabs/tabProvider.ts の providerLabel）。
//
// タブタイトルが basename(cwd) になった結果、同じリポジトリで claude と gemini を
// 1本ずつ開くとタイトルが同じ文字列になる（差し戻しの原因）。色（タブの色相）だけに
// 頼らず、ツールチップとアクセシブルネームに使うこのラベルが kind ごとに正しく
// 分かれることを固定する。

import { describe, expect, it } from 'vitest';
import { providerLabel } from '../../src/renderer/src/tabs/tabProvider';

describe('providerLabel', () => {
  it('claude / gemini / shell でそれぞれ異なるラベルを返す', () => {
    const labels = new Set([providerLabel('claude'), providerLabel('gemini'), providerLabel('shell')]);
    expect(labels.size).toBe(3);
  });

  it('claude は "Claude" を返す', () => {
    expect(providerLabel('claude')).toBe('Claude');
  });

  it('gemini は "Gemini" を返す', () => {
    expect(providerLabel('gemini')).toBe('Gemini');
  });

  it('shell は "シェル" を返す', () => {
    expect(providerLabel('shell')).toBe('シェル');
  });
});
