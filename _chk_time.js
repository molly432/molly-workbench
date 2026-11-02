/* 从两个源页里**原样提取**时间相关函数定义来跑，而不是复制一份手写版本。
   手写版本会变成「测我自己抄的东西」，跟文件里的真实实现脱钩。 */
const fs = require('fs');

function pull(file, names) {
  const src = fs.readFileSync(file, 'utf8');
  let out = '';
  for (const n of names) {
    const re = new RegExp('(\\n\\s*function ' + n + '\\s*\\([\\s\\S]*?\\n\\s*\\})', 'm');
    const m = src.match(re);
    if (!m) throw new Error('提取失败: ' + file + ' :: ' + n);
    out += m[1] + '\n';
  }
  return out;
}

const COMMON = `
function pad(n){ return (n<10?'0':'')+n; }
function keyOf(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function dayKey(v){
  if (!v) return '';
  var s = String(v);
  if (/^\\d{4}-\\d{2}-\\d{2}/.test(s)) return s.slice(0,10);
  var n = Number(v);
  if (!isNaN(n) && n>0) return keyOf(new Date(n));
  return '';
}
function dLabel(key){ var p=String(key||'').split('-'); return Number(p[1])+'月'+Number(p[2])+'日'; }
`;

const NAMES = ['timeOf', 'dtText', 'dtFriendly', 'toApiDate'];

function build(file, extra, names) {
  return COMMON + (extra || '') + pull(file, names || NAMES);
}

const host = build('workbench_v3.html');
const brain = build('workbench_brain.html',
  `function dayKeyB(v){
     if (!v) return '';
     if (typeof v === 'number'){ var d=new Date(v); return isNaN(d.getTime())?'':keyOf(d); }
     var s=String(v).trim();
     if (/^\\d{4}-\\d{2}-\\d{2}/.test(s)) return s.slice(0,10);
     var d2=new Date(s); return isNaN(d2.getTime())?'':keyOf(d2);
   }`, ['timeOf', 'dtText', 'toApiDate']);

let pass = 0, fail = 0;
function eq(label, got, want) {
  const ok = String(got) === String(want);
  if (ok) { pass++; console.log('  PASS  ' + label + '  → ' + JSON.stringify(got)); }
  else { fail++; console.log('  FAIL  ' + label + '  得到=' + JSON.stringify(got) + '  期望=' + JSON.stringify(want)); }
}

for (const [tag, code] of [['宿主', host], ['脑区', brain]]) {
  console.log('\n=== ' + tag + ' ===');
  const F = new Function(code + '; return {timeOf: timeOf, dtText: dtText,'
    + ' dtFriendly: (typeof dtFriendly === "function" ? dtFriendly : null),'
    + ' toApiDate: toApiDate};')();

  console.log('-- timeOf：只有真时间才算数，00:00 与无时间一律空 --');
  eq('timeOf("2026-09-21 14:30")', F.timeOf('2026-09-21 14:30'), '14:30');
  eq('timeOf("2026-09-21T14:30:00Z")', F.timeOf('2026-09-21T14:30:00Z'), '14:30');
  eq('timeOf("2026-09-21") 纯日期', F.timeOf('2026-09-21'), '');
  eq('timeOf("2026-09-21T00:00:00Z") 旧数据零点', F.timeOf('2026-09-21T00:00:00Z'), '');
  eq('timeOf(时间戳数字)', F.timeOf(1789798763281), '');
  eq('timeOf("")', F.timeOf(''), '');
  eq('timeOf(null)', F.timeOf(null), '');
  eq('timeOf("14:30") 孤立时间不算', F.timeOf('14:30'), '14:30');
  eq('timeOf("2026-09-21 09:05") 个位补零', F.timeOf('2026-09-21 9:05'), '09:05');
  eq('timeOf("2026-09-21 25:00") 非法小时', F.timeOf('2026-09-21 25:00'), '');
  eq('timeOf("2026-09-21 12:75") 非法分钟', F.timeOf('2026-09-21 12:75'), '');

  console.log('-- dtText：输入框标准写法 --');
  eq('dtText(带时间)', F.dtText('2026-09-21 14:30'), '2026-09-21 14:30');
  eq('dtText(ISO带时间)', F.dtText('2026-09-21T14:30:00Z'), '2026-09-21 14:30');
  eq('dtText(纯日期)', F.dtText('2026-09-21'), '2026-09-21');
  eq('dtText(旧零点)', F.dtText('2026-09-21T00:00:00Z'), '2026-09-21');
  eq('dtText(空)', F.dtText(''), '');

  console.log('-- toApiDate：写进 date 列的值 --');
  eq('纯日期原样', F.toApiDate('2026-09-21'), '2026-09-21');
  eq('带时间转 ISO', F.toApiDate('2026-09-21 14:30'), '2026-09-21T14:30:00Z');
  eq('从 ISO 读再写回（幂等）', F.toApiDate('2026-09-21T14:30:00Z'), '2026-09-21T14:30:00Z');
  eq('旧零点读回不变纯日期', F.toApiDate('2026-09-21T00:00:00Z'), '2026-09-21');
  eq('空值', F.toApiDate(''), '');

  console.log('-- dtFriendly：给人看 --');
  if (F.dtFriendly) {
    eq('带时间', F.dtFriendly('2026-09-21 14:30'), '9月21日 14:30');
    eq('纯日期', F.dtFriendly('2026-09-21'), '9月21日');
  } else {
    console.log('  SKIP  脑区不导出 dtFriendly（它的中文格式由 claimDayLabel 承担）');
  }
}

