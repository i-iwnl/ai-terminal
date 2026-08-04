# Promote Known Issues - known-issues.md を GitHub Issue に起こす

`.claude/workspace/*/known-issues.md` に溜まった未解決の課題を GitHub Issue として起こし、ラベルを付ける手順。

**なぜ要るか。** `known-issues.md` は作業中の観察を書き留める場所で、ワークスペースを開かないと誰にも見えない。作業が終わってワークスペースを離れると、そこに書いた課題は忘れられる。**状態（open / closed）の唯一の正は GitHub Issue** なので、追跡すべきものは Issue へ移す。

## トリガー

- 作業の節目に達したとき（**節目の定義は [update.md](update.md) の表が唯一の正**）。[loop.md](loop.md) の「5. 記録」から呼ばれる
- `known-issues.md` に未対処の項目が溜まってきたとき
- ユーザーが「known-issues を Issue にして」と言ったとき

## ⛔ 起票する前に、open の数を数える

**この手順は放っておくとポンプになる。** 周が known-issues を増やし、この手順がそれを機械的に起票し、
起票された Issue を潰す周がまた known-issues を増やす。**2026-08-04 に1日で 46 件作成 / 14 件 close（差し引き +32）**
という実績がある。

**起票を始める前に必ず測る。**

```bash
gh issue list --label known-issue --state open --json number --jq length
```

| 数 | やること |
|---|---|
| **20 件未満** | 通常どおり起票してよい |
| **20 件以上** | **新規起票を止める。** 先に既存を溶かす。ユーザーに数を報告し、束ねループを作るか close するかの判断を仰ぐ |

**束ねる場合は `tracking` ラベルを付け、上の件数からは除く**（束ね Issue は作業ではなく追跡なので、
個別 Issue と二重に数えると実際より多く見える）。束ね Issue の本文には
「**着手したら新規 Issue を立てない。見つけたものは known-issues.md に書き、周を増やして溶かす**」を必ず書く。

## Issue に起こすもの・起こさないもの

**判断基準は「これから誰かが手を動かす必要があるか」、かつ「今のループでは溶かせないか」。**

| ステータス | Issue 化 | 理由 |
|---|---|---|
| 未対処 | **する** | まさに追跡対象 |
| 調査中 | **する** | 途中で放置されるのを防ぐ |
| 先送り | **する**（`deferred` を付ける） | 「意図的に今やらない」と「忘れた」を区別できるようにする |
| 対処済み（残タスクなし） | しない | 記録として `known-issues.md` に残せば足りる |
| 対処済み（条件付きの残タスクあり） | **する**（`deferred` を付ける） | 例:「秘匿が要件になったら safeStorage へ移す」 |
| **今のループの周を1つ増やせば溶けるもの** | **しない** | 起票 -> 棚卸し -> また起票の循環を作る。**周を増やして、そこで溶かす** |
| **観察・教訓・「そういう仕様だと分かった」** | しない | 追跡すべき作業が無い。`known-issues.md` と `architecture.md` に残す |

**1つの項目が複数の独立した作業を含むなら、Issue を分ける。** 例: 「Phase 1 受け入れ基準」の中に「実機で確認する」と「README に明記する」が混ざっていたら別々の Issue にする。逆に、別々の項目が同じ1つの作業を指しているなら1つにまとめる。

## ラベル体系（唯一の正）

**種類・優先度を必ず1つずつ付ける。** 性質は該当するものを任意個。

| 分類 | ラベル | 意味 |
|---|---|---|
| 種類（1つ必須） | `bug` | 期待どおり動かない |
| | `enhancement` | 新しい機能・改善 |
| | `documentation` | README / docs / skill の記述 |
| | `test` | テスト・検証基盤 |
| | `chore` | 設定・ビルド・雑務 |
| 優先度（1つ必須） | `P1` | 次に着手する |
| | `P2` | 順番が来たら着手する |
| | `P3` | 必要になったら着手する |
| 性質（任意） | `known-issue` | `known-issues.md` 由来。**この手順で起こした Issue には必ず付ける** |
| | `manual-only` | 自動テストで担保できず、人手での確認が要る |
| | `deferred` | 意図的に先送りしている。着手の条件を本文に書くこと |
| | `tracking` | **束ね Issue**（それ自体は作業ではなく、個別 Issue の追跡）。**open 件数を数えるときは除く** |

**優先度は `known-issues.md` に書かれた値をそのまま使う。** ここで格上げ・格下げしない（判断が2箇所に分かれる）。優先度が書かれていない項目は、まず `known-issues.md` 側に書いてから起こす。

ラベルが未作成のリポジトリでは先に作る:

