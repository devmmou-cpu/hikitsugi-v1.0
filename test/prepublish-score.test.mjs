// 公開前の採点の道具：採点する人に渡すのは、役ごとの「読むもの」だけ（評価セットの隠し情報と正解は渡さない）。API は使わない。

import assert from 'node:assert/strict';
import test from 'node:test';
import { materialsOf, readmeSection, ROLES, textOfHtml } from '../eval/prepublish-score.mjs';

test('役は 3 つで、項目は 5 つずつ（docs/review/prepublish-rubric.md と同じ）', () => {
  assert.deepEqual(Object.keys(ROLES), ['successor', 'president', 'engineer']);
  for (const role of Object.values(ROLES)) assert.equal(role.items.length, 5);
});

test('読むものに、評価セットの隠し情報と正解を入れない。画像は README の画像だけ', () => {
  for (const roleId of Object.keys(ROLES)) {
    const { texts, images } = materialsOf(roleId);
    const all = Object.values(texts).join('\n');
    assert.doesNotMatch(all, /eval\/sets\/[a-z]+\/(hidden|answers)\//, roleId);
    for (const [, path] of images) assert.match(path, /^docs\/images\/[a-z-]+\.png$/);
  }
});

test('README の節の切り出しと、HTML から見える文字の取り出し', () => {
  const readme = '# 題\n\n## 今すぐ見る\n本文\n\n## 次\nほか';
  assert.equal(readmeSection(readme, '今すぐ見る'), '## 今すぐ見る\n本文');
  assert.throws(() => readmeSection(readme, 'ない節'));
  assert.equal(textOfHtml('<style>p{}</style><p>手順</p><svg><path/></svg><p>&lt;注意&gt;</p>'), '手順\n［絵］<注意>');
});