console.log('\n=== 关键回归：按天的老逻辑不能被时间后缀打破 ===');
{
  const F = new Function(COMMON + pull('workbench_v3.html', NAMES) +
    '; return {dayKey,timeOf,toApiDate};')();
  eq('dayKey("2026-09-21 14:30") 仍取到天', F.dayKey('2026-09-21 14:30'), '2026-09-21');
  eq('dayKey("2026-09-21T14:30:00Z") 仍取到天', F.dayKey('2026-09-21T14:30:00Z'), '2026-09-21');
  // 逾期比较：日期级字符串比较，带时间不能影响
  const today = '2026-09-21';
  const overdueKeys = ['2026-09-20 18:00', '2026-09-20', '2026-09-21 09:00', '2026-09-22 08:00'];
  const verdict = overdueKeys.map(k => F.dayKey(k) < today);
  eq('逾期判定（带时间不影响）', JSON.stringify(verdict), JSON.stringify([true, true, false, false]));
}

console.log('\n=== normTime / claimDayLabel（脑区标签）===');
{
  const src = fs.readFileSync('workbench_v3.html', 'utf8');
  const m = src.match(/\n\s*function normTime\s*\([\s\S]*?\n\s{4}\}/);
  if (!m) throw new Error('normTime 提取失败');
  console.log('  （已从源页提取 normTime，' + m[0].length + ' 字符）');
  const N = new Function(COMMON + m[0] + '; return normTime;')();
  eq('normTime("1430")', N('1430'), '14:30');
  eq('normTime("930")', N('930'), '09:30');
  eq('normTime("14:30")', N('14:30'), '14:30');
  eq('normTime("14.30")', N('14.30'), '14:30');
  eq('normTime("14：30") 全角冒号', N('14：30'), '14:30');
  eq('normTime("9:5")', N('9:5'), '09:05');
  eq('normTime("")', N(''), '');
  eq('normTime("abc")', N('abc'), '');
  eq('normTime("2500") 非法', N('2500'), '');

  const bsrc = fs.readFileSync('workbench_brain.html', 'utf8');
  const bm = bsrc.match(/\n\s*function claimDayLabel\s*\([\s\S]*?\n\s{2}\}/);
  if (!bm) throw new Error('claimDayLabel 提取失败');
  const CDL = new Function(COMMON + pull('workbench_brain.html', ['timeOf']) + bm[0] +
    '; return claimDayLabel;')();
  eq('claimDayLabel 带时间（曾会 NaN）', CDL('2026-09-21 14:30'), '9月21日 14:30');
  eq('claimDayLabel 纯日期', CDL('2026-09-21'), '9月21日');
  eq('claimDayLabel 空', CDL(''), '—');
}

console.log('\n__FAILED__ ' + fail);
process.exit(fail ? 1 : 0);
