// タブ1枚の状態（TabState）と、その中から leaf を引く純粋関数。
//
// useTabs.ts は window.api（preload の型）に依存する他のコードを大量に抱えており、
// そのまま test/unit/ からインポートすると tsconfig.test.json（global.d.ts の
// window.api 拡張を含まない）で型エラーになる（tabTitle.ts のコメントと同じ理由）。
// TabState 型と、それだけを使う純粋関数はここへ切り出し、単体テストから
// 安全にインポートできるようにする。
//
// PTY のメタ（ptyId / kind / title / agentSessionId / cwd / exit）は
// TabState 自体ではなく、ペインの木の中の leaf（PaneLeaf）に持たせる
// （Issue #56 PR 3。設計の唯一の正は `.claude/workspace/issue-56/design-review.md`
// の Q4）。`TabState` に残るのは `id` / `layout` / `activePaneId` / `createdAt`
// だけ。PR 3 の時点では木は常に leaf 1枚（`splitPane` を呼ぶ経路がまだ無い）ので、
// `tabLeaf()` が返す値は実質そのタブの「PTY のメタ」そのものになる。

import { isAbnormalExit } from '@shared/pty-exit';
import { flattenPaneTree, resolveActiveLeaf, type PaneLeaf, type PaneNode } from './paneTree';

export interface TabState {
  /** タブを一意に識別する ID。生成時点では leaf の paneId と同じ値（PTY の spawn 結果の ptyId）を使う。 */
  id: string;
  /** ペインの木。PR 3 の時点では常に leaf 1枚。 */
  layout: PaneNode;
  /** 木の中で「今表示している」leaf の paneId。 */
  activePaneId: string;
  /**
   * タブ自身の名前（Issue #131）。**未設定なら木の先頭 leaf から導出する**
   * （`tabDisplayTitle`）。
   *
   * **なぜタブ側に持つのか。** それまでタブは名前という属性を持たず、タブバーは
   * `tabLeaf(tab)`（＝いま選んでいるペイン）の `title` を借りて表示していた。
   * 借り先が「今選んでいるペイン」なので、`Cmd+]` を押すたびに見出し・タブ上端の
   * プロバイダ色・ツールチップ・**Mission Control 上のウィンドウ名**が同時に
   * 書き換わっていた（`shortcuts.ts` 自身の見積もりで 40〜80回/日）。
   *
   * **借り先を「木の先頭 leaf」に固定するだけでは足りない。** `closePane` は
   * 「2つの子を持つ分割ノードを、残った側の子1つに置き換える」ので、先頭の
   * ペインを閉じると別の leaf が繰り上がる。ユーザーが「このタブの名前」として
   * 付けた文字列が、**最初に開いたペインの寿命に縛られて消える**。
   */
  title?: string;
  createdAt: number;
  /**
   * アクティブなペイン（`activePaneId`）を最大化して表示するか（Issue #56 PR 8。
   * design-review.md 提案 I）。**PTY のメタ（Q4 の対象）ではなく、木の構造
   * （`ratio` / leaf の並び）にも一切触れない一時的な表示状態**なので leaf では
   * なくここに持つ。`activePaneId` が変われば最大化の対象も追従する
   * （常に「今アクティブなペインを最大化するかどうか」という1つの真偽値）。
   * 分割・ペインを閉じるなど木の構造が変わる操作（`splitActivePane` /
   * `closeActivePane`）は、この値を false に戻す（useTabs.ts 参照）。
   */
  maximized: boolean;
}

/**
 * タブの中で今表示すべき leaf を返す。PTY のメタ（ptyId / kind / title /
 * agentSessionId / cwd / exit）はここから読む。
 *
 * 内部は `resolveActiveLeaf` そのもの（`activePaneId` が見つからない異常時は
 * 先頭の leaf にフォールバックする）。TabState と PaneNode を橋渡しするための
 * 薄いラッパー。
 */
export function tabLeaf(tab: TabState): PaneLeaf {
  return resolveActiveLeaf(tab.layout, tab.activePaneId);
}

/**
 * そのタブを**代表する** leaf（Issue #131）。木の先頭 = 左上のペイン。
 *
 * `tabLeaf`（いま選んでいるペイン）との違いが要点。**タブが何であるかを示す
 * ものは、ここから引く**（見出し・プロバイダ色・ツールチップ）。
 * `tabLeaf` から引くと `Cmd+]` のたびに書き換わる。
 *
 * **状態（終了・あなたの番）はここから引かない。** それぞれ別の意味が既に
 * 決まっている（「あなたの番」は木の全 leaf を見る = `tabYourTurn.ts`、
 * 終了は `issue-56/design-review.md:81` が「全 leaf が終了したときだけ」と
 * 確定させている）。**識別と状態は別の軸**で、ここに混ぜると第三の意味が増える。
 */