```bash
gh label create "test"        --color "0e8a16" --description "テスト・検証基盤に関するもの" --force
gh label create "chore"       --color "fef2c0" --description "設定・ビルド・雑務" --force
gh label create "P1"          --color "b60205" --description "優先度 高（次に着手する）" --force
gh label create "P2"          --color "fbca04" --description "優先度 中（順番が来たら着手する）" --force
gh label create "P3"          --color "c2e0c6" --description "優先度 低（必要になったら着手する）" --force
gh label create "known-issue" --color "5319e7" --description ".claude/workspace/*/known-issues.md 由来" --force
gh label create "manual-only" --color "d4c5f9" --description "自動テストで担保できず、人手での確認が要る" --force
gh label create "deferred"    --color "cfd3d7" --description "意図的に先送りしている（必要になるまで着手しない）" --force
gh label create "tracking"    --color "1d76db" --description "束ね Issue（個別 Issue の追跡。件数には数えない）" --force
```

## 手順

### 1. 全ワークスペースの known-issues.md を読む

```bash
ls .claude/workspace/*/known-issues.md
```

**1つのワークスペースだけを見て済ませない。** 別の Issue の作業中に見つけた課題が、そのワークスペースに取り残されていることがある。

### 2. 既に Issue 化済みのものを除く

各項目の見出し直下に `> **GitHub Issue**: [#N](...)` があれば起こし済み。**重複して起こさない。**

```bash
grep -n "^## \|GitHub Issue" .claude/workspace/*/known-issues.md
```

### 3. Issue を作る

本文には**出典・症状・分かっていること・影響範囲・完了条件**を書く。`known-issues.md` の内容を要約せず、**読み手が元ファイルを開かなくても着手できる**ところまで書き写してよい（ここは二重化を許す。Issue を見た人がワークスペースを持っているとは限らないため）。

冒頭に出典を1行入れる:

```markdown
> 出典: `.claude/workspace/issue-<番号>/known-issues.md` の <番号> 番
```

`deferred` を付ける Issue には、**着手の条件**を必ず書く。「必要になったら」だけでは、何が起きたら必要なのかが失われる。

```bash
gh issue create --title "<何をするか。症状ではなく作業として書く>" \
  --label "<種類>,<優先度>,known-issue[,性質...]" \
  --body-file <本文ファイル>
```

### 4. known-issues.md に Issue 番号を書き戻す

見出しの直後に挿入する:

```markdown
## 3. tmux 永続化は E2E の範囲外

> **GitHub Issue**: [#15](https://github.com/<owner>/<repo>/issues/15)
```

**双方向にリンクが張られていない状態を作らない。** 片側しか無いと、次に読んだ人が「これは起こし済みか」を判断できず、重複した Issue が生まれる。

### 5. 既存 Issue のラベルも揃える

この手順以外で作られた Issue（機能追加など）にも、種類と優先度のラベルが付いているかを確認する。

```bash
gh issue list --state open --json number,title,labels \
  --template '{{range .}}#{{.number}} {{.title}}{{"\n"}}    {{range .labels}}[{{.name}}] {{end}}{{"\n"}}{{end}}'
```

### 6. 閉じられるものを数え上げて、候補として出す

**起票と同じ回数だけ、閉じる側も見る。** 起票側だけを自動化したせいで open が単調増加した
（この手順が長らく「close はやらない」とだけ書いていたのが原因）。

```bash
gh issue list --label known-issue --state open --json number,title
```

各 Issue について、次のどれかに当たるものを**候補として列挙し、根拠を1行添えてユーザーに提示する**。

| 閉じてよい形 | 根拠に書くこと |
|---|---|
| 実装が別の周で済んでいる | どのコミット・どの spec が担保しているか |
| 前提が変わって不要になった | 何が変わったか |
| 「やるかどうかを決める」が完了条件で、決まった | 決めた内容と理由（**決めないまま open で残すのが最も悪い**） |
| 別 Issue と同じ作業を指している | どちらに寄せるか |

**close の実行はユーザーの承認を得てから。** 判断を代行しないが、**候補を出さないのも同じくらい悪い**
（誰も数えないので減らない）。

## この手順がやらないこと

- **承認なしの `gh issue close`**: 閉じてよいかの最終判断はユーザーが行う。この手順は**候補の提示**まで（手順6）
- **`known-issues.md` の項目の削除**: Issue 化しても元の記述は残す。**観察の記録**と**追跡の状態**は役割が違う
- **優先度の見直し**: `known-issues.md` 側が正。変えたいならそちらを直してから起こす

## DoD（完了条件）

- **起票を始める前に open な `known-issue` の数を測り、20 件以上なら起票していない**
- 全ワークスペースの `known-issues.md` を見た（1つだけ見て終わっていない）
- 未対処 / 調査中 / 先送り の項目のうち、**今のループの周では溶かせないもの**が Issue になっている
  （「すべて起票する」ことは**完了条件ではない**。起票しない判断も記録する）
- **閉じられる Issue の候補を数え上げてユーザーに提示した**（手順6）
- 各 Issue に**種類・優先度・`known-issue`** が付いている
- `deferred` を付けた Issue に着手の条件が書かれている
- `known-issues.md` の各項目に Issue 番号が書き戻されている（双方向リンク）
