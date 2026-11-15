// 手順の絵。承認済みの型と部品（plugin/library/figure-kit.json）から、プログラムが SVG を組み立てる。
// AI は線や形を描かない。キーの絵は手順の文だけから作り、部品を並べる絵は、担当（Figure Planner）が返した
// 「どの部品を、どの順に、どの文字で」のデータを検査してから組み立てる。矢印の向きは、動詞の一覧でプログラムが決める。

import { readFileSync } from 'node:fs';

const KIT_PATH = new URL('../library/figure-kit.json', import.meta.url);
export const loadKit = () => JSON.parse(readFileSync(KIT_PATH, 'utf8'));

const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const TEXT = 'font-size="15" font-weight="700" fill="currentColor" stroke="none" text-anchor="middle"';
const SMALL = 'font-size="14" font-weight="700" fill="currentColor" stroke="none" text-anchor="middle"';
const ACCENT = 'stroke-width="3" style="stroke:var(--accent)"';
const svg = (width, height, label, body) => `<svg class="step-figure" viewBox="0 0 ${width} ${height}" fill="none" stroke="currentColor" stroke-width="2" role="img" aria-label="${esc(label)}">${body}</svg>`;
const compact = (text) => String(text ?? '').normalize('NFKC').replace(/\s+/g, '');

// ---- キーの絵 ----
// 読むキーの名前。ここにない名前は絵にしない
const KEY_NAMES = new Map([
  ['windows', 'Windows'], ['win', 'Windows'], ['ウィンドウズ', 'Windows'],
  ['ctrl', 'Ctrl'], ['control', 'Ctrl'], ['コントロール', 'Ctrl'],
  ['shift', 'Shift'], ['シフト', 'Shift'], ['alt', 'Alt'], ['オルト', 'Alt'],
  ['enter', 'Enter'], ['エンター', 'Enter'], ['esc', 'Esc'], ['エスケープ', 'Esc'],
  ['tab', 'Tab'], ['タブ', 'Tab'], ['delete', 'Delete'], ['del', 'Delete'], ['デリート', 'Delete'],
  ['backspace', 'Backspace'], ['バックスペース', 'Backspace'], ['space', 'Space'], ['スペース', 'Space'],
]);
const keyName = (raw) => {
  const word = raw.normalize('NFKC').trim();
  const lower = word.toLowerCase();
  if (KEY_NAMES.has(lower)) return KEY_NAMES.get(lower);
  if (/^f(?:[1-9]|1[0-2])$/i.test(word)) return word.toUpperCase();
  if (/^[a-z0-9]$/i.test(word)) return word.toUpperCase();
  return null;
};
// 「Windows キー」「E のキー」「「E」のキー」。キーボードの「キー」は名前が前にないので当たらない
const KEY_MENTION = /(?:「([^」]{1,12})」|([A-Za-z][A-Za-z0-9]*|[0-9]|ウィンドウズ|コントロール|シフト|オルト|エンター|エスケープ|タブ|デリート|バックスペース|スペース))\s*の?\s*キー/g;
const PLUS = /\b([A-Za-z][A-Za-z0-9]*)\s*\+\s*([A-Za-z0-9]{1,9})\b/;

/**
 * 手順の文から、押すキーを読む。読めないとき（一覧にない名前、4 つ以上、禁止の文、1 文に 2 組）は null。
 * @returns { keys, hold, seconds } か null
 */
export function readKeys(text) {
  const plain = String(text ?? '').normalize('NFKC');
  if (/ないで(?:ください|下さい)/.test(plain)) return null;
  const hold = /長押し/.test(plain);
  const seconds = hold ? plain.match(/(\d+)\s*秒/)?.[1] ?? null : null;
  const plus = plain.match(PLUS);
  if (plus) {
    const keys = [keyName(plus[1]), keyName(plus[2])];
    return keys.every(Boolean) ? { keys, hold, seconds } : null;
  }
  const names = [...plain.matchAll(KEY_MENTION)].map((match) => match[1] ?? match[2]);
  if (!names.length || names.length > 3) return null;
  const keys = names.map(keyName);
  if (keys.some((key) => !key)) return null;
  // 2 つ以上なら「押しながら」で同時に押すときだけ。別々に押す 2 組は絵にしない
  if (keys.length > 1 && !/押しながら/.test(plain)) return null;
  return { keys, hold, seconds };
}