export function tabRepresentativeLeaf(tab: TabState): PaneLeaf {
  return flattenPaneTree(tab.layout)[0];
}

/**
 * タブバー・ウィンドウタイトルに出す見出し（Issue #131）。
 *
 * **この関数がタブの見出しの唯一の正。** タブバー・macOS のウィンドウタイトルが
 * 揃ってここを通る（借り先が箇所ごとにずれる状態を作らないため。それが
 * まさに #131 で直した不具合だった）。
 *
 * `tab.title` が空文字だけになる経路は `renameTab` 側が `undefined` に
 * 畳むが、外部から回り込む可能性を考えてここでも導出へ落とす（鉄則5）。
 */
export function tabDisplayTitle(tab: TabState): string {
  const own = tab.title?.trim();
  if (own !== undefined && own !== '') return own;
  return tabRepresentativeLeaf(tab).title;
}

/**
 * そのタブの**全ペインが終了しているか**（Issue #142。タブバーの終了表示用）。
 *
 * **確定仕様は `.claude/workspace/issue-56/design-review.md:81`**
 * 「タブの終了バッジは全 leaf が終了したときだけ出す」。
 *
 * それまで `TabBar.tsx` は `tabLeaf(tab).exit`（＝いま選んでいるペイン）を見ており、
 * `every` でも `some` でもない**第三の挙動**だった。木の中身が1つも変わらないのに、
 * `Cmd+]` でアクティブなペインを移しただけでタブの終了表示が付いたり消えたりする。
 *
 * **`some`（いずれかが終了したら出す）にしてはいけない。** タブバーの状態スロットは
 * 「終了 -> あなたの番 -> 無印」の三分岐で終了を優先するため（プロセスが終わっている
 * タブに「あなたの番」のドットを出しても、押した先で入力できない）、`some` にすると
 * 「claude があなたの番 + 隣の zsh を exit した」タブから**あなたの番のドットが消える**。
 * 待たせている状態が分かるという原則を、分割中だけ壊す。
 *
 * 対になる `tabHasYourTurn`（`tabYourTurn.ts`）は木の全 leaf を `some` で見る。
 * **同じ「木全体を見る」でも量化子が違う**のは、意味が違うから:
 * あなたの番は「1つでも待っていれば待っている」、終了は「全部終わって初めて終わり」。
 *
 * `flattenPaneTree` は必ず1枚以上返すので `every` の vacuous truth は起きないが、
 * 外部から回り込む可能性を考えて空配列を false に畳んでおく（鉄則5）。
 */
export function tabAllPanesExited(layout: PaneNode): boolean {
  const leaves = flattenPaneTree(layout);
  if (leaves.length === 0) return false;
  return leaves.every((leaf) => leaf.exit !== undefined);
}

/**
 * タブの終了状態（Issue #166。タブバーの終了表示を severity で分けるため）。
 *
 * それまでタブは `tabAllPanesExited()` の boolean しか見ておらず、
 * **正常終了（`exit` と打つ）でも異常終了でも同じ赤**だった。
 * 同じ1つのイベントに対して通知バナーは青/赤に分かれ、ペイン本文は
 * コードを出し分けているのに、**タブだけが severity を捨てていた**。
 * 初見ユーザーがこのアプリで最初に見る赤はほぼ確実に `exit` = 正常終了なので、
 * そこで「赤 = 気にしなくていい」を学習すると本物のエラーが割り引かれて届く。
 *
 * **「異常か」の判定はここに書かない。** 唯一の正は `@shared/pty-exit` の
 * `isAbnormalExit()`（Issue #133 で Main / Renderer 共通に切り出した）。
 * `lib/notices.ts` の `severityForExit()` ではなく、そちらの素の判定を呼ぶ:
 * `severityForExit()` が持つ `'info' | 'error'` は**通知バナーの表現**であって
 * 事実ではない（`pty-exit.ts` の「1つの事実、2つの表現」）。
 * タブがバナーの語彙を借りると、バナー側の表現を増やしたときにタブの色が動く。
 *
 * **量化子が2つ出てくるので、対象の違いに注意すること。**
 *
 * - 「終わったか」は `every`（上の `tabAllPanesExited`）。全ペインが終わって初めて終わり
 * - 「異常があったか」は `some`。1枚でも異常なら、そのタブは「何かが失敗した」側に寄せる
 *
 * **上のコメントが禁じている `some` とは対象が違う。** あちらは「終了したか」を
 * `some` で決めることの禁止（「あなたの番」のドットが消えるため）で、こちらは
 * `every` の門をくぐった内側で severity だけを決めている。門の位置は動かない。
 *
 * `some` を選ぶ理由は誤りのコストが非対称だから: 偽陽性（正常なのに異常と出る）は
 * 一瞥で済むが、偽陰性（片方が異常終了しているのに正常と出る）は**気づかれない**。
 * Main 側の `shouldBounceOnExit`（`pty-exit.ts`）はペイン単位で発火するので、
 * `every` にすると「Dock は弾んだのにタブは正常だと言う」という層の食い違いが出る。
 */
