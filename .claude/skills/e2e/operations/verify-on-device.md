# 実機のアプリを agent-browser で確認する

起動中の ai-terminal に **CDP（Chrome DevTools Protocol）で接続**し、実際の画面を観測する手順。**実装を1つ終えるたびに回す**（回すタイミングの正は [/workspace-plan loop](../../workspace-plan/operations/loop.md) の「3. 検証」）。

**なぜ要るか。** E2E と撮影レーンは「ホバーしていない・注釈も無い・初期状態の DOM」しか見ない。**そこに写らない壊れ方が実際に3件あった**（Issue #119）。

| 実際に見つかったもの | なぜ自動テストで出ないか |
|---|---|
| 長いタイトルがホバー中に**省略記号も無しに断ち切られていた** | E2E も撮影もホバー状態を作らない |
| 選択中タブの下線が `docs/images/` の**どの画像でも注釈に隠れていた** | 画像は注釈で埋まっており、新しい要素は隠れる |
| **vibrancy が不透明な層2枚で最初から死んでいた** | コメントは「見えている」と具体的に書いていたが、誰も測っていなかった |

逆に、**回帰（自分が触っていない場所が壊れたこと）はここでは見つからない。** それは `make e2e` の仕事で、両者は代替関係にない。

## 準備

`agent-browser`（[vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser)）を `npx` 経由で使う。**インストールは不要**（実測: 0.27.0）。

```bash
npx agent-browser --version        # 0.27.0
npx agent-browser skills get electron   # 本家の Electron 向け手順（迷ったら原典を読む）
```

## 手順

### 1. ビルドしてから CDP 付きで起動する

**`npx electron .` が読むのは `out/` で、`src/` ではない。** ビルドせずに起動すると**前の版を観測して「直った」と結論する**（`loop.md` に同型の事故が記録されている）。

```bash
npm run build

D=<scratchpad>/appdata && mkdir -p "$D"
# ⛔ npx を通さない（下記）。Playwright の _electron.launch() と同じくバイナリを直接叩く。
AI_TERMINAL_DATA_DIR="$D" ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . \
  --remote-debugging-port=9222 > /tmp/aiterm-cdp.log 2>&1 &
sleep 8
# **ターゲットの件数まで見る。** /json/version はウィンドウが無くても返る。
curl -s http://127.0.0.1:9222/json/list | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"
```

⛔ **`npx electron .` で起動しない**（2026-08-05・Issue #170 の周で実測）。
`DevTools listening on ws://...` は出るのに **`app.whenReady()` が発火せず、CDP のターゲットが 0 件**のまま、
という状態に落ちることがある。**5回連続で再現し、`main` に戻して再ビルドしても、
`whenReady` だけの最小 Electron アプリでも同じ**だった。バイナリを直接叩けば一発で起動する。

**この症状は「アプリが壊れた」に見える。** 切り分けに時間を溶かさないために、
**ターゲットが 0 件なら、まず最小アプリで同じことが起きるかを見る**（アプリのコードを疑う前に起動経路を疑う）。

**`AI_TERMINAL_DATA_DIR` を必ず渡す**（`src/main/data-dir.ts` が最優先で読む絶対パス指定）。省くと dev / 安定版のどちらかの実データを読み書きする。#119 で「既定 260 のはずが 220」と食い違ったのは、`~/.ai-terminal-dev` に古い `config.json` が残っていたためで、**実機の値を疑う前にどちらを見ているかを疑う**羽目になった。

複数同時に立てるならポートをずらす（9223, 9224, ...）。

### 2. つないで、要素を拾う

```bash
npx agent-browser connect 9222
npx agent-browser snapshot -i        # 操作できる要素に @e1, @e2 ... の ref が振られる
```

`snapshot -i` はアクセシビリティツリーを返すので、**ロールと名前が出る**。「`tab "履歴" [ref=e6]`」のように見えるので、**a11y 名が意図どおり付いているかの確認も同時にできる**。

### 3. 操作して、測る

```bash
npx agent-browser click @e6                       # ref で操作する
npx agent-browser screenshot <path>.png
npx agent-browser mouse down / move <x> <y> / up  # ドラッグ（リサイズハンドル等）
```

**測るときは `eval` を使う。** 見た目の印象ではなく**計算後の値**を取る。

```bash
npx agent-browser eval "({ w: getComputedStyle(document.querySelector('.sidebar')).width, h: document.querySelector('.tab-bar')?.getBoundingClientRect().height })"
```

⛔ **`eval` に `return` を書かない。** 式（expression）として評価されるので `SyntaxError: Illegal return statement` になる。オブジェクトを返すときは `({...})` と括る。

セレクタが分からないときは総当たりで探す:

```bash
npx agent-browser eval "Array.from(document.querySelectorAll('body *')).filter(e=>/sidebar/i.test(e.className||'')).map(e=>e.tagName+'.'+e.className)"
```

