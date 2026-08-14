# Worklog

時系列の作業ログ。**設計判断の根拠**と**学んだ教訓**を中心に記録する。
コード差分は git log を参照、現状の構造は `architecture.md` を参照。

---

## 2026-08-14 - 周1: 原因の切り分け（実装前）

### 実施内容

- 「ai-terminal 内で zsh から起動した claude が一覧に出ない」という報告を受け、原因を特定した
- 一覧の情報源が `claude agents --json` -> `~/.claude/sessions/<pid>.json` であることを確認
- 実機で動いていた「タブから手動起動した claude」は `<pid>.key` だけを書き、`<pid>.json` を書いていなかった
- 同じ pty + `zsh -l` から起動する条件で、env だけを変えた A/B を実施（CLI 2.1.232）

| 条件 | `<pid>.json` | `claude agents --json` |
|---|---|---|
| そのまま（`CLAUDE*` を継承） | 書かれない | 出ない |
| 子プロセスで `CLAUDE*` を全削除 | 書かれる | 出る |

- 起動中の `.app` 自身の `process.env` に、親 Claude Code セッションのマーカーが載っていることを確認
- 画面にも `⚠ Transcript saving is off — inherited CLAUDE_CODE_CHILD_SESSION marker` が出ていた
- Issue #253 として起票し、ワークスペースを作成

### 設計判断

- **除去キーは明示列挙**: `CLAUDE_CONFIG_DIR` / `ANTHROPIC_*` は利用者の設定なので巻き添えにしない
- **除去は `process.env` を起動時に1回**: `buildPtyEnv` に置くと `mergeUserEnv` の埋め戻しと順序で噛み合わない（`architecture.md` の設計判断履歴が正）

### 教訓

- **外れた仮説を2つ踏んだ。**
  1. 「最初のプロンプト送信までは登録されない」-> tmux 越しに起動した claude は
     プロンプト表示の時点で `status: "idle"` として登録済みだった。**否定された**
  2. 「`CLAUDE_CODE_CHILD_SESSION` を tmux の `-e` で渡せば再現する」-> **再現しなかった**。
     tmux 経由の注入では期待した条件が作れておらず、**同じ pty 生成経路で env だけを
     変える A/B に切り替えて初めて確定した**
- **`script -q /dev/null claude` は対照実験に使えない。** stdin が tty でないと
  `tcgetattr/ioctl: Operation not supported on socket` で落ち、
  「登録されない」という**偽陽性**を出す（最初にこれで誤った結論に傾いた）
- **`python3` の `pty.fork()` は winsize を設定しない。** 0x0 のまま claude を起動すると
  TUI が1バイトも描画されず、これも「登録されない」に見える。
  `TIOCSWINSZ` を明示してから比較すること
- **`ps -Ewww -p <pid>` で他プロセスの env が読める**（同一ユーザー）。
  env 起因の不具合はこれで直接差分が取れる。
  ⛔ ただし**出力には API キー等が混ざる**。公開リポジトリの Issue / worklog には
  **キー名だけを書き、値を貼らない**

### 次に再開するとき最初に読むべきこと

- `architecture.md` の「3. 技術的制約・前提条件」。**除去の実行位置**（`ensureLoginShellPath()` より前 = `src/main/index.ts` の import 直後）が
  この修正の肝で、後ろに置くと探索シェルが同じ値を再エクスポートして無効化される
- 実装はまだ1行も入っていない。周2は `src/main/inherited-agent-env.ts` の新規作成から
- E2E の注入フラグは `e2e/fixtures/harness.ts` の `simulateAppleTerminalHost` が手本
  （`...process.env` の継承に任せると、**エージェントが `make e2e` を回したときだけ条件が揃う**
  非決定になる。明示注入が必須）

---

## 2026-08-14 - 周2: 実装・検証

### 実施内容

