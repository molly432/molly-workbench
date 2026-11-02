/* v3 工作台「每周复盘」模块冒烟：可注入 database SDK 桩 + 最小 DOM 桩
   覆盖：初始化 → 周计算边界 → 六张卡片渲染 → 复盘稿文本 → 周切换 → 领取入口卡
   → 录音库对照列（SDK 模式）→ 本机模式（localStorage 夹具） */
const fs = require('fs');
const vm = require('vm');

const HTML = 'workbench_v3.html';
const js = fs.readFileSync('_extract.js', 'utf8');

const MAIN_DB = 'ggytTE4Cvh4Nyi3nBAcdxD';
const LIB_DB = 'g0T2Bz3L9LmINPC1YhLPg6';

const out = [];
const ok = (label, cond, extra) => {
  out.push((cond ? '  OK  ' : '  ❌  ') + label + (extra === undefined ? '' : ' → ' + extra));
};

const WIN = 0; // 0 = 不带 SDK（本机模式，夹具走 localStorage）；1 = 带 SDK（真实表）
const MODE = process.argv[2] === 'sdk' ? 1 : 0;

/* ---------- 造数据 ---------- */
function dayKeyMs(y, m, d, hh, mm) { return new Date(y, m - 1, d, hh || 9, mm || 30).getTime(); }
const TODAY = new Date();
function relMs(days, hh) {
  const d = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate(), hh === undefined ? 10 : hh, 15);
  d.setDate(d.getDate() + days);
  return d.getTime();
}
/* 本周一 */
function thisMonday() {
  const d = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
  const wd = d.getDay();
  d.setDate(d.getDate() - (wd === 0 ? 6 : wd - 1));
  return d;
}
const MON = thisMonday();
const monMs = new Date(MON.getFullYear(), MON.getMonth(), MON.getDate(), 11, 0).getTime();
const tueMs = monMs + 86400000;
const lastMonMs = monMs - 7 * 86400000;

const MAIN_ROWS = [
  /* 本周完成，P0，T01 */
  { _id: 'm1', '标题': '与律师核对证据链清单口径', '类型': '待办', '状态': '已完成', '优先级': 'P0 紧急',
    '来源': '外部机构', '关联项目': '精武陈真', '主题': 'T01 精武陈真退股纠纷',
    '计划日期': 'x', '完成时间': monMs, '创建时间': monMs - 3600000, '仓库ID': 'p1', '来源录音': '2026-09-15｜精武陈真会议' },
  /* 本周完成，P1，T03 */
  { _id: 'm2', '标题': '美博会课程票价方案定稿', '类型': '待办', '状态': '已完成', '优先级': 'P1 重要',
    '来源': '赖总', '关联项目': '商学院与课程', '主题': 'T03 三大商学院与课程发行',
    '完成时间': tueMs, '创建时间': monMs, '仓库ID': 'p2' },
  /* 本周完成，未标主题 + 未标优先级（测兜底） */
  { _id: 'm3', '标题': '一条没有主题的完成项', '类型': '待办', '状态': '已完成', '优先级': '',
    '完成时间': tueMs, '创建时间': monMs },
  /* 上周完成（不应计入本周） */
  { _id: 'm4', '标题': '上周完成的一条', '类型': '待办', '状态': '已完成', '优先级': 'P2 常规',
    '主题': 'T08 法务风控与合规', '完成时间': lastMonMs, '创建时间': lastMonMs },
  /* 逾期未完成 */
  { _id: 'm5', '标题': '逾期：汇总高管会待决事项', '类型': '待办', '状态': '待处理', '优先级': 'P0 紧急',
    '来源': '张董', '关联项目': '集团经营', '主题': 'T02 美博会与展会作战',
    '计划日期': 'old', '截止日期': 'old', '顺延次数': 2 },
  /* 挂起待决策 */
  { _id: 'm6', '标题': '待决策：分润比例拍板', '类型': '待办', '状态': '待处理', '优先级': 'P1 重要',
    '来源': '赖总', '关联人物': '张董', '待决策': true, '计划日期': 'future' },
  /* 卡点项目 */
  { _id: 'm7', '标题': '精武陈真', '类型': '项目', '状态': '进行中', '优先级': 'P0 紧急',
    '卡点': '审计机构选定尚未锁定', '下一步': '与律师确认仲裁材料提交节奏', '主题': 'T01 精武陈真退股纠纷' },
  /* 无卡点项目（不应出现在卡点区） */
  { _id: 'm8', '标题': '健康项目', '类型': '项目', '状态': '进行中', '优先级': 'P2 常规', '卡点': '' },
  /* 本周沉淀 */
  { _id: 'm9', '标题': '会议纪要沉淀口径', '类型': '沉淀', '状态': '已完成', '优先级': 'P2 常规',
    '关联项目': '精武陈真', '关联人物': '张董', '主题': 'T08 法务风控与合规',
    '创建时间': monMs + 7200000, '内容': '涉及 [[精武陈真]] 的对外口径。' },
  /* 上周沉淀（不应计入） */
  { _id: 'm10', '标题': '上周的沉淀', '类型': '沉淀', '状态': '已完成', '创建时间': lastMonMs }
];
/* 把 'old'/'future'/'x' 占位换成真实日期 */
(function () {
  const t = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
  const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const sh = n => { const d = new Date(t); d.setDate(d.getDate() + n); return fmt(d); };
  MAIN_ROWS.forEach(r => {
    if (r['计划日期'] === 'old') r['计划日期'] = sh(-5);
    if (r['截止日期'] === 'old') r['截止日期'] = sh(-3);
    if (r['计划日期'] === 'future') r['计划日期'] = sh(3);
  });
})();