const keyWidth = (name) => ([...name].length === 1 ? 52 : 26 + 12 * [...name].length);

/** キーの絵の型。同時押しは「＋」、長押しは帯と「長押し」（秒数は文にあるときだけ）。 */
export function keyFigure({ keys, hold, seconds }) {
  let x = 30;
  const parts = [];
  keys.forEach((name, index) => {
    if (index > 0) {
      parts.push(`<text x="${x + 20}" y="66" ${TEXT}>＋</text>`);
      x += 40;
    }
    const width = keyWidth(name);
    parts.push(`<rect x="${x}" y="34" width="${width}" height="52" rx="8"/><text x="${x + width / 2}" y="65" ${TEXT}>${esc(name)}</text>`);
    x += width;
  });
  if (hold) {
    const label = seconds ? `${seconds}秒 長押し` : '長押し';
    parts.push(`<path d="M30 98H${x}" stroke-width="3" stroke-dasharray="2 5" stroke-linecap="round"/><text x="${x + 50}" y="65" ${TEXT}>${esc(label)}</text>`);
    x += 100;
  }
  const frame = `<rect x="18" y="22" width="${x - 6}" height="${hold ? 88 : 76}" rx="14" ${ACCENT}/>`;
  const label = hold ? `${keys.join('と')}のキーを長押しする図` : keys.length > 1 ? `キーボードの${keys.join('のキーと')}のキーを、同時に押す図` : `キーボードの${keys[0]}のキーを押す図`;
  return svg(Math.max(x + 30, 320), hold ? 124 : 120, label, parts.join('') + frame);
}

// ---- 部品を並べる絵 ----
/** 手順の文の動詞から、矢印の向きと、矢印の下に添える文字を決める。両方ある文と、一覧にない文は null。 */
export function arrowOf(text, kit = loadKit()) {
  const plain = compact(text);
  const find = (list) => [...list].sort((a, b) => b[0].length - a[0].length).find(([form]) => plain.includes(form));
  const toward = find(kit.verbs.toward);
  const away = find(kit.verbs.away);
  if (Boolean(toward) === Boolean(away)) return null;
  return toward ? { direction: 'toward', label: toward[1] } : { direction: 'away', label: away[1] };
}

/** 長押しの文字。秒数は手順の文にあるときだけ。 */
export function holdLabel(text) {
  const plain = String(text ?? '').normalize('NFKC');
  if (!/長押し/.test(plain)) return null;
  const seconds = plain.match(/(\d+)\s*秒/);
  return seconds ? `${seconds[1]}秒 長押し` : '長押し';
}

/** ランプの状態は、手順の文の語で決める。 */
const lampState = (text) => (/点滅/.test(text) ? 'blink' : /消え|消灯/.test(text) ? 'off' : 'on');

