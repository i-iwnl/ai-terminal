// role="tab" と role="tabpanel" を結ぶ DOM の id の唯一の正。
//
// ARIA 仕様は tab に aria-controls で対応する tabpanel を、tabpanel に
// aria-labelledby で対応する tab を要求する。この対応は「同じ文字列を2箇所で
// 組み立てる」形にすると必ずずれる（片方だけ書き換えても型が守ってくれない）ので、
// 生成規則をここに閉じ込める。
//
// 参照する側は TabBar.tsx（tab 側）と App.tsx（tabpanel 側）の2つ。

/** タブバーの role="tab" ボタンの id。 */
export function tabButtonId(tabId: string): string {
  return `tab-bar__tab-${tabId}`;
}

/** そのタブに対応する role="tabpanel"（TerminalPane の根）の id。 */
export function tabPanelId(tabId: string): string {
  return `terminal-pane-${tabId}`;
}
