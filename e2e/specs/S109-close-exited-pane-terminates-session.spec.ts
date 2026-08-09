import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, type LaunchedApp } from '../fixtures/harness';
import { livePanesFile } from '../fixtures/tmuxLivePanes';

let launched: LaunchedApp;

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * #244 周2。**PTY が先に終了していても、閉じたときに tmux セッションを終了させる。**
 *
 * ⭐ **これは実装の最初の版が踏んでいた穴**（code-review 2026-08-09 で指摘）。
 * `ptyKill` のハンドラは元々 `const entry = entries.get(ptyId); if (!entry) return;` で
 * 始まっており、**tmux セッションの終了をその後ろに置いていた**。
 *
 * PTY と tmux セッションは**寿命が違う**:
 *
 * | 起きること | PTY（tmux クライアント） | tmux セッション |
 * |---|---|---|
 * | 内側の CLI が自分で終了した | 死ぬ | 死ぬ |
 * | **利用者がペインの中で `Ctrl-b d` を押した** | **死ぬ** | **生き残る** |
 *
 * 2行目の状態でタブを閉じると、`entries.get()` が `undefined` を返して早期 return し、
 * **セッションが永久に残る** = この Issue が直そうとしている累積そのものが再発する。
 * しかも画面上は「終了したペインを閉じた」だけに見えるので、**誰も気づけない**。
 *
 * ⚠ **偽 tmux は `Ctrl-b d` を再現しない**（シムは exec するだけ）。ここでは
 * **内側の偽 claude を `exit` で終わらせて PTY だけを死なせ、`tmux-live-panes.txt` は
 * 生きたままにする**ことで、Main から見て同じ状態（entry は無い / セッション名は
 * 分かっている）を作る。**アプリが通るコードの分岐は実機とまったく同じ。**
 */
test('S109 PTY が先に終了していても、閉じれば tmux セッションを終了させる', async () => {
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
  const { window, fixturesDir } = launched;

  const killedSessionsPath = join(fixturesDir, 'tmux-killed-sessions.txt');
  const livePanesPath = join(fixturesDir, 'tmux-live-panes.txt');
  const sessionNamePath = join(fixturesDir, 'tmux-session-name.txt');
  const readKilled = (): string =>
    existsSync(killedSessionsPath) ? readFileSync(killedSessionsPath, 'utf8') : '';

  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  // --- 1. tmux でラップされた claude タブを開く --------------------------------
  await window.keyboard.press('Meta+Shift+C');
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(1, { timeout: 15_000 });
  await expect(
    window.locator('.terminal-pane__container .xterm-screen').last(),
  ).toContainText('FAKE CLAUDE READY', { timeout: 20_000 });

  await expect
    .poll(() => (existsSync(sessionNamePath) ? readFileSync(sessionNamePath, 'utf8').trim() : ''), {
      timeout: 15_000,
      message: '偽 tmux がセッション名を書いていない',
    })
    .toMatch(/^aiterm-[0-9a-f-]{36}$/i);
  const sessionName = readFileSync(sessionNamePath, 'utf8').trim();

  // tmux 側は「セッションが生きている」ままにしておく（`Ctrl-b d` 後の状態）。
  writeFileSync(
    livePanesPath,
    livePanesFile([
      {
        sessionName,
        startCommand: `claude --session-id ${sessionName.slice('aiterm-'.length)}`,
        cwd: launched.workDir,
      },
    ]),
  );

  // --- 2. 内側の CLI だけを終わらせる（PTY が死に、entry が破棄される） ---------
  await window.keyboard.type('exit');
  await window.keyboard.press('Enter');
  await expect(window.locator('.tab-bar__tab--claude.is-exited')).toHaveCount(1, {
    timeout: 20_000,
  });

  // 否定側: この時点ではまだ kill-session を叩いていない
  // （PTY の終了は利用者の「閉じる」ではないので、ここで終了させてはいけない）。
  expect(readKilled(), 'PTY が終了しただけで kill-session が呼ばれている').not.toContain(
    sessionName,
  );

  // --- 3. 終了したタブを閉じる -------------------------------------------------
  await window.keyboard.press('Meta+w');
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(0, { timeout: 15_000 });

  // --- 4. entry が無くても tmux セッションは終了している ------------------------
  await expect
    .poll(readKilled, {
      timeout: 15_000,
      message:
        'PTY が先に終了していると tmux セッションが残る（ptyKill の早期 return が原因。累積が再発する）',
    })
    .toContain(sessionName);
});
