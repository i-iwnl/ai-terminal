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

// アプリの既定値をそのまま使う。**e2e は tsconfig の @shared エイリアスの
// 対象外なので相対パスで読む**（エイリアスにすると Playwright の変換で解決できない）。
import { DEFAULT_THEME } from '../../src/shared/defaults';

// package.json が "type": "module" のため __dirname は使えない
const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const FIXTURES_DIR = join(REPO_ROOT, 'e2e/fixtures');

/** app.close() の完了を待つ上限。これを過ぎたら SIGKILL に切り替える。 */
const CLOSE_GRACE_MS = 5_000;

/**
 * Electron を、決まった時間で必ず終わる形で終了させる。
 *
 * ウィンドウを出さないまま固まった Electron に app.close() を投げると、実測で
 * 10 秒近く戻ってこない。後始末がテストの制限時間に食い込むと、リトライで
 * 緑になったあとでも Playwright が「どのテストにも属さないエラー」
 * （Worker teardown timeout）を出し、`make e2e` の終了コードが 1 になる。
 *
 * 後始末はテスト対象ではないので、待つのをやめて確実に殺す方を選ぶ。
 */
async function forceClose(app: ElectronApplication): Promise<void> {
  const graceful = app.close().catch(() => undefined);
  await Promise.race([
    graceful,
    new Promise<void>((r) => setTimeout(r, CLOSE_GRACE_MS).unref?.()),
  ]);
  // close() が間に合っていれば、この kill は既に終了したプロセスへの空振りになる。
  try {
    app.process().kill('SIGKILL');
  } catch {
    // 既に居ない場合など。後始末の失敗で実行結果を汚さない。
  }
}

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
  /**
   * 偽 CLI を起動時の PATH に置かず、一時 HOME の .zshrc からのみ PATH に足す。
   *
   * Finder / Dock から起動したパッケージ版は launchd の最小 PATH しか継承せず、
   * アプリは起動時にログインシェル（$SHELL -i -l）から PATH を取得して補完する
   * （src/main/shell-path.ts）。その解決が端から端まで機能していないと
   * CLI が見つからない、という本番の条件を再現する（Issue #40 の再発防止）。
   */
  cliOnlyViaLoginShell?: boolean;
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
   * ウィンドウを画面に出さずに実行するか。**既定は true（出さない）。**
   *
   * 表示したまま走らせると、テスト中のキー入力とマウス操作を Electron の
   * ウィンドウが奪う。ローカルで E2E を回している間、他の作業ができなくなるため
   * 既定を非表示にしてある。
   *
   * Electron に真のヘッドレスモードは無い（BrowserWindow はネイティブウィンドウを
   * 要求する）。ここでやっているのは「起動直後に BrowserWindow.hide() する」ことで、
   * ウィンドウは存在するが画面に現れない。
   *
   * 実測（macOS / Electron 43）では、隠したウィンドウでも requestAnimationFrame は
   * 60fps で回り続け、WebGL レンダラの描画も capturePage で取れるピクセルまで
   * 表示時と一致した。README 用の撮影（page.screenshot）も表示時と同じ画像になる。
   * つまり **描画を見るシナリオも撮影も、隠したまま成立する**。
   *
   * ⚠ ただしそれは「一度も show() していない」場合に限る。**一度表示してから
   * hide() したウィンドウでは page.screenshot() が 30 秒でタイムアウトする**
   * （実測）。Chromium は表示済みのウィンドウが隠れると occluded 扱いにして
   * 合成を止めるためと思われる。show() を最初から無効化しているのはこのため。
   *
   * 省略時は環境変数 AI_TERMINAL_E2E_SHOW を見る（`=1` なら表示する）。
   * spec 側は通常なにも書かなくてよい。
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

