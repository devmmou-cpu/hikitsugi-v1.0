// 段 1 の更新（連絡先と機器を足す）を、人の操作なしで通す（模擬評価）。
// 架空のオコジョ精工のサンプルを結果のフォルダにコピーし、更新する人の答えは台本で渡す。
// Writer、Editor、Verifier、言い方の担当は、本番と同じ指示文とモデルで API から呼ぶ（eval/update-cost.mjs の driveUpdate）。
// 更新する人の確認（このままでよい）は自動で承認し、「自動承認」と記録に残す。
// あわせて、API を使わない検査（見慣れない番号の確認、退職する本人の連絡先など）を行う。
// 使い方：node --env-file=.env eval/stage1-update.mjs [--limit 5] [--results-dir <フォルダ>] [--no-shots] [--checks-only]
//         node eval/stage1-update.mjs --judge <結果のフォルダ>（保存した結果から合否の表だけを作り直す。API は呼ばない）

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { checkSecretFiles } from '../scripts/check-secrets.mjs';
import { IDENTITY_ENV } from '../plugin/lib/identity.mjs';
import { manualProblems, pageStatementIds } from '../plugin/lib/page-check.mjs';
import { PHONE_DIR } from '../plugin/renderer/phone.mjs';
import { nextStep, run } from '../plugin/scripts/hikitsugi.mjs';
import { clientOf } from './lib/adapters/live.mjs';
import { driveUpdate } from './update-cost.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = join(ROOT, 'samples/okojo');
const UPDATER = '佐藤';
/** 架空のアカウント名と PC 名。実際の PC の名前を結果に残さない。 */
export const FICTIONAL_IDENTITY = { account: 'user-s1', host: 'OKJ-PC11' };
const APPROVED = '自動承認';

/** 更新する人の答えの台本。docs/design/stage1-update.md の「実物で確かめる手順」の文。 */
export const SCRIPT = {
  contact: '分電盤やブレーカーの工事はエゾクロテン電設に頼みます。電話番号は 03-0000-0131 で、受付は平日の9時から17時です。契約書の控えの場所は分かりません。',
  symptom: '分電盤のブレーカーが落ちて事務所の電気が止まったときは、エゾクロテン電設に電話します。',
  device: '停電用の予備の電池を事務所の棚の下の段に置きました。停電のときに共有の機器を数分だけ動かします。止まると、停電のときに共有の機器がすぐ止まります。パスワードはありません。電池の箱は開けないでください。',
};
const EZO = { name: 'エゾクロテン電設', phone: '03-0000-0131' };
const FREE_DIAL = '0120-000-000';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2));

/** サンプルをコピーし、更新を始める。返す tool は作業フォルダでプラグインのコマンドを動かす。 */
function startFromSample(base) {
  mkdirSync(base, { recursive: true });
  cpSync(join(SAMPLE, 'manual.json'), join(base, 'manual.json'));
  const work = join(base, 'hikitsugi-work');
  const tool = (command, args = [], stdin = '') => run(command, args, { work, stdin });
  const started = tool('update-start', [UPDATER]);
  return { base, work, tool, started, read: (name) => readJson(join(work, name)), write: (name, value) => writeJson(join(work, name), value) };
}

// ─── API を使わない検査 ───

const statement = (id, text, evidence) => ({ id, text, evidence: [evidence], library: null });

/** 足す連絡先の Writer の出力を、固定の文で書く（API を呼ばない）。 */
function writeFixedContact({ tool, read, write }, { answer, contact }) {
  tool('update-add-contact', ['vendor'], answer);
  const { round, update } = read('state.json');
  const id = update.target;
  tool('writer-task', [String(round), id]);
  const evidence = read('writer-task.json').revision.page_fix.evidence;
  write(`writer-${round}-${id}.json`, {
    statements: [
      statement('STM-001', '分電盤の工事の会社', evidence),
      statement('STM-002', '受付は平日の9時から17時です。', evidence),
      statement('STM-003', '記録がありません。', evidence),
      statement('STM-004', '分電盤のどこが落ちたかを伝えてください。', evidence),
    ],
    contact: { id, ...EZO, role: 'STM-001', hours: 'STM-002', contract_location: 'STM-003', what_to_tell: 'STM-004', ...contact },
  });
  return { id, round, check: () => tool('check-writer', [String(round), id]) };
}

