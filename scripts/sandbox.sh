#!/usr/bin/env bash
# ============================================================================
# ai-terminal - AI エージェント隔離実行用サンドボックス起動スクリプト
#
# 目的:
#   `claude` に危険なコマンドを実行させたいとき、ホストのファイルシステムを
#   壊さないよう、作業対象のディレクトリだけをマウントした Docker コンテナの
#   中で `claude` を起動する。
#
#   詳しい設計・認証の扱い・隔離の限界は docs/SANDBOX.md を参照。
#
# 使い方:
#   ./scripts/sandbox.sh [マウントするディレクトリ]
#   ./scripts/sandbox.sh --help
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

IMAGE_NAME="ai-terminal-sandbox"
IMAGE_TAG="latest"
IMAGE_REF="${IMAGE_NAME}:${IMAGE_TAG}"
DOCKERFILE="${REPO_ROOT}/Dockerfile.sandbox"

# claude の認証情報・設定 (~/.claude 相当) を永続化する named volume。
# ホストの ~/.claude をそのままマウントすると全プロジェクトのセッション
# 履歴までコンテナから見えてしまうため、サンドボックス専用の volume を
# 別途用意している（詳細は docs/SANDBOX.md）。
CLAUDE_VOLUME="ai-terminal-sandbox-claude-home"

print_help() {
  cat <<'EOF'
使い方:
  scripts/sandbox.sh [ディレクトリ]

説明:
  指定したディレクトリ（省略時はカレントディレクトリ）だけをマウントした
  使い捨ての Docker コンテナの中で claude を起動する。
  ホストのファイルシステム全体には触れないため、AI エージェントに危険な
  コマンドを試させたいときの隔離環境として使う。

引数:
  ディレクトリ   コンテナの /work にマウントするディレクトリ。
                 省略した場合はスクリプト実行時のカレントディレクトリ。

オプション:
  -h, --help     このヘルプを表示して終了する。

例:
  # カレントディレクトリをマウントして起動
  ./scripts/sandbox.sh

  # 特定のディレクトリをマウントして起動
  ./scripts/sandbox.sh ~/Desktop/job/some-project

認証について:
  claude の初回ログインはコンテナ内で行う（ブラウザでの OAuth 認証）。
  ログイン結果は Docker の named volume（"ai-terminal-sandbox-claude-home"）
  に保存され、次回以降の起動でも再ログイン不要になる。
  この volume はホストの ~/.claude とは別物なので、ホスト側の他プロジェクトの
  セッション履歴がコンテナから見えることはない。詳細は docs/SANDBOX.md 参照。

隔離について:
  マウントしたディレクトリはコンテナ内から自由に書き換え・削除できる。
  そのディレクトリ自体は保護されない点に注意すること。
  詳細は docs/SANDBOX.md の「隔離の限界」を必ず読むこと。
EOF
}

for arg in "$@"; do
  case "${arg}" in
    -h|--help)
      print_help
      exit 0
      ;;
  esac
done

if [ "$#" -gt 1 ]; then
  echo "エラー: 引数はマウントするディレクトリ1つだけを指定してください。" >&2
  print_help
  exit 1
fi

TARGET_DIR="${1:-$(pwd)}"

if [ ! -d "${TARGET_DIR}" ]; then
  echo "エラー: 指定されたディレクトリが存在しません: ${TARGET_DIR}" >&2
  exit 1
fi

# 絶対パスに正規化する（意図しないディレクトリをマウントする事故を防ぐため、
# 実際にマウントされる絶対パスをこのあと必ず表示する）。
TARGET_DIR="$(cd "${TARGET_DIR}" && pwd)"

# --- Docker の存在 / 起動確認 ------------------------------------------------

if ! command -v docker >/dev/null 2>&1; then
  echo "エラー: docker コマンドが見つかりません。" >&2
  echo "Docker Desktop をインストールしてください: https://www.docker.com/products/docker-desktop/" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "エラー: Docker デーモンに接続できません。" >&2
  echo "Docker Desktop が起動しているか確認してください。" >&2
  exit 1
fi

# --- イメージの確認 / 自動ビルド --------------------------------------------
# 毎回ビルドはせず、イメージが存在しないときだけビルドする。

if ! docker image inspect "${IMAGE_REF}" >/dev/null 2>&1; then
  echo "サンドボックスイメージ (${IMAGE_REF}) が見つからないため、ビルドします..."
  # ホストとの UID/GID のズレでマウントしたファイルが書けなくなる問題を
  # 避けるため、ホストのユーザーの UID/GID をそのままビルド引数として渡す。
  docker build \
    -f "${DOCKERFILE}" \
    --build-arg "SANDBOX_UID=$(id -u)" \
    --build-arg "SANDBOX_GID=$(id -g)" \
    -t "${IMAGE_REF}" \
    "${REPO_ROOT}"
fi

# --- マウント内容の表示 ------------------------------------------------------
# 意図しないディレクトリをマウントする事故を防ぐため、実行前に必ず表示する。

echo "============================================================"
echo " ai-terminal サンドボックス"
echo "------------------------------------------------------------"
echo " マウントするディレクトリ : ${TARGET_DIR}"
echo " コンテナ内のパス         : /work"
echo " イメージ                 : ${IMAGE_REF}"
echo " 認証情報の保存先          : Docker named volume (${CLAUDE_VOLUME})"
echo "============================================================"
echo ""
echo "上記のディレクトリだけがコンテナから読み書きできます。"
echo "コンテナ内の claude はこのディレクトリを自由に変更・削除できる点に"
echo "注意してください（詳細は docs/SANDBOX.md）。"
echo ""

# --- コンテナ起動 ------------------------------------------------------------
# -it        : claude は対話的な TUI のため必須
# --rm       : コンテナ自体は使い捨てにする
# -v (/work) : 作業対象ディレクトリだけをマウントする（ホスト全体は見せない）
# -v (claude-home) : 認証情報 / 設定を次回起動のために永続化する
#
# ネットワークについて:
#   claude は Anthropic の API と通信する必要があるため、ここでは
#   デフォルトのブリッジネットワーク（有効な状態）のまま起動している。
#   より厳しく制限したい場合は、事前に `claude` へのログインを済ませたうえで
#   `--network none` を付ける、あるいは `--dns` や外向きプロキシで許可先を
#   絞るなどの方法がある（本スクリプトでは採用していない）。

exec docker run \
  --rm \
  -it \
  -v "${TARGET_DIR}:/work" \
  -v "${CLAUDE_VOLUME}:/home/sandbox/.claude" \
  -w /work \
  "${IMAGE_REF}" \
  claude
