#!/usr/bin/env node
// Claude Code のフック（PreToolUse、Bash）。git push の前に npm test を実行し、失敗したら止める。
// 提出したリポジトリ（remote の submitted）への push と、force push は、テストの前に止める。
// 終了コード 2 で、コマンドの実行を止めて理由を伝える。

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** コマンドの中に git push があるか。`&&` や `;` でつないだものや、git -C の形も見つける。 */
export const runsGitPush = (command) => /(?:^|[;&|(\n]|\s)git\s+(?:-[Cc]\s+\S+\s+|--?[a-z-]+(?:=\S+)?\s+)*push(?:\s|$|[;&|)])/.test(command);

// 大会に提出したリポジトリ。変更しないと決めたので、remote の名前でも URL でも push させない
const SUBMITTED_REMOTE = 'submitted';
const SUBMITTED_URL = /github\.com[/:]devmmou-cpu\/hikitsugi(?:\.git)?\/?$/;

/** コマンドの中の git push ごとに、push の後ろの引数を返す。区切り（; & | ) 改行）までを1つとする。 */
function pushArguments(command) {
  const found = [];
  const pattern = /(?:^|[;&|(\n]|\s)git\s+(?:-[Cc]\s+\S+\s+|--?[a-z-]+(?:=\S+)?\s+)*push(?=\s|$|[;&|)])([^;&|)\n]*)/g;
  for (const match of command.matchAll(pattern)) found.push(match[1].trim().split(/\s+/).filter(Boolean).map((word) => word.replace(/^["']|["']$/g, '')));
  return found;
}

const isForce = (word) => /^--force(?:-with-lease|-if-includes)?(?:=.*)?$/.test(word) || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(word) || /^\+/.test(word) || /^--mirror$/.test(word);

/** 止める push なら理由を返す。提出したリポジトリへの push と、force push。 */
export function forbiddenPush(command) {
  for (const words of pushArguments(command)) {
    if (words.some((word) => word === SUBMITTED_REMOTE || SUBMITTED_URL.test(word))) return '提出したリポジトリ（submitted）へは push しません';
    if (words.some(isForce)) return 'force push はしません';
  }
  return null;
}

/** テストの結果の要約を作る。失敗したテストの名前だけを伝える。 */
function summarize(output) {
  const failed = [...new Set(output.split('\n').filter((line) => /^✖ /.test(line) && !line.includes('failing tests')))];
  const counts = output.split('\n').filter((line) => /^ℹ (tests|pass|fail) /.test(line));
  return [...counts, ...failed.slice(0, 20)].join('\n');
}

function main() {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const command = input.tool_input?.command ?? '';
  if (!runsGitPush(command)) return 0;
  const forbidden = forbiddenPush(command);
  if (forbidden) {
    console.error(`${forbidden}。git push を止めました。`);
    return 2;
  }
  const cwd = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
  const result = spawnSync('npm', ['test'], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.status === 0) return 0;
  console.error(`npm test が通らないので、git push を止めました。\n${summarize(`${result.stdout}\n${result.stderr}`)}`);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = main();
