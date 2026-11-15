#!/usr/bin/env node
// 公開前の採点（docs/review/prepublish-rubric.md）。決められた役を Claude Opus に演じさせ、README・サンプル・入れる手順を採点する。
// 採点する人は呼び出しごとに新しく、前の回の点も指摘も渡さない。渡すのは役ごとの「読むもの」だけ（評価セット、正解、holdout、開発の記録は渡さない）。
// 使い方：node --env-file=.env eval/prepublish-score.mjs --round <1|2> [--raters 2] [--dry-run]
//   --dry-run：API に送らず、入力の量（無料の数え方）と費用の見積もりだけを出す

import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildRequest, callAgent, clientOf, loadAgent, stripUnsupported, tagged } from './lib/adapters/live.mjs';
import { costOf } from './lib/pricing.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

export const SCALE = '5＝迷わずできる・分かる、4＝少し迷うができる、3＝読み直せばできる、2＝一部しかできない・誤解しそう、1＝できない・誤解する';

// 役と項目。docs/review/prepublish-rubric.md と同じ文
export const ROLES = {
  successor: {
    label: '後任',
    role: '事務職。IT の経験はない。前任者が退職した翌週に、社員から「ネットがつながらない」と言われた。手元にあるのは、前任者が作った IT の取扱説明書（サンプル）と、その説明',
    items: [
      '困りごと（「ネットがつながらない」「印刷できない」）から、正しいページにたどり着ける',
      'そのページで、自分でやること・やってはいけないこと・連絡する相手が分かる',
      '手順の言葉と絵で、触る物（ケーブル、電源アダプター、ランプ）が分かる',
      '社員に何と返せばよいかが分かる',
      '説明書に書いていない困りごとのとき、どうすればよいかが分かる',
    ],
  },
  president: {
    label: '社長',
    role: '従業員 30 人の会社の社長。IT を兼任で見てきた社員が退職する。この道具を入れるかを決める',
    items: [
      '何をする道具で、何をしないか（直さない、監視しない、本人確認しない）が分かる',
      '前任者の手間（時間、問数）と費用が分かる',
      '数字の読み方（模擬評価であること、幅、上限であること）を誤解しない',
      '安全（パスワードを集めない、外に送らない、置き場所）の説明で判断できる',
      '入れるかどうかを、追加で人に聞かずに決められる',
    ],
  },
  engineer: {
    label: '技術者',
    role: '初めてこのリポジトリを見る技術者。Claude Code は使える。社長に頼まれて、入れて試す',
    items: [
      '要るもの（Node.js、Claude Code、契約か API キー）と、「今すぐ見る」（入れずに見る）と「使ってみる」（入れて動かす）の違いが分かる',
      '書いてある手順どおりに入れて、最初の質問まで進める（手順の抜け、古い名前、存在しないパスがない）',
      '何がどこにあり、何が AI で何がプログラムかが分かる',
      'データの扱い（集めるもの、集めないもの、残る場所）が確かめられる',
      '限界と未検証の範囲が、隠れずに書いてある',
    ],
  },
};

const SCHEMA = stripUnsupported({
  type: 'object',
  additionalProperties: false,
  required: ['scores', 'findings'],
  properties: {
    scores: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['item', 'score', 'reason'], properties: { item: { type: 'integer' }, score: { type: 'integer' }, reason: { type: 'string' } } },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['where', 'quote', 'problem', 'suggestion', 'kind', 'stops_use'],
        properties: { where: { type: 'string' }, quote: { type: 'string' }, problem: { type: 'string' }, suggestion: { type: 'string' }, kind: { enum: ['wording', 'data_or_behavior'] }, stops_use: { type: 'boolean' } },
      },
    },
  },
});

/** README から見出し（## の行）で節を切り出す。 */
export function readmeSection(readme, heading) {
  const start = readme.indexOf(`\n## ${heading}`);
  if (start < 0) throw new Error(`README に「${heading}」の節がありません`);
  const next = readme.indexOf('\n## ', start + 1);
  return readme.slice(start + 1, next < 0 ? undefined : next).trim();
}

/** HTML から、読む人に見える文字だけを取り出す（スマホ用の束は JavaScript を使わないので、これで全文になる）。 */
export const textOfHtml = (html) =>
  html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '［絵］').replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|li|h\d|div|section|tr)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n\s*\n+/g, '\n').trim();

const image = (path) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: readFileSync(join(ROOT, path)).toString('base64') } });