const UNSAFE = /[<>&"'`]/;
export const OBJECT_LIMIT = 3;
export const LABEL_LIMIT = 12;

/**
 * 担当が返した並べ方を検査する。通らない絵は付けない。
 * @param figure { step, items: [{ part, label }] }
 * @param stepText 手順の文
 * @param evidenceTexts その文の根拠の文（聞き取りの答え、調査の値、部品の文面）
 */
export function figureProblems(figure, stepText, evidenceTexts = [], kit = loadKit()) {
  const problems = [];
  const items = figure.items ?? [];
  if (!items.length || items.length > OBJECT_LIMIT) problems.push(`${figure.step}：部品は 1〜${OBJECT_LIMIT} 個です（矢印はプログラムが足します）`);
  const text = compact(stepText);
  const sources = [stepText, ...evidenceTexts].map(compact);
  for (const item of items) {
    const part = kit.parts[item.part];
    if (!part) {
      problems.push(`${figure.step}：一覧にない部品です（${item.part}）`);
      continue;
    }
    // 部品にない物は絵にしない：その部品の語が手順の文にあること
    if (!part.words.some((word) => text.includes(compact(word)))) problems.push(`${figure.step}：手順の文に「${part.name}」の語がありません（${item.part}）`);
    if (item.label) {
      if (UNSAFE.test(item.label)) problems.push(`${figure.step}：添える文字に記号（< > & 引用符）は使えません`);
      if ([...item.label].length > LABEL_LIMIT) problems.push(`${figure.step}：添える文字は ${LABEL_LIMIT} 字までです（「${item.label}」）`);
      if (!sources.some((source) => source.includes(compact(item.label)))) problems.push(`${figure.step}：添える文字「${item.label}」が、手順の文にも根拠にもありません`);
      // 秒数は手順の文にあるときだけ
      const seconds = item.label.normalize('NFKC').match(/(\d+)\s*秒/);
      if (seconds && !text.includes(`${seconds[1]}秒`)) problems.push(`${figure.step}：絵の「${seconds[1]}秒」が手順の文にありません`);
    }
  }
  return problems;
}

/** 部品の絵 1 つ（100×100）。 */
function partBody(item, stepText, kit) {
  if (item.part === 'lamp') return kit.lamp_states[lampState(stepText)];
  return kit.parts[item.part].svg;
}

/**
 * 並べ方から絵を組み立てる。矢印は動詞の一覧で決め、物が動く側に置く（差す：機器 ← 物、抜く：機器　物 →）。
 * 一覧にない動詞の文は、矢印を付けない。電源ボタンの文字は、長押しのときプログラムが決める。
 */
export function partsFigure(figure, stepText, kit = loadKit()) {
  const arrow = arrowOf(stepText, kit);
  const objects = figure.items.map((item) => ({
    body: partBody(item, stepText, kit),
    label: item.part === 'power-button' && holdLabel(stepText) ? holdLabel(stepText) : item.label ?? '',
  }));
  const row = [...objects];
  if (arrow?.direction === 'toward') row.splice(row.length - 1, 0, { arrow: kit.arrows.left, label: arrow.label });
  if (arrow?.direction === 'away') {
    if (row.length > 1) row[row.length - 1] = { ...row[row.length - 1], gap: 28 };
    row.push({ arrow: kit.arrows.right, label: arrow.label });
  }
  let x = 10;
  const parts = [];
  for (const cell of row) {
    x += cell.gap ?? 0;
    const width = cell.arrow ? 80 : 100;
    parts.push(cell.arrow ? `<g transform="translate(${x} 6) scale(0.8 1)">${cell.arrow}</g>` : `<g transform="translate(${x} 6)">${cell.body}</g>`);
    if (cell.label) parts.push(`<text x="${x + width / 2}" y="128" ${SMALL}>${esc(cell.label)}</text>`);
    x += width + 8;
  }
  // 部品が少ない絵が大きく引き伸ばされないよう、幅の基準は 3 つ分（キーの絵と同じく、文字の大きさをそろえる）
  return { svg: svg(Math.max(x + 2, 334), 140, `${stepText}の図`, parts.join('')), arrow };
}

/** 部品を並べる絵の候補の手順。部品でない文で、物の部品の語があるもの。 */
export function figureCandidate(statement, kit = loadKit()) {
  if (!statement || statement.library) return false;
  const text = compact(statement.text);
  return Object.values(kit.parts).some((part) => part.words.some((word) => text.includes(compact(word))));
}

/**
 * 手順の並びに付ける絵（キーの絵と、部品を並べる絵）を、文章の ID ごとの SVG で返す。
 * 承認済みの手描きの図がある手順（skip）、前任者が外した手順（figure_off）、検査に通らない並べ方には付けない。
 */
export function stepFigures(stepIds, manual, { kit = loadKit(), skip = new Set() } = {}) {
  const byId = new Map(manual.statements.map((statement) => [statement.id, statement]));
  const off = new Set(manual.figure_off ?? []);
  const planned = new Map((manual.figures ?? []).map((figure) => [figure.step, figure]));
  const found = new Map();
  for (const id of stepIds ?? []) {
    const statement = byId.get(id);
    if (!statement || skip.has(id) || off.has(id)) continue;
    const keys = readKeys(statement.text);
    if (keys) {
      found.set(id, keyFigure(keys));
      continue;
    }
    const figure = planned.get(id);
    // 並べ方を決めたときと文が変わっていれば（更新で直した手順）、古い並べ方は使わない
    if (figure && figure.text === statement.text) found.set(id, partsFigure(figure, statement.text, kit).svg);
  }
  return found;
}
