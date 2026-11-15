// 操作の図の決まりを確かめる。枠と文字と暖色の印だけで、1枚 2KB 以内。承認した図だけを、共有フォルダの ① の3手順にだけ出す。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { firstStepFigures } from '../plugin/lib/figures.mjs';
import { renderPhoneBundle } from '../plugin/renderer/phone.mjs';
import { renderManual } from '../plugin/renderer/render.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const { figures } = read('../plugin/library/figures.json');
const parts = new Set(read('../plugin/library/procedures.json').procedures.map((part) => part.id));

test('図は共有フォルダの ① の3手順分で、部品に対応する', () => {
  assert.deepEqual(Object.keys(figures), ['LIB-001', 'LIB-002', 'LIB-013']);
  for (const id of Object.keys(figures)) assert.ok(parts.has(id), id);
});

test('図：1枚 2KB 以内で、枠と文字と暖色の印だけ。読み込みも実在のアイコンの形もない', () => {
  for (const [id, figure] of Object.entries(figures)) {
    assert.ok(Buffer.byteLength(figure.svg) <= 2048, id);
    assert.match(figure.svg, /role="img" aria-label="[^"]+"/, id);
    assert.match(figure.svg, /var\(--accent\)/, id);
    assert.doesNotMatch(figure.svg, /<(?:style|script|image|use|a|foreignObject|linearGradient)\b|href|url\(|font-family/i, id);
    const tags = new Set([...figure.svg.matchAll(/<([a-z]+)\b/g)].map((m) => m[1]));
    for (const tag of tags) assert.ok(['svg', 'rect', 'path', 'text'].includes(tag), `${id}: ${tag}`);
    // 暖色は押す場所の印にだけ使う。赤は部品の文面にある×にだけ使う
    assert.equal((figure.svg.match(/var\(--accent\)/g) ?? []).length, 1, `${id}: 暖色の印は1つだけ`);
    assert.equal((figure.svg.match(/var\(--danger-fg\)/g) ?? []).length, id === 'LIB-013' ? 1 : 0, `${id}: 赤は×だけ`);
    const colors = [...figure.svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]);
    for (const color of colors) assert.ok(['none', 'currentColor'].includes(color), `${id}: ${color}`);
  }
});

const FIGURE = /<svg class="step-figure"/g;
const figureCount = (html) => (html.match(FIGURE) ?? []).length;
const fixture = () => read('./fixtures/manual-full.json');

test('図は本人が承認している', () => {
  for (const [id, figure] of Object.entries(figures)) {
    assert.equal(figure.status, 'approved', id);
    assert.equal(figure.reviewed_by, 'Okojyo-Soft', id);
  }
});

test('未承認の図は画面に出さない', () => {
  const manual = fixture();
  const page = manual.symptom_pages.find((candidate) => candidate.id === 'T3');
  assert.equal(firstStepFigures(page, manual).size, 3);
  const drafts = Object.fromEntries(Object.entries(figures).map(([id, figure]) => [id, { ...figure, status: id === 'LIB-002' ? 'draft' : figure.status }]));
  assert.equal(firstStepFigures(page, manual, { figures: drafts }).size, 2);
});

// 承認済みの手描きの図（3 枚）。型から作る絵（キーの絵など）と見分けるため、説明の文で数える
const handCount = (html) => Object.values(figures).filter((figure) => html.includes(figure.alt)).length;
const handTotal = (html) => Object.values(figures).reduce((sum, figure) => sum + html.split(`aria-label="${figure.alt}"`).length - 1, 0);

test('PC 用では、手描きの図は共有フォルダの ① の3手順にだけ出る。ほかの手順には型から作った絵が出る', () => {
  const html = renderManual(fixture());
  assert.equal(handTotal(html), 3);
  const article = html.match(/<article[^>]*id="symptom-T3"[\s\S]*?<\/article>/)[0];
  const first = article.match(/<section class="first">[\s\S]*?<\/section>/)[0];
  assert.equal(figureCount(first), 3);
  for (const id of ['LIB-001', 'LIB-002', 'LIB-013']) assert.ok(first.includes(figures[id].alt), id);
  // 同じ LIB-001（Windows キー＋E）を「やること」で使うページには、手描きの図でなく、型から作ったキーの絵が出る
  const other = html.match(/<article[^>]*id="symptom-T4"[\s\S]*?<\/article>/)[0];
  assert.equal(handCount(other), 0);
  assert.match(other, /aria-label="キーボードのWindowsのキーとEのキーを、同時に押す図"/);
});

test('束でも、手描きの図は共有フォルダの ① の3手順にだけ出る。同じ部品を「やること」で使うページには型から作った絵が出る', () => {
  const manual = fixture();
  const other = manual.symptom_pages.find((page) => page.id === 'T4');
  const parts = other.steps.map((id) => manual.statements.find((statement) => statement.id === id).library);
  assert.ok(parts.includes('LIB-001') && parts.includes('LIB-002'));
  const files = renderPhoneBundle(manual);
  const withHand = files.filter((file) => handCount(file.html) > 0);
  assert.equal(withHand.length, 1);
  assert.equal(handTotal(withHand[0].html), 3);
  assert.ok(withHand[0].name.includes('共有フォルダ'));
  assert.ok(files.some((file) => !file.name.includes('共有フォルダが見えない') && /キーボードのWindowsのキーとEのキーを、同時に押す図/.test(file.html)));
});
