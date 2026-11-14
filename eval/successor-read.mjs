#!/usr/bin/env node
// 通読の評価（模擬評価）。IT 未経験の後任の役のモデルが、スマホ用の束の症状のページを文字だけで読み、
// 止まるところと迷うところを挙げる。11/4 の佐藤さん役の通読（docs/review/successor-read.md）を、API で同じ形で測り直すためのもの。
// 引用はプログラムがページの文字と照らし、合わないものは数えない。
//
// 使い方：node --env-file=.env eval/successor-read.mjs <通しの結果のフォルダ>...
//         結果は各フォルダの successor-read.json に残す。すでにあれば呼び直さない
//         --out <名前> で保存先の名前を変えられる（同じ説明書を読み直して、読むたびの揺れを見るため）
// 調整用の会社の結果だけを読む（holdout のフォルダは受け付けない）

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { prepareForRender } from '../plugin/lib/handover.mjs';
import { renderPhoneBundle } from '../plugin/renderer/phone.mjs';
import { buildRequest, callAgent, clientOf, loadAgent, tagged } from './lib/adapters/live.mjs';

const TUNING = /-(okojo|kuzuri|kinodoten)-pipeline$/;
export const CATEGORIES = ['identify', 'wait', 'confirm', 'missing', 'term', 'other'];
export const SEVERITIES = ['止まる', '迷う', '意味が分からない'];

const FINDINGS = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file', 'quote', 'severity', 'category', 'reason'],
        properties: {
          file: { type: 'string' },
          quote: { type: 'string' },
          severity: { enum: SEVERITIES },
          category: { enum: CATEGORIES },
          reason: { type: 'string' },
        },
      },
    },
  },
};

/** スマホ用の束の 1 ファイルを、画面に出る文字だけにする。図（SVG）と見えない部分は除く。 */
export function visibleText(html) {
  return html
    .replace(/<(style|script|svg|head)[\s\S]*?<\/\1>/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/(p|li|h1|h2|h3|section|div|tr)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
}

/** 症状のページだけ（連絡先の一覧と「当てはまる症状がないとき」は除く）。 */
export function symptomPages(manual) {
  return renderPhoneBundle(prepareForRender(manual).manual)
    .filter((file) => !/^(00|99)[ _]/.test(file.name))
    .map((file) => ({ file: file.name.replace(/\.html$/, ''), text: visibleText(file.html) }));
}

const compact = (text) => text.normalize('NFKC').replace(/\s+/g, '');

/** 引用がそのページの文字にあるものだけを数える。区分ごと、重さごとの数を返す。 */
export function summarize(findings, pages) {
  const texts = new Map(pages.map((page) => [page.file, compact(page.text)]));
  const checked = findings.map((finding) => ({ ...finding, quote_ok: Boolean(texts.get(finding.file)?.includes(compact(finding.quote))) }));
  const ok = checked.filter((finding) => finding.quote_ok);
  const count = (key, values) => Object.fromEntries(values.map((value) => [value, ok.filter((finding) => finding[key] === value).length]));
  return { findings: checked, counted: ok.length, dropped_quotes: checked.length - ok.length, by_category: count('category', CATEGORIES), by_severity: count('severity', SEVERITIES), page_quality: ok.filter((finding) => ['identify', 'wait', 'confirm'].includes(finding.category)).length };
}

export async function readThrough({ dir, client, record = () => {} }) {
  const manual = JSON.parse(readFileSync(join(dir, 'manual-final.json'), 'utf8'));
  const pages = symptomPages(manual);
  const agent = loadAgent('eval/agents/successor-reader.md');
  const api = await clientOf(client);
  const params = buildRequest(agent, FINDINGS, tagged({ company: manual.company_name, pages }));
  const parsed = await callAgent({ api, agent, params, record });
  return { pages: pages.length, ...summarize(parsed.findings, pages) };
}

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf('--out');
  const outName = at >= 0 ? args.splice(at, 2)[1] : 'successor-read.json';
  const dirs = args;
  if (!dirs.length) throw new Error('使い方：node --env-file=.env eval/successor-read.mjs <通しの結果のフォルダ>...');
  for (const dir of dirs) if (!TUNING.test(basename(dir))) throw new Error(`調整用の会社の通しの結果だけを読みます：${dir}`);
  for (const dir of dirs) {
    const out = join(dir, outName);
    if (existsSync(out)) {
      console.log(`${basename(dir)}：保存済み`);
      continue;
    }
    const calls = [];
    const result = await readThrough({ dir, record: (call) => calls.push(call) });
    const cost = calls.reduce((sum, call) => (sum === null || call.cost_usd === null ? null : sum + call.cost_usd), 0);
    writeFileSync(out, JSON.stringify({ label: '模擬評価', reader: 'successor-reader（Opus、文字だけ）', ...result, calls, cost_usd: cost }, null, 2) + '\n');
    console.log(`${basename(dir)}：ページ ${result.pages}、指摘 ${result.counted}（引用が合わず除いた ${result.dropped_quotes}）、見分け方・待つ時間・確かめ方 ${result.page_quality}、費用 $${cost?.toFixed(3)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