/** 照合まで、固定の結果（直しなし、全部正しい）で進めて、確認の表示を返す。 */
function fixedThroughReview({ work, tool, read, write }, target) {
  const round = String(read('state.json').round);
  if (nextStep(work).step === 'editor') {
    write(`editor-${round}.json`, { rewrites: [], glossary: [] });
    tool('merge-edits', [round]);
  }
  const scope = read(`verify-scope-${round}.json`).statements;
  write(`verification-${round}.json`, { results: scope.map((id) => ({ statement: id, verdict: 'correct', reason: '', checked: [], conflicts_with: [] })) });
  tool('check-verification', [round]);
  const step = nextStep(work);
  if (step.step !== 'review' || step.page !== target) throw new Error(`確認の段階に進みませんでした：${JSON.stringify(step)}`);
  return tool('review-show', [target]);
}

/** 止まるはずの操作を実行し、止まった理由が pattern に合うかを返す。 */
function stops(fn, pattern) {
  try {
    fn();
    return { passed: false, detail: '止まりませんでした' };
  } catch (error) {
    const lines = error.message.split('\n');
    return { passed: pattern.test(error.message), detail: (lines.find((line) => pattern.test(line)) ?? lines[0]).replace(/^[\s・-]+/, '') };
  }
}

/** API を使わない検査。dir の下に検査ごとのフォルダを作る。 */
export function apiFreeChecks(dir) {
  const results = [];
  const check = (name, label, fn) => {
    let result;
    try {
      result = fn(startFromSample(join(dir, name)));
    } catch (error) {
      result = { passed: false, detail: `検査が途中で失敗しました：${error.message.split('\n')[0]}` };
    }
    results.push({ name, label, ...result });
  };

  check('free-dial', `番号 ${FREE_DIAL} で、止まらずに確認を求められる`, (ctx) => {
    const added = writeFixedContact(ctx, { answer: SCRIPT.contact.replace(EZO.phone, FREE_DIAL), contact: { phone: FREE_DIAL } });
    added.check();
    const shown = fixedThroughReview(ctx, added.id);
    const asked = shown.includes(`電話番号：${FREE_DIAL}\n確認：見慣れない形の番号です`);
    return { passed: asked, detail: asked ? '書いた内容の検査は通り、確認の表示に「確認：見慣れない形の番号です…この番号でよいですか」が出た' : '確認の表示に確認の文が出ませんでした', shown };
  });
  check('retiree', '連絡先の相手が田中さん（退職する本人）だと止まる', (ctx) =>
    stops(() => writeFixedContact(ctx, { answer: `${SCRIPT.contact}分からないことは田中に聞きます。`, contact: { name: '田中' } }).check(), /退職する担当者を連絡先に載せないでください/));
  check('not-a-number', '番号でない番号（分からない）は止まる', (ctx) =>
    stops(() => writeFixedContact(ctx, { answer: `${SCRIPT.contact}番号は分からない。`, contact: { phone: '分からない' } }).check(), /番号の形ではありません/));
  check('password-contact', 'パスワードの本体らしい答えは、連絡先を足す前に断る', ({ tool }) =>
    stops(() => tool('update-add-contact', ['vendor'], 'エゾクロテン電設のパスワードは abcd1234 です。'), /パスワードの本体/));
  check('password-device', 'パスワードの本体らしい答えは、機器を足す前に断る', ({ tool }) =>
    stops(() => tool('update-add-device', [], '停電用の予備の電池のパスワードは abcd1234 です。'), /パスワードの本体/));
  results.push((() => {
    const base = join(dir, 'round');
    mkdirSync(base, { recursive: true });
    writeJson(join(base, 'manual.json'), { ...readJson(join(SAMPLE, 'manual.json')), round: '../../x' });
    const result = stops(() => run('update-start', [UPDATER], { work: join(base, 'hikitsugi-work'), stdin: '' }), /回の番号が正しくありません/);
    return { name: 'round', label: '回の番号がおかしい manual.json からは更新を始められない', ...result };
  })());
  return results;
}

// ─── API を使う通し ───

const UPDATES = [
  { name: 'contact', label: '連絡先を足す（エゾクロテン電設）', start: (tool) => tool('update-add-contact', ['vendor'], SCRIPT.contact) },
  { name: 'symptom', label: '症状を足す（分電盤）', start: (tool) => tool('update-add', [], SCRIPT.symptom) },
  { name: 'device', label: '機器を足す（予備の電池）', start: (tool) => tool('update-add-device', [], SCRIPT.device) },
];

const filesIn = (dir) => (existsSync(dir) ? readdirSync(dir).map((name) => join(dir, name)).filter((path) => statSync(path).isFile()) : []);

