#!/usr/bin/env node
// コミットの前の点検（npm run gate）と、コミットのときの照合（.githooks/pre-commit から呼ぶ）。
// - gate：全テスト（scripts/run-tests.mjs）と秘密情報の点検を、コミットする中身そのもので流す。
//   どちらも通ったときだけ、その中身（index の tree）を記録する。始める前に古い記録は消す
// - --check-commit：今の index の tree が記録と同じときだけ、コミットを通す
// 点検の出力をパイプでつないでも、コミットの可否はこの記録だけで決まる（11/14、テストが落ちたままコミットできた件の直し）。
// 終了コード：0＝合格（gate）／コミットしてよい（--check-commit）、1＝不合格

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
export const RECORD = 'hikitsugi-gate.json';

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** 記録を置く場所。worktree ごとの git のフォルダに置く（追跡しない）。 */
export function recordPath(cwd) {
  const dir = git(cwd, ['rev-parse', '--git-dir']);
  return join(isAbsolute(dir) ? dir : join(cwd, dir), RECORD);
}

/** 今の index の中身を表す tree の ID。 */
export const indexTree = (cwd) => git(cwd, ['write-tree']);

/** テストを流す前の条件。index に入れていない変更や、追跡していないファイルがあれば、テストした中身とコミットする中身が違う。 */
export function preconditionProblems(cwd) {
  const problems = [];
  const unstaged = git(cwd, ['diff', '--name-only']).split('\n').filter(Boolean);
  if (unstaged.length) problems.push(`index に入れていない変更があります（git add してから点検します）：${unstaged.slice(0, 10).join('、')}`);
  const untracked = git(cwd, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  if (untracked.length) problems.push(`追跡していないファイルがあります（足すか、消してから点検します）：${untracked.slice(0, 10).join('、')}`);
  return problems;
}

const defaultRun = (cwd) => (command, args) => spawnSync(command, args, { cwd, stdio: 'inherit' }).status;

/**
 * 点検を流し、通れば記録する。
 * @param run (command, args) => 終了コード。テストでは偽物を渡す
 */
export function runGate({ cwd = ROOT, run = defaultRun(cwd), steps = [['npm', ['test']], ['node', ['scripts/check-secrets.mjs']]] } = {}) {
  const path = recordPath(cwd);
  rmSync(path, { force: true });
  const before = preconditionProblems(cwd);
  if (before.length) return { ok: false, reasons: before };
  const tree = indexTree(cwd);
  const reasons = [];
  for (const [command, args] of steps) {
    const status = run(command, args);
    if (status !== 0) reasons.push(`${[command, ...args].join(' ')} が通りませんでした（終了コード ${status}）`);
  }
  // 点検のあいだに中身が変わっていれば、記録しない
  const after = [...preconditionProblems(cwd), ...(indexTree(cwd) === tree ? [] : ['点検のあいだに index が変わりました'])];
  reasons.push(...after);
  if (reasons.length) return { ok: false, reasons };
  writeFileSync(path, JSON.stringify({ tree, checked_at: new Date().toISOString() }, null, 2) + '\n');
  return { ok: true, tree };
}

/** コミットしてよいか。よければ null、だめなら理由。 */
export function commitProblem(cwd = ROOT) {
  const path = recordPath(cwd);
  if (!existsSync(path)) return '点検の記録がありません。npm run gate を流して、合格してからコミットしてください';
  const record = JSON.parse(readFileSync(path, 'utf8'));
  if (record.tree !== indexTree(cwd)) return 'コミットする中身が、点検に合格した中身と違います。npm run gate を流し直してください';
  return null;
}

function main(args) {
  if (args.includes('--check-commit')) {
    const problem = commitProblem(process.cwd());
    if (!problem) return 0;
    console.error(`コミットを止めました：${problem}`);
    return 1;
  }
  const result = runGate({ cwd: process.cwd() });
  if (!result.ok) {
    console.error(`\n点検に合格しませんでした。記録していません：\n${result.reasons.join('\n')}`);
    return 1;
  }
  console.log(`\n点検に合格しました。この中身（tree ${result.tree.slice(0, 12)}）をコミットできます`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
