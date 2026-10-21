// Таблица каны, транскрипции (Хэпбёрн / Поливанов), разбор слов и сравнение ответов
const ROWS = [
  { id: 'a', g: 'basic', name: 'а', h: 'あ い う え お', l: 'a i u e o', r: 'а и у э о' },
  { id: 'ka', g: 'basic', name: 'ка', h: 'か き く け こ', l: 'ka ki ku ke ko', r: 'ка ки ку кэ ко' },
  { id: 'sa', g: 'basic', name: 'са', h: 'さ し す せ そ', l: 'sa shi su se so', r: 'са си су сэ со' },
  { id: 'ta', g: 'basic', name: 'та', h: 'た ち つ て と', l: 'ta chi tsu te to', r: 'та ти цу тэ то' },
  { id: 'na', g: 'basic', name: 'на', h: 'な に ぬ ね の', l: 'na ni nu ne no', r: 'на ни ну нэ но' },
  { id: 'ha', g: 'basic', name: 'ха', h: 'は ひ ふ へ ほ', l: 'ha hi fu he ho', r: 'ха хи фу хэ хо' },
  { id: 'ma', g: 'basic', name: 'ма', h: 'ま み む め も', l: 'ma mi mu me mo', r: 'ма ми му мэ мо' },
  { id: 'ya', g: 'basic', name: 'я', h: 'や ゆ よ', l: 'ya yu yo', r: 'я ю ё' },
  { id: 'ra', g: 'basic', name: 'ра', h: 'ら り る れ ろ', l: 'ra ri ru re ro', r: 'ра ри ру рэ ро' },
  { id: 'wa', g: 'basic', name: 'ва + н', h: 'わ を ん', l: 'wa wo n', r: 'ва во н' },
  { id: 'ga', g: 'dakuten', name: 'га', h: 'が ぎ ぐ げ ご', l: 'ga gi gu ge go', r: 'га ги гу гэ го' },
  { id: 'za', g: 'dakuten', name: 'дза', h: 'ざ じ ず ぜ ぞ', l: 'za ji zu ze zo', r: 'дза дзи дзу дзэ дзо' },
  { id: 'da', g: 'dakuten', name: 'да', h: 'だ ぢ づ で ど', l: 'da ji zu de do', r: 'да дзи дзу дэ до' },
  { id: 'ba', g: 'dakuten', name: 'ба', h: 'ば び ぶ べ ぼ', l: 'ba bi bu be bo', r: 'ба би бу бэ бо' },
  { id: 'pa', g: 'dakuten', name: 'па', h: 'ぱ ぴ ぷ ぺ ぽ', l: 'pa pi pu pe po', r: 'па пи пу пэ по' },
  { id: 'kya', g: 'yoon', name: 'кя', h: 'きゃ きゅ きょ', l: 'kya kyu kyo', r: 'кя кю кё' },
  { id: 'sha', g: 'yoon', name: 'ся', h: 'しゃ しゅ しょ', l: 'sha shu sho', r: 'ся сю сё' },
  { id: 'cha', g: 'yoon', name: 'тя', h: 'ちゃ ちゅ ちょ', l: 'cha chu cho', r: 'тя тю тё' },
  { id: 'nya', g: 'yoon', name: 'ня', h: 'にゃ にゅ にょ', l: 'nya nyu nyo', r: 'ня ню нё' },
  { id: 'hya', g: 'yoon', name: 'хя', h: 'ひゃ ひゅ ひょ', l: 'hya hyu hyo', r: 'хя хю хё' },
  { id: 'mya', g: 'yoon', name: 'мя', h: 'みゃ みゅ みょ', l: 'mya myu myo', r: 'мя мю мё' },
  { id: 'rya', g: 'yoon', name: 'ря', h: 'りゃ りゅ りょ', l: 'rya ryu ryo', r: 'ря рю рё' },
  { id: 'gya', g: 'yoon', name: 'гя', h: 'ぎゃ ぎゅ ぎょ', l: 'gya gyu gyo', r: 'гя гю гё' },
  { id: 'ja', g: 'yoon', name: 'дзя', h: 'じゃ じゅ じょ', l: 'ja ju jo', r: 'дзя дзю дзё' },
  { id: 'bya', g: 'yoon', name: 'бя', h: 'びゃ びゅ びょ', l: 'bya byu byo', r: 'бя бю бё' },
  { id: 'pya', g: 'yoon', name: 'пя', h: 'ぴゃ ぴゅ ぴょ', l: 'pya pyu pyo', r: 'пя пю пё' },
];
const GROUPS = [{ id: 'basic', name: 'Основные' }, { id: 'dakuten', name: 'С дакутэном' }, { id: 'yoon', name: 'Сочетания (ёон)' }];
// подсказка для одинаково звучащих знаков
const HINTS = { 'ぢ': 'ряд та', 'づ': 'ряд та', 'じ': 'ряд са', 'ず': 'ряд са' };

