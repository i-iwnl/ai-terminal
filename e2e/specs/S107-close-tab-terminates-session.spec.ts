import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchApp, closeApp, setAgentEntries, type LaunchedApp } from '../fixtures/harness';
import {
  livePanesFile,
  readKilledTmuxSessions,
  waitForNewTmuxSessionName,
} from '../fixtures/tmuxLivePanes';

let launched: LaunchedApp;

test.afterEach(async () => {
  await closeApp(launched);
});

/**
 * #244 周1-2。**「タブを閉じる」= AI を終了する。**
 *
 * 直す前は、閉じても死ぬのは tmux **クライアント**だけで、サーバ側のセッションと
 * 内側の `claude` / `gemini` は生き残っていた（`pty-pitfalls.md` の 2026-08-03 実測）。
 * アプリ側に終了させる手段が1つも無かったため、**閉じるたびに1本ずつ累積した**
 * （実機で7本が1〜2日前から入力待ちのまま生存していた）。
 *
 * ⭐ **この spec が見ているのは2つ。**
 *
 * 1. アプリが `tmux kill-session` を**実際に叩いた**こと（偽 tmux が受けた名前を記録する）
 * 2. その結果、そのセッションが**「タブに戻せる」対象から消えた**こと
 *
 * 1 だけだと「叩いてはいるが名前が違う」を見逃し、2 だけだと「一覧の描画側で
 * 隠しているだけ」を見逃す。**両方を見る。**
 *
 * ⭐ **否定側を同じ spec で見る。** 閉じる前に「まだ1本も kill していない」ことと
 * 「その行が押せる」ことを先に assert する。これが無いと、**もともと押せなかった行**を
 * 見て「終了したから押せなくなった」と誤読できる。
 *
 * ⭐⭐ **`pty.kill` の呼び出し箇所は2つあり、両方を踏む。**
 *
 * | 経路 | 呼ぶ関数 | 踏み方 |
 * |---|---|---|
 * | タブごと（木の全 leaf） | `useTabs.closeTab()` | 1枚だけのタブで `Cmd+W` |
 * | ペイン1枚（分割中） | `useTabs.closeActivePane()` | 2枚に分割してから `Cmd+W` |
 *
 * ⛔ **`Cmd+Option+W` とタブバーの x を足しても意味が無い。** どちらも
 * `requestCloseTab` -> `closeTab` に合流するので、上の表の1行目と**同じ関数**を
 * もう一度踏むだけ（2026-08-09 に `App.tsx` / `useTabs.ts` を読んで確認した）。
 * 無検査なのは `closeActivePane` のほうで、**tmux ペインでこの経路を踏む spec は
 * S90 を含めてリポジトリに1本も無かった**。
 *
 * ⚠ **偽 tmux での「セッションの生存」は `tmux-live-panes.txt` が唯一の正**
 * （シムは exec するだけでセッションの実体を持たない。`e2e/fixtures/bin/tmux` 冒頭）。
 * したがってここで見ているのは「アプリが tmux に終了を要求し、tmux 側の一覧から
 * 消えたときに画面が追従する」まで。**本物の tmux で実際にプロセスが死ぬかは実機確認**。
 */
