import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import SettingsWindow from './settings/SettingsWindow';
// xterm.js 本体のスタイル。これを読み込まないと WebGL レンダラの canvas が
// 配置されず、ターミナルが真っ黒のまま何も描画されない。
// DOM レンダラでは文字が実 DOM のテキストノードなので、読み込み忘れても表示だけは
// 出てしまう（= --disable-gpu で走る E2E では検出できない）。styles.css より先に
// 読み込み、アプリ側の指定が後勝ちになるようにする。
import '@xterm/xterm/css/xterm.css';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('root 要素が見つかりません');
}

// 設定は独立したウィンドウだが、ビルドの入力（HTML）を増やさないよう
// 同じバンドルを `#settings` 付きで読み込んで描画を切り替える。
const isSettingsWindow = window.location.hash === '#settings';

createRoot(container).render(
  <StrictMode>{isSettingsWindow ? <SettingsWindow /> : <App />}</StrictMode>,
);
