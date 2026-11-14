// 全テストを流すプログラム（npm test）と、コミットの前の点検（npm run gate、pre-commit）。
// 落ちたのに通ったと扱う経路がないことを確かめる。偽のテストのファイルと、使い捨ての git の作業場所を使う。

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { forbiddenCommit } from '../scripts/hooks/pre-push-test.mjs';
import { commitProblem, recordPath, runGate } from '../scripts/gate.mjs';
import { countsOf, judge, runAll, testGroups } from '../scripts/run-tests.mjs';
import { existsSync } from 'node:fs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'hikitsugi-run-tests-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const file = (dir, name, body) => {
  writeFileSync(join(dir, name), `import test from 'node:test';\nimport assert from 'node:assert/strict';\n${body}\n`);
  return join(dir, name);
};
const PASS = "test('通る', () => assert.equal(1, 1));";
const FAIL = "test('落ちる', () => assert.equal(1, 2));";
const HANG = "test('止まる', () => new Promise(() => {}));";
const run = (dir, groups) => runAll({ groups, cwd: dir, imports: [], testTimeout: 3000, groupTimeout: 60000, echo: false });

test('撮影のテスト（scripts/screenshots.mjs を使うファイル）は、並べて流す組に入れない', () => {
  const { parallel, serial } = testGroups(join(ROOT, 'test'));
  assert.ok(serial.some((path) => path.endsWith('phone.test.mjs')));
  assert.ok(serial.some((path) => path.endsWith('renderer-visual.acceptance.test.mjs')));
  assert.ok(!parallel.some((path) => serial.includes(path)));
  assert.ok(parallel.some((path) => path.endsWith('run-tests.test.mjs')));
});

test('全部通れば合格。件数を足す', async () =>
  withDir(async (dir) => {
    const result = await run(dir, { parallel: [file(dir, 'a.test.mjs', PASS), file(dir, 'b.test.mjs', PASS)], serial: [file(dir, 'c.test.mjs', PASS)] });
    assert.equal(result.ok, true);
    assert.equal(result.total, 3);
  }));

test('どちらの組で落ちても、時間切れでも、件数が 0 でも、合格にしない（時間切れは 1 件 3 秒で確かめる）', async () =>
  withDir(async (dir) => {
    const pass = file(dir, 'pass.test.mjs', PASS);
    const failParallel = await run(dir, { parallel: [pass, file(dir, 'fail.test.mjs', FAIL)], serial: [] });
    assert.equal(failParallel.ok, false);
    assert.match(failParallel.reasons.join(), /失敗 1 件/);
    const failSerial = await run(dir, { parallel: [pass], serial: [file(dir, 'fail2.test.mjs', FAIL)] });
    assert.equal(failSerial.ok, false);
    assert.match(failSerial.reasons.join(), /撮影の組/);
    const hang = await run(dir, { parallel: [pass], serial: [file(dir, 'hang.test.mjs', HANG)] });
    assert.equal(hang.ok, false);
    // 要約が「0 件」なら不合格。ファイルが 1 つもなければ不合格
    assert.match(judge('組', { code: 0, signal: null, timedOut: false, output: 'ℹ tests 0\nℹ pass 0\nℹ fail 0\n' }).reasons.join(), /1 件も流れていません/);
    assert.equal((await run(dir, { parallel: [], serial: [] })).ok, false);
  }));

test('件数は最後の要約を読む。終了コードが 0 でも、失敗の件数があれば不合格', () => {
  // テストの中の出力に、同じ形の行が混ざっても取り違えない
  assert.deepEqual(countsOf('ℹ tests 5\nℹ fail 0\n…\nℹ tests 7\nℹ pass 6\nℹ fail 1\n'), { tests: 7, pass: 6, fail: 1, cancelled: null });
  assert.equal(judge('組', { code: 0, signal: null, timedOut: false, output: 'ℹ tests 3\nℹ pass 2\nℹ fail 1\n' }).reasons.length, 1);
  assert.match(judge('組', { code: 0, signal: null, timedOut: false, output: '何も出ない' }).reasons.join(), /件数を読めません/);
  assert.match(judge('組', { code: 1, signal: null, timedOut: false, output: 'ℹ tests 3\nℹ fail 0\n' }).reasons.join(), /終了コードが 1/);
});

