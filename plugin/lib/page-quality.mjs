// ページの質。物に触る手順（電源、ケーブル、ボタン、ランプ）のあるページで、
// 触る物の見分け方、待つ時間、直ったかの確かめ方がそろっているかをプログラムが見る。
// 足りないページは、前任者の確認の前に 3 ページまで聞く（手順の抜けの質問）。それでも足りなければ、
// 画面に「〜の記録はありません」と決まった文を出す。数字や見分け方を、根拠なしに作らない。

import { bodyFields } from './page-check.mjs';
import { appendExtraEntry } from './transcript.mjs';

export const PAGE_GAP = 'GAP-901';
export const PAGE_GAP_ITEM = 'CHK-00';
export const PAGE_GAP_LIMIT = 3;

// 物に触る手順：物の語と、手で触る動きの語があり、画面の操作でない文。部品（画面の操作の承認済みの文）は除く
const OBJECT = /電源|ケーブル|コンセント|プラグ|アダプター|ランプ|ボタン|スイッチ/u;
const TOUCH = /抜いて|抜き|差して|挿して|差し直|挿し直|差し込|つないで|入れて|入れ直|切って|押して|見て/u;
const SCREEN = /画面|マーク|メニュー|クリック|「[^」]+」を(?:押|選)|アドレス欄|ブラウザー|キーを/u;
// 電源を入れ直す、差し直すなど、そのあとに待つ時間が要る手順
// 「差し込み口」「つないである」のような名前や様子の語は数えない。動きの語（〜てください、〜てから、〜て、）だけ
const RESTART = /差し直|挿し直|入れ直|(?:差|挿|差し込ん|つない)で(?:ください|から|、)|電源ボタンを押|電源を[^。]*入れ/u;
// 見分け方：置き場所か目印の語と、機器の語が同じ文にある
const PLACE = /上|下|裏|前面|背面|横|奥|棚|柱|机|ラック|天井|壁|入口|部屋|室|詰所|シール|ラベル|白い|黒い|青い|灰色|緑|赤い|四角|丸い|書いた|書いてある|貼って|にある|に置いて|に設置/u;
const THING = /AP|ルーター|NAS|サーバー|PC|パソコン|ケーブル|アダプター|プラグ|複合機|プリンター|UTM|ハブ|モデム|機器|箱/u;
// 待つ時間：数と単位があり、待つ・かかる・までの語がある
const WAIT = /\d+(?:\s*[〜~～-]\s*\d+)?\s*(?:秒|分)[^。]*(?:待|かか|まで|充電)|待[^。]*\d+\s*(?:秒|分)/u;
// 直ったかの確かめ方
const CONFIRM = /直っています|戻っています|切れています|起動しています|つながっています|直ったことが分かります/u;
// 「記録がありません」と書いた文
const SAID_NONE = {
  mark: /(?:置き場所|目印|見分け)[^。]*記録がありません/u,
  wait: /待つ時間[^。]*記録がありません/u,
  confirm: /(?:確かめ方|直ったか)[^。]*記録がありません/u,
};
export const CHECK_LABELS = { mark: '触る物の置き場所と目印', wait: '待つ時間', confirm: '直ったかの確かめ方' };

const textsOf = (manual) => new Map(manual.statements.map((statement) => [statement.id, statement]));

/** 物に触る手順の文か。 */
export function isPhysicalStep(statement) {
  if (!statement || statement.library) return false;
  return OBJECT.test(statement.text) && TOUCH.test(statement.text) && !SCREEN.test(statement.text);
}

/**
 * ページ 1 つの、物に触る手順と、足りない項目。
 * @returns { physical: 手順の ID, needs: 要る項目, missing: 足りない項目, said_none: 「記録がありません」と書いてある項目 } か、物に触る手順がなければ null
 */
export function pageChecks(page, manual) {
  const byId = textsOf(manual);
  const steps = [...(page.first_steps ?? []), ...(page.steps ?? [])];
  const physical = steps.filter((id) => isPhysicalStep(byId.get(id)));
  if (!physical.length) return null;
  const own = Object.values(bodyFields(page)).flat().filter(Boolean).map((id) => byId.get(id)).filter((statement) => statement && !statement.library);
  const texts = own.map((statement) => statement.text);
  const needs = ['mark', ...(physical.some((id) => RESTART.test(byId.get(id).text)) ? ['wait'] : []), 'confirm'];
  const has = {
    mark: texts.some((text) => PLACE.test(text) && THING.test(text)),
    wait: texts.some((text) => WAIT.test(text)),
    confirm: Boolean(page.goal || page.first_goal) || texts.some((text) => CONFIRM.test(text)),
  };
  const saidNone = needs.filter((key) => !has[key] && texts.some((text) => SAID_NONE[key].test(text)));
  return { physical, needs, missing: needs.filter((key) => !has[key] && !saidNone.includes(key)), said_none: saidNone };
}

