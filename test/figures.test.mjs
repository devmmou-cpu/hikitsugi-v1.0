// 手順の絵：キーの絵と、部品を並べる絵。承認済みの型と部品だけから、プログラムが組み立てる。AI も通信も使わない。

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { arrowOf, arrowSidesInText, figureCandidate, figureProblems, holdLabel, keyFigure, loadKit, partsFigure, readKeys, stepFigures } from '../plugin/lib/figure-build.mjs';

const kit = loadKit();
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));

test('型と部品は本人が承認したもの。部品は 10 個（物の 8 個と、矢印、×印）', () => {
  assert.equal(kit.status, 'approved');
  assert.equal(kit.reviewed_by, 'Okojyo-Soft');
  assert.equal(Object.keys(kit.parts).length + 2, 10);
  assert.ok(kit.arrows.left && kit.arrows.right && kit.cross);
});

test('組み立てた絵は、今の図と同じ要素と色だけを使う（AI の出力を SVG として入れない）', () => {
  const figures = [
    keyFigure(readKeys('Ctrl キーを押しながら C のキーを押してください。')),
    keyFigure(readKeys('Shift キーを 3 秒長押ししてください。')),
    partsFigure({ items: [{ part: 'router', label: 'AP' }, { part: 'power', label: '電源アダプター' }] }, 'AP の電源アダプターを抜いてください。').svg,
    partsFigure({ items: [{ part: 'lamp', label: '' }] }, 'ランプが点滅していれば、待ってください。').svg,
  ];
  for (const svg of figures) {
    const tags = new Set([...svg.matchAll(/<([a-z]+)\b/g)].map((m) => m[1]));
    for (const tag of tags) assert.ok(['svg', 'rect', 'path', 'text', 'g'].includes(tag), tag);
    for (const [, color] of svg.matchAll(/(?:fill|stroke)="([^"]+)"/g)) assert.ok(['none', 'currentColor'].includes(color), color);
    for (const [, style] of svg.matchAll(/style="([^"]+)"/g)) assert.match(style, /^stroke:var\(--(?:accent|danger-fg)\)$/);
    assert.doesNotMatch(svg, /<script|on[a-z]+=|href/);
  }
});

test('キーの絵：書き方の揺れを読み、読めないときは絵にしない', () => {
  assert.deepEqual(readKeys('キーボードの Windows キーを押しながら、E のキーを押してください。').keys, ['Windows', 'E']);
  assert.deepEqual(readKeys('Ctrl キーを押しながら C のキーを押してください。').keys, ['Ctrl', 'C']);
  assert.deepEqual(readKeys('Ｃｔｒｌ＋Ｓ を押してください。').keys, ['Ctrl', 'S']);
  assert.deepEqual(readKeys('コントロールキーを押しながら「v」のキーを押してください。').keys, ['Ctrl', 'V']);
  assert.deepEqual(readKeys('アドレスを入力して、Enter キーを押してください。').keys, ['Enter']);
  assert.equal(readKeys('Delete キーは押さないでください。'), null);
  assert.equal(readKeys('Fn キーを押してください。'), null);
  assert.equal(readKeys('Ctrl キーと Alt キーと Delete キーと Tab キーを押しながら…'), null);
  assert.equal(readKeys('Esc キーを押して、Enter キーを押してください。'), null);
  assert.equal(readKeys('キーボードを確かめてください。'), null);
});

test('長押しの秒数は、手順の文にあるときだけ添える', () => {
  assert.equal(holdLabel('電源ボタンを長押ししてください。'), '長押し');
  assert.equal(holdLabel('電源ボタンを 4 秒長押ししてください。'), '4秒 長押し');
  assert.match(keyFigure(readKeys('Shift キーを長押ししてください。')), />長押し</);
  assert.doesNotMatch(keyFigure(readKeys('Shift キーを長押ししてください。')), /秒/);
  // 文にない秒数を絵の文字にしない
  assert.match(figureProblems({ step: 'STM-001', items: [{ part: 'power-button', label: '4秒 長押し' }] }, 'NAS の電源ボタンを長押ししてください。', ['4秒 長押しします。']).join(), /「4秒」が手順の文にありません/);
});

