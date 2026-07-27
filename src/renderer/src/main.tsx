import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
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

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
