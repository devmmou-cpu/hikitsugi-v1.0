#!/usr/bin/env node
// push の前に実行する秘密情報の点検。依存なし。問題があれば終了コード 1。
// 使い方：node scripts/check-secrets.mjs [リポジトリのフォルダ]
//         node scripts/check-secrets.mjs --files <ファイルかフォルダ>...（書き出した HTML の点検。スマホ向けの束にも使う）

import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';

// 実際のキーの形だけを探す。E5 の評価用ダミーは対象外で、eval/lib/integrity.mjs が別に検査する。
const SECRET_PATTERNS = [
  ['Anthropic の API キー', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['GitHub のトークン', /gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/],
  ['AWS のアクセスキー', /AKIA[0-9A-Z]{16}/],
  ['Slack のトークン', /xox[abpr]-[A-Za-z0-9-]{10,}/],
  ['秘密鍵', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['環境変数への直書き', /ANTHROPIC_API_KEY\s*=\s*["']?[A-Za-z0-9_-]{8,}/],
  ['キーの代入', /(?:api[_-]?key|secret|token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{20,}["']/i],
];

// 実行した PC のアカウント名と PC 名。更新の記録に残る値が、リポジトリや書き出したファイルに入っていないかを見る。
// 値はその場で OS から読み、リポジトリにも出力にも書かない。環境変数の架空の値（HIKITSUGI_IDENTITY）は使わない。
// 短い名前とよくある名前は、ほかの語に当たるので調べない。日本語の名前も、架空の人物名と区別できないので調べない
const COMMON_NAMES = new Set(['user', 'users', 'admin', 'administrator', 'root', 'owner', 'guest', 'test', 'default', 'home', 'local', 'localhost', 'desktop', 'laptop', 'public', 'workgroup', 'azuread']);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 調べる語の一覧。label は表示用の種類の名前で、値は出さない。skipped は調べなかった語の数。 */
// ドメイン名は Windows の環境変数 USERDOMAIN（ほかの OS ではない）。WORKGROUP、AzureAD のようなよくある値は調べない
export function identityWords({ account, host, domain } = { account: (() => { try { return userInfo().username; } catch { return ''; } })(), host: (() => { try { return hostname(); } catch { return ''; } })(), domain: process.platform === 'win32' ? process.env.USERDOMAIN ?? '' : '' }) {
  const words = [];
  let skipped = 0;
  const add = (label, value) => {
    const word = value?.trim();
    if (!word) return;
    if (word.length < 3 || COMMON_NAMES.has(word.toLowerCase()) || !/^[\x21-\x7e]+$/.test(word)) skipped += 1;
    else if (!words.some((entry) => entry.word.toLowerCase() === word.toLowerCase())) words.push({ label, word, pattern: new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(word)}(?![A-Za-z0-9])`, 'i') });
  };
  add('PC のアカウント名', account);
  add('ドメイン名', domain);
  // PC 名は、そのままの形と、最初の「.」より前（.local やドメインを外した形）の両方を調べる
  add('PC 名', host);
  const short = host?.split('.')[0];
  if (short !== host) add('PC 名', short);
  return { words, skipped };
}

/** 文字列に、実行した PC のアカウント名と PC 名が語として出てこないか調べる。値そのものは返さない。 */
export const identityProblems = (text, words) => [...new Set(words.filter(({ pattern }) => pattern.test(text)).map(({ label }) => `${label}の形があります`))];

/** 文字列にキーの形がないか調べる。値そのものは返さない。 */
export const secretProblems = (text, words = []) => [...SECRET_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([label]) => `${label} の形があります`), ...identityProblems(text, words)];

/** 書き出したファイルを点検する。フォルダは中のファイルすべてを見る。 */
export function checkSecretFiles(paths, { identity } = {}) {
  const { words } = identity ? identityWords(identity) : identityWords();
  const files = paths.flatMap((path) => (statSync(path).isDirectory() ? readdirSync(path).map((name) => join(path, name)).filter((file) => statSync(file).isFile()) : [path]));
  return files.flatMap((file) => secretProblems(readFileSync(file, 'utf8'), words).map((problem) => `${file}: ${problem}`));
}

const SECRET_FILE = /(^|\/)(\.env(\..+)?|.*\.pem|.*\.key|id_rsa|id_ed25519)$/;
const MUST_BE_IGNORED = ['.env', '.env.local', 'secret.pem', 'secret.key'];

export function checkSecrets(cwd, { identity } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1024 ** 3 });
  const problems = [];
  const { words } = identity ? identityWords(identity) : identityWords();

  // 1. 秘密のファイルが追跡されていないこと
  for (const file of git('ls-files').split('\n').filter(Boolean)) {
    if (SECRET_FILE.test(file) && !file.endsWith('.env.example')) {
      problems.push(`秘密のファイルが git で追跡されています: ${file}`);
    }
  }

  // 2. 秘密のファイルが .gitignore で無視されること
  for (const file of MUST_BE_IGNORED) {
    const ignored = spawnSync('git', ['check-ignore', '-q', '--no-index', file], { cwd }).status === 0;
    if (!ignored) problems.push(`.gitignore で無視されていません: ${file}`);
  }

  // 3. コミット履歴全体と、これからコミットされる変更に、キーの形がないこと
  const sources = [
    ['コミット履歴', git('log', '-p', '--no-ext-diff', '--format=commit %h', 'HEAD')],
    ['作業中の変更', git('diff', 'HEAD', '--no-ext-diff')],
  ];
  for (const [where, text] of sources) {
    for (const line of text.split('\n')) {
      // 削除行は履歴に残っていても、追加した時点の行で検出できる
      if (!line.startsWith('+')) continue;
      for (const [label, pattern] of SECRET_PATTERNS) {
        // 値そのものは表示しない
        if (pattern.test(line)) problems.push(`${where}に ${label} の形があります`);
      }
      for (const problem of identityProblems(line, words)) problems.push(`${where}に ${problem}`);
    }
  }
  return [...new Set(problems)];
}

/** 調べなかった名前があれば、その数を伝える。値は出さない。 */
function skippedNote() {
  const { skipped } = identityWords();
  return skipped ? `\n（アカウント名か PC 名のうち ${skipped} 件は、短いか、よくある名前か、英数字以外を含むので調べていません）` : '';
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === '--files') {
  const problems = checkSecretFiles(process.argv.slice(3));
  if (problems.length) {
    console.error('秘密情報の点検：問題があります。配らないでください。');
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(`秘密情報の点検：問題なし（書き出したファイル）${skippedNote()}`);
  }
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const problems = checkSecrets(process.argv[2] ?? process.cwd());
  if (problems.length) {
    console.error('秘密情報の点検：問題があります。push しないでください。');
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(`秘密情報の点検：問題なし（追跡ファイル、.gitignore、コミット履歴、作業中の変更、この PC のアカウント名と PC 名）${skippedNote()}`);
  }
}
