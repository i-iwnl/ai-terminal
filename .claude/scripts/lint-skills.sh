#!/usr/bin/env bash
#
# lint-skills.sh - .claude 配下の skill / agent の構造ハーネス
#
# 「文章で書いたルール」ではなく機械で守らせるための検査。skill / agent の md を
# 編集したら必ず実行する。設計ルールの原典は .claude/README.md の「設計ルール」節。
#
# 検査項目:
#   check1  frontmatter（name/description）の有無と name の一致
#   check2  ファイルサイズ上限
#   check3  相対リンク切れ（コードフェンス内・インラインコード内は除外）
#   check4  skill 配下のカテゴリ違反（第6のカテゴリを作らない）
#   check5  operations / reference の H1 欠落
#   check6  .claude/README.md の skill 一覧と実体の同期
#   check7  ルート CLAUDE.md の健全性（起動点として機能しているか）
#   check8  生成残骸（{{placeholder}} / CUSTOMIZE コメント）
#
# 出力: チェックごとに [PASS] / [FAIL] 理由 を1行ずつ、最後に合計を表示。
# 終了コード: FAIL 件数（0 = 全チェック通過）。
#
# Usage:
#   bash .claude/scripts/lint-skills.sh
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"     # .claude
REPO_ROOT="$(cd "${CLAUDE_DIR}/.." && pwd)"
SKILLS_ROOT="${CLAUDE_DIR}/skills"
AGENTS_DIR="${CLAUDE_DIR}/agents"

PASS_COUNT=0
FAIL_COUNT=0

pass() { echo "[PASS] $1"; PASS_COUNT=$(( PASS_COUNT + 1 )); }
fail() { echo "[FAIL] $1"; FAIL_COUNT=$(( FAIL_COUNT + 1 )); }

# 検査対象の md を列挙（skill の SKILL.md / operations / reference / examples）
list_skill_md() {
  ls "${SKILLS_ROOT}"/*/SKILL.md \
     "${SKILLS_ROOT}"/*/operations/*.md \
     "${SKILLS_ROOT}"/*/reference/*.md \
     "${SKILLS_ROOT}"/*/examples/*.md 2>/dev/null
}

# md からコードフェンス内・インラインコード内を除去して出力する
# （説明用の架空パスを「リンク切れ」と誤検知しないため）
strip_code() {
  awk '
    /^[[:space:]]*```/ { infence = 1 - infence; next }
    infence { next }
    { gsub(/`[^`]*`/, ""); print }
  ' "$1"
}

# --- check 1: frontmatter（name/description）と name の一致 --------------------
# description は常時ロードされる自動ルーティングの入口。欠けると skill/agent が
# 一度も呼ばれない（存在しないのと同じ）。name はディレクトリ名と一致していないと
# /skill-name での明示起動が効かない。
check_frontmatter() {
  local md rel name_line desc_line name_val dir_name
  for md in "${SKILLS_ROOT}"/*/SKILL.md "${AGENTS_DIR}"/*.md; do
    [ -e "$md" ] || continue
    rel="${md#"${CLAUDE_DIR}"/}"
    if [ "$(head -n1 "$md")" != "---" ]; then
      fail "check1: ${rel} に frontmatter がない（name/description が必須。無いと自動ルーティングされない）"
      continue
    fi
    name_line="$(awk 'NR>1 && /^---$/{exit} NR>1 && /^name:[[:space:]]*[^[:space:]]/{print; exit}' "$md")"
    desc_line="$(awk 'NR>1 && /^---$/{exit} NR>1 && /^description:[[:space:]]*[^[:space:]]/{print; exit}' "$md")"
    if [ -z "$name_line" ] || [ -z "$desc_line" ]; then
      fail "check1: ${rel} の frontmatter に name または description が無い/空"
      continue
    fi
    case "$md" in
      */SKILL.md)
        name_val="$(printf '%s' "$name_line" | sed 's/^name:[[:space:]]*//; s/[[:space:]]*$//')"
        dir_name="$(basename "$(dirname "$md")")"
        if [ "$name_val" != "$dir_name" ]; then
          fail "check1: ${rel} の name(${name_val}) がディレクトリ名(${dir_name})と不一致"
          continue
        fi
        ;;
    esac
    pass "check1: ${rel} frontmatter OK"
  done
}