/** 結果から、合否の表を作る。 */
export function judge({ base, work, steps, before, identity }) {
  const manual = readJson(join(work, 'manual-final.json'));
  const bundle = readJson(join(base, 'manual.json')).manual;
  const html = readFileSync(join(base, 'manual.html'), 'utf8');
  const phoneFiles = filesIn(join(base, PHONE_DIR));
  const phone = phoneFiles.map((path) => readFileSync(path, 'utf8')).join('\n');
  const text = new Map(manual.statements.map((s) => [s.id, s.text]));
  const contact = manual.contacts.find((c) => c.name === EZO.name);
  const addedPageId = steps.find((step) => step.name === 'symptom')?.target;
  const page = manual.symptom_pages.find((p) => p.id === addedPageId);
  const deviceId = steps.find((step) => step.name === 'device')?.target;
  const device = manual.devices.find((d) => d.id === deviceId);
  const rows = [];
  const row = (group, label, passed, detail) => rows.push({ group, label, passed: Boolean(passed), detail });
  const allDone = steps.length === UPDATES.length && steps.every((step) => step.status === 'update');

  // 合格の条件 1：連絡先を足し、症状ページの ③ にその連絡先を使う
  row('場面', '1. エゾクロテン電設を連絡先として足し、続けて足した分電盤の症状ページの ③ の連絡先になる',
    contact && page && page.fallback?.contact === contact.id,
    `連絡先 ${contact ? `${contact.id}（${contact.phone}）` : 'なし'}、ページ ${page ? `${page.id}「${text.get(page.title)}」の ③ は ${page.fallback?.contact}` : 'なし'}`);
  // 合格の条件 2：機器を足し、会社のIT に載る
  const companyTab = html.slice(html.indexOf('<section id="tab-company"'));
  row('場面', '2. 機器を 1 台足し、「会社のIT」に載る', device && html.includes('<section id="tab-company"') && companyTab.includes(text.get(device.name)),
    device ? `${device.id}「${text.get(device.name)}」` : '機器が足されていません');
  // 合格の条件 3：照合を通り、確認を経て、3 つの出力に出る
  const addedIds = [
    ...(contact ? [contact.role, contact.hours, contact.contract_location, contact.what_to_tell] : []),
    ...(page ? pageStatementIds(page) : []),
    ...(device ? [device.name, device.location, device.purpose, device.impact, device.credential_location, device.credential_none, device.caution] : []),
  ].filter(Boolean);
  const verdicts = new Map();
  for (const name of readdirSync(work)) {
    const match = name.match(/^verification-(\d+)\.json$/);
    if (!match || Number(match[1]) <= before.round) continue;
    for (const result of readJson(join(work, name)).results) verdicts.set(result.statement, result.verdict);
  }
  const unverified = addedIds.filter((id) => verdicts.get(id) !== 'correct');
  const approvals = steps.flatMap((step) => step.reviews ?? []);
  const inBundle = contact && bundle.contacts.some((c) => c.id === contact.id) && page && bundle.symptom_pages.some((p) => p.id === page.id) && device && bundle.devices.some((d) => d.id === device.id);
  const pageTitle = page ? text.get(page.title) : null;
  // スマホ用は番号を区切りごとの span に分けて書くので、タグを除いた文字で比べる
  const phoneText = phone.replace(/<[^>]+>/g, '');
  const phoneShown = contact && phoneText.includes(contact.name) && phoneText.includes(contact.phone.replace(/-/g, '')) && pageTitle && phoneText.includes(pageTitle);
  const pcShown = contact && html.includes(contact.name) && pageTitle && html.includes(pageTitle) && device && html.includes(text.get(device.name));
  row('場面', '3. 足した文が Verifier の照合を通り、更新する人の確認（自動承認）を経て、PC 用・スマホ用・manual.json に出る',
    allDone && addedIds.length && !unverified.length && approvals.length === UPDATES.length && approvals.every((a) => a.decision === APPROVED) && inBundle && phoneShown && pcShown,
    [`足した文 ${addedIds.length} 件のうち、照合で「正しい」でないもの ${unverified.length} 件${unverified.length ? `（${unverified.join('、')}）` : ''}`,
      `確認 ${approvals.length} 回（${approvals.map((a) => `${a.page} ${a.decision}`).join('、')}）`,
      `PC 用 ${pcShown ? '出た' : '出ていない'}、スマホ用 ${phoneShown ? '連絡先と症状ページが出た' : '出ていない'}（機器はスマホ用の束にもともと出さない）、manual.json ${inBundle ? '出た' : '出ていない'}`].join('。'));
  // 合格の条件 4：更新の記録
  const added = manual.updates.slice(-UPDATES.length);
  const kinds = added.map((u) => u.kind).join(',');
  const recorded = kinds === 'add_contact,add,add_device' && added.every((u) => u.by === UPDATER && u.account === identity.account && u.host === identity.host && u.identity_source === 'env');
  row('場面', '4. 更新の記録に、種類（連絡先の追加、機器の追加）、名乗った名前、アカウント名、PC 名が並ぶ',
    recorded && JSON.stringify(bundle.updates) === JSON.stringify(manual.updates), `記録の種類 ${kinds}、名前 ${[...new Set(added.map((u) => u.by))].join('、')}、架空のアカウント名と PC 名 ${recorded ? 'あり' : '違う'}、manual.json にも同じ記録`);
  // 合格の条件 5：既存の検査が足した内容にも効く。通しの出力の全体の検査と、API を使わない検査（別の行）で見る
  const left = manualProblems(manual, readJson(join(work, 'state.json')).retiree);
  row('場面', '5. 既存の検査が足した内容にも効く（通しの出力の全体の検査。止まる側は「追加の検査」の行）', allDone && !left.length, left.length ? left.slice(0, 5).join(' / ') : '全体の検査で問題なし。各更新で check-writer の検査を通った');

  // アカウント名と PC 名を画面に出さない
  const fictionalShown = [identity.account, identity.host].filter((value) => html.includes(value) || phone.includes(value));
  const realShown = checkSecretFiles([join(base, 'manual.html'), join(base, PHONE_DIR)]).filter((problem) => /アカウント名|PC 名/.test(problem));
  row('画面', 'PC 用（印刷を含む）とスマホ用の画面に、アカウント名と PC 名が出ていない', !fictionalShown.length && !realShown.length,
    `架空の値が出た箇所 ${fictionalShown.length} 件、この PC の実際の値が出た箇所 ${realShown.length} 件（スマホ用 ${phoneFiles.length} ファイルを見た）`);
  return rows;
}

