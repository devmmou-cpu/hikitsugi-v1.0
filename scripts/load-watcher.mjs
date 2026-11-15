// 撮影の検査で、ページの読み込みの終わりを待つ道具（Chrome の DevTools の Page.loadEventFired を数える）。
// 決まった時間だけ待つと、機械が重いときに読み込みの前に調べて止まる（11/15、撮影の検査が負荷で落ちた件）。
// 読み込みの数を覚えておき、移動や開き直しの前の数より増えるまで待つ。先に終わった読み込みも数えるので、取りこぼさない。

/**
 * @param browser on(method, fn) を持つもの（scripts/screenshots.mjs の connect の戻り値）
 * @param timeoutMs これより待っても増えなければ失敗にする
 * @param error 失敗のときに投げる Error を作る関数
 */
export function loadWatcher(browser, { timeoutMs, error = (message) => new Error(message) }) {
  let count = 0;
  const waiters = [];
  browser.on('Page.loadEventFired', () => {
    count += 1;
    waiters.splice(0).forEach((wake) => wake());
  });
  const after = (since) =>
    new Promise((done, fail) => {
      const timer = setTimeout(() => fail(error(`ページの読み込みが終わりません（${timeoutMs / 1000} 秒）`)), timeoutMs);
      const check = () => {
        if (count <= since) return waiters.push(check);
        clearTimeout(timer);
        done();
      };
      check();
    });
  return { now: () => count, after };
}
