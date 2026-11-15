#!/usr/bin/env node
// README の「約 25 分答えると、何が手に入るか」の表を、サンプル（samples/okojo/manual.json）から数えて作る。手で数を書かない。
// test/samples.test.mjs が、README の表がこの出力と同じかを確かめる。
// 使い方：node scripts/sample-counts.mjs

import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { measureFigures } from '../eval/figure-report.mjs';

const SAMPLE = new URL('../samples/okojo/manual.json', import.meta.url);
const BADGES = [['self', '自分で直せる'], ['check_first', '確認してから'], ['vendor', '業者へ連絡'], ['internal', '社内で相談']];

/** サンプルの数。出来上がった物の数で、効果の数字ではない。 */
export function sampleCounts(bundle = JSON.parse(readFileSync(SAMPLE, 'utf8'))) {
  const manual = bundle.manual;
  const figures = measureFigures(manual);
  const badge = Object.fromEntries(BADGES.map(([value]) => [value, manual.symptom_pages.filter((page) => page.badge?.value === value).length]));
  return {
    pages: manual.symptom_pages.length,
    badge,
    replies: manual.symptom_pages.filter((page) => page.reply_to_staff).length,
    contacts: manual.contacts.length,
    routines: (manual.routines ?? []).length,
    devices: (manual.devices ?? []).length,
    figured: figures.figured,
    steps: figures.slots,
    noRecord: manual.statements.filter((statement) => statement.text.includes('記録がありません')).length,
  };
}

/** README に載せる表（Markdown）。 */
export function countsTable(counts = sampleCounts()) {
  const badges = BADGES.map(([value, label]) => `${label} ${counts.badge[value]}`).join('、');
  return [
    '| 手に入るもの | サンプルの数 |',
    '|---|---|',
    `| 症状のページ | ${counts.pages}（${badges}） |`,
    `| 社員に返す文が付いたページ | ${counts.replies} |`,
    `| 連絡先（業者と社内の相談先） | ${counts.contacts} |`,
    `| 決まった作業（毎週・毎月・毎年） | ${counts.routines} |`,
    `| 会社の機器・ソフト | ${counts.devices} |`,
    `| 絵が付いた手順 | ${counts.figured}（手順 ${counts.steps} のうち） |`,
    `| 「記録がありません」と明示した所 | ${counts.noRecord} |`,
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) console.log(countsTable());