/**
 * 物に触る手順のあるページで、足りない項目のあるもの。電源の入れ直しとケーブルのページを先にする。
 * 同じ手順の文のページは 1 問にまとめる（pages に並べる）。
 */
export function pageGaps(manual) {
  const byId = textsOf(manual);
  const found = manual.symptom_pages.flatMap((page, order) => {
    const checks = pageChecks(page, manual);
    if (!checks?.missing.length) return [];
    const priority = checks.physical.some((id) => RESTART.test(byId.get(id).text) || /ケーブル/u.test(byId.get(id).text)) ? 0 : 1;
    return [{ page: page.id, title: byId.get(page.title)?.text ?? page.id, step: byId.get(checks.physical[0]).text, missing: checks.missing, priority, order }];
  });
  const groups = new Map();
  for (const gap of found.sort((a, b) => a.priority - b.priority || a.order - b.order)) {
    const key = gap.step.normalize('NFKC').replace(/\s+/g, '');
    const group = groups.get(key);
    if (group) {
      group.pages.push(gap.page);
      group.missing = [...new Set([...group.missing, ...gap.missing])];
    } else groups.set(key, { page: gap.page, pages: [gap.page], title: gap.title, step: gap.step, missing: gap.missing });
  }
  return [...groups.values()].map((group) => ({ ...group, missing: ['mark', 'wait', 'confirm'].filter((key) => group.missing.includes(key)) }));
}

const ASK = {
  mark: '触る機器はどこにあって、何が目印ですか（置き場所、色、シールなど）。',
  wait: '差し直したり電源を入れたりしたあと、どのくらい待ちますか。',
  confirm: '直ったことは、何で分かりますか（ランプの色、画面の表示など）。',
};

/** 手順の抜けの質問の文。1 ページに 1 問。 */
export function pageGapQuestion(gap) {
  return `「${gap.title}」のページの手順「${gap.step}」について教えてください。${gap.missing.map((key) => ASK[key]).join('')}分からないものは「分からない」と書いてください。`;
}

/** 答えを聞き取りの記録に足す。質問の上限（20 問）には数えない。 */
export function recordPageGap(transcript, gap, { answer, status, answeredAt }) {
  return appendExtraEntry(transcript, { gap: PAGE_GAP, covers: [PAGE_GAP_ITEM], question: pageGapQuestion(gap), answer, status, answeredAt });
}

/** Writer にそのページだけを書き直してもらうときの直しの指示。答えにないことは書かせない。 */
export function pageGapComment(gap, entryId) {
  const what = gap.missing.map((key) => CHECK_LABELS[key]).join('、');
  return `このページの物に触る手順に、${what}が足りませんでした。前任者の答え（${entryId}）にあるものだけを、このページに書いてください。置き場所と目印は、その手順の文か notes に書きます。待つ時間は、その手順のすぐ後に「〈答えの時間〉待ってください。」の手順で書きます。直ったかの確かめ方は goal に書きます。答えにないものは書かず、数字を作らないでください。`;
}

/**
 * 画面に出す決まった文。足りない項目が残ったページだけ。
 * 「記録がありません」は事実（記録がないこと）なので、根拠の照合はしない。数字や見分け方は書かない。
 */
export function missingNote(page, manual) {
  const checks = pageChecks(page, manual);
  if (!checks?.missing.length) return null;
  const labels = checks.missing.map((key) => CHECK_LABELS[key]);
  return `${labels.join('、')}は、記録がありません。${page.fallback ? '分からないときは、③ の相手に聞いてください。' : '分からないときは、社内で相談してください。'}`;
}

/**
 * 根拠のない数字（待つ時間）の文。数と単位（「10秒」「2〜3分」）が、その文の根拠の文にない文を返す。
 * @param readEvidence 根拠の ID から文字列を返す関数
 */
export function unsupportedWaits(manual, readEvidence) {
  const compact = (text) => text.normalize('NFKC').replace(/\s+/g, '');
  const NUMBER = /\d+(?:[〜~～-]\d+)?(?:秒|分)/gu;
  return manual.statements.flatMap((statement) => {
    if (statement.library) return [];
    const numbers = compact(statement.text).match(NUMBER) ?? [];
    if (!numbers.length || !/待|かか|まで|充電/u.test(statement.text)) return [];
    const evidence = statement.evidence.map(readEvidence).filter((text) => text !== null).map(compact).join('\n').replace(/[〜~～]/g, '-');
    const missing = numbers.filter((number) => !evidence.includes(number.replace(/[〜~～]/g, '-')));
    return missing.length ? [{ statement: statement.id, text: statement.text, numbers: missing }] : [];
  });
}
