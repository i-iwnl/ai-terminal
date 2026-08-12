// src/shared/context-menu.ts の単体テスト（Issue #135）。
//
// **メニューが実際に画面へ出たかは Playwright から観測できない**
// （`Menu.popup()` はネイティブで、DOM に出ない）。だから項目・並び・語・
// 有効/無効の正をこの純粋関数に置いて、ここで固定する。
// `closeTabCopy.ts` / `pty-exit.ts` と同じ作法。
//
// E2E（S91）は「右クリック -> Main が popup を呼ぶ -> その項目を click すると
// 実際に分割される」という**配線**を見る。項目表そのものはここが正。

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  terminalContextMenuItems,
  taskContextMenuItems,
  type TerminalContextMenuItem,
} from '../../src/shared/context-menu';

/** セパレータを除いたラベルの並び（読みやすさのため）。 */
function labels(items: TerminalContextMenuItem[]): string[] {
  return items.filter((i) => i.kind !== 'separator').map((i) => i.label);
}

describe('terminalContextMenuItems', () => {
  const single = { paneCount: 1, hasSelection: false };
  const split = { paneCount: 2, hasSelection: false };

  it('クリップボードが先頭にある（ターミナルで右クリックする理由の第1位）', () => {
    // **ここが無いと「ネイティブの右クリックのつもりで開いて空振り」になる。**
    // Terminal.app のターミナル面の文脈メニューにも Copy / Paste が入っている。
    const items = terminalContextMenuItems(single);
    expect(items[0]).toMatchObject({ kind: 'role', label: 'コピー', role: 'copy' });
    expect(items[1]).toMatchObject({ kind: 'role', label: 'ペースト', role: 'paste' });
  });

  it('選択が無ければ「コピー」を無効にする（押して何も起きないより情報量が多い）', () => {
    expect(terminalContextMenuItems({ ...single, hasSelection: false })[0]).toMatchObject({
      enabled: false,
    });
    expect(terminalContextMenuItems({ ...single, hasSelection: true })[0]).toMatchObject({
      enabled: true,
    });
    // ペーストは選択と無関係（クリップボード側の話）。
    expect(terminalContextMenuItems({ ...single, hasSelection: false })[1]).toMatchObject({
      enabled: true,
    });
  });

  it('**破壊的な項目は最後で、セパレータの向こうにある**（カーソルの真下に置かない）', () => {
    for (const state of [single, split]) {
      const items = terminalContextMenuItems(state);
      const last = items[items.length - 1];
      expect(last.kind).toBe('action');
      expect(last.kind === 'action' && last.action).toEqual({ type: 'close-pane' });
      expect(items[items.length - 2].kind).toBe('separator');
    }
  });

  it('**1ペインのタブでは「ペイン」という語を1つも出さない**', () => {
    // ペインヘッダとアクセント線は分割中しか出ないので、1枚のときは
    // 「ペイン」に指示対象が画面上に無い（初見ユーザーに対する語の失敗）。
    const items = labels(terminalContextMenuItems(single));
    expect(items.some((label) => label.includes('ペイン'))).toBe(false);
    // 1枚のとき `close-pane` は結果としてタブを閉じるので、語もそう出す。
    expect(items).toContain('タブを閉じる');
  });

  it('1ペインでは「最大化」を出さない（押しても画面が1pxも動かない）', () => {
    // 「何も起きないまま終わらせない」という規約に反する項目は、そもそも出さない。
    expect(labels(terminalContextMenuItems(single))).not.toContain('ペインを最大化');
    expect(labels(terminalContextMenuItems(split))).toContain('ペインを最大化');
  });

  it('分割中は「ペイン」の群が出て、閉じるの語もペインになる', () => {
    const items = labels(terminalContextMenuItems(split));
    expect(items).toContain('ペインを最大化');
    expect(items).toContain('ペイン名を変更...');
    expect(items).toContain('ペインを閉じる');
    expect(items).not.toContain('タブを閉じる');
  });

  it('並びが規約どおり（クリップボード -> 作る -> 見る -> 分割中だけ -> 壊す）', () => {
    expect(labels(terminalContextMenuItems(split))).toEqual([
      'コピー',
      'ペースト',
      '右に分割',
      '下に分割',
      '画面を消去',
      'ターミナル内を検索',
      'ペインを最大化',
      'ペイン名を変更...',
      'ペインを閉じる',
    ]);
  });

  it('**新しい能力を1つも作っていない**（action はすべて既存の AppAction）', () => {
    // Issue #135 の完了条件そのもの。ここが崩れると、右クリックだけが
    // 通る裏口ができる。
    const actions = terminalContextMenuItems(split)
      .filter((i): i is Extract<TerminalContextMenuItem, { kind: 'action' }> => i.kind === 'action')
      .map((i) => i.action.type);
    expect(actions).toEqual([
      'split-pane',
      'split-pane',
      'clear-terminal',
      'toggle-search',
      'toggle-maximize-pane',
      'rename-active-pane',
      'close-pane',
    ]);
  });

  it('「ペイン名を変更...」だけアクセラレータを持たない（アプリメニューと同じ判断）', () => {
    const rename = terminalContextMenuItems(split).find(
      (i) => i.kind === 'action' && i.label === 'ペイン名を変更...',
    );
    expect(rename).toBeDefined();
    expect(rename && rename.kind === 'action' && rename.accelerator).toBeUndefined();
  });
});

