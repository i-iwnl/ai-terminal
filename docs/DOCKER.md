# Docker 環境について

**前提: GUI（Electron 本体）はコンテナの中では動かさない。** アプリ本体の起動・動作確認は常にホスト（macOS）側で `npm run dev` を使うこと。

理由: このアプリは Electron の GUI アプリであり、コンテナ内から画面を X11/VNC などで転送すると日本語 IME とフォント描画が壊れる。ここで扱う Docker / devcontainer 環境は、あくまで「typecheck・lint・build を再現可能に回す」「開発環境の依存バージョンを固定する」ためのものであり、アプリの起動対象ではない。

このリポジトリには目的の異なる Docker 関連環境が複数あるので、それぞれの役割を整理する。

## 1. ビルド/CI 検証用（`Dockerfile` / `docker-compose.yml`）

**用途**: ローカルで、CI と同じ手順（typecheck / lint / build）を Linux コンテナ上で再現するため。「自分の Mac ではビルド/lint が通るが CI では通らない」というズレを事前に検出する。

**使い方**:

```bash
# typecheck -> lint -> build をまとめて実行
docker compose run --rm verify

# 個別に実行したい場合
docker compose run --rm verify npm run lint
```

`docker-compose.yml` はカレントディレクトリ（ソースコード）をコンテナにバインドマウントする一方、`node_modules` だけは named volume で隔離している（後述の落とし穴を参照）。`package.json` の依存関係を変更したときは、イメージの再ビルドが必要になる。

```bash
docker compose build verify
```

単体で Docker イメージだけをビルドしたい場合:

```bash
docker build -t ai-terminal-verify .
```

## 2. GitHub Actions（`.github/workflows/ci.yml`）

**用途**: push / pull_request のたびに typecheck / lint / build を自動実行する。

**構成上の判断**: Docker イメージ経由ではなく、素の `ubuntu-latest` ランナー上で Node.js 22 をセットアップして直接実行している。Docker イメージのビルド分だけ余計に時間がかかるため、CI の速度を優先した。ローカルでの再現性が欲しいときは、上記の `Dockerfile` / `docker-compose.yml` を使う、という役割分担にしている。

CI ではアプリ本体を起動しないため、`ELECTRON_SKIP_BINARY_DOWNLOAD=1` を設定して Electron バイナリ（100MB 超）のダウンロードをスキップしている（`electron-vite build` がこの状態でも問題なく動作することを確認済み）。

## 3. devcontainer（`.devcontainer/devcontainer.json`）

**用途**: VS Code などの devcontainer 対応エディタで開く、日常の開発環境。Node.js / TypeScript の開発に必要な最低限の構成のみを入れている（拡張機能は ESLint とフォーマッタのみ）。

ルート直下の `Dockerfile`（ビルド/CI 検証用）をそのまま再利用している。CI 検証用イメージと devcontainer で必要なツールチェーン（Node のバージョン、node-pty のネイティブビルドに必要な python3 / make / g++）が全く同じであるため、ファイルを分けると二重管理になり、どちらかだけバージョンを上げ忘れて環境がズレるリスクがあるという判断による。

コンテナ起動後、`postCreateCommand` で `npm ci` が自動的に走る。

**繰り返しになるが、devcontainer の中で Electron の GUI を起動することはできない。** typecheck / lint / build の実行と、エディタの補完・型チェックのためだけに使うこと。

## よくある落とし穴

### node_modules をホストと共有すると壊れる

`node-pty` はネイティブモジュール。macOS 上では bundled prebuild（`darwin-arm64` / `darwin-x64`）がそのまま使われるが、Linux コンテナ向けの prebuild は同梱されていないため、コンテナ内では `node-gyp` によるソースビルドが走る（実機で確認済み: `node_modules/node-pty/build/Release/pty.node` が生成される）。

そのため、**ホストの `node_modules` をコンテナにそのままマウントしてはいけない。** macOS 向けにビルド/取得されたネイティブバイナリと、Linux 向けにビルドされたバイナリが混在すると、`require` 時にクラッシュする。

`docker-compose.yml` ではソースコードはバインドマウントしつつ、`node_modules` だけは named volume（`node_modules:/app/node_modules`）で隔離している。devcontainer 側でも同様に `mounts` で named volume に差し替えている。**この設定を外して `node_modules` をホストと共有する構成に変更しないこと。**

### Electron バイナリのダウンロード

`npm install` は既定で Electron 本体（100MB 超）をダウンロードしようとする。CI / ビルド検証コンテナではアプリを起動しないため不要であり、`ELECTRON_SKIP_BINARY_DOWNLOAD=1` を設定してスキップしている。この状態でも `electron-vite build`（typecheck・lint も含む）が問題なく通ることを実機で確認済み。

もし将来 Electron 本体を使う検証（例: `electron-builder` でのパッケージング検証）をコンテナで行いたくなった場合は、この環境変数を外す必要がある点に注意する。

### イメージのベース

`node:22-bookworm-slim` を使っている（`node:22-bookworm` ではなく slim 版）。slim には `python3` / `make` / `g++` が含まれていないため、`node-pty` の `node-gyp` ビルド用に `apt-get install` で追加している。この最小限のツールチェーンで typecheck / lint / build が問題なく通ることを確認済みなので、通常版（非 slim）に変更する必要はない。

## サンドボックス用 Docker について

AI エージェントを隔離実行するためのサンドボックス用 Docker 環境（`Dockerfile.sandbox` / `scripts/sandbox.sh`）については、別途 `docs/SANDBOX.md` を参照。