/** 役ごとの「読むもの」。文字の資料と画像。 */
export function materialsOf(roleId) {
  const readme = read('README.md');
  if (roleId === 'successor') {
    const dir = join(ROOT, 'samples/okojo/phone');
    const phone = readdirSync(dir).filter((name) => name.endsWith('.html')).sort().map((name) => `### ${name.replace(/\.html$/, '')}\n${textOfHtml(readFileSync(join(dir, name), 'utf8'))}`).join('\n\n');
    return {
      texts: { 'README の「今すぐ見る」': readmeSection(readme, '今すぐ見る（インストール不要）'), 'README の「使う場面の例」': readmeSection(readme, '使う場面の例（架空）'), 'サンプルの説明書（スマホ用の束、全ファイルの文字）': phone },
      images: [['PC 用の画面：工場の Wi-Fi が切れるときのページ（pc-figure-page.png）', 'docs/images/pc-figure-page.png'], ['PC 用の画面：測定室の検査用 PC のページ（free-item.png）', 'docs/images/free-item.png'], ['PC 用の画面：更新で足したページ（added-page.png）', 'docs/images/added-page.png']],
    };
  }
  if (roleId === 'president') return { texts: { README: readme }, images: [] };
  const check = read('docs/review/prepublish-check.md');
  const install = check.slice(check.indexOf('## 1.'), check.indexOf('## 2.')).trim();
  const tree = execFileSync('git', ['ls-files', 'plugin', '.claude-plugin'], { cwd: ROOT, encoding: 'utf8' }).trim();
  return { texts: { README: readme, '入れる手順を確かめた記録（docs/review/prepublish-check.md の 1）': install, 'plugin/ と .claude-plugin/ のファイルの一覧': tree, LICENSE: read('LICENSE') }, images: [] };
}

export function scoreRequest(roleId, agent = loadAgent('eval/agents/prepublish-scorer.md')) {
  const role = ROLES[roleId];
  const { texts, images } = materialsOf(roleId);
  const intro = tagged({ role: role.role, items: role.items.map((item, index) => `${index + 1}. ${item}`).join('\n'), scale: SCALE });
  const materials = Object.entries(texts).map(([name, text]) => `<material name="${name}">\n${text}\n</material>`).join('\n\n');
  const content = [
    ...images.flatMap(([name, path]) => [{ type: 'text', text: `画像：${name}` }, image(path)]),
    { type: 'text', text: `${intro}\n\n<materials>\n${materials}\n</materials>\n\n${role.label}として読み、items の 5 項目に点を付け、指摘を返してください。` },
  ];
  return buildRequest(agent, SCHEMA, content, { maxTokens: 16000 });
}

async function main() {
  const { values } = parseArgs({ options: { round: { type: 'string' }, raters: { type: 'string' }, 'dry-run': { type: 'boolean' } } });
  if (!values.round) throw new Error('使い方：--round <1|2> [--raters 2] [--dry-run]');
  const raters = Number(values.raters ?? 2);
  const api = await clientOf();
  const agent = loadAgent('eval/agents/prepublish-scorer.md');
  if (values['dry-run']) {
    let total = 0;
    for (const roleId of Object.keys(ROLES)) {
      const params = scoreRequest(roleId, agent);
      const { model, system, thinking, output_config, messages } = params;
      const { input_tokens: tokens } = await api.messages.countTokens({ model, system, thinking, output_config, messages });
      // 出力は 1 回 8,000 トークンと多めに見積もる
      const cost = costOf(model, { input_tokens: tokens, output_tokens: 8000 });
      total += cost * raters;
      console.log(`${ROLES[roleId].label}：入力 ${tokens} トークン、1 回 約 $${cost.toFixed(2)}`);
    }
    console.log(`見積もり（${raters} 人ずつ）：約 $${total.toFixed(2)}`);
    return;
  }
  const out = join(ROOT, 'eval/results', `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-prepublish-score-r${values.round}`);
  mkdirSync(out, { recursive: true });
  const calls = [];
  const record = ({ raw_text: _raw, ...call }) => calls.push(call);
  const jobs = Object.keys(ROLES).flatMap((roleId) => Array.from({ length: raters }, (_, index) => ({ roleId, rater: index + 1 })));
  const results = await Promise.all(jobs.map(async ({ roleId, rater }) => {
    const parsed = await callAgent({ api, agent, params: scoreRequest(roleId, agent), record });
    writeFileSync(join(out, `${roleId}-${rater}.json`), JSON.stringify(parsed, null, 2));
    return { roleId, rater, total: parsed.scores.reduce((sum, entry) => sum + entry.score, 0), scores: parsed.scores.map((entry) => entry.score), findings: parsed.findings.length };
  }));
  const cost = calls.reduce((sum, call) => sum + (call.cost_usd ?? 0), 0);
  writeFileSync(join(out, 'summary.json'), JSON.stringify({ label: '模擬評価（公開前の採点）', round: Number(values.round), results, calls, cost_usd: cost }, null, 2));
  for (const roleId of Object.keys(ROLES)) {
    const mine = results.filter((entry) => entry.roleId === roleId);
    const totals = mine.map((entry) => entry.total);
    console.log(`${ROLES[roleId].label}：${mine.map((entry) => `${entry.total}（${entry.scores.join('・')}）`).join('、')}　平均 ${(totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1)}、揺れ ${Math.max(...totals) - Math.min(...totals)}`);
  }
  console.log(`費用：$${cost.toFixed(4)}　保存先：${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