# --- check 2: ファイルサイズ上限 ---------------------------------------------
# 超過は「混ざりすぎ」のサイン。SKILL.md の超過はルーティング表に手順を書いた疑い。
check_file_size() {
  local md rel lines limit
  for md in $(list_skill_md); do
    rel="${md#"${CLAUDE_DIR}"/}"
    lines="$(wc -l < "$md" | tr -d ' ')"
    case "$md" in
      */SKILL.md) limit=100 ;;
      *) limit=500 ;;
    esac
    if [ "$lines" -le "$limit" ]; then
      pass "check2: ${rel} ${lines}行（上限${limit}以内）"
    else
      fail "check2: ${rel} ${lines}行が上限${limit}を超過（H2境界・意味が通る単位で分割。章番号での機械分割は禁止）"
    fi
  done
}

# --- check 3: 相対リンク切れ（フェンス内・インラインコード内は除外） ----------
check_relative_links() {
  local md rel dir link target broken
  for md in $(list_skill_md); do
    rel="${md#"${CLAUDE_DIR}"/}"
    dir="$(dirname "$md")"
    broken=""
    while IFS= read -r link; do
      [ -z "$link" ] && continue
      case "$link" in
        http://*|https://*|mailto:*|/*|\#*) continue ;;
      esac
      target="${link%%#*}"
      [ -z "$target" ] && continue
      if [ ! -e "${dir}/${target}" ]; then
        broken="${broken} ${link}"
      fi
    done <<EOF
$(strip_code "$md" | grep -o '](\.\{0,2\}[A-Za-z0-9_./-]*\.md[^)]*)' 2>/dev/null | sed 's/^](//; s/)$//' | sort -u)
EOF
    if [ -z "$broken" ]; then
      pass "check3: ${rel} 相対リンク切れなし"
    else
      fail "check3: ${rel} にリンク切れ:${broken}"
    fi
  done
}

# --- check 4: skill 配下のカテゴリ違反 ---------------------------------------
# skill 配下に置けるのは SKILL.md / operations / reference / examples / scripts のみ。
# 第6のカテゴリ（README.md 等）を作ると、どこに何があるかの規律が崩れる。
check_categories() {
  local skill_dir name entry base violations
  for skill_dir in "${SKILLS_ROOT}"/*/; do
    [ -d "$skill_dir" ] || continue
    name="$(basename "$skill_dir")"
    violations=""
    for entry in "$skill_dir"* "$skill_dir".[!.]*; do
      [ -e "$entry" ] || continue
      base="$(basename "$entry")"
      if [ -d "$entry" ]; then
        case "$base" in
          operations|reference|examples|scripts) ;;
          *) violations="${violations} ${base}/" ;;
        esac
      else
        case "$base" in
          SKILL.md) ;;
          *) violations="${violations} ${base}" ;;
        esac
      fi
    done
    if [ -z "$violations" ]; then
      pass "check4: ${name}/ カテゴリ違反なし"
    else
      fail "check4: ${name}/ に規定外の要素:${violations}（実例は examples/、図解は reference/ へ）"
    fi
  done
}

# --- check 5: operations / reference の H1 欠落 -------------------------------
# 単体で開いたときに何のファイルか分かるように H1 を付ける。
check_h1() {
  local md rel missing=""
  for md in "${SKILLS_ROOT}"/*/operations/*.md "${SKILLS_ROOT}"/*/reference/*.md; do
    [ -e "$md" ] || continue
    rel="${md#"${CLAUDE_DIR}"/}"
    if ! grep -qE '^# [^[:space:]]' "$md"; then
      missing="${missing} ${rel}"
    fi
  done
  if [ -z "$missing" ]; then
    pass "check5: operations / reference は全て H1 あり"
  else
    fail "check5: H1 が無いファイル:${missing}"
  fi
}

# --- check 6: README の skill 一覧と実体の同期 --------------------------------
# 一覧は目次（ルーティングの正は各 SKILL.md の description）だが、ズレると
# 人が skill の存在に気づけなくなる。
check_readme_index() {
  local readme="${CLAUDE_DIR}/README.md"
  if [ ! -f "$readme" ]; then
    fail "check6: .claude/README.md が存在しない（skill 一覧・設計ルールの置き場）"
    return
  fi
  local skill_dir name missing="" listed stale=""
  for skill_dir in "${SKILLS_ROOT}"/*/; do
    [ -d "$skill_dir" ] || continue
    name="$(basename "$skill_dir")"
    grep -q "skills/${name}/SKILL.md" "$readme" || missing="${missing} ${name}"
  done
  while IFS= read -r listed; do
    [ -z "$listed" ] && continue
    [ -d "${SKILLS_ROOT}/${listed}" ] || stale="${stale} ${listed}"
  done <<EOF
$(grep -o 'skills/[A-Za-z0-9_-]*/SKILL\.md' "$readme" 2>/dev/null | sed 's#^skills/##; s#/SKILL\.md$##' | sort -u)
EOF
  if [ -z "$missing" ] && [ -z "$stale" ]; then
    pass "check6: README の skill 一覧と実体が一致"
  else
    [ -n "$missing" ] && fail "check6: README の一覧に未掲載の skill:${missing}"
    [ -n "$stale" ] && fail "check6: README に載っているが実体が無い skill:${stale}"
  fi
}