const toHira = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const toKata = s => s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60));
const SMALL = { 'ぁ': 'あ', 'ぃ': 'い', 'ぅ': 'う', 'ぇ': 'え', 'ぉ': 'お', 'っ': 'つ', 'ゃ': 'や', 'ゅ': 'ゆ', 'ょ': 'よ', 'ゎ': 'わ', 'ゕ': 'か', 'ゖ': 'け' };
const bigOf = c => { const h = toHira(c); const b = SMALL[h]; return b ? (h === c ? b : toKata(b)) : c; };
const isSmall = c => !!SMALL[toHira(c)];

const TABLE = {}; // хирагана -> [лат, рус]
for (const r of ROWS) { const h = r.h.split(' '), l = r.l.split(' '), ru = r.r.split(' '); h.forEach((k, i) => TABLE[k] = [l[i], ru[i]]); }
Object.assign(TABLE, {
  'ゔ': ['vu', 'ву'], 'ふぁ': ['fa', 'фа'], 'ふぃ': ['fi', 'фи'], 'ふぇ': ['fe', 'фэ'], 'ふぉ': ['fo', 'фо'], 'てぃ': ['ti', 'ти'], 'でぃ': ['di', 'ди'],
  'ちぇ': ['che', 'че'], 'しぇ': ['she', 'сэ'], 'じぇ': ['je', 'дзэ'], 'うぃ': ['wi', 'уи'], 'うぇ': ['we', 'уэ'], 'うぉ': ['wo', 'уо'],
  'ゔぁ': ['va', 'ва'], 'ゔぃ': ['vi', 'ви'], 'ゔぇ': ['ve', 'вэ'], 'ゔぉ': ['vo', 'во'], 'とぅ': ['tu', 'ту'], 'どぅ': ['du', 'ду'], 'つぁ': ['tsa', 'ца'],
  'ぁ': ['a', 'а'], 'ぃ': ['i', 'и'], 'ぅ': ['u', 'у'], 'ぇ': ['e', 'э'], 'ぉ': ['o', 'о'], 'ゃ': ['ya', 'я'], 'ゅ': ['yu', 'ю'], 'ょ': ['yo', 'ё'],
});
const RU_VOWELS = 'аиуэояюё', LAT_VOWELS = 'aiueo';
const RU_VOWEL_OF = { 'я': 'а', 'ю': 'у', 'ё': 'о' };
const MACRON = '̄';

// разбор строки каны в транскрипцию: {lat, ru}
function transcribe(kana) {
  const h = toHira(kana);
  const units = [];
  for (let i = 0; i < h.length;) {
    const two = h.slice(i, i + 2);
    if (two.length === 2 && TABLE[two]) { units.push({ k: two, l: TABLE[two][0], r: TABLE[two][1] }); i += 2; continue; }
    const c = h[i];
    if (c === 'ー') units.push({ k: c, long: true });
    else if (c === 'っ') units.push({ k: c, gem: true });
    else if (TABLE[c]) units.push({ k: c, l: TABLE[c][0], r: TABLE[c][1] });
    else units.push({ k: c, l: c, r: c });
    i++;
  }
  let lat = '', ru = '';
  units.forEach((u, i) => {
    const next = units[i + 1], prev = units[i - 1];
    if (u.long) { lat += MACRON; ru += MACRON; return; }
    if (u.gem) {
      if (next && next.l) { lat += next.l.startsWith('ch') ? 't' : next.l[0]; ru += next.r[0]; }
      else { lat += 't'; ru += 'т'; }
      return;
    }
    let l = u.l, r = u.r;
    if (u.k === 'ん') {
      if (next && next.l && /^[bpm]/.test(next.l)) { l = 'm'; r = 'м'; }
      else if (next && next.l && /^[aiueoy]/.test(next.l)) { l = "n'"; r = "н'"; }
    }
    if (u.k === 'い' && prev && prev.r && 'аоуэ'.includes(prev.r[prev.r.length - 1]) && !(next && next.k === 'ん')) r = 'й';
    // долгие гласные: おう, おお, うう -> макрон, как в словарях Хэпбёрна и Поливанова
    if ((u.k === 'う' && prev && prev.l && /[ou]$/.test(prev.l)) || (u.k === 'お' && prev && prev.l && /o$/.test(prev.l))) { l = MACRON; r = MACRON; }
    lat += l; ru += r;
  });
  return { lat, ru };
}