// ---- コミットの前の点検 ----
function withRepo(fn) {
  return withDir((dir) => {
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'first');
    return fn({ dir, git });
  });
}

test('点検：落ちたら記録しない。記録がなければコミットを止める', () =>
  withRepo(({ dir, git }) => {
    writeFileSync(join(dir, 'a.txt'), 'b\n');
    git('add', 'a.txt');
    const failed = runGate({ cwd: dir, run: (command) => (command === 'npm' ? 1 : 0) });
    assert.equal(failed.ok, false);
    assert.match(failed.reasons.join(), /npm test が通りませんでした/);
    assert.equal(existsSync(recordPath(dir)), false);
    assert.match(commitProblem(dir), /記録がありません/);
    // 秘密情報の点検だけが落ちても同じ
    assert.equal(runGate({ cwd: dir, run: (command) => (command === 'node' ? 1 : 0) }).ok, false);
    assert.equal(existsSync(recordPath(dir)), false);
  }));

test('点検：合格した中身と同じときだけコミットできる。index を変えたら照合で止める', () =>
  withRepo(({ dir, git }) => {
    writeFileSync(join(dir, 'a.txt'), 'b\n');
    git('add', 'a.txt');
    assert.equal(runGate({ cwd: dir, run: () => 0 }).ok, true);
    assert.equal(commitProblem(dir), null);
    writeFileSync(join(dir, 'a.txt'), 'c\n');
    git('add', 'a.txt');
    assert.match(commitProblem(dir), /点検に合格した中身と違います/);
    // 前の合格の記録は、次の点検を始めた時点で消える（次の点検が落ちれば、記録は残らない）
    runGate({ cwd: dir, run: () => 1 });
    assert.match(commitProblem(dir), /記録がありません/);
  }));

test('点検：index に入れていない変更や、追跡していないファイルがあれば流さない', () =>
  withRepo(({ dir }) => {
    writeFileSync(join(dir, 'a.txt'), 'b\n');
    let ran = false;
    assert.match(runGate({ cwd: dir, run: () => { ran = true; return 0; } }).reasons.join(), /index に入れていない変更/);
    assert.equal(ran, false);
    writeFileSync(join(dir, 'new.txt'), 'n\n');
    assert.match(runGate({ cwd: dir, run: () => 0 }).reasons.join(), /追跡していないファイル/);
  }));

test('pre-commit フック：記録と同じ中身だけを通し、違えば git commit が失敗する', () =>
  withRepo(({ dir, git }) => {
    const hooks = join(dir, 'hooks');
    mkdirSync(hooks);
    writeFileSync(join(hooks, 'pre-commit'), `#!/bin/sh\nexec node "${join(ROOT, 'scripts/gate.mjs')}" --check-commit\n`, { mode: 0o755 });
    git('config', 'core.hooksPath', hooks);
    writeFileSync(join(dir, 'a.txt'), 'b\n');
    git('add', 'a.txt');
    const commit = () => spawnSync('git', ['commit', '-q', '-m', 'second'], { cwd: dir, encoding: 'utf8' });
    const blocked = commit();
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /コミットを止めました/);
    // 点検は追跡していないファイル（フックのフォルダ）を嫌うので、記録を書く処理だけを呼ぶ
    git('add', 'hooks');
    assert.equal(runGate({ cwd: dir, run: () => 0 }).ok, true);
    assert.equal(commit().status, 0);
  }));

test('Claude Code のフック：点検の照合を飛ばす git commit を止める。メッセージの中の文字は見ない', () => {
  assert.match(forbiddenCommit('git commit --no-verify -m x'), /--no-verify/);
  assert.match(forbiddenCommit('git add a && git commit -nm "x"'), /-n/);
  assert.match(forbiddenCommit('git -c core.hooksPath=/dev/null commit -m x'), /フックの場所/);
  assert.equal(forbiddenCommit('git commit -m "x"'), null);
  assert.equal(forbiddenCommit('git commit -m "-n を含む"'), null);
  assert.equal(forbiddenCommit('git commit -q -F - <<EOF\n本文\nEOF'), null);
  assert.equal(forbiddenCommit('git status'), null);
});
