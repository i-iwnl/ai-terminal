# Worklog

時系列の作業ログ。**設計判断の根拠**と**学んだ教訓**を中心に記録する。
コード差分は git log を参照、現状の構造は `architecture.md` を参照。

---

## 2026-07-29 - 設定をモーダルから独立ウィンドウへ

### 実施内容

- 計画ゲートでユーザーに2案を提示し、**独立ウィンドウ案**の判断を得た（#20 の D と同じ方向）
- `src/main/settings-window.ts` を新設（生成・多重防止・開閉の IPC）
- 同じバンドルを `#settings` 付きで読み込み、`main.tsx` で描画を切り替える形にした
- `SettingsWindow.tsx` を新設し、`SettingsPanel.tsx` から backdrop / dialog ラッパーを撤去した
- `App.tsx` からモーダルの state と描画を削除した
- **`config:changed` を全ウィンドウへ配信する経路を追加した**（下記の教訓）
- `FALLBACK_CONFIG` を `lib/defaults.ts` に切り出した（本体と設定ウィンドウで共有）
- `styles.css` から `.settings-backdrop` / `__head` / `__title` / `__close` を削除し、`.settings--window` を追加
- E2E に `openSettingsWindow()` ヘルパを足し、S31 / S32 / S35 と撮影スクリプトを追従させた
- `annotateAndShoot` に `targetWidth` を足し、設定ウィンドウは 620px で保存するようにした
- 検証: `make check`（unit 75）/ `make e2e`（38 passed）/ `make e2e-lint`（PASS=279 FAIL=0）

### 設計判断

判断の一覧と根拠は `architecture.md` の設計判断履歴が正。要点だけ:

- **モーダルをやめたら実装量が減った。** フォーカストラップ・Esc の自前処理・背景クリック判定・
  backdrop がすべて不要になり、#25 の問題3つが構造ごと消えた
- ビルドの入力（HTML）を増やさず、`#settings` で描画を切り替える形にした

### 教訓（該当する場合）

- **モーダルを別ウィンドウに切り出すと、state の共有が切れる。**
  モーダルだった頃は同じ React ツリーだったので `setConfig` で本体に反映されたが、
  別 Renderer では届かない。**E2E S31 が「フォントサイズが 13px のまま」で赤くなって初めて気づいた。**
  Main から全ウィンドウへ配信する経路を足して解決した。
  UI の置き場所を変えるときは「今まで暗黙に共有されていたものは何か」を先に洗い出すべきだった
- **ウィンドウを閉じるキーの `press()` は reject しうる。** 押した瞬間にページが消えるため
  Playwright が "Target page has been closed" を投げる。**閉じたことは `app.windows().length` で
  判定し、`press()` の reject は握り潰す**のが正しい形（握り潰しても、押せていなければ次の assert が落ちる）
- **狭いウィンドウを README の統一幅（1200px）に引き伸ばすと、ぼやけて読めない。**
  520px の設定ウィンドウを 1200px にしたら文字が巨大かつ不鮮明になった。撮影幅を引数にした
- 3周連続で、**撮った画像を実際に目で見たことで問題が見つかっている**（S12 の吹き出し重なり、
  S31 の引き伸ばし）。撮り直したら必ず開いて見る

### 次に再開するとき最初に読むべきこと

- **Issue #25 の実装・検証・文書更新は完了。** 残りは commit / push / PR
- **これで #20 の Phase 0（デザイン以前に壊れているもの）は5件すべて完了。**
  次は #20 の Phase 1（トークン層）で、**PR 1（`src/shared/defaults.ts` へ既定値を寄せる）から**。
  `issue-25/known-issues.md` の3番がその前提
- PR は #29 -> #30 -> #33 -> #34 -> 本PR の順に積んである。**前段がマージされたら base を繰り上げる**
- 各 Issue の `known-issues.md` に**実機確認が3件**残っている（#22 の二重発火、#23 の VoiceOver、
  #24 の通知クリック）。いずれも自動テストでは担保できない

---

<!-- 以降、作業のたびにセクションを追記 -->
