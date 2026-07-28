# ai-terminal
#
# よく使うコマンドの入口。詳しい説明は README.md を参照。
# アプリ本体の起動は必ずホスト（macOS）で行う。GUI を Docker では動かさない。

.DEFAULT_GOAL := help
.PHONY: help install dev dev-debug dev-quiet build check typecheck lint format rebuild fix-electron \
        docker-verify docker-build sandbox sandbox-build clean clean-docker \
        e2e e2e-lint e2e-report e2e-screenshots

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

## Main プロセスのデバッガを有効にして起動する（chrome://inspect から接続）
dev-debug:
	npx electron-vite dev --inspect --sourcemap

## DevTools を自動で開かずに起動する
dev-quiet:
	AI_TERMINAL_NO_DEVTOOLS=1 npm run dev

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
# E2E テスト（Playwright）
# ---------------------------------------------------------------------------

## E2E テストを実行する（ビルド済みの out/ を使うため build に依存）
e2e: build
	npx playwright test

## scenarios.yml と e2e/specs/ の 1:1 対応を検査する（実行前提なし）
e2e-lint:
	node scripts/lint-e2e.mjs

## 直近の E2E 実行の HTML レポートを開く
e2e-report:
	npx playwright show-report e2e/report

## README の使い方ガイド用スクリーンショットを撮る（docs/images/ に出力。make e2e には含まれない）
e2e-screenshots: build
	npx playwright test --config=e2e/screenshots.playwright.config.ts

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
