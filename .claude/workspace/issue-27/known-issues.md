# Known Issues

実装中に発見された未解決のバグ・先送りした課題。
詳細な観察記録は `worklog.md` を参照。

---

<!-- 問題が見つかったら以下のフォーマットで追記 -->

## 1. パッケージ版のアプリアイコンが Electron 既定のまま

> **GitHub Issue**: [#31](https://github.com/i-iwnl/ai-terminal/issues/31)

### 症状

`make package` で生成した .app / dmg のアイコンが Electron の既定アイコンになる（electron-builder が `default Electron icon is used  reason=application icon is not set` と警告する）。

### 原因（判明している場合）

アイコン画像（`build/icon.icns`）を用意していない。electron-builder は `build/` 配下の icon を自動検出するが、存在しないため既定にフォールバックしている。

### 影響範囲

- Dock / Finder / dmg での見た目のみ。機能への影響は無い

### 対処方針

- [x] アプリアイコンの画像を用意し、`build/icon.png` として配置する（electron-builder が icns へ自動変換するため .icns の手作業は不要だった。SVG 原本も `build/icon.svg` に同梱）

### 優先度

P3

### ステータス

対処済み（2026-07-29。デザインは3案からユーザーが C 案「プロンプト + AI スパーク」を選定）

---
