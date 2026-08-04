# Known Issues

実装中に発見された未解決のバグ・先送りした課題。

---

## 1. この Issue では扱わないもの

| # | 内容 | 出典 |
|---|---|---|
| 1 [#142](https://github.com/i-iwnl/ai-terminal/issues/142) | **タブの終了バッジがアクティブ leaf しか見ていない。** `issue-56/design-review.md:81` は「全 leaf が終了したときだけ」と確定させているが、実装は `tabLeaf(tab).exit`（第三の挙動）。`TabBar.tsx:335 / :343 / :357 / :443` の4箇所 | `issue-130/known-issues.md` |
| 2 [#132](https://github.com/i-iwnl/ai-terminal/issues/132) | `Cmd+J` がペインに着地しない（`App.tsx:554-566`） | `issue-130/known-issues.md` X1 |

### ステータス

**全件起票済み**（2026-08-04）。#142 / #132。