// приведение ответа к сравнимому виду: снимаются различия систем записи и долгота гласных
function canon(s, sys) {
  s = (s || '').toLowerCase().normalize('NFD').replace(/[̄̂́̀]/g, '').normalize('NFC');
  s = s.replace(/[^a-zа-яё]/g, '');
  const rules = sys === 'lat'
    ? [['tch', 'tt'], ['shi', 'si'], ['sha', 'sya'], ['shu', 'syu'], ['sho', 'syo'], ['she', 'sye'], ['sh', 's'], ['chi', 'ti'], ['cha', 'tya'], ['chu', 'tyu'], ['cho', 'tyo'], ['che', 'tye'], ['ch', 't'],
      ['tsu', 'tu'], ['fu', 'hu'], ['dzu', 'zu'], ['dzi', 'zi'], ['ji', 'zi'], ['ja', 'zya'], ['ju', 'zyu'], ['jo', 'zyo'], ['je', 'zye'], ['j', 'z'], ['du', 'zu'], ['di', 'zi'], ['wo', 'o'],
      ['nn', 'n'], [/m(?=[bpm])/g, 'n'], ['ou', 'o'], ['oo', 'o'], ['uu', 'u'], ['aa', 'a'], ['ii', 'i'], ['ee', 'e'], ['ei', 'e']]
    : [['ша', 'ся'], ['шу', 'сю'], ['шо', 'сё'], ['ше', 'сэ'], ['ши', 'си'], ['ш', 'с'], ['щ', 'с'], ['джи', 'дзи'], ['джа', 'дзя'], ['джу', 'дзю'], ['джо', 'дзё'], ['дж', 'дз'], ['жи', 'дзи'], ['ж', 'дз'],
      ['чи', 'ти'], ['ча', 'тя'], ['чу', 'тю'], ['чо', 'тё'], ['че', 'тэ'], ['ч', 'т'], ['тсу', 'цу'], ['ху', 'фу'], ['йо', 'ё'], ['йу', 'ю'], ['йа', 'я'], ['йе', 'э'], ['е', 'э'], ['ь', ''], ['ъ', ''], ['й', 'и'],
      ['нн', 'н'], [/м(?=[бпм])/g, 'н'], ['оу', 'о'], ['оо', 'о'], ['уу', 'у'], ['аа', 'а'], ['ии', 'и'], ['ээ', 'э'], ['эи', 'э'], ['ёо', 'ё'], ['ёу', 'ё'], ['юу', 'ю']];
  for (const [a, b] of rules) s = typeof a === 'string' ? s.split(a).join(b) : s.replace(a, b);
  return s;
}

const ALT = { 'を': ['o|о'] };

// все допустимые варианты чтения для каны или слова
function readingsOf(kana, override) {
  const t = transcribe(kana);
  const list = [t];
  (ALT[toHira(kana)] || []).concat(override ? [override] : []).forEach(o => { const [lat, ru] = o.split('|'); list.push({ lat: lat || t.lat, ru: ru || t.ru }); });
  return list;
}
function checkReading(answer, kana, sys, override) {
  const a = canon(answer, sys);
  return a.length > 0 && readingsOf(kana, override).some(r => canon(r[sys], sys) === a);
}
// чтение для показа
function displayReading(kana, sys, override) {
  if (override) { const [lat, ru] = override.split('|'); const v = sys === 'lat' ? lat : ru; if (v) return v; }
  return transcribe(kana)[sys];
}

