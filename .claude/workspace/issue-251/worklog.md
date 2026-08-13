# Worklog

時系列の作業ログ。**設計判断の根拠**と**学んだ教訓**を中心に記録する。
コード差分は git log を参照、現状の構造は `architecture.md` を参照。

---

## 2026-08-13 - 原因の特定とワークスペース作成

### 実施内容

- 利用者から「ai-terminal 内でスクロールすると page-up/down が反応してしまう」と、上流の
  [anthropics/claude-code#65833](https://github.com/anthropics/claude-code/issues/65833) の報告を受けた
- **Claude Code 側が何をしているかを実測した**（`claude 2.1.229` のバイナリと pty プローブ）
  - 起動時に `ESC[?1000h ESC[?1002h ESC[?1003h ESC[?1006h` を必ず出す（XTVERSION に応答しなくても出る）
  - `tmux new-session -A -s <名前> -- claude` 経由でも、これらは外側の端末まで素通しされる（tmux 3.7b / `mouse` 既定 off で確認）
  - キーバインドは `wheelup -> scroll:lineUp` / `wheeldown -> scroll:lineDown` / `pageup -> scroll:pageUp`。
    **ホイールはマウス報告として受け取る前提**になっている
  - 同方向の矢印を **100ms 以内に 8 本以上**受け取ると `arrow-burst` と判定し、
    `Scroll wheel is sending arrow keys · use PgUp/PgDn to scroll` を出す
- **アプリ側が原因**であることを xterm.js 6.0.0 のソース（`lib/xterm.js.map` の `sourcesContent`）で確認した
- Issue #251 を起票し、ワークスペースを作成した

### 設計判断

- **#238 の `⛔ 次に触る人へ` を外す**: 禁止の根拠「マウス報告 ON ならカスタムハンドラには来ない」が
  実装と合っていない。`CoreBrowserTerminal.ts` の wheel の経路は2本ある。

  | 経路 | 条件 | カスタムハンドラ |
  |---|---|---|
  | 要素の `wheel` リスナー | `requestedEvents.wheel` が無い（マウス報告 OFF / x10） | 呼ぶ |
  | `eventListeners.wheel -> sendEvent()` | マウス報告 ON でホイールを含むプロトコル | **`case 'wheel':` の冒頭で呼び、`false` ならマウス報告を送らず return** |

  loop.md の「禁止の理由が実測で成り立たないなら実測してから判断する」に従い、実測してから外した。

- **除外するのはホイールを含むプロトコルだけ**（`vt200` / `drag` / `any`）: #238 が心配していた
  「x10 で既定の矢印1個に落ちて悪化する」は本物なので、`none` / `x10` では変換を続ける。

### 教訓

- **「この経路には来ない」は、実装を読んで確かめるまで信じない。** #238 は PR 本文・コードコメントの
  両方に同じ誤った前提を書き、次に触る人（＝今回）に対して**正しい修正を明示的に禁止していた**。
  根拠が1箇所（上流の別の関数）の読み違いだったため、2箇所に書いても間違いは減らなかった。
- **CLI の挙動は推測せず、pty で実際に起動して出力を測るのが速い。** 「マウス報告を出しているか」
  「tmux を通るか」は、どちらも数分のプローブで白黒がついた。

### 次に再開するとき最初に読むべきこと

- `src/renderer/src/terminal/wheelScroll.ts` に判定の純粋関数を足すところから。
  `useTerminal.ts:272` 付近の `⛔` コメントは**内容が誤り**なので、実装と一緒に訂正する
- 完了条件は `overview.md` の「2. 完成条件」。E2E は「代替画面 + マウス報告 ON のシェルタブに
  ホイールを送り、PTY へ届いた列が SGR マウス報告か矢印か」を見る形を想定している

---

## 2026-08-13 - 周1: ガードの実装・関門・実機での対照実験

### 実施内容

- `wheelScroll.ts` に `shouldConvertWheelToArrows(bufferType, mouseTrackingMode)` を追加し、
  `useTerminal.ts` のカスタムハンドラ冒頭で呼ぶようにした
- `useTerminal.ts` と `.claude/skills/terminal/reference/xterm-setup.md` の**誤った `⛔` を訂正**した
- 単体テスト（`test/unit/wheel-scroll.test.ts`）と E2E（`S119`）を追加した
- README のホイールの説明を実装に合わせた（「常に矢印に変換する」-> 「マウス操作を受け付ける
  CLI にはそのまま渡す」）

### 関門が実際に赤くなることの確認

**単体テスト**（`npx vitest run test/unit/wheel-scroll.test.ts`。無傷は 40 passed）

| 壊し方 | 結果 |
|---|---|
| ホイールを含むモードの一覧を空にする | 4 failed |
| `x10` も除外に含める（#238 の改善を壊す側） | 2 failed |
| 代替画面バッファの判定を消す | 3 failed |
| マウス報告の判定を反転する | 6 failed |
| ガードごと #251 以前へ戻す | 4 failed |

**E2E**（`npm run build && npx playwright test S119`）

| 壊し方 | 結果 |
|---|---|
| カスタムハンドラを丸ごと外す（#238 ごと消す） | 1 failed |
| ガードを #251 以前へ戻す（代替画面なら常に変換） | 1 failed |
| ホイールを含むモードの一覧から `vt200` を落とす | 1 failed |
| （復元後） | 1 passed |

### 実機確認（agent-browser + CDP / claude 2.1.229）

**同じ操作を、ガードのある版と外した版で1回ずつ行った対照実験。**
操作は「claude タブを開く -> `.xterm-screen` に `WheelEvent(deltaY: -120)` を3連続で dispatch」。

| 確認したこと | ガードあり（本 PR） | ガードなし（対照） |
|---|---|---|
| claude ペインの `.xterm` の class | `enable-mouse-events` あり | `enable-mouse-events` あり |
| ホイール3回のあとの転写 | **2行ぶん上へスクロールし `Jump to bottom (click)` が出た** | スクロールせず |
| CLI の通知 | 出ない | **`Scroll wheel is sending arrow keys · use PgUp/PgDn to scroll`** |
| 入力欄 | 変化なし | **`History 100/100` に飛び、過去の入力が入った** |

⭐ **対照側の「入力欄が履歴に飛ぶ」が、利用者の言う「page-up/down が反応してしまう」の正体。**
矢印が転写ではなく入力履歴を送っていた。

### 検証

| | 結果 |
|---|---|
| `make check` | 870 tests / 55 files すべて green |
| `make e2e` | **EXIT=0 / 124 passed / 6 flaky**（flaky はいずれも起動タイムアウト。ロードアベレージ 6〜7 の負荷由来でリトライ通過） |
| `make e2e-lint` | PASS=951 / FAIL=0 |
| `lint-skills.sh` | PASS=95 / FAIL=0 |

⚠ **`make e2e` を3回回し、1回目だけ EXIT=2 になった**（出力を保存しておらず内訳は不明）。
2回目・3回目は EXIT=0。**この周は Electron の実機確認と並行して回しており、負荷が高い状態だった。**
`make e2e-screenshots` は不要（見た目を1px も変えていない。`docs/images/` に差分なし）。

### 教訓

- **「関門が赤くなるか」を1通りで済ませない。** E2E の否定側を最初「矢印が1本以上届く」で書いたら、
  **カスタムハンドラを丸ごと外しても緑のまま**だった。xterm 自身のフォールバック（矢印を1個送る）が
  効くため。#238 が直したのは「1ノッチ = 矢印1個」なので、**2本以上**でなければ意味を持たない。
- **測ろうとしている画面を、後始末で消さない。** spec の末尾に `printf '\033[?1049l'` を書いたせいで、
  代替画面ごと出力が消えて1回落とした。後始末は `afterEach` のアプリ終了に任せる。

### 次に再開するとき最初に読むべきこと

- **実装・検証・文書は完了している。** 残りは `known-issues.md` の 1番の未チェック項目
  （PR #238 に「#251 で訂正した」とコメントを残す）だけで、**PR を出すときに実施する**
- commit / push / PR はユーザーの明示指示待ち（ルート CLAUDE.md）。ブランチは
  `fix/wheel-mouse-report-251` で、上の検証はすべてこのブランチの作業ツリーで通したもの

---
