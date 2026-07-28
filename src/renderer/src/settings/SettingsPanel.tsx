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

export interface SettingsPanelProps {
  config: AppConfig;
  /** 変更を Main へ反映する。適用後の設定が返る */
  onChange: (patch: Partial<AppConfig>) => void;
  onClose: () => void;
}

/** Webhook のテスト送信の結果表示。target ごとに1つ保持する。 */
type TestStatus = { state: 'idle' } | { state: 'sending' } | { state: 'done'; message: string };

const IDLE: TestStatus = { state: 'idle' };

/**
 * Webhook 設定のパッチを組み立てる。
 * 計算プロパティ（`{ [target]: ... }`）だと Partial<AppConfig> に収まらないため、
 * 送信先ごとに明示的に分岐する。
 */
function webhookPatch(target: WebhookTarget, next: WebhookConfig): Partial<AppConfig> {
  return target === 'slack' ? { slack: next } : { discord: next };
}

export default function SettingsPanel({ config, onChange, onClose }: SettingsPanelProps) {
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
    <div className="settings settings--window" aria-label="設定">
      <div className="settings__body">
          <section className="settings__section">
            <h3 className="settings__heading">表示</h3>
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

          <section className="settings__section">
            <h3 className="settings__heading">通知</h3>
            <label className="settings__row">
              <input
                type="checkbox"
                checked={config.notifyOnIdle}
                onChange={(e) => onChange({ notifyOnIdle: e.target.checked })}
              />
              <span>タスクの完了時に通知する</span>
            </label>
            <label className="settings__row">
              <input
                type="checkbox"
                checked={config.notifySound}
                onChange={(e) => onChange({ notifySound: e.target.checked })}
              />
              <span>通知音を鳴らす</span>
            </label>
            <div className="settings__row">
              <span className="settings__label">サウンド</span>
              <select
                className="settings__select"
                aria-label="通知音"
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

          <section className="settings__section">
            <h3 className="settings__heading">Slack / Discord への転送</h3>
            <p className="settings__note">
              タスク完了通知を Incoming Webhook にも送ります。URL は config.json
              に平文で保存されます。
            </p>
            {renderWebhook('slack', 'Slack', 'https://hooks.slack.com/services/...')}
            {renderWebhook('discord', 'Discord', 'https://discord.com/api/webhooks/...')}
          </section>

          <section className="settings__section">
            <h3 className="settings__heading">アクセシビリティ</h3>
            <p className="settings__note">
              ターミナルの内容は GPU が canvas に描くため、既定では VoiceOver
              から読めません。有効にすると読み上げ用の要素を別に出します（描画は少し重くなります）。
              VoiceOver が動いていることを検知できたときは、この設定に関わらず有効になります。
            </p>
            <label className="settings__row">
              <input
                type="checkbox"
                checked={config.screenReaderMode}
                onChange={(e) => onChange({ screenReaderMode: e.target.checked })}
              />
              <span>ターミナルの内容をスクリーンリーダーから読めるようにする</span>
            </label>
          </section>

          <section className="settings__section">
            <h3 className="settings__heading">動作</h3>
            <label className="settings__row">
              <input
                type="checkbox"
                checked={config.useTmux}
                onChange={(e) => onChange({ useTmux: e.target.checked })}
              />
              <span>tmux が使えるなら AI CLI をラップする</span>
            </label>
            <label className="settings__row">
              <input
                type="checkbox"
                checked={config.scopeAgentsToCwd}
                onChange={(e) => onChange({ scopeAgentsToCwd: e.target.checked })}
              />
              <span>タスク一覧を現在のディレクトリに絞り込む</span>
            </label>
            <label className="settings__row">
              <span className="settings__label">ポーリング間隔(ms)</span>
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
        </div>
    </div>
  );
}