/** 撮影プログラムの自動検査をかける。 */
function screenshotChecks(base, out) {
  const targets = [
    { label: 'PC 用の HTML（manual.html）', input: join(base, 'manual.html'), output: join(out, 'pc') },
    { label: 'スマホ用の束', input: join(base, PHONE_DIR), output: join(out, 'phone') },
  ];
  return targets.map(({ label, input, output }) => {
    const started = Date.now();
    const result = spawnSync(process.execPath, [join(ROOT, 'scripts/screenshots.mjs'), input, output], { encoding: 'utf8', timeout: 15 * 60 * 1000, env: { ...process.env } });
    const log = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    writeFileSync(`${output}.log`, log);
    return { label, exit_code: result.status, passed: result.status === 0, seconds: Math.round((Date.now() - started) / 1000), tail: log.trim().split('\n').slice(-8) };
  });
}

async function main() {
  const { values } = parseArgs({ options: { limit: { type: 'string' }, 'results-dir': { type: 'string' }, 'no-shots': { type: 'boolean' }, 'checks-only': { type: 'boolean' }, judge: { type: 'string' } } });
  const limit = Number(values.limit ?? 5);
  // 保存した結果から、合否の表だけを作り直す（API は呼ばない）。前の表は gates_before_rejudge に残す
  if (values.judge) {
    const summary = readJson(join(values.judge, 'summary.json'));
    const live = { base: join(values.judge, 'live'), work: join(values.judge, 'live/hikitsugi-work') };
    const before = { round: readJson(join(SAMPLE, 'manual.json')).round };
    const gates = judge({ ...live, steps: summary.steps, before, identity: summary.identity });
    writeJson(join(values.judge, 'summary.json'), { ...summary, gates_before_rejudge: summary.gates_before_rejudge ?? summary.gates, gates, rejudged_at: new Date().toISOString() });
    for (const gate of gates) console.log(`${gate.passed ? '合格' : '不合格'}　${gate.label}：${gate.detail}`);
    return [...summary.checks, ...gates, ...summary.screenshots].every((item) => item.passed) ? 0 : 1;
  }
  // 実際の PC の名前を残さない。外から渡された値があっても、架空の値に揃える
  process.env[IDENTITY_ENV] = JSON.stringify(FICTIONAL_IDENTITY);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  const dir = join(values['results-dir'] ?? join(ROOT, 'eval/results'), `${stamp}-okojo-stage1-update`);
  mkdirSync(dir, { recursive: true });
  const summary = { label: '模擬評価', what: '段 1 の更新の自動の通し（架空のオコジョ精工）', identity: FICTIONAL_IDENTITY, review: `更新する人の確認は「このままでよい」を${APPROVED}`, started_at: new Date().toISOString() };

  const checks = apiFreeChecks(join(dir, 'checks'));
  summary.checks = checks.map(({ shown: _shown, ...item }) => item);
  for (const item of checks) console.log(`${item.passed ? '合格' : '不合格'}　${item.label}：${item.detail}`);
  if (values['checks-only']) {
    writeJson(join(dir, 'summary.json'), summary);
    console.log(`保存先：${dir}`);
    return checks.every((item) => item.passed) ? 0 : 1;
  }

  const api = await clientOf();
  const live = startFromSample(join(dir, 'live'));
  const before = { round: live.read('state.json').round };
  summary.update_start = live.started;
  console.log(live.started);
  const calls = [];
  let spent = 0;
  const record = ({ raw_text: _raw, ...call }) => {
    calls.push(call);
    spent += call.cost_usd ?? 0;
  };
  const startedAll = Date.now();
  summary.steps = [];
  for (const item of UPDATES) {
    const from = calls.length;
    const started = Date.now();
    const reviews = [];
    let status;
    let error;
    let target;
    try {
      console.log(item.start(live.tool));
      target = live.read('state.json').update.target;
      status = await driveUpdate({
        work: live.work,
        api,
        record,
        overBudget: () => spent > limit,
        review: ({ page, tool }) => {
          const shown = tool('review-show', [page]);
          tool('review-ok', [page]);
          reviews.push({ page, decision: APPROVED, shown, at: new Date().toISOString() });
        },
      });
    } catch (failure) {
      status = 'error';
      error = failure.message;
    }
    const mine = calls.slice(from);
    const byAgent = {};
    for (const call of mine) byAgent[call.agent] = (byAgent[call.agent] ?? 0) + 1;
    const step = { name: item.name, label: item.label, target, status, ...(error ? { error } : {}), cost_usd: Number(mine.reduce((total, call) => total + (call.cost_usd ?? 0), 0).toFixed(4)), seconds: Math.round((Date.now() - started) / 1000), calls: byAgent, reviews };
    summary.steps.push(step);
    console.log(JSON.stringify({ ...step, reviews: reviews.map(({ shown: _shown, ...review }) => review) }));
    if (status !== 'update' || spent > limit) break;
  }
  summary.cost_usd = Number(spent.toFixed(4));
  summary.unknown_cost_calls = calls.filter((call) => call.cost_usd === null).length;
  summary.seconds = Math.round((Date.now() - startedAll) / 1000);
  summary.history = live.tool('history');
  writeJson(join(dir, 'calls.json'), calls);

  // Verifier の判定を、回ごとにまとめる
  summary.verifier = readdirSync(live.work)
    .map((name) => name.match(/^verification-(\d+)\.json$/))
    .filter((match) => match && Number(match[1]) > before.round)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map((match) => {
      const counts = {};
      for (const result of readJson(join(live.work, match[0])).results) counts[result.verdict] = (counts[result.verdict] ?? 0) + 1;
      return { round: Number(match[1]), file: `live/hikitsugi-work/${match[0]}`, counts };
    });
  summary.gates = existsSync(join(live.base, 'manual.html')) ? judge({ ...live, steps: summary.steps, before, identity: FICTIONAL_IDENTITY }) : [];
  summary.screenshots = values['no-shots'] || !summary.steps.every((step) => step.status === 'update') ? [] : screenshotChecks(live.base, join(dir, 'shots'));
  summary.finished_at = new Date().toISOString();
  writeJson(join(dir, 'summary.json'), summary);
  for (const gate of summary.gates) console.log(`${gate.passed ? '合格' : '不合格'}　${gate.label}：${gate.detail}`);
  for (const shot of summary.screenshots) console.log(`${shot.passed ? '合格' : '不合格'}　撮影の検査 ${shot.label}（終了コード ${shot.exit_code}、${shot.seconds} 秒）`);
  console.log(`費用 $${summary.cost_usd.toFixed(4)}、時間 ${summary.seconds} 秒`);
  console.log(`保存先：${dir}`);
  const passed = [...checks, ...summary.gates, ...summary.screenshots].every((item) => item.passed) && summary.gates.length > 0;
  return passed ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main();
}