// похожие знаки: группы для тренировки «Похожие знаки» и подбора вариантов в квизе на слух
const SIMILAR = [
  { id: 'a-o', s: 'h', k: ['あ', 'お'], t: 'у お справа отдельная капелька, у あ вместо неё перекладина пересекает вертикаль' },
  { id: 'ki-sa', s: 'h', k: ['き', 'さ'], t: 'у き две горизонтали, у さ — одна' },
  { id: 'sa-chi', s: 'h', k: ['さ', 'ち'], t: 'зеркальны: нижняя дуга у さ открыта вправо, у ち — влево' },
  { id: 'ko-ni', s: 'h', k: ['こ', 'に', 'た'], t: 'у に слева вертикальная палочка, у た слева крестик' },
  { id: 'shi-tsu', s: 'h', k: ['し', 'つ'], t: 'し идёт сверху вниз и загибается вправо, つ — слева направо и загибается вниз' },
  { id: 'te-so', s: 'h', k: ['て', 'そ', 'ん'], t: 'у て одна перекладина; у そ сверху зигзаг; у ん нет перекладины — галочка и хвост вверх' },
  { id: 'nu-me', s: 'h', k: ['ぬ', 'め'], t: 'у ぬ в конце петелька, у め её нет' },
  { id: 'ne-re-wa', s: 'h', k: ['ね', 'れ', 'わ'], t: 'хвост: у ね закручен в петлю, у れ уходит вверх, у わ — плавная дуга вниз' },
  { id: 'ha-ho-ke', s: 'h', k: ['は', 'ほ', 'け'], t: 'у ほ справа две горизонтали, у は одна и петля, у け петли нет' },
  { id: 'ma-yo', s: 'h', k: ['ま', 'よ'], t: 'у ま две перекладины, у よ — одна и она слева не выходит' },
  { id: 'ru-ro', s: 'h', k: ['る', 'ろ'], t: 'у る в конце петля, у ろ её нет' },
  { id: 'i-ri', s: 'h', k: ['い', 'り'], t: 'у り правая черта длиннее левой и уходит вниз' },
  { id: 'u-ra', s: 'h', k: ['う', 'ら'], t: 'у う сверху короткая черта, у ら сверху точка, а слева — вертикаль' },
  { id: 'ku-he', s: 'h', k: ['く', 'へ'], t: 'く — галочка, открытая вправо; へ — горка, открытая вниз' },
  { id: 'ta-na', s: 'h', k: ['た', 'な'], t: 'у な справа внизу петля, у た — две короткие горизонтали' },
  { id: 'ba-pa', s: 'h', k: ['ば', 'ぱ'], t: 'две чёрточки — «б», кружок — «п»' },
  { id: 'shi-tsu-so-n', s: 'k', k: ['シ', 'ツ', 'ソ', 'ン'], t: 'у シ и ン последняя черта идёт снизу вверх, у ツ и ソ — сверху вниз. У シ и ツ по две чёрточки, у ソ и ン — одна' },
  { id: 'ku-ke-ta', s: 'k', k: ['ク', 'ケ', 'タ'], t: 'タ — это ク с чертой внутри; у ケ перекладина выходит вправо, а вниз от неё идёт отдельная черта' },
  { id: 'u-wa-fu', s: 'k', k: ['ウ', 'ワ', 'フ'], t: 'у ウ сверху точка (3 штриха), у ワ слева вертикаль (2), フ — один штрих' },
  { id: 'ko-yu-yo-ro', s: 'k', k: ['コ', 'ユ', 'ヨ', 'ロ'], t: 'コ открыта влево, ロ замкнута, у ヨ три горизонтали, у ユ нижняя черта длиннее и выходит вправо' },
  { id: 'chi-te', s: 'k', k: ['チ', 'テ'], t: 'у チ сверху наклонная черта и вертикаль проходит сквозь перекладину; у テ две горизонтали' },
  { id: 'su-nu', s: 'k', k: ['ス', 'ヌ'], t: 'у ヌ хвост перечёркнут отдельной чертой' },
  { id: 'a-ma', s: 'k', k: ['ア', 'マ'], t: 'у ア вторая черта длинная и уходит вниз влево, у マ — короткая, вниз вправо' },
  { id: 'na-me', s: 'k', k: ['ナ', 'メ'], t: 'у ナ горизонталь, у メ обе черты косые' },
  { id: 'ru-re', s: 'k', k: ['ル', 'レ'], t: 'ル — два штриха, レ — один' },
  { id: 'sa-se', s: 'k', k: ['サ', 'セ'], t: 'у サ две вертикали, у セ одна, с крюком' },
  { id: 'ra-wo', s: 'k', k: ['ラ', 'ヲ'], t: 'у ヲ две горизонтали и отдельная косая, у ラ сверху короткая черта' },
];

if (typeof module !== 'undefined') module.exports = { ROWS, SIMILAR, transcribe, canon, checkReading, displayReading, toKata, toHira, bigOf };
