// 設定ウィンドウのルート。
//
// 本体ウィンドウとは別の BrowserWindow で、同じバンドルを `#settings` 付きで
// 読み込んで描画する（ビルドの入力を増やさないため）。
//
// 設定の唯一の正は Main 側の config.json。ここは読み込んで編集フォームへ渡し、
// 変更を config:set へ流すだけに徹する。

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { AppConfig } from '@shared/ipc';
import { DEFAULT_CONFIG } from '@shared/defaults';
import SettingsPanel from './SettingsPanel';

export default function SettingsWindow(): ReactElement {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [accessibilitySupport, setAccessibilitySupport] = useState(false);

  useEffect(() => {
    window.api.config
      .get()
      .then(setConfig)
      .catch((err: unknown) => {
        console.warn('[settings] 設定の取得に失敗しました。既定値を表示します。', err);
      });
  }, []);

  // 支援技術の起動状態（Issue #149）。**Main と話すのはこの層の仕事**で、
  // SettingsPanel は編集フォームに徹する（このファイルの冒頭の分担）。
  // 取得に失敗しても false のまま続行する（App.tsx と同じ形）。
  useEffect(() => {
    window.api.app
      .accessibilitySupport()
      .then(setAccessibilitySupport)
      .catch((err: unknown) => {
        console.warn('[settings] 支援技術の状態を取得できませんでした。', err);
      });
    return window.api.app.onAccessibilitySupportChanged(setAccessibilitySupport);
  }, []);

  const changeConfig = useCallback((patch: Partial<AppConfig>) => {
    window.api.config
      .set(patch)
      .then((next) => {
        setConfig(next);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(`設定の保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, []);

  const close = useCallback(() => {
    window.api.settings.close();
  }, []);

  return (
    <>
      {error && (
        <div className="settings__error" role="alert">
          {error}
        </div>
      )}
      <SettingsPanel
        config={config}
        accessibilitySupport={accessibilitySupport}
        onChange={changeConfig}
        onClose={close}
      />
    </>
  );
}
