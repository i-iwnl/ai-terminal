# Architecture

Issue #251 における変更対象の構造。
設計判断の根拠は末尾の「設計判断履歴」を参照。

---

## 1. 対象トラック

単一トラック（renderer のみ）。

| コンポーネント | 変更内容 | 影響範囲 |
|---|---|---|
| `src/renderer/src/terminal/wheelScroll.ts` | 変更（介入可否の判定を純粋関数として追加） | `useTerminal.ts` |
| `src/renderer/src/terminal/useTerminal.ts` | 変更（ハンドラ冒頭でガードを呼ぶ / 誤ったコメントの訂正） | claude / gemini / シェルの全タブ |
| `test/unit/wheel-scroll.test.ts` | 追加 | - |
| `e2e/specs/` + `e2e/scenarios.yml` | 追加（シナリオ1本） | - |

---

## 2. Contract（src/shared/ipc.ts）変更

なし。

---

## 3. 技術的制約・前提条件

- ルート CLAUDE.md の鉄則2「**PTY の出力は加工しない**」の裏返しとして、**PTY への入力も勝手に置き換えない**のがこの修正の趣旨。マウス報告を要求しているアプリには、こちらで作った矢印ではなくマウス報告そのものを届ける。
- `term.modes.mouseTrackingMode` は xterm.js の公開 API。`Terminal.ts` の `get modes()` が `coreMouseService.activeProtocol` を写しているだけなので、プロトコルとの対応は 1:1（`X10 -> 'x10'` / `VT200 -> 'vt200'` / `DRAG -> 'drag'` / `ANY -> 'any'` / それ以外 `'none'`）。
- ホイールを含むプロトコルは `VT200` / `DRAG` / `ANY` の3つ（`CoreMouseService.ts` の `DEFAULT_PROTOCOLS`）。**`X10` は `events: DOWN` だけでホイールを含まない**ので、こちらが変換を続けないと「矢印1個」に落ちる。

---

## 4. 設計判断履歴

| 日付 | 判断 | 根拠 | 代替案 |
|---|---|---|---|
| 2026-08-13 | `term.modes.mouseTrackingMode` を見て `vt200` / `drag` / `any` では介入しない | #238 の PR 本文にある「マウス報告 ON ならカスタムハンドラには来ない」という禁止の前提が、xterm.js 6.0.0 の実装と合っていない（`CoreBrowserTerminal.ts` の `sendEvent()` は `case 'wheel':` の冒頭でカスタムハンドラを呼び、`false` ならマウス報告を送らずに return する） | `buffer.active.type` だけで判定し続ける（現状。マウス報告を握り潰すので不可）／ CLI 側の仕様に合わせて PgUp/PgDn を送る（鉄則に反する。CLI ごとの都合をアプリに埋める） |
| 2026-08-13 | `none` / `x10` では従来どおり矢印へ変換する | #238 が心配していた「wheel を要求しない x10 モードで既定の矢印1個に落ちて悪化する」は本物。ホイールを含むプロトコルだけを除外すれば両立する | `mouseTrackingMode !== 'none'` で一括除外（x10 で悪化する） |