test('S107 タブでもペインでも、閉じると tmux セッションごと終了する', async () => {
  launched = await launchApp({ config: { useTmux: true }, fakeTmux: true });
  const { window, fixturesDir } = launched;

  const livePanesPath = join(fixturesDir, 'tmux-live-panes.txt');
  const readKilled = (): string => readKilledTmuxSessions(fixturesDir);
  const readLivePanes = (): string =>
    existsSync(livePanesPath) ? readFileSync(livePanesPath, 'utf8') : '';

  // 最初のシェルのプロンプトが出るまで待ってから操作する（S104 と同じ理由）。
  await expect(window.locator('.terminal-pane__container .xterm-screen').first()).toContainText(
    /[$%#>]/,
    { timeout: 20_000 },
  );

  // --- 1. claude タブを開き、アプリが採番した tmux セッション名を知る ------------
  await window.keyboard.press('Meta+Shift+C');
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(1, { timeout: 15_000 });

  // 画面ではなくファイルから読む（偽 CLI は生の UUID を画面に出さない）。
  const sessionName = await waitForNewTmuxSessionName(fixturesDir, '');
  const sessionId = sessionName.slice('aiterm-'.length);

  // tmux 側に「そのセッションが生きている」状態を作る。
  // ⛔ 行を手で組み立てないこと（組み立ての正は `e2e/fixtures/tmuxLivePanes.ts`）。
  writeFileSync(
    livePanesPath,
    livePanesFile([
      { sessionName, startCommand: `claude --session-id ${sessionId}`, cwd: launched.workDir },
    ]),
  );

  // そのセッションが `claude agents --json` にも出ている状態にする。
  setAgentEntries(launched, [
    {
      pid: 4321,
      cwd: launched.workDir,
      kind: 'interactive',
      startedAt: Date.now() - 60_000,
      sessionId,
      name: 'terminated-on-close',
      status: 'idle',
    },
  ]);

  const row = window.locator('.task-item', { hasText: 'terminated-on-close' });
  await expect(row).toHaveCount(1, { timeout: 20_000 });

  // --- 2. 否定側: 閉じる前は「まだ何も終了させていない」「その行は押せる」 --------
  expect(readKilled(), 'タブを開いただけで kill-session が呼ばれている').not.toContain(sessionName);
  expect(readLivePanes(), 'tmux 側の一覧に載っていない（前提が崩れている）').toContain(sessionName);
  await expect(row.locator('button.task-item__row')).toHaveCount(1, { timeout: 20_000 });

  // --- 3. タブを閉じる ---------------------------------------------------------
  await window.keyboard.press('Meta+w');
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(0, { timeout: 15_000 });

  // --- 4. tmux セッションごと終了している --------------------------------------
  // (a) アプリが実際に kill-session を叩いた（叩いた名前まで一致する）。
  await expect
    .poll(readKilled, { timeout: 15_000, message: 'アプリが tmux kill-session を叩いていない' })
    .toContain(sessionName);

  // (b) その結果、tmux 側の一覧から消えた。
  expect(readLivePanes(), 'kill-session を叩いたのに一覧から消えていない').not.toContain(
    sessionName,
  );

  // (c) 画面が追従し、「タブに戻せる」対象ではなくなった。
  //     行そのものは `claude agents --json` に残っている間は出続ける（CLI が言ったことは隠さない）。
  await expect(row.locator('button.task-item__row')).toHaveCount(0, { timeout: 20_000 });
  await expect(row.locator('.task-item__row')).toHaveCount(1);

  // --- 5. もう1つの経路: 分割中のペイン1枚を閉じる（closeActivePane） -----------
  //
  // ここまでで踏んだのは `closeTab`（木の全 leaf）だけ。**ペイン1枚を閉じる経路は
  // 別の関数で、別の `pty.kill` 呼び出し箇所**（冒頭の表）。片方だけ直した実装が
  // 緑になるのを防ぐため、同じ spec で両方を踏む。
  await window.keyboard.press('Meta+Shift+C');
  await expect(window.locator('.tab-bar__tab--claude')).toHaveCount(1, { timeout: 15_000 });

  const secondName = await waitForNewTmuxSessionName(fixturesDir, sessionName);
  writeFileSync(
    livePanesPath,
    livePanesFile([
      {
        sessionName: secondName,
        startCommand: `claude --session-id ${secondName.slice('aiterm-'.length)}`,
        cwd: launched.workDir,
      },
    ]),
  );

  // 右に分割する。新しいペインはシェルで、分割直後はそちらがアクティブになる。
  await window.keyboard.press('Meta+d');
  const activeTab = window.locator('.tab-bar__tab').last();
  await expect(activeTab.locator('.tab-bar__close')).toHaveAttribute(
    'aria-label',
    'タブを閉じる（2 ペイン）',
    { timeout: 15_000 },
  );

  // claude のペインへ戻る（Cmd+Option+← = move-pane-focus left）。
  await window.keyboard.press('Meta+Alt+ArrowLeft');

  // 否定側: この時点ではまだ2本目を終了させていない。
  expect(readKilled(), '分割しただけで2本目が終了させられている').not.toContain(secondName);

  // `Cmd+W` = ペインを閉じる。2枚あるので closeActivePane を通る。
  await window.keyboard.press('Meta+w');

  // タブは残り、ペインが1枚に戻る（= タブごと閉じたのではない）。
  await expect(activeTab.locator('.tab-bar__close')).toHaveAttribute('aria-label', 'タブを閉じる', {
    timeout: 15_000,
  });

  // それでも tmux セッションは終了している。
  await expect
    .poll(readKilled, {
      timeout: 15_000,
      message: 'ペイン1枚を閉じる経路が tmux kill-session を叩いていない',
    })
    .toContain(secondName);
  expect(readLivePanes(), 'ペインを閉じたのに一覧から消えていない').not.toContain(secondName);
});
