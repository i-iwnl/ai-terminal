import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * PR 19（Issue #20 H）の密度調整（`.tab-bar__tab` の `gap: 6px -> var(--sp-2)`、
 * `padding: 0 10px -> 0 var(--sp-3)`）が、タブの当たり判定に幾何変化を持ち込んだ。
 *
 * 選択用の `<button class="tab-bar__tab-button">` は、閉じるボタン
 * （`.tab-bar__close`。非アクティブ時は見た目も無く `pointer-events: none`）を
 * 依然として同じ flex の行の1アイテムとして扱っていたため、閉じるボタンの
 * 幅 + 前後の gap ぶんが「見えない・押せない・かつ選択もできない」死角として
 * 残っていた。密度調整前は padding が広く、その死角がタブの端に寄っていて
 * 中央のクリックとは重ならなかったため、この PR の変更まで気づかれなかった。
 *
 * `S44-target-size.spec.ts` は「小さいボタン自身が 24x24 以上あるか」を見ており、
 * **「タブという行全体の、押せるはずの領域が本当に押せるか」は別の観点**で
 * どの spec も見ていなかった（S47 は resume 経由の間接的な症状でしか
 * この壊れを検出できず、原因の特定に追跡が要った）。
 *
 * ここでは `document.elementFromPoint(中央)` で実際にヒットする要素が、
 * 選択用ボタン（`.tab-bar__tab-button`）かその子孫であることを直接確認する。
 * 座標は `boundingBox()` から計算し、決め打ちしない。
 *
 * **Issue #121 周3 で「中央 1点」から「帯」へ拡張した。**
 *
 * 中央 1点だけを見る形は、**タブの端の死角をまったく検出しなかった**。
 * Issue #120 周3 の実測（2枚目のタブ、90x35）が残したヒットテスト地図:
 *
 * ```
 * 350-370  .tab-bar__tab        死角 21px（padding-left 12 + state-slot 6 + gap 3）
 * 371-394  .tab-bar__close      当たり判定 24px
 * 395-397  .tab-bar__tab-button 3px
 * 398-426  .tab-bar__title      29px
 * 427-439  .tab-bar__tab        死角 13px（padding-right 12 + border-right 1）
 * ```
 *
 * **90px のうち 34px（38%）が、押しても何も起きなかった。** Safari /
 * Terminal.app / VS Code はいずれもタブのどこを押しても選択される。
 *
 * いまは**幅いっぱいを 1px 刻みで走査する**。非アクティブ・非 hover の
 * タブでは閉じるボタンが `pointer-events: none` なので、
 * **右端の border 1px を除く全列が選択用ボタンに解決するはず**。
 */
