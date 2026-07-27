# ai-terminal
#
# よく使うコマンドの入口。詳しい説明は README.md を参照。
# アプリ本体の起動は必ずホスト（macOS）で行う。GUI を Docker では動かさない。

.DEFAULT_GOAL := help
.PHONY: help install dev build check typecheck lint format rebuild fix-electron \
        docker-verify docker-build sandbox sandbox-build clean clean-docker

# ---------------------------------------------------------------------------
# ヘルプ
# ---------------------------------------------------------------------------

## このヘルプを表示する
help:
	@echo "ai-terminal"
	@echo ""
	@echo "使い方: make <ターゲット>"
	@echo ""
	@grep -E '^## |^[a-zA-Z0-9_-]+:' $(MAKEFILE_LIST) \
		| sed 's/^## /  DESC:/' \
		| awk 'BEGIN{FS=":"} \
			/^  DESC:/{desc=substr($$0,8); next} \
			/^[a-zA-Z0-9_-]+/{ if (desc != "") { printf "  \033[36m%-16s\033[0m %s\n", $$1, desc; desc="" } }'
	@echo ""

# ---------------------------------------------------------------------------
# 開発
# ---------------------------------------------------------------------------

## 依存をインストールする（初回のみ）
install:
	npm install

## アプリを起動する（ホストで実行すること）
dev:
	npm run dev

## 本番ビルドを out/ に出力する
build:
	npm run build

## typecheck と lint をまとめて実行する
check: typecheck lint

## 型チェック（main / renderer 両方）
typecheck:
	npm run typecheck

## ESLint
lint:
	npm run lint

## Prettier で整形する
format:
	npx prettier --write "src/**/*.{ts,tsx,css}" "*.{json,md}"

# ---------------------------------------------------------------------------
# ネイティブモジュール / Electron
# ---------------------------------------------------------------------------

## node-pty を Electron の ABI に合わせて再ビルドする
rebuild:
	npm run rebuild

## Electron 本体のバイナリが入っていないとき（Error: Electron uninstall）に実行する
fix-electron:
	node node_modules/electron/install.js

# ---------------------------------------------------------------------------
# Docker（検証）
# ---------------------------------------------------------------------------

## typecheck + lint + build を Docker コンテナ内で実行する
docker-verify:
	docker compose run --rm verify

## 検証用イメージをビルドし直す（キャッシュを使わない）
docker-build:
	docker compose build --no-cache verify

# ---------------------------------------------------------------------------
# Docker（AI エージェントのサンドボックス）
# ---------------------------------------------------------------------------

## カレントディレクトリをマウントしてサンドボックス内で claude を起動する
sandbox:
	./scripts/sandbox.sh

## サンドボックスのイメージをビルドし直す
sandbox-build:
	docker build -f Dockerfile.sandbox \
		--build-arg SANDBOX_UID=$$(id -u) \
		--build-arg SANDBOX_GID=$$(id -g) \
		-t ai-terminal-sandbox:latest .

# ---------------------------------------------------------------------------
# 後始末
# ---------------------------------------------------------------------------

## ビルド成果物を削除する（node_modules は消さない）
clean:
	rm -rf out dist

## 検証用の Docker リソースを削除する（サンドボックスの認証 volume は残す）
clean-docker:
	docker compose down -v --remove-orphans