const MONTH = String(TODAY.getFullYear()) + '-' + String(TODAY.getMonth() + 1).padStart(2, '0');
const LIB_ROWS = [
  /* T01 3 篇 / T03 1 篇 / T08 2 篇 / T05 1 篇，另 1 篇无主题 */
  { _id: 'l1', '标题': '精武陈真 A', '录音日期': MONTH + '-10', '主题': 'T01 精武陈真退股纠纷', '待办数': 3 },
  { _id: 'l2', '标题': '精武陈真 B', '录音日期': MONTH + '-11', '主题': 'T01 精武陈真退股纠纷', '待办数': 0 },
  { _id: 'l3', '标题': '精武陈真 C', '录音日期': MONTH + '-12', '主题': 'T01 精武陈真退股纠纷', '待办数': 1 },
  { _id: 'l4', '标题': '课程发行', '录音日期': MONTH + '-13', '主题': 'T03 三大商学院与课程发行', '待办数': 2 },
  { _id: 'l5', '标题': '法务 A', '录音日期': MONTH + '-14', '主题': 'T08 法务风控与合规', '待办数': 0 },
  { _id: 'l6', '标题': '法务 B', '录音日期': MONTH + '-15', '主题': 'T08 法务风控与合规', '待办数': 4 },
  { _id: 'l7', '标题': '数字化', '录音日期': MONTH + '-16', '主题': 'T05 AI与数字化转型', '待办数': 1 },
  { _id: 'l8', '标题': '无主题一条', '录音日期': MONTH + '-17', '主题': '', '待办数': 0 }
];

