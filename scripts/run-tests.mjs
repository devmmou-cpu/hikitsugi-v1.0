#!/usr/bin/env node
// 全テストを確実に流し、結果を正しく返す（npm test の本体）。
// - Chrome で撮影するテスト（scripts/screenshots.mjs を使うファイル）は、ほかのテストと並べず、あとから 1 ファイルずつ流す。
//   全部を同時に流すと、負荷で Chrome が止まり、テストが戻ってこなかったため（11/14）
// - テスト 1 件ごとと、組ごとに時間切れを付ける。止まったら失敗にする
// - 終了コードが 0 で、件数が 1 件以上あり、「fail 0」と出たときだけ合格にする。どれかが欠ければ失敗
// 終了コード：0＝全件合格、1＝失敗（理由を表示）

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
// 撮影のプログラムのパスを、引用符つきで書いているファイル（説明の文の中の名前は数えない）
const SHOTS = /['"`]scripts\/screenshots\.mjs['"`]/;

/** テストのファイルを、並べて流すものと、1 つずつ流すもの（撮影）に分ける。 */
export function testGroups(dir = join(ROOT, 'test')) {
  const files = readdirSync(dir).filter((name) => name.endsWith('.test.mjs')).sort().map((name) => join(dir, name));
  const serial = files.filter((file) => SHOTS.test(readFileSync(file, 'utf8')));
  return { parallel: files.filter((file) => !serial.includes(file)), serial };
}

/** node --test の出力から件数を読む。最後の要約の値を使う（テストの中の出力に同じ形の行があっても取り違えない）。読めなければ null。 */
export function countsOf(output) {
  const read = (name) => {
    const found = [...output.matchAll(new RegExp(`^ℹ ${name} (\\d+)$`, 'gm'))].at(-1);
    return found ? Number(found[1]) : null;
  };
  return { tests: read('tests'), pass: read('pass'), fail: read('fail'), cancelled: read('cancelled') };
}

/** 1 つの組を流す。出力はそのまま見せ、件数を読むために残す。 */
function runGroup({ files, concurrency, testTimeout, groupTimeout, imports, cwd, echo }) {
  return new Promise((done) => {
    const args = [...imports.flatMap((path) => ['--import', path]), '--test', '--test-reporter=spec', `--test-timeout=${testTimeout}`, ...(concurrency ? [`--test-concurrency=${concurrency}`] : []), ...files];
    // テストの中から呼ばれたときに、親のテストの合図（NODE_TEST_CONTEXT）を引き継ぐと、要約の行が出ないので外す
    const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const keep = (stream, target) => stream.on('data', (chunk) => { output += chunk; if (echo) target.write(chunk); });
    keep(child.stdout, process.stdout);
    keep(child.stderr, process.stderr);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, groupTimeout);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      done({ code, signal, timedOut, output });
    });
  });
}

/** 組の結果を判定する。合格の条件をすべて満たさなければ、理由を返す。 */
export function judge(name, { code, signal, timedOut, output }) {
  const counts = countsOf(output);
  const reasons = [];
  if (timedOut) reasons.push(`${name}：時間切れで止めました`);
  if (signal) reasons.push(`${name}：テストが止められました（${signal}）`);
  if (code !== 0) reasons.push(`${name}：終了コードが ${code} です`);
  if (counts.tests === null || counts.fail === null) reasons.push(`${name}：テストの件数を読めません`);
  else if (counts.tests === 0) reasons.push(`${name}：テストが 1 件も流れていません`);
  if (counts.fail) reasons.push(`${name}：失敗 ${counts.fail} 件`);
  if (counts.cancelled) reasons.push(`${name}：中止 ${counts.cancelled} 件`);
  return { counts, reasons };
}

/**
 * 全テストを流す。並べて流す組のあとに、撮影の組を 1 ファイルずつ流す。
 * @returns { ok, reasons, total }
 */
export async function runAll({ groups = testGroups(), cwd = ROOT, imports = ['./test/setup-identity.mjs'], testTimeout = 10 * 60 * 1000, groupTimeout = 30 * 60 * 1000, echo = true } = {}) {
  const results = [];
  if (groups.parallel.length) results.push(['並べて流す組', await runGroup({ files: groups.parallel, testTimeout, groupTimeout, imports, cwd, echo })]);
  if (groups.serial.length) results.push(['撮影の組（1 つずつ）', await runGroup({ files: groups.serial, concurrency: 1, testTimeout, groupTimeout, imports, cwd, echo })]);
  const judged = results.map(([name, result]) => [name, judge(name, result)]);
  const reasons = judged.flatMap(([, result]) => result.reasons);
  if (!results.length) reasons.push('テストのファイルがありません');
  const total = judged.reduce((sum, [, result]) => sum + (result.counts.tests ?? 0), 0);
  return { ok: reasons.length === 0, reasons, total, groups: judged.map(([name, result]) => ({ name, ...result.counts })) };
}

async function main() {
  const groups = testGroups();
  console.log(`テストを流します：並べて ${groups.parallel.length} ファイル、そのあと撮影を 1 つずつ ${groups.serial.length} ファイル（${groups.serial.map((file) => relative(ROOT, file)).join('、')}）`);
  const result = await runAll({ groups });
  console.log(`\n全テストの結果：${result.groups.map((group) => `${group.name} ${group.tests ?? '?'} 件（失敗 ${group.fail ?? '?'}）`).join('、')}`);
  if (!result.ok) {
    console.error(`全テストは合格していません：\n${result.reasons.join('\n')}`);
    return 1;
  }
  console.log(`全テスト合格：${result.total} 件`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main();
