/**
 * E2E の隔離ハーネス。
 *
 * このアプリは実 OS に触る（PTY で本物のシェルを起動し、claude agents --json で
 * マシン上の実セッションを拾い、~/.claude/projects の実履歴を読む）。
 * 素直にテストを書くと結果が非決定的になり、さらにスクリーンショットに
 * 実プロジェクト名や実プロンプトが写り込む。
 *
 * そこで HOME と PATH を差し替えて隔離する。アプリ本体のコードは一切変更しない。
 */

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  cpSync,
  chmodSync,
  utimesSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// package.json が "type": "module" のため __dirname は使えない
const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FIXTURES_DIR = join(REPO_ROOT, 'e2e/fixtures');

/** 起動したアプリと、その隔離環境の情報 */
export interface LaunchedApp {
  app: ElectronApplication;
  window: Page;
  /** 一時 HOME の絶対パス */
  home: string;
  /** アプリの作業ディレクトリ（履歴の探索キーになる） */
  workDir: string;
}

export interface LaunchOptions {
  /** claude agents --json が失敗する状況を再現する */
  agentsFail?: boolean;
  /** claude agents --json が 0 件を返す状況を再現する */
  agentsEmpty?: boolean;
  /** gemini --list-sessions が 0 件を返す状況を再現する */
  geminiEmpty?: boolean;
  /** 偽 CLI を PATH に置かない（CLI 不在時のエラー表示を検証する） */
  withoutCli?: boolean;
  /** config.json の上書き */
  config?: Record<string, unknown>;
  /** 履歴の JSONL を配置しない（空状態の検証用） */
  withoutHistory?: boolean;
  /**
   * GPU を有効にして起動する（= xterm が WebGL レンダラになる）。
   *
   * 既定は false（`--disable-gpu`）。理由は下の electron.launch のコメントを参照。
   * ただし既定のままだと **DOM レンダラ経路しか検証されない**。実際にユーザーが使う
   * `make dev` / 本番起動は WebGL レンダラなので、描画そのものを検証するシナリオだけ
   * このオプションで GPU を有効にする。
   *
   * WebGL レンダラでは文字が canvas に描かれ DOM から読めないため、
   * テキストによる検証はできない。ピクセルを見ること（e2e/fixtures/pixels.ts）。
   */
  gpu?: boolean;
  /**
   * ウィンドウを画面に出さずに実行する（`make e2e-headless`）。
   *
   * Electron に真のヘッドレスモードは無い（BrowserWindow はネイティブウィンドウを要求する）。
   * ここでやっているのは「起動直後に BrowserWindow.hide() する」ことで、
   * ウィンドウは存在するが画面に現れない。テストを流している間に画面を占有されない。
   *
   * 実測（macOS / Electron 43）では、隠したウィンドウでも
   * requestAnimationFrame は 60fps で回り続け、WebGL レンダラの描画も
   * capturePage で取れるピクセルまで表示時と一致した。つまり **描画を見る
   * シナリオも隠したまま検証できる**。
   *
   * 既定は環境変数 AI_TERMINAL_E2E_HIDDEN を見る。spec 側は何も書かなくてよい。
   */
  hidden?: boolean;
}

/**
 * 作業ディレクトリの絶対パスを ~/.claude/projects 配下のディレクトリ名に変換する。
 * 規則は「/ を - に置換」。src/main/history/paths.ts と同じ規則を、
 * テスト側で独立に実装して突き合わせる（実装をそのまま import すると
 * 規則が壊れたときに両方が同時に壊れて検出できない）。
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replaceAll('/', '-');
}

const DEFAULT_CONFIG = {
  fontFamily: 'Menlo, monospace',
  fontSize: 13,
  pollIntervalMs: 700,
  // tmux でラップすると PTY の exit が発火しなくなり、E2E の前提が変わる。
  // 永続化の検証は E2E の対象外なので明示的に無効化する。
  useTmux: false,
  notifyOnIdle: true,
  notifySound: false,
  scopeAgentsToCwd: false,
  theme: {
    background: '#1e1e1e',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    selectionBackground: '#264f78',
  },
};

/** 正常な履歴 JSONL（title あり） */
function normalSessionJsonl(cwd: string, sessionId: string): string {
  return [
    JSON.stringify({ type: 'mode', sessionId, cwd, timestamp: '2026-07-20T10:00:00.000Z' }),
    JSON.stringify({
      type: 'user',
      sessionId,
      cwd,
      gitBranch: 'main',
      timestamp: '2026-07-20T10:00:01.000Z',
      message: { role: 'user', content: 'サイドバーのレイアウトを直したい' },
    }),
    // 実データの ai-title 行はキーが aiTitle（title ではない）。
    // 330 ファイルを走査して確認済み。ここを間違えると本物と違う形を検証してしまう。
    JSON.stringify({
      type: 'ai-title',
      sessionId,
      aiTitle: 'サイドバーのレイアウト修正',
      timestamp: '2026-07-20T10:00:02.000Z',
    }),
  ].join('\n');
}

