// ドラッグ&ドロップされたファイルを、シェルのコマンドラインへ挿入できる文字列に整形する。
//
// **ここは純粋関数だけを置く。** DataTransfer から実際にパスを取り出す処理は
// terminal/TerminalPane.tsx 側（webUtils に依存するため単体テストできない）。
//
// エスケープ方式は Terminal.app / iTerm2 / Ghostty と同じ**バックスラッシュ方式**にする。
// シングルクォートで囲む方式にしないのは、ドロップした直後にユーザーが続けて文字を打ったとき、
// クォートの内側に閉じ込められてしまうため（`'/path/to/file' --flag` と打てなくなる）。

/**
 * バックスラッシュのエスケープが要らない文字。
 *
 * ASCII の英数字と `_` `.` `/` `-` だけを安全側で通し、それ以外の ASCII 記号はすべて
 * エスケープする。**非 ASCII（日本語・絵文字）はエスケープしない** -- シェルにとって
 * 特別な意味を持たない上、エスケープすると見た目が読めなくなる。
 */
const SAFE_ASCII = /[A-Za-z0-9_./-]/;

/** ASCII の範囲外（ここから上は素通しする） */
const NON_ASCII_START = 0x80;

/** DEL。これ未満の 0x20 未満とあわせて制御文字とみなす */
const DEL = 0x7f;

/** 半角スペース。これ未満のコードポイントは制御文字 */
const SPACE = 0x20;

/**
 * バックスラッシュでは安全に表現できない文字を含むか。
 *
 * 改行を `\` + 改行にするとシェルの行継続になり、**改行そのものが消えて別のパスになる**。
 * 正規表現に制御文字を直接書くとソースに生の制御文字が混入するので、コードポイントで判定する。
 */
function hasControlChar(path: string): boolean {
  for (const ch of path) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < SPACE || code === DEL) return true;
  }
  return false;
}

/**
 * パス1件をシェルで1トークンとして解釈される形にする。
 *
 * 制御文字（改行・タブ）を含むパスだけはシングルクォートで囲む。
 * `'` 自体は `'\''` で閉じ直す -- sh / bash / zsh のいずれでも通る書き方。
 */
export function escapeShellPath(path: string): string {
  if (path === '') return "''";

  if (hasControlChar(path)) {
    return "'" + path.replaceAll("'", "'\\''") + "'";
  }

  let out = '';
  for (const ch of path) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= NON_ASCII_START || SAFE_ASCII.test(ch)) {
      out += ch;
    } else {
      out += '\\' + ch;
    }
  }
  return out;
}

/**
 * ドロップされたパス群を、コマンドラインへ挿入する1本の文字列にする。
 *
 * 末尾にスペースを1つ足すのは他のターミナルと同じ挙動。
 * ドロップ直後に `--flag` を続けて打てるようにするためで、これが無いと毎回スペースを押すことになる。
 * 空配列のときは空文字を返す（PTY へ何も送らせない）。
 */
export function buildDropInsertion(paths: string[]): string {
  const usable = paths.filter((p) => p !== '');
  if (usable.length === 0) return '';
  return usable.map(escapeShellPath).join(' ') + ' ';
}

/**
 * `text/uri-list`（RFC 2483）を絶対パスの配列に変換する。
 *
 * Finder からのドラッグは `dataTransfer.files` と `text/uri-list` の両方を持つ。
 * こちらを第2の経路として持っておくと、他アプリからの URI ドラッグにも対応でき、
 * かつ**合成した DataTransfer で E2E から検証できる唯一の経路**になる
 * （`webUtils.getPathForFile()` は本物の File にしかパスを返さない）。
 *
 * `file:` 以外のスキームは無視する。パース不能な行も黙って捨てる
 * （外部フォーマットのパース失敗でアプリを落とさない、の方針）。
 */
export function pathsFromUriList(uriList: string): string[] {
  const paths: string[] = [];
  for (const rawLine of uriList.split(/\r?\n/)) {
    const line = rawLine.trim();
    // 空行と、RFC 2483 のコメント行
    if (line === '' || line.startsWith('#')) continue;
    const path = fileUriToPath(line);
    if (path !== null) paths.push(path);
  }
  return paths;
}

/**
 * `file:///Users/me/a%20b.txt` を `/Users/me/a b.txt` にする。
 * file スキーム以外、およびデコードに失敗した URI では null を返す。
 */
function fileUriToPath(uri: string): string | null {
  if (!/^file:\/\//i.test(uri)) return null;
  // file://localhost/path と file:///path の両方を受ける
  const withoutScheme = uri.slice('file://'.length).replace(/^localhost/i, '');
  if (!withoutScheme.startsWith('/')) return null;
  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    // 不正なパーセントエンコーディング。捨てる
    return null;
  }
}
