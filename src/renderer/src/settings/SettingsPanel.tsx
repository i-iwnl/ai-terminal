// 設定フォーム。**独立した設定ウィンドウの中身**として描画される。
//
// macOS 13 以降の作法では、アプリ全体に効く設定は非モーダルの Settings ウィンドウ。
// モーダルシートは「この書類に対する不可逆な決定」に使うもので、Webhook URL の
// 入力には重い。独立ウィンドウにしたことで、フォーカストラップ・Esc の自前処理・
// 背景クリック判定・backdrop がすべて不要になった（実装量はむしろ減っている）。
//
// ~/.ai-terminal/config.json を手で編集しなくても、通知まわり（サウンド・Slack /
// Discord の Webhook）を設定できるようにするための画面。
// 変更は即座に config:set へ流す（保存ボタンを持たない）。設定の唯一の正は
// Main 側の config.json で、ここは編集フォームに徹する。
//
// 入れ子の設定（slack / discord）は Main の setConfig が浅いマージで扱うため、
// 部分パッチではなく必ずオブジェクト全体を送ること。

import { useEffect, useState } from 'react';
import type { AppConfig, SoundOption, WebhookConfig, WebhookTarget } from '@shared/ipc';
import { THEME_NAME_CUSTOM, THEME_NAME_UNSET, THEME_PRESETS } from '@shared/themes';
import { DETECTED_NOTICE_TEXT, shouldShowDetectedNotice } from '@shared/screen-reader-mode';

export interface SettingsPanelProps {
  config: AppConfig;
  /**
   * OS 側で支援技術が動いているか（Issue #149）。
   *
   * **`config` とは別に受け取る。** これは設定ではなく実行時の状態で、
   * 設定ファイルには入らない。取得と購読は `SettingsWindow` の仕事。
   */
  accessibilitySupport: boolean;
  /** 変更を Main へ反映する。適用後の設定が返る */
  onChange: (patch: Partial<AppConfig>) => void;
  onClose: () => void;
}

/** Webhook のテスト送信の結果表示。target ごとに1つ保持する。 */
type TestStatus = { state: 'idle' } | { state: 'sending' } | { state: 'done'; message: string };

const IDLE: TestStatus = { state: 'idle' };

/**
 * 「タスクの完了時に通知する」を切ると Slack / Discord への自動送信も止まる、という
 * 依存を書いた注記の id。**注記は親スイッチ（notifyOnIdle）の直下に1つだけ置き、
 * Slack / Discord 両方のチェックボックスから `aria-describedby` で参照する。**
 *
 * 視覚的な入れ子（インデント）にはしない。macOS ではインデントが
 * 「親が off なら無効」を含意するが、ここは無効化しない（テスト送信は notify() を
 * 通らないので通知 off でも届く）ため、入れ子にすると依存を主張してから自分で
 * 否定する形になる。依存は AT には aria-describedby だけで伝える。
 */
const NOTIFY_DEPENDENCY_NOTE_ID = 'settings-notify-dependency-note';

/**
 * 「支援技術を検知したので、設定に関わらず有効になっている」を出す行の id
 * （Issue #149）。チェックボックスから `aria-describedby` で参照する。
 *
 * **参照はいつでも張る。** 注記が出ていないときは要素が空になるだけで、
 * dangling な IDREF にはならない（要素そのものは常に描く。下記）。
 */
const SCREEN_READER_DETECTED_ID = 'settings-screen-reader-detected';

/**
 * Webhook 設定のパッチを組み立てる。
 * 計算プロパティ（`{ [target]: ... }`）だと Partial<AppConfig> に収まらないため、
 * 送信先ごとに明示的に分岐する。
 */
function webhookPatch(target: WebhookTarget, next: WebhookConfig): Partial<AppConfig> {
  return target === 'slack' ? { slack: next } : { discord: next };
}