- `src/main/inherited-agent-env.ts` を新規作成（`INHERITED_AGENT_SESSION_KEYS` / `stripInheritedAgentSession` / `purgeInheritedAgentSession`）
- `src/main/index.ts` の import 直後（`ensureLoginShellPath()` より前）で `purgeInheritedAgentSession()` を呼ぶ
- `test/unit/inherited-agent-env.test.ts`（12件）
- `e2e/fixtures/harness.ts` に `simulateLaunchedFromAgentSession` を追加し、**既定では親セッションの env を落としてから**起動 env を組み立てるようにした
- `e2e/specs/S120-inherited-agent-env.spec.ts` と `scenarios.yml` の1行を追加
- README「うまく動かないとき」に1項目追加

### 検証

`make check` 緑 / `make e2e` 緑（126 passed・5 flaky はリトライで緑）/ `make e2e-lint` FAIL=0。
撮影レーンは回していない（UI・CSS・DOM を1つも触っていないため）。

**関門が赤くなることを、壊し方を変えて6通り確認した。**

| # | 壊し方 | unit | S120 |
|---|---|---|---|
| A | `index.ts` の呼び出しを消す | **緑**（届かない） | 赤 |
| B | 呼び出しを `ensureLoginShellPath()` の後ろへ動かす | 緑 | 赤 |
| C | `purgeInheritedAgentSession` を何もしない実装にする | 赤 | 赤 |
| D | 一覧から `CLAUDE_CODE_CHILD_SESSION` を落とす | 赤4件 | 赤 |
| E | 前方一致（`startsWith('CLAUDE')`）に置き換える | 赤 | 緑 |
| F | `buildPtyEnv` が env を1つも渡さないようにする | 緑 | 赤（**control 側**） |

- **A と B は単体テストでは届かない。** S120 を書いた理由がここ（呼び出しの位置そのものが仕様）
- **F は control が無ければ緑になっていた。** env が1つも届かなければ `marker=[]` は当然成立する

### 実機確認（agent-browser / CDP）

親セッションのマーカーを持つシェルから `out/` を起動（この検証を行ったエージェント自身の env が
条件を満たしているので、注入は不要だった）。

1. シェルタブで `echo "control=[${SHELL:+set}] marker=[...]"` -> `control=[set] marker=[]`
2. 同じタブで `claude` を起動 -> `~/.claude/sessions/<pid>.json` が**書かれた**
3. `claude agents --json` にその pid が出た
4. サイドバーに `ai-terminal-57` として並んだ

### 教訓

- ⛔ **`npx agent-browser connect <port>` を信用しない。** `connect 9222` が `✓ Done` を返したのに、
  実際に操作していたのは**別ポート（9225）で動いていた利用者の実アプリ**だった。
  `npx agent-browser eval "location.href"` で**必ず接続先を確認してから操作する**。
  この取り違えで、**利用者が別プロジェクトで走らせていた Claude Code セッションに
  検証用の文字列を送信してしまった**（実害あり）。
- **代わりに `chromium.connectOverCDP('http://127.0.0.1:<port>')` を直接使うと取り違えない。**
  `@playwright/test` から import すればリポジトリ内で動く（`playwright` 単体は入っていない）。
  接続直後に `page.url()` を出して、見ているアプリを毎回名乗らせること。
- **実機は WebGL レンダラなので `.xterm-rows` から文字が読めない。**（E2E は `--disable-gpu` で
  DOM レンダラに落ちるので読める）。実機で端末の中身を見るときは**スクリーンショット**を撮る。
- **E2E ハーネスが `...process.env` を素通しすると、「誰が回したか」でシナリオの前提が変わる。**
  このリポジトリではエージェントが `make e2e` を回すので、親セッションの env が全シナリオに
  混ざっていた。ハーネス側で落としてから組み立てるようにした。

### 次に再開するとき最初に読むべきこと

- 実装・検証は完了。**残っているのは commit / push / PR だけ**で、これは利用者の明示指示待ち
  （ルート CLAUDE.md）。ブランチは `fix/253-inherited-agent-env`
- push 前にもう一度 `make e2e` と `make e2e-lint` を通すこと。撮影レーンは不要（UI 非変更）
- `known-issues.md` の2件（手動起動の gemini は原理的に一覧へ出せない / `.key` の残骸）は
  いずれも意図的な非対処。起票するなら `/workspace-plan promote-known-issues` を明示的に呼ぶ

---

<!-- 以降、作業のたびにセクションを追記 -->
