// 撮影の検査の、読み込みの終わりを待つ道具。Chrome を使わず、合図だけを偽物で送って確かめる。

import assert from 'node:assert/strict';
import test from 'node:test';
import { loadWatcher } from '../scripts/load-watcher.mjs';

const fakeBrowser = () => {
  const listeners = new Map();
  return { on: (method, fn) => listeners.set(method, fn), fire: (method) => listeners.get(method)?.() };
};

test('移動の前の数より、読み込みの合図が増えるまで待つ', async () => {
  const browser = fakeBrowser();
  const loads = loadWatcher(browser, { timeoutMs: 1000 });
  const since = loads.now();
  let finished = false;
  const waiting = loads.after(since).then(() => { finished = true; });
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(finished, false);
  browser.fire('Page.loadEventFired');
  await waiting;
  assert.equal(finished, true);
});

test('待ち始める前に終わった読み込みも数える（取りこぼして待ち続けない）', async () => {
  const browser = fakeBrowser();
  const loads = loadWatcher(browser, { timeoutMs: 1000 });
  const since = loads.now();
  browser.fire('Page.loadEventFired');
  await loads.after(since);
  assert.equal(loads.now(), since + 1);
});

test('合図が来なければ、時間切れで失敗にする（通ったと扱わない）', async () => {
  const browser = fakeBrowser();
  class Usage extends Error {}
  const loads = loadWatcher(browser, { timeoutMs: 30, error: (message) => new Usage(message) });
  await assert.rejects(loads.after(loads.now()), (error) => error instanceof Usage && /読み込みが終わりません/.test(error.message));
});
