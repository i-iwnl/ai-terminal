// 読み上げモードの「実効値」の判定（Issue #149）。
//
// **設定値と実効値は別物。** `AppConfig.screenReaderMode` は利用者が明示的に
// 選んだ永続値で、実際に読み上げ用の DOM を生やすかどうかは
// **OS 側で支援技術が動いているか**にも依る（`src/main/accessibility.ts`）。
//
// この判定を1箇所に置く理由は、**読み手が2つある**こと。本体ウィンドウ
// （`App.tsx` -> `PaneTreeView`）と設定ウィンドウ（`SettingsPanel.tsx` の表示）で
// 同じ式を書くと、3つ目の条件が増えた日に**設定ウィンドウだけが嘘をつく**。
//
// ⚠ **`accessibilitySupport` は「VoiceOver が動いている」ではない。**
// 由来は Electron の `app.accessibilitySupportEnabled` で、Chromium が
// 支援技術の利用を検出したときに真になる。VoiceOver 以外（音声コントロール・
// スイッチコントロール・AX API に繋ぐ自動化ツール）でも立つので、
// **この値を根拠に「VoiceOver」と断定してはいけない**（design-review で5人全員が指摘）。

/** 判定に要る設定値だけを取る（`AppConfig` 全体に依存させない）。 */
export interface ScreenReaderModeInput {
  /** 利用者が設定ウィンドウで選んだ永続値。 */
  screenReaderMode: boolean;
}

/**
 * xterm の読み上げモードを実際に有効にするか。
 *
 * **設定が off でも、支援技術を検知していれば有効にする。** 設定の存在を
 * 知らない利用者でも読める状態になる、というのが自動検知の狙い
 * （`src/main/accessibility.ts` の冒頭）。
 */
export function isScreenReaderModeEffective(
  config: ScreenReaderModeInput,
  accessibilitySupport: boolean,
): boolean {
  return config.screenReaderMode || accessibilitySupport;
}

/**
 * 設定ウィンドウに「いま自動で有効になっている」の注記を出すか。
 *
 * **出すのは「設定と実効値が食い違っているとき」だけ。** 利用者が自分で
 * チェックを入れているなら、有効なのは本人の設定が理由なので説明する必要が無い
 * （チェックを入れた瞬間に注記が消えるのが、そのままフィードバックになる）。
 *
 * 検知していない既定の状態で「無効です」を常時出すことはしない。
 * 全利用者にノイズを増やすだけで、運ぶ情報が無い。
 */
export function shouldShowDetectedNotice(
  config: ScreenReaderModeInput,
  accessibilitySupport: boolean,
): boolean {
  return accessibilitySupport && !config.screenReaderMode;
}

/**
 * 上の注記の文言。**「VoiceOver を検知した」と断定しない**（この判定の由来である
 * `app.accessibilitySupportEnabled` は支援技術全般で立つ）。
 *
 * **状態を先頭に置く。** この文はチェックボックスの `aria-describedby` から
 * 参照され、読み上げでは「…読めるようにする、チェックボックス、**オフ**」の
 * 直後に読まれる。矛盾を最短で打ち消せる語順がこれになる。
 *
 * **括弧とコロンを使わない。** VoiceOver は句読点の読み上げ設定によって
 * 「かっこ」「コロン」を発話しうるので、まさにこの文を読む人にとってノイズになる。
 */
export const DETECTED_NOTICE_TEXT = 'いま有効です。VoiceOver などの支援技術を検知しています';