# --- check 7: ルート CLAUDE.md の健全性 ---------------------------------------
# CLAUDE.md は skill 一式の起動点。委譲方針が無いと skill が呼ばれず一式が死蔵され、
# .claude/README.md への導線が無いと設計ルールに辿り着けない。サイズ超過は
# 「常時ロードすべきでない内容が混入した」サイン（skill 側へ逃がす）。
check_root_claude_md() {
  local file="${REPO_ROOT}/CLAUDE.md" lines
  if [ ! -f "$file" ]; then
    fail "check7: ルート CLAUDE.md が存在しない（委譲方針・検証コマンドの唯一の正の置き場）"
    return
  fi
  lines="$(wc -l < "$file" | tr -d ' ')"
  if [ "$lines" -le 250 ]; then
    pass "check7: CLAUDE.md ${lines}行（上限250以内）"
  else
    fail "check7: CLAUDE.md ${lines}行が上限250を超過（タスク発生時に取りに行けばよい内容を skill へ逃がす）"
  fi
  # 実在する skill 名（+ 個人 skill）が /name 形式で言及されているか
  local skill_dir name found=""
  for skill_dir in "${SKILLS_ROOT}"/*/; do
    [ -d "$skill_dir" ] || continue
    name="$(basename "$skill_dir")"
    grep -q "/${name}\b" "$file" && found="yes"
  done
  grep -qE '/(orchestrator|workspace-plan)\b' "$file" && found="yes"
  if [ -n "$found" ]; then
    pass "check7: CLAUDE.md に skill への導線あり"
  else
    fail "check7: CLAUDE.md に委譲方針（どのタスクでどの skill を起動するか）が無い（作った skill が自動起動しない）"
  fi
  if grep -q '\.claude/README\.md' "$file"; then
    pass "check7: CLAUDE.md に .claude/README.md への導線あり"
  else
    fail "check7: CLAUDE.md に .claude/README.md への導線が無い（設計ルールに辿り着けない）"
  fi
}

# --- check 8: 生成残骸 --------------------------------------------------------
# コードフェンス内・インラインコード内は検査しない（check3 と同じ理由）。
# `{{...}}` は生成テンプレートの残骸であると同時に、実在するコマンドの構文でもある
# （gh の --template、Go template、Handlebars 等）。手順書に載せた実行可能なコマンドを
# 残骸と誤検知すると、検査を通すために手順の方を曲げることになる。
# 本物の残骸は散文・見出し・frontmatter に現れるので、フェンス外だけを見れば足りる。
check_no_leftovers() {
  local md rel hits=""
  for md in $(list_skill_md) "${AGENTS_DIR}"/*.md "${CLAUDE_DIR}/README.md" "${REPO_ROOT}/CLAUDE.md"; do
    [ -e "$md" ] || continue
    rel="${md#"${REPO_ROOT}"/}"
    if strip_code "$md" | grep -q '{{[^}]\{1,\}}}\|<!-- CUSTOMIZE'; then
      hits="${hits} ${rel}"
    fi
  done
  if [ -z "$hits" ]; then
    pass "check8: placeholder / CUSTOMIZE コメントの残骸なし（コードフェンス内は対象外）"
  else
    fail "check8: 生成残骸が残存:${hits}"
  fi
}

# === CUSTOM CHECKS ============================================================
# ここから下はリポジトリ固有のチェックを追加する。
# 追加基準:「二重化された事実」を見つけたら突合チェックを書く（解消できるなら解消が先）。
# 例:
#  - ドキュメントに書かれたコマンドが package.json / Makefile に実在するか
#  - 設定ファイルの既定値とドキュメント記載値の突合
#  - 手順が全パッケージ／全アプリに言及しているか

# --- 実行 --------------------------------------------------------------------
if [ ! -d "$SKILLS_ROOT" ]; then
  echo "[FAIL] .claude/skills が存在しない（/init-skills init で立ち上げる）"
  exit 1
fi

check_frontmatter
check_file_size
check_relative_links
check_categories
check_h1
check_readme_index
check_root_claude_md
check_no_leftovers

echo "----------------------------------------------"
echo "合計: PASS=${PASS_COUNT} FAIL=${FAIL_COUNT}"

exit "$FAIL_COUNT"
