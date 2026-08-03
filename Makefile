# ai-terminal
#
# よく使うコマンドの入口。詳しい説明は README.md を参照。
# アプリ本体の起動は必ずホスト（macOS）で行う。GUI を Docker では動かさない。

# パッケージ済みアプリの位置。electron-builder は arch ごとに出力先を分ける
# （Apple Silicon は dist/mac-arm64、Intel は dist/mac）。
APP_NAME := ai-terminal.app
APP_DEST := /Applications/$(APP_NAME)
# ビルド後に評価する（= を使う）。:= だと Makefile 読み込み時に確定してしまい、
# 初回ビルドでは dist/ がまだ無いので常に空になる。
APP_SRC_AT_RUNTIME = $(firstword $(wildcard dist/mac-arm64/$(APP_NAME) dist/mac/$(APP_NAME)))

.DEFAULT_GOAL := help
.PHONY: help install dev dev-debug dev-quiet build package package-dir install-app check typecheck lint unit unit-watch format \
        rebuild fix-electron docker-verify docker-build sandbox sandbox-build clean clean-docker \
        e2e e2e-visible e2e-lint e2e-report e2e-screenshots e2e-packaged e2e-packaged-run css-substitution-check

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

## 安定版の .app と dmg を dist/ に生成する（ローカル用。署名は ad-hoc）
package:
	npm run package

## 安定版の .app のみを dist/ に生成する（dmg を作らない高速版。e2e-packaged 用）
package-dir:
	npm run package:dir

## パッケージ版の .app に対してスモーク E2E を実行する（package-dir から一括）
e2e-packaged: package-dir
	@$(MAKE) --no-print-directory e2e-packaged-run

# dist/ の既存成果物に対してスモークだけを実行する（ビルドしない）。
# install-app が package 直後の成果物を使い回すための内部ターゲット。
e2e-packaged-run:
	npx playwright test --config=e2e/packaged.playwright.config.ts

# **起動中は入れ替えない。** このアプリは AI エージェントの PTY を抱えているので、
# 動いたまま .app を差し替えると実行中のセッションを巻き添えで失う。
# 終了してから実行すること（エラーで止めるだけで、勝手に kill はしない）。
#
# 起動チェックは package より先に置く。prerequisite にすると、1分かけてビルドしてから
# 「起動中なので中止」と言うことになる（実測でそうなった）。
# APP_SRC はビルド前だと空になりうるので、参照は package の後で行う。
## ビルドして /Applications へ入れ替える（package まで一括。起動中は中止する）
install-app:
	@pgrep -f '$(APP_DEST)/Contents/MacOS/' >/dev/null 2>&1 && { \
	  printf '\n  中止: $(APP_DEST) が起動中です。\n'; \
	  printf '  実行中の AI セッションを失うため、アプリを終了してから実行してください。\n\n'; \
	  exit 1; \
	} || true
	@$(MAKE) --no-print-directory package
	@test -n "$(APP_SRC_AT_RUNTIME)" || { echo "  ビルド成果物が見つかりません（dist/ を確認）"; exit 1; }
	@printf '\n  入れ替え前スモーク: パッケージ版 .app に対して E2E を実行します\n\n'
	@$(MAKE) --no-print-directory e2e-packaged-run || { \
	  printf '\n  中止: パッケージ版スモークが失敗しました。/Applications は入れ替えていません。\n\n'; \
	  exit 1; \
	}
	rm -rf "$(APP_DEST)"
	ditto "$(APP_SRC_AT_RUNTIME)" "$(APP_DEST)"
	@printf '\n  インストールしました: $(APP_DEST)\n'
	@printf '  設定とメモの保存先は ~/.ai-terminal（make dev は ~/.ai-terminal-dev）\n\n'

## typecheck と lint と単体テストをまとめて実行する
check: typecheck lint unit

## 型チェック（main / renderer / test）
typecheck:
	npm run typecheck

## ESLint
lint:
	npm run lint

## 単体テスト（vitest。純粋関数のみ。アプリは起動しない）
unit:
	npm run unit

## 単体テストを watch モードで実行する
unit-watch:
	npm run unit:watch

## Prettier で整形する
format:
	npx prettier --write "src/**/*.{ts,tsx,css}" "*.{json,md}"

# ---------------------------------------------------------------------------
# E2E テスト（Playwright）
# ---------------------------------------------------------------------------

# 撮影レーンを make e2e から回すときの画像の捨て先（Issue #120 D-1）。
# docs/images/ を書き換えないためだけの場所で、中身は使わない
# （同じコードで2回撮っても13枚中13枚がバイト差になるので、make e2e のたびに
#  作業ツリーが汚れるのを避ける）。.gitignore 済み。
SCREENSHOTS_SCRATCH := e2e/.screenshots-out

## E2E テストを実行する（ウィンドウは表示しない。ビルド済みの out/ を使うため build に依存）
## 撮影レーン（e2e/screenshots.spec.ts）も含む。docs/images/ は書き換えない
e2e: build
	AI_TERMINAL_E2E_IMAGES_DIR=$(SCREENSHOTS_SCRATCH) npx playwright test

## E2E をウィンドウを表示して実行する（挙動を目で追いたいときだけ。マウスを奪われる）
e2e-visible: build
	AI_TERMINAL_E2E_SHOW=1 AI_TERMINAL_E2E_IMAGES_DIR=$(SCREENSHOTS_SCRATCH) npx playwright test

## docs/images/ の中身が実装とずれていないかを画素で検査する
## （先に make e2e か make e2e-screenshots を実行しておくこと）
e2e-screenshots-check:
	node scripts/verify-screenshots.mjs

## scenarios.yml と e2e/specs/ の 1:1 対応を検査する（実行前提なし）
e2e-lint:
	node scripts/lint-e2e.mjs

## CSS のトークン置換が値を変えていないことを検証する（値を変える PR では落ちる）
css-substitution-check:
	node scripts/verify-css-substitution.mjs $(REV)

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
