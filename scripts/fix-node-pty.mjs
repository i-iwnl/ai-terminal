// node-pty の spawn-helper に実行権限を復元する。
//
// node-pty の macOS 向け prebuild に同梱されている spawn-helper は、
// npm でインストールした際に実行権限（+x）が落ちることがある。
// この状態で PTY を起動すると、原因の分かりにくい
// 「Error: posix_spawnp failed.」で失敗する。
//
// npm install のたびに権限が落ちるため、postinstall で毎回復元する。
// macOS / Linux 以外では何もしない。

import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PREBUILDS_DIR = join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds');

if (process.platform === 'win32') {
  process.exit(0);
}

if (!existsSync(PREBUILDS_DIR)) {
  // node-pty が未インストール、またはソースからビルドされた構成。何もしない。
  process.exit(0);
}

let fixed = 0;

for (const dir of readdirSync(PREBUILDS_DIR)) {
  const helper = join(PREBUILDS_DIR, dir, 'spawn-helper');
  if (!existsSync(helper)) continue;

  const mode = statSync(helper).mode;
  // 所有者に実行権限が付いているか
  if (mode & 0o100) continue;

  try {
    chmodSync(helper, 0o755);
    fixed += 1;
    console.log(`[fix-node-pty] 実行権限を復元しました: prebuilds/${dir}/spawn-helper`);
  } catch (err) {
    console.warn(`[fix-node-pty] 実行権限の復元に失敗しました: ${helper}`, err);
  }
}

if (fixed === 0) {
  // 既に正しい状態。静かに終わる。
  process.exit(0);
}