test('矢印の向きは動詞の一覧で決める。差す・つなぐは機器へ、抜く・外すは機器から。一覧にない動詞と、両方ある文は付けない', () => {
  assert.deepEqual(arrowOf('電源アダプターを差してください。'), { direction: 'toward', label: '差す' });
  assert.deepEqual(arrowOf('電源アダプターを差し直してください。'), { direction: 'toward', label: '差し直す' });
  assert.deepEqual(arrowOf('ノート PC に、電源アダプターをつないでください。'), { direction: 'toward', label: 'つなぐ' });
  assert.deepEqual(arrowOf('LAN ケーブルを抜いてください。'), { direction: 'away', label: '抜く' });
  assert.equal(arrowOf('ランプの色を確かめてください。'), null);
  assert.equal(arrowOf('電源を抜いて、10秒待ってから差してください。'), null);
  // 絵の矢印は、文と同じ向きで、下に動詞の文字がある
  const away = partsFigure({ items: [{ part: 'router', label: 'AP' }, { part: 'power', label: '' }] }, 'AP の電源アダプターを抜いてください。');
  assert.equal(away.arrow.direction, 'away');
  assert.ok(away.svg.includes(kit.arrows.right) && !away.svg.includes(kit.arrows.left));
  assert.match(away.svg, />抜く</);
  const toward = partsFigure({ items: [{ part: 'router', label: 'AP' }, { part: 'power', label: '' }] }, '電源アダプターを差してください。');
  assert.ok(toward.svg.includes(kit.arrows.left) && !toward.svg.includes(kit.arrows.right));
  assert.match(toward.svg, />差す</);
  const none = partsFigure({ items: [{ part: 'router', label: 'AP' }] }, 'AP のランプを見てください。');
  assert.ok(!none.svg.includes(kit.arrows.left) && !none.svg.includes(kit.arrows.right));
});

test('部品の少ない絵も、幅の基準は部品 3 つ分。大きく引き伸ばさない（11/15）', () => {
  const width = (svg) => Number(svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) /)[1]);
  const one = partsFigure({ items: [{ part: 'lamp', label: 'ランプ' }] }, 'ランプが緑になるまで待ってください。').svg;
  const two = partsFigure({ items: [{ part: 'router', label: 'AP' }, { part: 'power', label: '' }] }, 'AP の電源アダプターを抜いてください。').svg;
  const three = partsFigure({ items: [{ part: 'pc', label: 'PC' }, { part: 'cable', label: '' }, { part: 'router', label: '' }] }, 'PC とルーターのあいだのケーブルを確かめてください。').svg;
  assert.equal(width(one), 334);
  // 矢印のある 2 つは、基準より広くなることがある（狭くはしない）
  assert.ok(width(two) >= 334);
  assert.ok(width(three) >= 334);
});

test('並べ方の検査：部品にない物、文にない物、根拠にない文字、記号、多すぎる部品は通さない', () => {
  const text = '工場の入口に近い柱の上にある AP の、電源アダプターを抜いてください。';
  assert.deepEqual(figureProblems({ step: 'STM-001', items: [{ part: 'router', label: 'AP' }, { part: 'power', label: '電源アダプター' }] }, text), []);
  assert.match(figureProblems({ step: 'STM-001', items: [{ part: 'forklift', label: '' }] }, text).join(), /一覧にない部品/);
  assert.match(figureProblems({ step: 'STM-001', items: [{ part: 'printer', label: '' }] }, text).join(), /「複合機・プリンター」の語がありません/);
  assert.match(figureProblems({ step: 'STM-001', items: [{ part: 'router', label: '2 階の AP' }] }, text).join(), /手順の文にも根拠にもありません/);
  // 根拠にある語なら添えられる
  assert.deepEqual(figureProblems({ step: 'STM-001', items: [{ part: 'router', label: '白い箱' }, { part: 'power', label: '' }] }, text, ['AP は白い箱です。']), []);
  assert.match(figureProblems({ step: 'STM-001', items: [{ part: 'router', label: 'AP<b>' }] }, text, ['AP<b>']).join(), /記号/);
  assert.match(figureProblems({ step: 'STM-001', items: Array.from({ length: 4 }, () => ({ part: 'router', label: '' })) }, text).join(), /1〜3 個/);
});