// **語をアプリメニューと一字一句そろえる。**
//
// 右クリックで覚えた語がメニューバーで同じなら、そこでショートカットキーを
// 見つけられる。語がずれると発見の連鎖が切れる（`menu.ts` 冒頭が
// 「キーの発見経路の正はメニューバー」と宣言している）。
//
// **これは機械で守れる。** `menu.ts` をテキストとして読んで突き合わせる
// （`menu-accelerators.test.ts` / `readme-commands.test.ts` と同じ型）。
describe('コンテキストメニューの語がアプリメニューと一致する', () => {
  const MENU = readFileSync(resolve(import.meta.dirname, '../../src/main/menu.ts'), 'utf8');

  it('パーサ自体が健全（menu.ts を読めている）', () => {
    expect(MENU).toContain("actionItem(win, '右に分割'");
  });

  it('action 項目のラベルが menu.ts に同じ文字列で存在する', () => {
    // 「タブを閉じる」は `closeTabLabel()` が動的に組むので除く（menu.ts に
    // リテラルとしては現れない）。それ以外は完全一致で存在するはず。
    const dynamicInMenuTs = new Set(['タブを閉じる']);
    const missing = terminalContextMenuItems({ paneCount: 2, hasSelection: true })
      .filter((i): i is Extract<TerminalContextMenuItem, { kind: 'action' }> => i.kind === 'action')
      .map((i) => i.label)
      .concat(
        terminalContextMenuItems({ paneCount: 1, hasSelection: true })
          .filter(
            (i): i is Extract<TerminalContextMenuItem, { kind: 'action' }> => i.kind === 'action',
          )
          .map((i) => i.label),
      )
      .filter((label) => !dynamicInMenuTs.has(label))
      .filter((label) => !MENU.includes(`'${label}'`));

    expect(
      Array.from(new Set(missing)),
      'コンテキストメニューにあって src/main/menu.ts に無い語がある。' +
        '同じ操作が2つの名前を持つと、右クリックで覚えた語からキーを見つけられない',
    ).toEqual([]);
  });

  it('アクセラレータも menu.ts の同じ項目と一致する', () => {
    // 語が同じでキーが違う、という食い違いのほうが誤解を生む。
    const pairs: Array<[string, string]> = [
      ['右に分割', 'Cmd+D'],
      ['下に分割', 'Cmd+Shift+D'],
      ['画面を消去', 'Cmd+K'],
      ['ターミナル内を検索', 'Cmd+F'],
      ['ペインを最大化', 'Cmd+Shift+Enter'],
      ['ペインを閉じる', 'Cmd+W'],
    ];
    const items = terminalContextMenuItems({ paneCount: 2, hasSelection: true });
    for (const [label, accelerator] of pairs) {
      const item = items.find((i) => i.kind === 'action' && i.label === label);
      expect(item, `${label} が項目表に無い`).toBeDefined();
      expect(item && item.kind === 'action' && item.accelerator, label).toBe(accelerator);
      // menu.ts 側にも同じ組があること。
      expect(MENU, `menu.ts の ${label} のキーが違う`).toContain(`'${label}', '${accelerator}'`);
    }
  });
});

// タスク一覧の行の右クリックメニュー（Issue #244 周6-a、実機不具合の差し戻し）。
describe('taskContextMenuItems', () => {
  it('タブを開いていない行（hasOpenTab: false）では「この AI を終了」の1項目だけを返す', () => {
    // **「タブに戻す」は作らない。** 行そのものをクリックすれば戻れるので、
    // 同じ操作の入口をメニューにもう1つ作らない設計判断
    // （design-review/proposal-v2-after-review.md §2-E'）。
    const items = taskContextMenuItems({ hasOpenTab: false });
    expect(items).toEqual([
      { kind: 'action', label: 'この AI を終了', action: { type: 'kill-agent-session' } },
    ]);
  });

  it('タブが開いている行（hasOpenTab: true）では「このペインを閉じて AI を終了」になる', () => {
    // 実機不具合の差し戻し: タブが開いている行で「この AI を終了」を選んでも、
    // 直す前はタブ（ペイン）が閉じずに残っていた。行き先が2つに分かれる操作は
    // 文言で言い切る（design-rules §6）。
    const items = taskContextMenuItems({ hasOpenTab: true });
    expect(items).toEqual([
      {
        kind: 'action',
        label: 'このペインを閉じて AI を終了',
        action: { type: 'kill-agent-session' },
      },
    ]);
  });

  it('**新しい能力を1つも作っていない**（action は hasOpenTab によらず既存の AppAction のまま）', () => {
    const actions = [
      ...taskContextMenuItems({ hasOpenTab: false }),
      ...taskContextMenuItems({ hasOpenTab: true }),
    ].map((i) => i.action.type);
    expect(actions).toEqual(['kill-agent-session', 'kill-agent-session']);
  });
});
