// 待っている間の見え方（11/15、本人の決定）。書いて検査する段は、本人の操作がなく長いので、
// 始める前に目安の時間を、ページが 1 枚終わるたびに進み具合と残りの目安を出す。表示はプログラムが決め、主のエージェントがそのまま伝える。
// 目安は、実物の /hikitsugi:start の通し（Claude Code の対話モード）の実測の平均から出す。
// 出典：docs/night/real-run-report.md の「段階ごとの所要時間」（11/4 の 2 回。共通部分 4分30秒・2分37秒、
// 手順ページ 1 枚 約46秒・約37秒、言葉を直す段 5分32秒・2分21秒、根拠と照らす段 5分18秒・5分10秒、言い方 53秒・43秒）。
// 手順の絵の段（11/15 から）は実物の通しで測っていないので、目安に入れない（API では 1 回 2〜4 秒）。

export const MEASURED_SECONDS = Object.freeze({ common: 214, page: 42, editor: 237, verifier: 314, phrases: 48 });
// 実物の通しと評価の通しの、手順ページの枚数の幅（書き始める前は、まだ枚数が決まっていない）
export const TYPICAL_PAGES = Object.freeze([12, 16]);

const minutes = (seconds) => Math.max(1, Math.round(seconds / 60));
const after = ({ editor, verifier, phrases } = MEASURED_SECONDS) => editor + verifier + phrases;
const STILL = '画面が止まって見えても動いています。';

/** 書く段に入る前（1 回目の共通部分を書く前）。枚数はまだ決まっていないので、幅で出す。 */
export function writingStartNotice(seconds = MEASURED_SECONDS) {
  const [low, high] = TYPICAL_PAGES.map((pages) => minutes(seconds.common + pages * seconds.page + after(seconds)));
  return `ここから、説明書を書いて、言葉を直し、根拠と照らします。約 ${low}〜${high} 分かかります。${STILL}`;
}

/** 共通部分が終わり、手順ページの枚数が決まったとき。 */
export function pagesPlannedNotice(pages, extraParts = 0, seconds = MEASURED_SECONDS) {
  return `手順のページは ${pages} 枚です。残り約 ${minutes((pages + extraParts) * seconds.page + after(seconds))} 分です。`;
}

/** 手順ページが 1 枚終わったとき。done は終わった枚数、total は全部の枚数。 */
export function pageDoneNotice(done, total, extraParts = 0, seconds = MEASURED_SECONDS) {
  return `${total} 枚中 ${done} 枚が終わりました。残り約 ${minutes((total - done + extraParts) * seconds.page + after(seconds))} 分です。`;
}

/** 差し戻しで書き直すとき（2 回目以降）。 */
export function resendDoneNotice(done, total, seconds = MEASURED_SECONDS) {
  return `書き直し ${total} 件中 ${done} 件が終わりました。残り約 ${minutes((total - done) * seconds.page + after(seconds))} 分です。`;
}

/** ページを書き終えて、言葉を直す段に入る前。 */
export function editorNotice(seconds = MEASURED_SECONDS) {
  return `ページを書き終えました。このあと、言葉を直す段（約 ${minutes(seconds.editor)} 分）と、根拠と照らす段（約 ${minutes(seconds.verifier)} 分）が続きます。${STILL}`;
}

/** 根拠と照らす段に入る前。いちばん長く黙る段。 */
export function verifierNotice(seconds = MEASURED_SECONDS) {
  return `このあと、すべての文を根拠と照らします。約 ${minutes(seconds.verifier)} 分、途中の表示はありません。${STILL}`;
}