test('候補の手順は、部品でない文で、物の部品の語があるものだけ', () => {
  assert.equal(figureCandidate({ text: 'NAS の電源ボタンを押してください。', library: null }), true);
  assert.equal(figureCandidate({ text: '社長に連絡してください。', library: null }), false);
  assert.equal(figureCandidate({ text: '画面の右下にある、Wi-Fi のマークを押してください。', library: 'LIB-010' }), false);
  // 矢印の動詞がある文は、機器と動かす物の語が両方あるときだけ
  assert.equal(figureCandidate({ text: 'ルーターの電源プラグを差してください。', library: null }), true);
  assert.equal(figureCandidate({ text: '電源アダプターを差してください。', library: null }), false);
  assert.equal(figureCandidate({ text: 'ルーターを外してください。', library: null }), false);
});

test('矢印の絵は、機器と動かす物の両方が手順の文にあるときだけ。片方しかない文は、差す先を推測せず絵にしない（11/15）', () => {
  assert.equal(arrowSidesInText('ルーターの電源プラグを抜いてください。'), true);
  assert.equal(arrowSidesInText('PC の裏の LAN ケーブルを差し直してください。'), true);
  assert.equal(arrowSidesInText('電源アダプターを差してください。'), false);
  assert.equal(arrowSidesInText('LAN ケーブルを抜いてください。'), false);
  // 矢印の動詞がない文は、この決まりの対象外
  assert.equal(arrowSidesInText('ランプが緑になるまで待ってください。'), true);
  // 文に両方あっても、並べ方に片方しかなければ通さない
  const text = 'ルーターの電源プラグを抜いてください。';
  assert.match(figureProblems({ step: 'STM-001', items: [{ part: 'power', label: '' }] }, text).join(), /機器と、差す・抜く物の両方/);
  assert.deepEqual(figureProblems({ step: 'STM-001', items: [{ part: 'router', label: '' }, { part: 'power', label: '' }] }, text), []);
  assert.match(figureProblems({ step: 'STM-001', items: [{ part: 'power', label: '' }] }, '電源アダプターを差してください。').join(), /機器と、差す・抜く物の両方/);
});

test('手順に付ける絵：キーの絵は文から作り、部品の絵は並べ方の記録から作る。外した手順と、文が変わった手順には付けない', () => {
  const manual = {
    statements: [
      { id: 'STM-001', text: 'Ctrl キーを押しながら C のキーを押してください。', library: 'LIB-024' },
      { id: 'STM-002', text: 'PC の LAN ケーブルを抜いてください。', library: null },
      { id: 'STM-003', text: 'NAS の電源ボタンを押してください。', library: null },
      { id: 'STM-004', text: 'ルーターの電源プラグを差してください。', library: null },
      { id: 'STM-005', text: '電源アダプターを差してください。', library: null },
    ],
    figures: [
      { step: 'STM-002', text: 'PC の LAN ケーブルを抜いてください。', items: [{ part: 'pc', label: 'PC' }, { part: 'cable', label: '' }] },
      { step: 'STM-003', text: 'NAS の電源ボタンを押してください。', items: [{ part: 'box', label: 'NAS' }, { part: 'power-button', label: '' }] },
      { step: 'STM-004', text: 'ルーターの電源を差してください。', items: [{ part: 'router', label: '' }, { part: 'power', label: '' }] },
      // 決まりの前に記録した、片方だけの矢印の絵。描くときにも付けない
      { step: 'STM-005', text: '電源アダプターを差してください。', items: [{ part: 'power', label: '' }] },
    ],
    figure_off: ['STM-003'],
  };
  const found = stepFigures(['STM-001', 'STM-002', 'STM-003', 'STM-004', 'STM-005'], manual);
  assert.deepEqual([...found.keys()], ['STM-001', 'STM-002']);
  assert.match(found.get('STM-001'), />Ctrl</);
  assert.equal(stepFigures(['STM-001'], manual, { skip: new Set(['STM-001']) }).size, 0);
});