export type TabExitState = 'running' | 'exited' | 'exited-abnormal';

export function tabExitState(layout: PaneNode): TabExitState {
  if (!tabAllPanesExited(layout)) return 'running';
  const abnormal = flattenPaneTree(layout).some(
    (leaf) => leaf.exit !== undefined && isAbnormalExit(leaf.exit),
  );
  return abnormal ? 'exited-abnormal' : 'exited';
}

/**
 * ptyId からタブを探す（PTY の終了イベント・cwd 追従の突き合わせに使う）。
 *
 * **`tabLeaf(t)`（アクティブな leaf 1枚だけ）ではなく、木の全 leaf を見る。**
 * PR 3 の時点では木が常に leaf 1枚だったため両者は等価だったが、PR 4 で分割が
 * 有効になると非アクティブな leaf の PTY も終了しうる（例: 2枚に分割したタブで、
 * フォーカスが無い側のシェルで `exit` と打つ）。アクティブな leaf だけを見ていると、
 * その終了イベントの相手先タブが見つからず `markExited` が静かに no-op になる。
 */
export function findTabByPtyId(tabs: TabState[], ptyId: string): TabState | undefined {
  return tabs.find((t) => flattenPaneTree(t.layout).some((leaf) => leaf.ptyId === ptyId));
}

/**
 * agentSessionId からタブを探す（タスク一覧・通知クリックからのタブ前面化の突き合わせに使う）。
 *
 * 上の `findTabByPtyId` と同じ理由で、木の全 leaf を見る（アクティブでない
 * ペインで claude / gemini が動いていても、そのタブ自体は前面化できる必要がある）。
 * **ただし、そのタブの中のどのペインをアクティブにするかまでは踏み込まない**
 * （design-review.md の U4 はタスク一覧・通知をペイン粒度にする話で、これは
 * PR 8 の担当。ここで直すのはタブが見つからず前面化ごと失敗する分だけ）。
 */
export function findTabByAgentSessionId(
  tabs: TabState[],
  agentSessionId: string,
): TabState | undefined {
  return tabs.find((t) => flattenPaneTree(t.layout).some((leaf) => leaf.agentSessionId === agentSessionId));
}

/** タブとペインの両方を指す位置（U4: タスク一覧・通知クリックの突き合わせ結果）。 */
export interface PaneLocation {
  tabId: string;
  paneId: string;
}

/**
 * agentSessionId から、そのセッションが動いているタブ**とペイン**の両方を特定する
 * （design-review.md U4）。
 *
 * `findTabByAgentSessionId` はタブしか返さないため、対象ペインが今のタブに
 * 既に見えている（= `setActiveTabId` が no-op になる）場合に「画面が1pxも
 * 動かない」壊れ方をする。呼び出し側（App.tsx）はこの関数が返す `paneId` へ
 * `setActivePaneInTab` することで、タブ切り替えとは独立にペインへフォーカスを移す。
 */
export function findPaneByAgentSessionId(
  tabs: TabState[],
  agentSessionId: string,
): PaneLocation | undefined {
  for (const t of tabs) {
    const leaf = flattenPaneTree(t.layout).find((l) => l.agentSessionId === agentSessionId);
    if (leaf) return { tabId: t.id, paneId: leaf.paneId };
  }
  return undefined;
}

/**
 * タブの並び順（tabs 配列の順）で次のタブの id を返す（`Cmd+Shift+]`。Issue #20 J）。
 * 末尾の次は先頭へ折り返す。`paneTree.ts` の `nextPane` と同じ考え方をタブに適用したもの。
 * activeTabId が見つからない・タブが1枚も無い場合はそのまま返す（no-op）。
 */
export function nextTabId(tabs: readonly Pick<TabState, 'id'>[], activeTabId: string): string {
  const index = tabs.findIndex((t) => t.id === activeTabId);
  if (index === -1 || tabs.length === 0) return activeTabId;
  return tabs[(index + 1) % tabs.length].id;
}

/** タブの並び順で前のタブの id を返す（`Cmd+Shift+[`）。先頭の前は末尾へ折り返す。 */
export function previousTabId(tabs: readonly Pick<TabState, 'id'>[], activeTabId: string): string {
  const index = tabs.findIndex((t) => t.id === activeTabId);
  if (index === -1 || tabs.length === 0) return activeTabId;
  return tabs[(index - 1 + tabs.length) % tabs.length].id;
}
