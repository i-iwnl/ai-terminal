# ============================================================================
# ai-terminal - ビルド/CI 検証用 Dockerfile
#
# 用途:
#   - typecheck / lint / build をローカル環境に依存せず再現可能に回すための
#     コンテナ。GitHub Actions (.github/workflows/ci.yml) とは役割が違い、
#     こちらは「ローカルで CI と同じ手順を再現する」ためのもの。
#
# 重要な注意:
#   - このアプリは Electron の GUI アプリだが、GUI をこのコンテナの中で
#     起動することは想定していない（X11/VNC 転送は日本語 IME とフォントが
#     壊れるため設計から除外している）。アプリ本体の起動は常にホスト
#     （macOS）側で `npm run dev` を使うこと。
#   - node-pty はネイティブモジュール。macOS 向けの prebuild は
#     node_modules/node-pty/prebuilds に同梱されているが、Linux 向け
#     (linux-x64) の prebuild は同梱されていないため、このコンテナでは
#     node-gyp によるソースビルドが走る。そのため python3 / make / g++ を
#     ビルドツールとして導入している。
# ============================================================================

FROM node:22-bookworm-slim

# node-pty のネイティブビルド（node-gyp）に必要な最小限のツールチェーン。
# node:22-bookworm-slim には含まれていないため明示的に入れる。
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 \
       make \
       g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# レイヤキャッシュを効かせるため、依存関係の定義ファイルだけ先に COPY する。
# ソースコードだけを変更した場合は npm ci の層が再利用される。
COPY package.json package-lock.json ./

# CI ではアプリを起動しない（typecheck / lint / build のみ）ため、
# electron 本体（100MB 超）のダウンロードをスキップする。
# electron-vite build 自体は electron バイナリを必要としないことを確認済み。
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

RUN npm ci

# 依存関係のインストール後にソースコードを COPY する。
COPY . .

# デフォルトでは typecheck -> lint -> build を順に実行する。
# 個別に実行したい場合は `docker run <image> npm run lint` のように上書きする。
CMD ["sh", "-c", "npm run typecheck && npm run lint && npm run build"]