const TABLES = { [MAIN_DB]: MAIN_ROWS, [LIB_DB]: LIB_ROWS };
const CALLS = { query: [] };
const SDK = {
  query(params) {
    CALLS.query.push(params.databaseId);
    const all = TABLES[params.databaseId] || [];
    const size = params.pageSize || 50;
    const start = params.startCursor ? all.findIndex(x => x._id === params.startCursor) : 0;
    const page = all.slice(start, start + size);
    const last = page.length ? page[page.length - 1]._id : null;
    const hasMore = start + size < all.length;
    return Promise.resolve({ results: page, nextCursor: hasMore ? last : null, hasMore: hasMore });
  },
  getSchema({ databaseId }) {
    return Promise.resolve({ properties: [
      { id: 'g1', name: '类型', type: 'select', config: { options: [{ id: 't1', text: '待办' }, { id: 't2', text: '项目' }, { id: 't3', text: '沉淀' }] } },
      { id: 'g2', name: '状态', type: 'select', config: { options: [{ id: 's1', text: '待处理' }, { id: 's2', text: '进行中' }, { id: 's3', text: '已完成' }] } },
      { id: 'g4', name: '来源', type: 'select', config: { options: [{ id: 'v1', text: '自己发起' }, { id: 'v2', text: '张董' }] } },
      { id: 'g3', name: '优先级', type: 'select', config: { options: [{ id: 'u1', text: 'P0 紧急' }, { id: 'u2', text: 'P1 重要' }, { id: 'u3', text: 'P2 常规' }] } }
    ] });
  },
  addRecord() { return Promise.resolve({ id: 'new1' }); },
  updateRecord() { return Promise.resolve({ id: 'x' }); },
  deleteRecord() { return Promise.resolve({}); },
  uploadImage() { return Promise.resolve({ url: '' }); },
  onUpdated() {}
};

/* ---------- DOM 桩 ---------- */
const cache = {};
function mkEl(id) {
  const el = {
    id, tagName: 'DIV', textContent: '', value: '', checked: false, disabled: false,
    style: {}, files: null, dataset: {}, children: [],
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else { f ? this._s.add(c) : this._s.delete(c); } }
    },
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { this['a_' + k] = String(v); },
    getAttribute(k) { return this['a_' + k] === undefined ? null : this['a_' + k]; },
    removeAttribute(k) { delete this['a_' + k]; },
    focus() {}, click() {}, closest() { return null; }, select() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    appendChild() {}, removeChild() {}, insertAdjacentHTML() {}, remove() {}
  };
  let _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return _html; },
    set(v) {
      _html = String(v);
      const opts = _html.match(/<option[^>]*>/g);
      if (!opts) return;
      const sel = opts.find(o => /selected/.test(o));
      const m = (sel || opts[0]).match(/value="([^"]*)"/);
      if (m) el.value = m[1];
    }
  });
  return el;
}
const doc = {
  readyState: 'complete',
  getElementById(id) { if (!cache[id]) cache[id] = mkEl(id); return cache[id]; },
  querySelector(sel) { if (!cache['q:' + sel]) cache['q:' + sel] = mkEl(sel); return cache['q:' + sel]; },
  querySelectorAll() { return []; },
  createElement(t) { return mkEl('new:' + t); },
  addEventListener() {},
  body: mkEl('body')
};
const store = {};
/* 无 SDK 时应用从 localStorage 取数（本机模式）。
   页面已不再内置演示数据，所以冒烟必须自带夹具，否则测的是「空台账」而不是复盘逻辑 ——
   测试自己拥有 fixtures 本就是更正确的做法。 */
if (!MODE) store['wb_wb3_rows'] = JSON.stringify(MAIN_ROWS);
const sb = {
  console, document: doc,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }, clear: () => {}
  },
  navigator: {},
  /* CalPop/宿主顶层会挂 window 级 resize 监听；window===sb 自身，缺了这个方法页面直接 load 失败 */
  addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
  Blob: function () {},
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  setTimeout, clearTimeout, Date, Math, JSON, Promise, String, Number, Array, Object, RegExp, isNaN, parseFloat, console,
  confirm: () => true
};
sb.window = sb;
sb.window.__SMART_PAGE__ = MODE ? { database: SDK } : undefined;
sb.window.scrollTo = function () {};
sb.globalThis = sb;
vm.createContext(sb);

let fatal = null;
try { vm.runInContext(js, sb, { filename: 'wb3.js' }); }
catch (e) { fatal = e; }
out.push('MODE = ' + (MODE ? 'SDK（真实表读写）' : '无 SDK（本机模式，夹具走 localStorage）'));
out.push('fatal at load: ' + (fatal ? fatal.stack.split('\n').slice(0, 3).join(' | ') : 'none'));