/** title が無い履歴（ai-title 生成前のセッション。実データで約 14% 発生する） */
function untitledSessionJsonl(cwd: string, sessionId: string): string {
  return [
    JSON.stringify({ type: 'mode', sessionId, cwd, timestamp: '2026-07-21T09:00:00.000Z' }),
    JSON.stringify({
      type: 'user',
      sessionId,
      cwd,
      gitBranch: 'feat/tabs',
      timestamp: '2026-07-21T09:00:01.000Z',
      // content がリスト形式のケース（文字列の場合と両方あり得る）
      message: {
        role: 'user',
        content: [
          { type: 'thinking', thinking: '無視されるべき要素' },
          { type: 'text', text: 'タブの切り替えでフォーカスが外れる問題を調べて' },
        ],
      },
    }),
  ].join('\n');
}

/** 意図的に壊した JSONL（パース不能。縮退表示されることを検証する） */
function brokenSessionJsonl(): string {
  return ['{ this is not valid json', '<<<<<<< broken', '{"type":'].join('\n');
}

/**
 * 隔離環境を構築してアプリを起動する。
 * 各テストで呼び、必ず closeApp で後始末する。
 */
export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  // macOS の一時ディレクトリは /var 配下だが、/var は /private/var へのシンボリックリンク。
  // OS の getcwd() は正規化した /private/var/... を返すため、realpath を取らずに
  // フィクスチャを配置すると、アプリが探すパスと1文字ずれて履歴が見つからなくなる
  // （~/.claude/projects のディレクトリ名は cwd の絶対パスから機械的に作られるため）。
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'ai-terminal-e2e-')));
  const workDir = join(home, 'work', 'demo-project');
  mkdirSync(workDir, { recursive: true });

  // シェルのプロンプトを固定する。
  // 既定のままだと実マシンのユーザー名とホスト名がプロンプトに出てしまい、
  // スクリーンショットに写り込む（README に載せる画像としては不適切）。
  // カレントディレクトリ名は残す（spec がプロンプトの検出に使っている）。
  writeFileSync(join(home, '.zshrc'), "PROMPT='%1~ %# '\nRPROMPT=''\n");

  // 設定（フォント・テーマ・ポーリング間隔を固定する）
  mkdirSync(join(home, '.ai-terminal'), { recursive: true });
  writeFileSync(
    join(home, '.ai-terminal', 'config.json'),
    JSON.stringify({ ...DEFAULT_CONFIG, ...options.config }, null, 2),
  );

  // 履歴の JSONL。mtime の降順で並ぶことを検証したいので、書き込む順で差をつける
  if (!options.withoutHistory) {
    const projectDir = join(home, '.claude', 'projects', encodeProjectDir(workDir));
    mkdirSync(projectDir, { recursive: true });
    const entries: Array<[string, string]> = [
      ['11111111-1111-4111-8111-111111111111', normalSessionJsonl(workDir, '11111111-1111-4111-8111-111111111111')],
      ['22222222-2222-4222-8222-222222222222', untitledSessionJsonl(workDir, '22222222-2222-4222-8222-222222222222')],
      ['33333333-3333-4333-8333-333333333333', brokenSessionJsonl()],
    ];
    entries.forEach(([id, body], index) => {
      const file = join(projectDir, `${id}.jsonl`);
      writeFileSync(file, `${body}\n`);
      // mtime を明示的にずらす（後に書いたものほど新しい = 一覧の先頭に来る）
      const when = new Date(Date.UTC(2026, 6, 20 + index, 10, 0, 0));
      utimesSync(file, when, when);
    });
  }

  // 偽 CLI を置く bin ディレクトリ（実行権限を確実に付ける）
  const binDir = join(home, 'bin');
  mkdirSync(binDir, { recursive: true });
  if (!options.withoutCli) {
    for (const name of ['claude', 'gemini']) {
      const dest = join(binDir, name);
      cpSync(join(FIXTURES_DIR, 'bin', name), dest);
      chmodSync(dest, 0o755);
    }
  }

  // 偽 CLI が読むフィクスチャ（cwd を埋め込む必要があるので実行時に生成する）
  const runtimeFixtures = join(home, 'fixtures');
  mkdirSync(runtimeFixtures, { recursive: true });
  writeFileSync(
    join(runtimeFixtures, 'agents.json'),
    JSON.stringify(
      [
        {
          pid: 4321,
          cwd: workDir,
          kind: 'interactive',
          startedAt: Date.UTC(2026, 6, 27, 1, 0, 0),
          sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          name: 'demo-project-busy',
          status: 'busy',
        },
        {
          pid: 4322,
          cwd: '/tmp/other-project',
          kind: 'interactive',
          startedAt: Date.UTC(2026, 6, 27, 0, 30, 0),
          sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          name: 'other-project-idle',
          status: 'idle',
        },
      ],
      null,
      2,
    ),
  );
  cpSync(join(FIXTURES_DIR, 'gemini-sessions.txt'), join(runtimeFixtures, 'gemini-sessions.txt'));

  // PATH の先頭に偽 CLI を置く。最小限のシステムパスだけを残し、
  // 実行環境に入っている本物の claude / gemini を拾わないようにする。
  const path = `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`;

  const launchOptions = {
    // --disable-gpu により xterm の WebGL アドオンの初期化が失敗し、
    // アプリの try/catch が DOM レンダラへフォールバックする。
    // DOM レンダラなら文字が .xterm-rows に入るため、テキストを検証できる
    // （WebGL レンダラでは canvas に描画されるので DOM から読めない）。
    // 副次的に「WebGL が使えない環境でも動く」ことの検証も兼ねる。
    //
    // ⚠ この既定は検証の盲点を作る。DOM レンダラは文字を実 DOM のテキストノードとして
    // 描くため、xterm.css の読み込みを忘れていても表示されてしまう。実際にその不具合を
    // 全22シナリオ green のまま見逃した（`make dev` でターミナルが真っ黒になっていた）。
    // 描画そのものは options.gpu を立てた S23 がピクセルで検証している。
    //
    // --user-data-dir を分けないと、Electron の userData は HOME の差し替えを無視して
    // ~/Library/Application Support/ai-terminal を共有する。テストを並列に回したとき
    // 別テストのウィンドウ状態やキャッシュが混ざる原因になる。
    args: [
      REPO_ROOT,
      ...(options.gpu ? [] : ['--disable-gpu']),
      `--user-data-dir=${join(home, 'electron-user-data')}`,
    ],
    cwd: workDir,
    env: {
      ...process.env,
      HOME: home,
      // zsh に上で書いた .zshrc を読ませる
      ZDOTDIR: home,
      PATH: path,
      AI_TERMINAL_E2E_FIXTURES: runtimeFixtures,
      AI_TERMINAL_E2E_AGENTS_FAIL: options.agentsFail ? '1' : '',
      AI_TERMINAL_E2E_AGENTS_EMPTY: options.agentsEmpty ? '1' : '',
      AI_TERMINAL_E2E_GEMINI_EMPTY: options.geminiEmpty ? '1' : '',
      // 開発起動ではないので DevTools は開かないが、念のため明示する
      AI_TERMINAL_NO_DEVTOOLS: '1',
      // Renderer をローカルファイルから読ませる（dev server を使わない）
      ELECTRON_RENDERER_URL: '',
    },
  };

  const app = await electron.launch(launchOptions);
  try {
    // firstWindow の既定タイムアウトは 30 秒。1回のフル実行で Electron の起動が
    // spec の本数だけ走るため、マシンが混んでいるとコールドスタートがこれを超える。
    // 起動が「失敗」しているのではなく単に遅いだけなので、明示的に長めに取る。
    // ここでリトライしてはいけない（2回分の待ち時間がテスト全体の予算を食い潰し、
    // 30秒で1回失敗するより悪くなる）。再試行は playwright.config.ts の retries に委ねる。
    const window = await app.firstWindow({ timeout: 60_000 });
    await window.waitForLoadState('domcontentloaded');

    // ヘッドレス実行。アプリ本体は変更せず、テスト側からウィンドウを隠す
    // （隔離ハーネスの前提「アプリのコードには手を入れない」を崩さないため）。
    if (options.hidden ?? process.env.AI_TERMINAL_E2E_HIDDEN === '1') {
      await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) win.hide();
      });
    }

    return { app, window, home, workDir };
  } catch (err) {
    // ウィンドウが出ないまま失敗した Electron は、呼び出し側が LaunchedApp を
    // 受け取れないため誰にも close されない。ここで確実に始末する。
    await app.close().catch(() => undefined);
    rmSync(home, { recursive: true, force: true });
    throw err;
  }
}

/**
 * 起動したアプリを閉じる。
 *
 * `beforeEach` の launchApp() が失敗すると、spec 側の変数には **前のテストの
 * （既に閉じた）LaunchedApp が残ったまま** afterEach が走る。素直に close すると
 * そこで例外になり、「どのテストにも属さないエラー」として Playwright の終了コードが
 * 1 になる（テスト自体はリトライで緑になっているのに `make e2e` が失敗する）。
 *
 * 後片付けの失敗はテスト対象ではないので、ここでは握り潰す。
 */
export async function closeApp(launched: LaunchedApp | undefined): Promise<void> {
  if (!launched) return;
  try {
    await launched.app.close();
  } catch {
    // 既にプロセスが落ちている場合など。後片付けの失敗で実行結果を汚さない。
  }
  // 一時 HOME を消す。消さないと1テスト1ディレクトリで溜まり続ける
  // （実際に 864 個溜まっていた）。中身はこのファイルが決定的に生成するもので、
  // 失敗の調査には Playwright の trace / screenshot を使えばよい。
  try {
    rmSync(launched.home, { recursive: true, force: true });
  } catch {
    // 消せなくてもテスト結果には影響させない。
  }
}