/**
 * E2E で書き込む config.json の中身。
 *
 * **theme はアプリの既定値をそのまま使う（自前で書かない）。**
 * ここに色を手で書いていたせいで、`src/shared/defaults.ts` の既定色を変えても
 * E2E とスクリーンショットには届かない状態になっていた。
 * ターミナルの背景は CSS の面と一致していなければならない（Issue #20 の A-2）ので、
 * 片方だけ動くと、撮影した画像すべてに 4px の帯が写る。
 *
 * theme 以外は「速く・決定的に」するための E2E 固有の値なので、ここで指定する。
 */
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
  theme: DEFAULT_THEME,
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
  //
  // cliOnlyViaLoginShell のときは、偽 CLI のディレクトリをこの .zshrc でだけ
  // PATH に足す（起動時の PATH には入れない）。アプリの shell-path.ts が
  // ログインシェル経由で PATH を解決できて初めて CLI が見つかる状態を作る。
  const binDir = join(home, 'bin');
  const zshrcLines = ["PROMPT='%1~ %# '", "RPROMPT=''"];
  if (options.cliOnlyViaLoginShell) {
    zshrcLines.push(`export PATH="${binDir}:$PATH"`);
  }
  writeFileSync(join(home, '.zshrc'), `${zshrcLines.join('\n')}\n`);

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
  // cliOnlyViaLoginShell のときは偽 CLI を PATH に置かず、launchd 起動と同じ
  // 「最小 PATH + ログインシェル経由でのみ CLI に到達できる」状態にする。
  const path = options.cliOnlyViaLoginShell
    ? '/usr/bin:/bin:/usr/sbin:/sbin'
    : `${binDir}:/usr/bin:/bin:/usr/sbin:/sbin`;

  // パッケージ版スモーク（e2e/packaged.playwright.config.ts）では、node_modules の
  // electron で out/ を起動する代わりに、dist/ の本物の .app バイナリを起動する。
  // asar・app.isPackaged: true・本番の preload 読み込みまで本物になる。
  // 隔離（一時 HOME / PATH / AI_TERMINAL_DATA_DIR / --user-data-dir）は同一。
  const packagedBinary = process.env.AI_TERMINAL_E2E_PACKAGED_APP;

  const launchOptions = {
    ...(packagedBinary ? { executablePath: packagedBinary } : {}),
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
      // パッケージ版はバイナリ自身がアプリを含むので、エントリポイントの指定は不要
      ...(packagedBinary ? [] : [REPO_ROOT]),
      ...(options.gpu ? [] : ['--disable-gpu']),
      `--user-data-dir=${join(home, 'electron-user-data')}`,
    ],
    cwd: workDir,
    env: {
      ...process.env,
      HOME: home,
      // zsh に上で書いた .zshrc を読ませる
      ZDOTDIR: home,
      // ハーネスは .zshrc + ZDOTDIR で zsh を前提にしているので、シェルも固定する。
      // 開発機の $SHELL が zsh 以外でも、PTY のシェルタブと shell-path.ts の
      // ログインシェル解決が同じ前提で動く。
      SHELL: '/bin/zsh',
      PATH: path,
      AI_TERMINAL_E2E_FIXTURES: runtimeFixtures,
      // E2E は out/ を electron バイナリで起動するため isPackaged が false になり、
      // アプリの既定では保存先が ~/.ai-terminal-dev に化ける（dev/安定版の分離）。
      // 上で敷いた config.json 等のフィクスチャを読ませるため、絶対パスで固定する。
      AI_TERMINAL_DATA_DIR: join(home, '.ai-terminal'),
      // 偽 CLI が JSON を加工するために使う node の絶対パス。
      // PATH には最小限のシステムパスしか残していないので node は載っていない。
      // PATH に足すのではなく明示的に渡すことで、隔離（本物の claude / gemini を
      // 拾わない）を崩さずに済ませる。
      AI_TERMINAL_E2E_NODE: process.execPath,
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

  // ウィンドウを一度も画面に出さない（既定）。
  //
  // アプリは `show: false` で BrowserWindow を作り、'ready-to-show' で show() を
  // 呼ぶ。**起動してから隠すのでは間に合わない**（一瞬ウィンドウが現れてフォーカスを
  // 奪い、テストの本数だけそれが繰り返される）。そこで show() 自体を無効化する。
  //
  // BrowserWindow.prototype を書き換えるので、この時点でまだ作られていない
  // ウィンドウにも効く。electron.launch() は Main プロセスに接続した直後に返り、
  // app.whenReady() より先に評価できるとは限らないため、
  // 既に作られてしまったウィンドウは hide() で取り消す（保険）。
  const hidden = options.hidden ?? process.env.AI_TERMINAL_E2E_SHOW !== '1';
  if (hidden) {
    await app.evaluate(({ app: electronApp, BrowserWindow }) => {
      const proto = BrowserWindow.prototype;
      // show / showInactive / focus / moveTop はいずれもウィンドウを前面に出す。
      // 無効化しても webContents は生きているので、DOM 操作・CDP 入力・
      // capturePage は従来どおり動く。
      proto.show = function noop() {};
      proto.showInactive = function noop() {};
      proto.focus = function noop() {};
      proto.moveTop = function noop() {};
      for (const win of BrowserWindow.getAllWindows()) win.hide();

      // macOS では、ウィンドウを出さなくてもアプリの起動そのものが
      // アプリケーションをアクティブにし、編集中のエディタからキーボード
      // フォーカスを奪う。Dock アイコンを消すとアクセサリ扱いになり、
      // アクティブ化も Cmd+Tab への出現もしなくなる。
      electronApp.dock?.hide();
    });
  }

  try {
    // 以前は 60 秒だった（ウィンドウを表示していた頃、マシンが混んでいると
    // コールドスタートが既定の 30 秒を超えたため）。非表示化のあと実測し直した。
    //
    // フル実行3回・99起動で計測した firstWindow の所要時間は
    // 最小 101ms / 中央 119ms / **最大 421ms**。分布は二極で、成功する起動は
    // 必ず 0.5 秒以内に返り、**失敗する起動は 60 秒待ってもウィンドウが出ない**
    // （99回中2回。待ち時間を伸ばしても救えない種類の失敗）。
    // 実測最大の約35倍に当たる 15 秒を上限とする。ここを長くしても、
    // 失敗した起動の判明が遅れるだけで成功率は上がらない。
    //
    // この値は失敗時の後始末（最大 CLOSE_GRACE_MS）と合わせて
    // playwright.config.ts の timeout に収まっていること。収まらないと、
    // リトライで緑になってもテスト全体が異常終了する。
    //
    // ここでリトライしてはいけない（2回分の待ち時間がテスト全体の予算を食い潰す）。
    // 再試行は playwright.config.ts の retries に委ねる。
    const window = await app.firstWindow({ timeout: 15_000 });
    await window.waitForLoadState('domcontentloaded');
    return { app, window, home, workDir };
  } catch (err) {
    // ウィンドウが出ないまま失敗した Electron は、呼び出し側が LaunchedApp を
    // 受け取れないため誰にも close されない。ここで確実に始末する。
    await forceClose(app);
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
  await forceClose(launched.app);
  // 一時 HOME を消す。消さないと1テスト1ディレクトリで溜まり続ける
  // （実際に 864 個溜まっていた）。中身はこのファイルが決定的に生成するもので、
  // 失敗の調査には Playwright の trace / screenshot を使えばよい。
  try {
    rmSync(launched.home, { recursive: true, force: true });
  } catch {
    // 消せなくてもテスト結果には影響させない。
  }
}

/**
 * 設定ウィンドウを開いて、その Page を返す。
 *
 * 設定は本体とは別の BrowserWindow（Issue #25 でモーダルから独立ウィンドウへ変えた）。
 * `app.windows()` には本体も含まれるので、**本体以外**を探す。
 * 既に開いていればそれを返し、無ければ `trigger` を実行して現れるのを待つ。
 */
export async function openSettingsWindow(
  launched: LaunchedApp,
  trigger: () => Promise<void>,
): Promise<Page> {
  const existing = launched.app.windows().find((page) => page !== launched.window);
  if (existing) return existing;

  const appeared = launched.app.waitForEvent('window', { timeout: 15_000 });
  await trigger();
  const settings = await appeared;
  await settings.waitForLoadState('domcontentloaded');
  // 描画されるまで待つ（中身が空のまま assert して落ちるのを防ぐ）
  await settings.locator('.settings--window').waitFor({ state: 'visible', timeout: 15_000 });
  return settings;
}