export default function SettingsPanel({
  config,
  accessibilitySupport,
  onChange,
  onClose,
}: SettingsPanelProps) {
  // `themeName` が未設定（既存の config.json を手で書いていた利用者）でも、
  // 保存済みの4色がたまたま既定と同じなら「既定（ダーク）」を選択済みに見せる。
  // **違っていれば「カスタム」**（勝手に既定へ寄せて、その人の設定を
  // 選び直しただけで失わせない）。
  const savedMatchesDefault =
    JSON.stringify(config.theme) ===
    JSON.stringify(THEME_PRESETS.find((p) => p.id === 'default')?.theme);
  const selectedThemeId =
    config.themeName !== THEME_NAME_UNSET
      ? config.themeName
      : savedMatchesDefault
        ? 'default'
        : THEME_NAME_CUSTOM;
  const [sounds, setSounds] = useState<SoundOption[]>([]);
  const [testStatus, setTestStatus] = useState<Record<WebhookTarget, TestStatus>>({
    slack: IDLE,
    discord: IDLE,
  });

  // 選択できる通知音の一覧。取得に失敗しても空のまま続行する
  // （select が「OS 既定」だけになるだけで、他の設定は触れる）。
  useEffect(() => {
    window.api.notify
      .listSounds()
      .then(setSounds)
      .catch((err: unknown) => {
        console.warn('[settings] 通知音の一覧取得に失敗しました', err);
      });
  }, []);

  // Escape と Cmd+W でウィンドウを閉じる。
  // 独立ウィンドウなので、閉じる手段はここと OS のクローズボタンの2つ。
  // メニューの「タブを閉じる」は本体ウィンドウのタブを対象にしているため、
  // ここでは使えない（Cmd+W は表示専用の accelerator で登録もされていない）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const isEscape = e.key === 'Escape';
      const isCmdW = e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'w';
      if (!isEscape && !isCmdW) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const testWebhook = (target: WebhookTarget): void => {
    setTestStatus((prev) => ({ ...prev, [target]: { state: 'sending' } }));
    window.api.notify
      .testWebhook({ target, url: config[target].url })
      .then((result) => {
        setTestStatus((prev) => ({
          ...prev,
          [target]: {
            state: 'done',
            message: result.ok ? '送信しました' : `失敗: ${result.error ?? '不明なエラー'}`,
          },
        }));
      })
      .catch((err: unknown) => {
        setTestStatus((prev) => ({
          ...prev,
          [target]: {
            state: 'done',
            message: `失敗: ${err instanceof Error ? err.message : String(err)}`,
          },
        }));
      });
  };

  const renderWebhook = (target: WebhookTarget, label: string, placeholder: string) => {
    const webhook = config[target];
    const status = testStatus[target];
    return (
      <div className="settings__webhook">
        <label className="settings__row">
          <input
            type="checkbox"
            checked={webhook.enabled}
            // 通知トグルへの依存を AT に伝える。参照先は「通知」節に1つだけある注記で、
            // renderWebhook 側では id を作らない（2回呼ばれるので、ここで id を
            // 生成すると DOM に重複した id が出る）。
            aria-describedby={NOTIFY_DEPENDENCY_NOTE_ID}
            onChange={(e) => onChange(webhookPatch(target, { ...webhook, enabled: e.target.checked }))}
          />
          <span>{label} に送る</span>
        </label>
        <input
          type="text"
          className="settings__text"
          aria-label={`${label} の Webhook URL`}
          placeholder={placeholder}
          value={webhook.url}
          onChange={(e) => onChange(webhookPatch(target, { ...webhook, url: e.target.value }))}
        />
        <div className="settings__row">
          <button
            type="button"
            className="settings__button"
            disabled={status.state === 'sending' || webhook.url.length === 0}
            onClick={() => testWebhook(target)}
          >
            {status.state === 'sending' ? '送信中...' : 'テスト送信'}
          </button>
          {status.state === 'done' && (
            <span className="settings__status" role="status">
              {status.message}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    // 設定ウィンドウの本体。role の無い <div> に aria-label を付けても AT には
    // 届かないので <main> にする（見出しも h3 単独ではなく h2 から始める）。
    <main className="settings settings--window" aria-label="設定">
      <div className="settings__body">
          {/* 1. 外観。`ターミナル` にはしない（tmux もスクリーンリーダーも
              「ターミナルの設定」で、それらは別の節にある）。 */}
          <section className="settings__section">
            <h2 className="settings__heading">外観</h2>
            {/* 配色プリセット（Issue #119 周6 / #20 の PR 18）。
                **自由な色入力にはしない。** `chromeSafeToApply` が false になる
                背景を選べてしまい、そのとき起きるのは「何も起きない」ではなく
                「端末だけ色が変わり、クロームが暗いまま残る半適用」になる
                （src/shared/themes.ts の冒頭参照）。プリセットが安全であることは
                test/unit/themes.test.ts が関門にしている。 */}
            <label className="settings__row">
              <span className="settings__label">配色</span>
              <select
                className="settings__select"
                value={selectedThemeId}
                onChange={(e) => onChange({ themeName: e.target.value })}
              >
                {/* config.json を手で編集して4色を決めている状態。
                    **選択肢として残す**（プリセットを一度選んだあとに戻る道が
                    無いと、手で書いた設定が二度と使えなくなる）。 */}
                {selectedThemeId === THEME_NAME_CUSTOM && (
                  <option value={THEME_NAME_CUSTOM}>カスタム（config.json の設定）</option>
                )}
                {THEME_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="settings__note">
              ターミナルの配色を変えると、サイドバーとタブバーの色も自動で合わせます。
            </p>
            <label className="settings__row">
              <span className="settings__label">フォント</span>
              <input
                type="text"
                className="settings__text"
                value={config.fontFamily}
                onChange={(e) => onChange({ fontFamily: e.target.value })}
              />
            </label>
            <label className="settings__row">
              <span className="settings__label">サイズ</span>
              <input
                type="number"
                className="settings__number"
                min={6}
                max={48}
                value={config.fontSize}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  // 空欄にすると NaN が来る。既存値を維持して壊さない。
                  if (Number.isFinite(next)) onChange({ fontSize: next });
                }}
              />
            </label>
          </section>

          {/* 2. 動作中の AI。設定ウィンドウは 520x640 固定で、末尾に置くと
              スクロールしないと存在に気づけない（絞り込みを見つけられない）。
              改名だけでは足りないので位置ごと前に出す。 */}
          <section className="settings__section">
            <h2 className="settings__heading">動作中の AI</h2>
            <label className="settings__row">
              <input
                type="checkbox"
                checked={config.useTmux}
                onChange={(e) => onChange({ useTmux: e.target.checked })}
              />
              <span>アプリを閉じても AI の作業を続ける（tmux が必要）</span>
            </label>
            {/* isTmuxAvailable が false のときは黙って通常起動する。条件
                （tmux が必要）を落とすと実装より強い約束になるので落とさない。 */}
            <p className="settings__note">
              tmux が入っていない環境では、この設定を有効にしても通常どおり起動します。
            </p>
            <label className="settings__row">
              <input
                type="checkbox"
                checked={config.scopeAgentsToCwd}
                onChange={(e) => onChange({ scopeAgentsToCwd: e.target.checked })}
              />
              <span>このフォルダのものだけ表示する</span>
            </label>
            <label className="settings__row">
              {/* 単位は ms のまま。`= 3.0 秒` のような換算表示を3つ目の子として
                  足すと、.settings__row の2列グリッドの2行目に落ちて崩れる。 */}
              <span className="settings__label">更新間隔（ミリ秒）</span>
              <input
                type="number"
                className="settings__number"
                min={500}
                step={500}
                value={config.pollIntervalMs}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next)) onChange({ pollIntervalMs: next });
                }}
              />
            </label>
          </section>

          {/* 3. 通知。 */}
          <section className="settings__section">
            <h2 className="settings__heading">通知</h2>
            <label className="settings__row">
              <input
                type="checkbox"
                checked={config.notifyOnIdle}
                onChange={(e) => onChange({ notifyOnIdle: e.target.checked })}
              />
              <span>タスクの完了時に通知する</span>
            </label>
            {/* 依存は notifyOnIdle の値によらず**常時**出す。off のときだけ出す形は
                「壊れた後の診断」であって依存の可視化ではない（人が Webhook を
                設定するのは通知が on のとき）。Dock バッジは poller.ts が
                notifyOnIdle と独立に更新しているので、それも書く。 */}
            <p className="settings__note" id={NOTIFY_DEPENDENCY_NOTE_ID}>
              オフにすると Slack / Discord
              への自動送信も止まります（テスト送信は届きます）。Dock バッジの数字は残ります。
            </p>
            <label className="settings__row">
              <input
                type="checkbox"
                checked={config.notifySound}
                onChange={(e) => onChange({ notifySound: e.target.checked })}
              />
              <span>音を鳴らす</span>
            </label>
            <div className="settings__row">
              <span className="settings__label">音の種類</span>
              <select
                className="settings__select"
                // 可視ラベルと一致させる（WCAG 2.5.3 Label in Name）。この行は
                // <div> なので <label> による関連付けが無く、アクセシブル名は
                // この aria-label が唯一の供給元になる。
                aria-label="音の種類"
                value={config.notifySoundId}
                disabled={!config.notifySound}
                onChange={(e) => onChange({ notifySoundId: e.target.value })}
              >
                {/* 一覧が取れていなくても、現在の設定値は必ず選択肢に出す
                    （取得失敗で選択が「OS 既定」に化けて見えるのを防ぐ）。 */}
                {sounds.length === 0 && (
                  <option value={config.notifySoundId}>{config.notifySoundId || 'OS 既定'}</option>
                )}
                {sounds.map((sound) => (
                  <option key={sound.id} value={sound.id}>
                    {sound.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="settings__button"
                aria-label="通知音を試聴"
                disabled={!config.notifySound}
                onClick={() => {
                  void window.api.notify.playSound({ soundId: config.notifySoundId });
                }}
              >
                試聴
              </button>
            </div>
          </section>

          {/* 4. Slack / Discord への転送。通知節の入れ子にはしない（B-2 の注記参照）。 */}
          <section className="settings__section">
            <h2 className="settings__heading">Slack / Discord への転送</h2>
            <p className="settings__note">
              タスク完了通知を Incoming Webhook にも送ります。URL は config.json
              に平文で保存されます。
            </p>
            {renderWebhook('slack', 'Slack', 'https://hooks.slack.com/services/...')}
            {renderWebhook('discord', 'Discord', 'https://discord.com/api/webhooks/...')}
          </section>

          {/* 5. アクセシビリティ。 */}
          <section className="settings__section">
            <h2 className="settings__heading">アクセシビリティ</h2>
            <p className="settings__note">
              ターミナルの内容は GPU が canvas に描くため、既定では VoiceOver
              から読めません。有効にすると読み上げ用の要素を別に出します（描画は少し重くなります）。
              VoiceOver が動いていることを検知できたときは、この設定に関わらず有効になります。
            </p>
            <label className="settings__row">
              <input
                type="checkbox"
                checked={config.screenReaderMode}
                // 設定が off でも実効では有効、という食い違いを AT へ伝える
                // （Issue #149）。参照先は下の行で、NOTIFY_DEPENDENCY_NOTE_ID と同じ形。
                // **これが無いと、この機能の対象者は「オフ」としか聞けない。**
                aria-describedby={SCREEN_READER_DETECTED_ID}
                onChange={(e) => onChange({ screenReaderMode: e.target.checked })}
              />
              <span>ターミナルの内容をスクリーンリーダーから読めるようにする</span>
            </label>
            {/* ⛔ **この行を <label> の中に入れない。** 中に入れると
                (1) チェックボックスのアクセシブル名にこの文が連結されて
                    WCAG 2.5.3（Label in Name）を割り、
                (2) .settings__row は 2 列グリッドなので 3 つ目の子が
                    2 行目に落ちて崩れる（同じ罠が上の「更新間隔」にも注記してある）。
                インデントもしない（macOS では入れ子が「親が off なら無効」を含意する。
                NOTIFY_DEPENDENCY_NOTE_ID と同じ判断）。

                **要素は常に描き、中身だけを出し入れする。** 条件付きで要素ごと
                生やすと、live region が中身と同時に現れることになり読み上げが
                飛ぶことがある（App.tsx の .app-status と同じ形にする）。
                空のときは行ボックスを作らないので、見た目は「何も出ない」まま。 */}
            <span className="settings__status" role="status" id={SCREEN_READER_DETECTED_ID}>
              {shouldShowDetectedNotice(config, accessibilitySupport) ? DETECTED_NOTICE_TEXT : ''}
            </span>
          </section>
        </div>
    </main>
  );
}
