// 待っている間の見え方：目安の時間と、進み具合の行。目安は実物の通しの実測の平均から出す。

import assert from 'node:assert/strict';
import test from 'node:test';
import { editorNotice, MEASURED_SECONDS, pageDoneNotice, pagesPlannedNotice, resendDoneNotice, verifierNotice, writingStartNotice } from '../plugin/lib/progress.mjs';

test('目安は実測の平均（11/4 の実物の通し 2 回）。値を変えるときは出典も直す', () => {
  assert.deepEqual({ ...MEASURED_SECONDS }, { common: 214, page: 42, editor: 237, verifier: 314, phrases: 48 });
});

test('書く段に入る前は、枚数が決まっていないので幅で出す。止まって見えても動いていると伝える', () => {
  // 12 枚：214 + 12×42 + 237 + 314 + 48 = 1317 秒 → 22 分。16 枚：1485 秒 → 25 分
  assert.equal(writingStartNotice(), 'ここから、説明書を書いて、言葉を直し、根拠と照らします。約 22〜25 分かかります。画面が止まって見えても動いています。');
});

test('ページが 1 枚終わるたびに、何枚中何枚と、残りの目安を出す', () => {
  assert.equal(pagesPlannedNotice(15), '手順のページは 15 枚です。残り約 20 分です。');
  assert.equal(pageDoneNotice(4, 15), '15 枚中 4 枚が終わりました。残り約 18 分です。');
  // 最後の 1 枚のあとも、言葉を直す段と根拠と照らす段の分が残る
  assert.equal(pageDoneNotice(15, 15), '15 枚中 15 枚が終わりました。残り約 10 分です。');
  // 手順ページのない困りごとの判断（1 件）が残っていれば、その分を足す
  assert.equal(pageDoneNotice(15, 15, 1), '15 枚中 15 枚が終わりました。残り約 11 分です。');
  assert.equal(resendDoneNotice(1, 3), '書き直し 3 件中 1 件が終わりました。残り約 11 分です。');
});

test('長く黙る段（根拠と照らす）の前に、時間と、途中の表示がないことを伝える', () => {
  assert.equal(editorNotice(), 'ページを書き終えました。このあと、言葉を直す段（約 4 分）と、根拠と照らす段（約 5 分）が続きます。画面が止まって見えても動いています。');
  assert.equal(verifierNotice(), 'このあと、すべての文を根拠と照らします。約 5 分、途中の表示はありません。画面が止まって見えても動いています。');
});
