// 公開前の採点で残った指摘の直し（11/15、本人の決定）
// - 「記録がありません」の文は、赤い × ではなく、注意として読める見た目（点線の枠と ？ の記号）で出す。文は変えない
// - 「挿す」「挿し直す」などの表記は、画面に出すときに「差す」にそろえる。記録（manual.json）の文と手順部品は変えない

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { forDisplay, unifyNotation } from '../plugin/lib/display.mjs';
import { arrowOf } from '../plugin/lib/figure-build.mjs';
import { renderPhoneBundle } from '../plugin/renderer/phone.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';

const fixture = () => {
  const raw = JSON.parse(readFileSync(new URL('./fixtures/manual-full.json', import.meta.url), 'utf8'));
  return structuredClone(raw.manual ?? raw);
};

test('表記：動詞の「挿」は「差」にそろえ、名詞の「挿入」「挿絵」は変えない', () => {
  assert.equal(unifyNotation('電源アダプターを挿して、挿し直し、挿し込みます。挿さっています。'), '電源アダプターを差して、差し直し、差し込みます。差さっています。');
  assert.equal(unifyNotation('USB を挿入します。挿絵があります。'), 'USB を挿入します。挿絵があります。');
});

test('表記：画面に出す文だけをそろえ、記録の文は変えない。絵の並べ方の記録の文も同じにそろえ、絵が外れない。矢印の向きと文字は「差す」の形で、一覧と食い違わない', () => {
  const manual = fixture();
  const step = manual.statements.find((statement) => !statement.library);
  step.text = 'ルーターの電源プラグを挿し直してください。';
  manual.figures = [{ step: step.id, text: step.text, items: [{ part: 'router', label: 'ルーター' }, { part: 'power', label: '電源プラグ' }] }];
  const shown = forDisplay(manual);
  assert.equal(shown.statements.find((statement) => statement.id === step.id).text, 'ルーターの電源プラグを差し直してください。');
  assert.equal(shown.figures[0].text, 'ルーターの電源プラグを差し直してください。');
  assert.equal(step.text, 'ルーターの電源プラグを挿し直してください。', '記録の文は変えない');
  // 部品の文は変えない
  for (const statement of shown.statements.filter((entry) => entry.library)) assert.equal(statement.text, manual.statements.find((entry) => entry.id === statement.id).text);
  assert.deepEqual(arrowOf('ルーターの電源プラグを挿し直してください。'), { direction: 'toward', label: '差し直す' });
  assert.deepEqual(arrowOf('ルーターの電源プラグを差し直してください。'), { direction: 'toward', label: '差し直す' });
});

test('「記録がありません」の帯は、点線の枠と ？ の記号（band-norecord）。ほかの例外の帯は今のまま。PC 用とスマホ用で同じ', () => {
  const manual = fixture();
  const exception = manual.statements.find((statement) => statement.id === 'STM-103');
  exception.text = '空きがあるのに届かないときの対応は、記録がありません。イタチ事務機に連絡してください。';
  const html = renderManual(manual);
  const pageHtml = html.slice(html.indexOf('id="symptom-T4"'), html.indexOf('</article>', html.indexOf('id="symptom-T4"')));
  assert.match(pageHtml, /<p class="band band-norecord"><svg class="icon" role="presentation"><use href="#i-help"\/><\/svg><span>空きがあるのに届かないときの対応は、記録がありません。/);
  assert.match(pageHtml, /<p class="band band-exception">.*?帯が赤ければ/);
  assert.doesNotMatch(pageHtml, /<p class="band band-exception">(?:(?!<\/p>)[^])*記録がありません/);
  const phone = renderPhoneBundle(manual).map((file) => file.html).join('\n');
  assert.match(phone, /<p class="band band-norecord"><svg viewBox="0 0 24 24" role="presentation">.*?<\/svg><span>空きがあるのに届かないときの対応は、記録がありません。/);
  assert.match(phone, /\.band-norecord\s*\{[^}]*border:\s*1\.5px dashed var\(--line-strong\)/);
});
