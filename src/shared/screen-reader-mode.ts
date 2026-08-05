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