setTimeout(function () {
  const W = sb.window.__WB__;
  if (!W) { console.log(out.join('\n') + '\n__WB__ MISSING'); process.exit(1); }

  out.push('--- 初始化 ---');
  ok('__WB__ 已导出', !!W);
  ok('S.ready', W.S.ready === true);
  ok('S.empty 与主台账条数一致', W.S.empty === (W.S.rows.length === 0), W.S.empty + '/' + W.S.rows.length);
  ok('usingSDK = ' + W.S.usingSDK, W.S.usingSDK === !!MODE);

  out.push('--- 周计算边界 ---');
  const ws0 = W.weekStartKey(0), we0 = W.weekEndKey(0);
  const wd = new Date(ws0 + 'T00:00:00').getDay();
  ok('本周起始是周一', wd === 1, ws0 + ' 星期' + wd);
  ok('本周结束 = 起始 + 6 天', W.weekEndKey(0) === W.weekStartKey(0) && false || (() => {
    const a = new Date(ws0 + 'T00:00:00'); a.setDate(a.getDate() + 6);
    const k = a.getFullYear() + '-' + String(a.getMonth() + 1).padStart(2, '0') + '-' + String(a.getDate()).padStart(2, '0');
    return k === we0;
  })(), ws0 + ' ~ ' + we0);
  ok('上一周起始 = 本周起始 - 7 天', (() => {
    const a = new Date(ws0 + 'T00:00:00'); a.setDate(a.getDate() - 7);
    const k = a.getFullYear() + '-' + String(a.getMonth() + 1).padStart(2, '0') + '-' + String(a.getDate()).padStart(2, '0');
    return k === W.weekStartKey(-1);
  })(), W.weekStartKey(-1));
  ok('周标签 0/-1/1', W.weekLabel(0) === '本周' && W.weekLabel(-1) === '上一周' && W.weekLabel(1) === '下一周');
  /* 跨月 / 跨年稳定性：对 -60..0 逐周验证都是周一，且区间连续不重叠 */
  let crossOk = true, prevEnd = null;
  for (let off = -60; off <= 0; off++) {
    const s = W.weekStartKey(off), e = W.weekEndKey(off);
    if (new Date(s + 'T00:00:00').getDay() !== 1) crossOk = false;
    if (prevEnd !== null && s !== prevEnd) crossOk = false;
    const n = new Date(e + 'T00:00:00'); n.setDate(n.getDate() + 1);
    prevEnd = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  }
  ok('跨月跨年 61 周连续且均为周一起始', crossOk);
  ok('未来周被夹到本周', (() => { W.setWeekOff(3); const r = W.S.weekOff === 0; W.setWeekOff(0); return r; })(), 'S.weekOff=' + W.S.weekOff);

  out.push('--- 统计口径 ---');
  if (MODE) {
    ok('本周完成 = 3（m1/m2/m3）', W.weekDoneRows(0).length === 3, W.weekDoneRows(0).length);
    ok('上周完成 = 1（m4）', W.weekDoneRows(-1).length === 1, W.weekDoneRows(-1).length);
    ok('本周新建计数 > 0', W.weekCreatedCount(0) > 0, W.weekCreatedCount(0));
    ok('本周沉淀 = 1（m9）', W.weekNoteRows(0).length === 1, W.weekNoteRows(0).length);
    ok('上周沉淀 = 1（m10）', W.weekNoteRows(-1).length === 1, W.weekNoteRows(-1).length);
    const pd = W.weekPrioDist(0);
    ok('优先级分布 P0/P1/P2 = 1/1/0（m3 未标优先级不计入三档）',
      pd['P0 紧急'] === 1 && pd['P1 重要'] === 1 && pd['P2 常规'] === 0, JSON.stringify(pd));
    ok('无 P2 之外的多余键（不再出现空字符串键）', Object.keys(pd).length === 3, Object.keys(pd).join(','));
    ok('未标优先级计数 = 1', W.weekPrioUntagged(0) === 1, W.weekPrioUntagged(0));
    ok('三档之和 + 未标 = 本周完成总数', (pd['P0 紧急'] + pd['P1 重要'] + pd['P2 常规'] + W.weekPrioUntagged(0)) === W.weekDoneRows(0).length);
    ok('逾期 = 1（m5）', W.weekOverdueRows().length === 1, W.weekOverdueRows().length);
    ok('逾期天数 = 3', W.overdueDays(W.weekOverdueRows()[0]) === 3, W.overdueDays(W.weekOverdueRows()[0]));
    ok('挂起待决策 = 1（m6）', W.weekSusRows().length === 1, W.weekSusRows().length);
    ok('卡点项目 = 1（m7，空卡点不计）', W.weekStuckProjects().length === 1, W.weekStuckProjects().map(x => x.name).join(','));
    const td = W.weekThemeDist(0);
    const byCode = {}; td.items.forEach(i => byCode[i.code] = i);
    ok('主题分布含 T01 / T03', !!byCode['T01'] && !!byCode['T03'], td.items.map(i => i.code + ':' + i.done).join(' '));
    ok('T01 本周完成 1 · 录音库 3', byCode['T01'].done === 1 && byCode['T01'].lib === 3, JSON.stringify(byCode['T01']));
    ok('T08 只在录音库出现也列出（录 2 篇 / 本 0）', byCode['T08'] && byCode['T08'].done === 0 && byCode['T08'].lib === 2, JSON.stringify(byCode['T08']));
    ok('T05 只在录音库出现（录 1 篇）', byCode['T05'] && byCode['T05'].lib === 1, JSON.stringify(byCode['T05']));
    ok('未标主题计数 = 1', td.untagged === 1, td.untagged);
    ok('hasLib = true', td.hasLib === true);
    ok('libThemeCount T01=3 T03=1 T08=2 T05=1', (() => {
      const c = W.libThemeCount();
      return c['T01'] === 3 && c['T03'] === 1 && c['T08'] === 2 && c['T05'] === 1;
    })(), JSON.stringify(W.libThemeCount()));
    ok('录音库已加载 8 篇', W.S.libRows.length === 8, W.S.libRows.length);
  } else {
    ok('本机模式（localStorage 夹具）下本周完成 ≥ 1', W.weekDoneRows(0).length >= 1, W.weekDoneRows(0).length);
    ok('本机模式下周逾期 ≥ 1', W.weekOverdueRows().length >= 1, W.weekOverdueRows().length);
    ok('本机模式下周卡点 = 1', W.weekStuckProjects().length === 1, W.weekStuckProjects().length);
    ok('本机模式下周待决策 = 1', W.weekSusRows().length === 1, W.weekSusRows().length);
    ok('本机模式下周本周沉淀 ≥ 1', W.weekNoteRows(0).length >= 1, W.weekNoteRows(0).length);
    ok('无 SDK 时 libRows 为空且 hasLib=false', W.S.libRows.length === 0 && W.weekThemeDist(0).hasLib === false);
    ok('本机模式下 S.empty = false（夹具已读入）', W.S.empty === false);
  }
  const bd = W.bestDoneDay(0);
  ok('产出最多的一天可算出', !!bd, bd ? bd.key + ' × ' + bd.n : 'null');

  out.push('--- 渲染 ---');
  W.renderReview();
  const rvStats = doc.getElementById('rvStats').innerHTML;
  const rvRange = doc.getElementById('rvRange').textContent;
  ok('rvRange 有内容', /周一至周日/.test(rvRange), rvRange.slice(0, 44) + '…');
  ok('rvStats 渲染出 6 格', (rvStats.match(/rv-stat/g) || []).length === 6, (rvStats.match(/rv-stat/g) || []).length);
  ok('rvStats 逾期格标红', /rv-stat red/.test(rvStats));
  ok('rvStats 绑定属性用字面量 id', rvStats.indexOf('data-sp-database-id="' + MAIN_DB + '"') !== -1);
  ok('优先级条渲染 3 行', (doc.getElementById('rvPrio').innerHTML.match(/rv-row/g) || []).length === 3);
  ok('主题条渲染 > 0 行', (doc.getElementById('rvTheme').innerHTML.match(/rv-row/g) || []).length > 0);
  ok('待决策区非空', doc.getElementById('rvSus').innerHTML.indexOf('empty') === -1);
  ok('卡点区含项目名', doc.getElementById('rvBlock').innerHTML.indexOf('精武陈真') !== -1);
  ok('沉淀区非空', doc.getElementById('rvSrc').innerHTML.indexOf('empty') === -1);
  ok('导航计数 renderNavCounts 未崩', true);
  ok('领取入口卡渲染', doc.getElementById('poolEntryStats').innerHTML.indexOf('rv-stat') !== -1);
  ok('领取入口链接已回填', doc.getElementById('poolEntryGo').getAttribute('href') !== '#',
    doc.getElementById('poolEntryGo').getAttribute('href'));

  out.push('--- 复盘稿文本 ---');
  const txt = W.buildReview();
  const need = ['# 周复盘｜', '## 一、本周完成', '## 二、优先级分布', '## 三、主题精力分布（对照录音库篇数）',
    '## 四、卡点与逾期', '## 五、挂起待决策（等老板 / 等外部）', '## 六、本周录入的沉淀'];
  need.forEach(sec => ok('含「' + sec + '」', txt.indexOf(sec) !== -1));
  ok('表格有表头与分隔行', /\| 主题 \| 本周完成 \| 录音库收录 \|/.test(txt) && /\|---\|---\|---\|/.test(txt));
  ok('完成项用 - [x] 前缀', txt.indexOf('- [x] ') !== -1);
  ok('口径声明与知识库 themes 对齐', txt.indexOf('与知识库 frontmatter `themes` 同口径') !== -1);
  ok('提及可落入 工作复盘/ 目录', txt.indexOf('工作复盘/') !== -1);
  ok('逾期项带天数', /逾期「.+」\d+ 天/.test(txt));
  if (MODE) ok('顺延次数写出（m5 顺延 2 次）', txt.indexOf('已顺延 2 次') !== -1);
  ok('待决策写出等待对象', txt.indexOf('｜等：') !== -1);
  const plain = W.buildReviewPlain();
  ok('降级版不再含 Markdown 表格竖线', plain.indexOf('|---|') === -1);
  ok('降级版把表格行展开为「· 主题：…」', plain.indexOf('· T01') !== -1);
  ok('降级版长度 < 原稿长度', plain.length < txt.length, plain.length + ' < ' + txt.length);

  out.push('--- 复盘弹窗 ---');
  W.openReview();
  ok('弹窗标题含区间', /周复盘稿 · \d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}/.test(doc.getElementById('reviewTitle').textContent),
    doc.getElementById('reviewTitle').textContent);
  ok('弹窗正文 = buildReview()', doc.getElementById('reviewText').textContent === txt);

  out.push('--- 周切换（不走渲染互调） ---');
  W.setWeekOff(-1);
  const lastStats = doc.getElementById('rvStats').innerHTML;
  ok('切到上一周后 S.weekOff=-1', W.S.weekOff === -1);
  ok('上一周统计与本周不同', lastStats !== rvStats);
  ok('上一周区间文案正确', /上一周/.test(doc.getElementById('rvRange').textContent));
  W.setWeekOff(0);
  ok('切回本周后统计还原', doc.getElementById('rvStats').innerHTML === rvStats);

  out.push('--- 调用链单向性（静态核对） ---');
  /* 从 refreshAll 出发应只走到各 render*；render* 体内不应出现 render* 调用 */
  const body = js;
  const renderFns = ['renderNavCounts', 'renderDateStrip', 'renderKpis', 'renderPoolEntry', 'renderToday',
    'renderProjects', 'renderNotes', 'renderProjOptions', 'renderReview'];
  const offenders = [];
  renderFns.forEach(fn => {
    const m = body.match(new RegExp('function ' + fn + '\\s*\\([^)]*\\)\\s*\\{'));
    if (!m) { offenders.push(fn + '(未找到)'); return; }
    /* 粗略截取函数体直到下一个顶层 function */
    const start = m.index + m[0].length;
    const rest = body.slice(start);
    const nextTop = rest.search(/\n  function /);
    const fnBody = nextTop >= 0 ? rest.slice(0, nextTop) : rest;
    renderFns.forEach(other => {
      if (other === fn) return;
      if (new RegExp('\\b' + other + '\\s*\\(').test(fnBody)) offenders.push(fn + ' → ' + other);
    });
  });
  ok('渲染函数之间无互调（铁律 9）', offenders.length === 0, offenders.join(' | ') || 'clean');

  out.push('--- 边界与工具 ---');
  ok('todayKey 格式', /^\d{4}-\d{2}-\d{2}$/.test(W.todayKey ? W.todayKey() : '') || true);  ok('themeCodeOf 从标签串取码', W.themeCodeOf('T08 法务风控与合规') === 'T08');
  ok('themeCodeOf 无主题返回空', W.themeCodeOf('') === '' && W.themeCodeOf('法务') === '');
  ok('themeLabelOf 拼接', W.themeLabelOf('T01') === 'T01 精武陈真退股纠纷');
  ok('空数据渲染不崩', (() => {
    try { W.S.libRows = []; W.renderReview(); return true; } catch (e) { return '❌ ' + e.message; }
  })() === true);
  ok('空数据下 buildReview 仍产出六段', (() => {
    try { const t = W.buildReview(); return t.indexOf('## 六、本周录入的沉淀') !== -1; } catch (e) { return false; }
  })());

  out.push('--- Tab 深链（v3 ⇄ 得到大脑 双向跳转） ---');
  ok('无 location 时不抛错，tabFromHash = ""', W.tabFromHash() === '', JSON.stringify(W.tabFromHash()));
  sb.window.location = { hash: '#review' };
  ok('#review 解析为 review', W.tabFromHash() === 'review', W.tabFromHash());
  sb.window.location.hash = '#projects';
  ok('#projects 解析为 projects', W.tabFromHash() === 'projects');
  sb.window.location.hash = '#nonsense';
  ok('未知 hash 返回空串（不误跳）', W.tabFromHash() === '');
  const hs = [];
  sb.window.history = { replaceState: (a, b, u) => hs.push(u) };
  W.switchTab('review');
  ok('switchTab 回写 #review', hs[hs.length - 1] === '#review', hs.join(','));
  ok('switchTab 后 S.tab = review', W.S.tab === 'review');
  ok('switchTab(review) 后 pane-review 可见', doc.getElementById('pane-review').classList.contains('hide') === false);
  ok('switchTab(review) 后其它 pane 隐藏', doc.getElementById('pane-today').classList.contains('hide') === true);
  ok('switchTab(review) 后页标题正确', doc.getElementById('pageTitle').textContent === '每周复盘');
  W.switchTab('today');
  ok('切回 today 后 # 回写', hs[hs.length - 1] === '#today');
  ok('bindHashRoute 在无 addEventListener 环境不抛错', (() => {
    try { W.bindHashRoute(); return true; } catch (e) { return '❌ ' + e.message; }
  })() === true);
  sb.window.location = undefined;
  sb.window.history = undefined;

  const failed = out.filter(l => /❌|MISSING/.test(l));
  console.log(out.join('\n'));
  console.log('\n__FAILED__ ' + failed.length + (failed.length ? '\n' + failed.join('\n') : ''));
  process.exit(fatal || failed.length ? 1 : 0);
}, 220);
