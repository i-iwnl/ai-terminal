//
// scenarios.mjs - e2e/scenarios.yml の最小パーサ。
//
// **台帳のパースをここ1箇所に閉じ込める**（`scripts/lint-e2e.mjs` と
// `scripts/verify-screenshots.mjs` の両方が使う）。CLAUDE.md の
// 「外部フォーマットのパースは1ファイルに閉じ込める」と同じ理由で、
// 台帳の書式を変えたときに直す場所を1箇所にする。
//
// YAML パースについて:
//   scenarios.yml は「トップレベルの scenarios: 配下に、id/title/spec/screenshot/
//   readme/note のスカラーキーだけを持つフラットなリスト」という単純な構造しか
//   使わない。汎用 YAML パーサ（js-yaml 等）を新規に依存追加するほどではないため、
//   外部パッケージには頼らず、行単位の正規表現で必要なフィールドだけを抽出する。
//   note: >- の折り畳みスカラーなど、検査に使わないフィールドの中身は読み捨てる
//   （インデントの深さで「継続行」と判定して無視するだけで、値は解釈しない）。
//

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   spec: string,
 *   screenshot: string | undefined,
 *   readme: boolean,
 * }} ScenarioEntry
 */

/**
 * scenarios.yml の最小パーサ。
 *
 * 各シナリオは `  - id: S01` で始まり、以降 `    key: value`（4スペースインデント）
 * のスカラー行が続く前提。6スペース以上インデントされた行（note の折り畳み継続行
 * など）は「前のキーの続き」とみなして無視する。
 *
 * @param {string} text
 * @returns {ScenarioEntry[]}
 */
export function parseScenarios(text) {
  const lines = text.split('\n');
  /** @type {Record<string, string>[]} */
  const entries = [];
  /** @type {Record<string, string> | null} */
  let current = null;

  for (const line of lines) {
    const entryMatch = line.match(/^ {2}-\s+id:\s*(\S+)\s*$/);
    if (entryMatch) {
      current = { id: entryMatch[1] };
      entries.push(current);
      continue;
    }
    if (!current) continue;

    // トップレベルキー（id と同じ深さ = 4スペースインデント）のみ拾う。
    // それより深いインデントは note の折り畳み継続行などなので無視する。
    const kvMatch = line.match(/^ {4}([a-zA-Z_]+):\s*(.*)$/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;
      if (key === 'id') continue;
      current[key] = rawValue.trim();
    }
  }

  return entries.map((e) => ({
    id: e.id,
    title: e.title ?? '',
    spec: e.spec ?? '',
    screenshot: e.screenshot || undefined,
    readme: e.readme === 'true',
  }));
}