test('S69 タブの中央をクリックすると、そのタブが選択される', async () => {
  const { window } = launched;

  // 1枚目のまま検証すると「起動直後から選択中」で意味が無いので、2枚目を足し、
  // 1枚目（非アクティブ・閉じるボタンが見えない状態）を対象にする。
  // Meta+t ではなく「+」ボタン経由で開く（キーボードショートカットは別 PR の
  // 担当ファイルに実装があり、この spec の関心事ではない）。
  //
  // **3枚開いて真ん中を測る**（Issue #121 周3）。1枚目を測ると、左端の 4px が
  // `.sidebar__resize-handle`（`right: -4px; width: 8px` の意図的なつかみ代。
  // `cursor: col-resize` で feedback も出る）に当たり、タブ自身の死角と混ざる。
  // ここで測りたいのはタブの当たり判定なので、隣接要素の影響が無い位置を選ぶ。
  const tabs = window.locator('.tab-bar__tab');
  for (let i = 0; i < 2; i += 1) {
    await window.locator('.tab-bar__new').click();
    await window.locator('.tab-bar__new-menu-item', { hasText: '新しいシェル' }).click();
    await expect(tabs).toHaveCount(i + 2, { timeout: 15_000 });
  }

  // 直前のクリックでカーソルが tabs[0] の上に残っていると :hover が誤って
  // 効き、閉じるボタンが「見えている」状態のまま測ってしまう。タブ行から
  // 離れた場所へ動かしてから測る。
  await window.mouse.move(400, 400);

  const target = tabs.nth(1);
  await expect(target).not.toHaveClass(/is-active/);

  const box = await target.boundingBox();
  if (!box) throw new Error('タブの boundingBox が取得できなかった');
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  // 中央が実際にヒットする要素を確認する（クリックする前に。クリック後は
  // 選択状態が変わり、閉じるボタンの opacity/pointer-events も変わるため、
  // 「元の状態でどこに当たるか」を先に固定してから操作する）。
  const hitsSelectButton = await window.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el !== null && el.closest('.tab-bar__tab-button') !== null;
    },
    [centerX, centerY] as const,
  );
  expect(hitsSelectButton, 'タブ中央のクリックは選択用ボタンに当たるべき').toBe(true);

  // --- 帯で見る（Issue #121 周3）-------------------------------------------
  // 幅いっぱいを 1px 刻みで走査し、どの列が何に当たるかの地図を作る。
  // 非アクティブ・非 hover なので閉じるボタンは pointer-events: none。
  // **右端の border-right 1px を除く全列が、選択用ボタンに解決するはず。**
  const hitMap = await window.evaluate(
    ([left, width, y]) => {
      const rows: { offset: number; hit: string }[] = [];
      // 最後の 1px は .tab-bar__tab の border-right なので走査対象から外す。
      for (let offset = 0; offset <= width - 2; offset += 1) {
        const el = document.elementFromPoint(left + offset + 0.5, y);
        let hit = 'なし';
        if (el) {
          if (el.closest('.tab-bar__tab-button')) hit = 'select';
          else if (el.closest('.tab-bar__close')) hit = 'close';
          else if (el.closest('.tab-bar__tab')) hit = '死角(.tab-bar__tab)';
          else hit = el.className || el.tagName;
        }
        rows.push({ offset, hit });
      }
      return rows;
    },
    [box.x, Math.round(box.width), centerY] as const,
  );

  // 連続する同じ結果を畳んで、落ちたときに読める地図にする。
  const bands: string[] = [];
  for (const row of hitMap) {
    const last = bands[bands.length - 1];
    const label = `${row.hit}`;
    if (last?.endsWith(label)) {
      bands[bands.length - 1] = last.replace(/^\d+-\d+/, (m) => `${m.split('-')[0]}-${row.offset}`);
    } else {
      bands.push(`${row.offset}-${row.offset} ${label}`);
    }
  }

  const dead = hitMap.filter((r) => r.hit !== 'select');
  expect(
    dead.length,
    `タブ幅 ${Math.round(box.width)}px のうち ${dead.length}px が選択用ボタンに当たらない。\n` +
      `非アクティブ・非 hover のタブは、border-right の 1px を除いて全面が選択領域であるべき。\n` +
      `ヒットテスト地図（タブ左端からの offset）:\n  ${bands.join('\n  ')}`,
  ).toBe(0);

  // --- 閉じるボタンが出ている状態（アクティブなタブ）でも死角が無いこと -------
  //
  // **選択できる面が広がったぶん、閉じるボタンの張り出しの意味が変わった。**
  // Issue #120 周3 で閉じるボタンの箱を左へ 10px 広げたとき、その 10px は
  // 「いま死角である」ことを前提に無害と判断していた。死角が消えたいまは
  // **選択領域の上に載っている**ので、判断をやり直す必要がある
  // （design-rules.md「入れ子の破壊的ターゲットは、隣のターゲットへ向かう
  // 向きにだけは見た目を越えない」）。
  //
  // 実測（アクティブなタブ、90px。左端からの offset）:
  //
  //   0-15 select | 16-39 close | 40-88 select
  //   状態ドットの見た目 12-18 / 閉じるボタンの箱 16-40（24px = 2.5.8 の下限）
  //
  // **結論: この張り出しは残す。** 16-26 は「x」の描画（30-36）のすぐ左で、
  // **閉じるボタンを狙って外した位置**にあたる。押した結果（閉じる）は狙いと
  // 一致するので、規則が上下の張り出しを許しているのと同じ理由で許される。
  // タイトル側（右）へは 1px も越えていないこと（S44 が別に固定している）が
  // 効いていて、破壊的な誤爆は「選択を狙って閉じてしまう」形にはならない。
  const activeTab = tabs.filter({ hasNot: window.locator('.tab-bar__title-input') }).last();
  await expect(activeTab).toHaveClass(/is-active/);
  const activeBox = await activeTab.boundingBox();
  if (!activeBox) throw new Error('アクティブなタブの boundingBox が取得できなかった');

  const activeMap = await window.evaluate(
    ([left, width, y]) => {
      const rows: { offset: number; hit: string }[] = [];
      for (let offset = 0; offset <= width - 2; offset += 1) {
        const el = document.elementFromPoint(left + offset + 0.5, y);
        let hit = 'なし';
        if (el) {
          if (el.closest('.tab-bar__close')) hit = 'close';
          else if (el.closest('.tab-bar__tab-button')) hit = 'select';
          else if (el.closest('.tab-bar__tab')) hit = '死角(.tab-bar__tab)';
          else hit = el.className || el.tagName;
        }
        rows.push({ offset, hit });
      }
      return rows;
    },
    [activeBox.x, Math.round(activeBox.width), activeBox.y + activeBox.height / 2] as const,
  );

  const activeDead = activeMap.filter((r) => r.hit !== 'select' && r.hit !== 'close');
  expect(
    activeDead.map((r) => r.offset),
    '閉じるボタンが出ている状態でも、タブの全面が「選択」か「閉じる」のどちらかであるべき',
  ).toEqual([]);

  // 閉じるボタンの帯は連続した1本で、2.5.8 の下限（24px）を満たすこと。
  const closeOffsets = activeMap.filter((r) => r.hit === 'close').map((r) => r.offset);
  expect(closeOffsets.length, '閉じるボタンの当たり判定は 24px 以上あるべき').toBeGreaterThanOrEqual(24);
  expect(
    closeOffsets[closeOffsets.length - 1] - closeOffsets[0] + 1,
    '閉じるボタンの当たり判定は連続した1本の帯であるべき（選択領域に分断されない）',
  ).toBe(closeOffsets.length);

  // 実際にクリックして選択が切り替わることも確認する（当たり判定の確認だけでなく、
  // クリックの結果として意図した動作＝タブ選択が起きることまで見る）。
  // **端を押す。** 中央は拡張前から通っていたので、帯の意味が出るのは端。
  await window.mouse.click(box.x + 2, centerY);
  await expect(target).toHaveClass(/is-active/);
});