### 4. 後片付け

```bash
lsof -ti :9222                                   # 残っていれば pid が出る
pkill -f "Electron.app/Contents/MacOS/Electron"
```

⛔ **`pkill -f "remote-debugging-port=9222"` では取り逃す**（プロセス一覧に引数が出ないことがあり、
実際に**2つ残ったまま**になった。2026-08-06 実測）。**`lsof -ti :9222` が空になるまで確認する。**

**残すと次の起動が静かに壊れる。** ポートを掴まれた側は

```
bind() failed: Address already in use (48)
Cannot start http server for devtools.
```

を吐くが、**アプリ自体は普通に起動する**。そこへ `connect` すると**古いターゲットにつながり**、
`agent-browser` は「ペインが0枚」「要素が無い」と**嘘の観測結果を返す**（2回誤読した）。
**実機で「無いはずのないもの」が無いときは、まずポートを疑う。**

## 何を見るか

**その周で変えたものを、変えた文脈で見る。** チェックリストではなく、周ごとに違う。目安:

- **状態を変えて見る** — ホバー中・フォーカス中・選択中・空・エラー。E2E が作らない状態がここに集中している
- **数える** — 幅・高さ・コントラスト比・要素数。「ずれて見える」ではなく `getComputedStyle` の値で言う
- **永続化を見る** — 変更 -> `config.json` に入ったか -> **アプリを再起動して戻るか**。3手目まで踏んで初めて確認したことになる
- **潰して見る** — ウィンドウを狭める・長い文字列を入れる。断ち切れ・はみ出しはここでしか出ない

## agent-browser でも届かないもの

**CDP は Renderer の中しか見られない。** 次は人間が操作するしかなく、手順は [../reference/limitations.md](../reference/limitations.md) にある。

| 対象 | 届かない理由 |
|---|---|
| VoiceOver の読み上げ品質（#148） | OS の支援技術そのものを動かす必要がある |
| OS 通知のクリック（#151） | 通知はアプリの外にある |
| Finder からの実ドラッグ（`dataTransfer.files`） | 実ファイル由来の `File` でないとパスが取れない |
| Dock の跳ね（`dock.bounce`） | Electron に読み戻す API が無い |
| ネイティブメニューの accelerator 二重発火 | Main 側の経路で、Renderer には現れない |
| tmux セッションの生死（#154） | プロセスの話。`tmux ls` / `ps` を別途叩く |
| **ポインタ由来の振る舞い**（`onMouseMove` / `mousedown` / ドラッグ） | **`agent-browser` のマウス操作はページに DOM イベントを1つも届けない**（下記） |
| **OS ウィンドウの移動・リサイズ** | ウィンドウを掴む手段が無い。位置や大きさの永続化は E2E（`app.evaluate` の `setBounds`）で見る |
| **OS フォーカス**（どのウィンドウが前面か） | `document.hasFocus()` が **false のまま**。`osascript` で前に出そうとしても Apple Events の権限が無い（-1743） |

### ⛔ `agent-browser` のマウス操作は DOM イベントを届けない（2回誤読した）

| 試したこと | 結果 |
|---|---|
| `mouse move` -> React の `onMouseMove` | **発火しない** |
| `mouse down` / `up` -> `document` の `mousedown`（capture・素の DOM リスナ） | **発火しない**（プローブで **0回**） |
| ⚠ しかし `:hover` は正しく付く | `document.querySelectorAll(':hover')` に対象要素が出る |
| ⚠ Playwright の `hover()` / `click()` | **発火する**（同じ CDP 経由なのに挙動が違う） |

**`:hover` が付くので「効いている」と誤読しやすい。** ポインタ由来の振る舞いを実機で確かめたいときは
`dispatchEvent(new MouseEvent(..., { bubbles: true }))` で代替する。**キーボード（`agent-browser key`）は問題なく届く。**

## 記録の作法

**worklog に表で残す。** 書式は #119 / #121 で定着したもの:

```markdown
### 実機確認（agent-browser）

| 確認したこと | 結果 |
|---|---|
| 設定にキーが無いときの既定 | 260px |
| アプリ再起動後 | 340px（永続化できている） |
```

**「確認した」だけでは次に読む人が同じ確認をやり直す。** 測った値をそのまま書く。**記録と実測がずれていたら、記録のほうを直す**（#119 で `styles.css` と `index.ts` のコメントが2つとも事実と違っていた）。

## DoD（完了条件）

- `npm run build` を通してから起動した（`out/` が今の `src/` である）
- `AI_TERMINAL_DATA_DIR` を渡して隔離した
- その周で変えたものを、**ホバー / フォーカス / 潰した状態**のうち該当するもので見た
- 測った値を `worklog.md` に表で書いた
- `pkill` でアプリを落とした
