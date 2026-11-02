/* 统一工作台冒烟：两段 IIFE（宿主 + 脑区）在同一沙箱依序执行，
   验证 7 个 Tab 共用一个导航壳、跨模块互相驱动、脑区数据链路仍然完好。
   依赖：可注入 database SDK 桩 + 最小 DOM 桩（无浏览器内核环境下的等价验收） */
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('workbench.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (scripts.length !== 2) { console.log('__FAILED__ 1\nscript 块数异常: ' + scripts.length); process.exit(1); }

const LIB_DB = 'g0T2Bz3L9LmINPC1YhLPg6';
const POOL_DB = 'fONLTaaLixhK3YpW5ExBJO';
const MAIN_DB = 'ggytTE4Cvh4Nyi3nBAcdxD';

/* ---------- 造真实形状的数据 ---------- */
function mkLib(i, date, todoN, state) {
  return {
    _id: 'lib' + i, '标题': '第 ' + i + ' 场会议纪要', '录音日期': date,
    '来源ID': '19000000000000000' + i, '主题': i % 2 ? 'T08 法务风控与合规' : 'T03 三大商学院与课程发行',
    '摘要': '这是第 ' + i + ' 场的摘要内容。'.repeat(4),
    '待办事项': todoN ? '• 事项A\n• 事项B' : '', '待办数': todoN,
    '关键摘录': '摘录', '文件名': date + '__第' + i + '场',
    '提取状态': state || (todoN ? '已提取' : '无待办'), '同步时间': 1758000000000
  };
}
const SRC_BATCH = '2026-09-14｜业务提成方案与合作复盘会议讨论';
const TABLES = {
  [LIB_DB]: [
    mkLib(1, '2026-09-17', 2), mkLib(2, '2026-09-10', 0), mkLib(3, '2026-08-20', 3), mkLib(4, '2026-05-08', 0),
    mkLib(5, '2026-09-14', 2, '已精读'), mkLib(6, '2026-06-11', 0, '历史不抽取')
  ],
  [POOL_DB]: [
    { _id: 'p1', '事项': '整理金武成真在职人员劳动合同并逐条核实', '状态': '待领取', '优先级建议': 'P0 紧急',
      '来源录音': '2026-09-17｜样品间管理系统讨论', '录音日期': '2026-09-17', '来源ID': '191', '主题': 'T08 法务风控与合规',
      '指派人': '茉莉', '命中规则': 'P1原生待办|紧急词:尽快', '原文摘录': '尽快把劳动合同整理出来', '内容指纹': 'fp1', '创建时间': 1 },
    { _id: 'p2', '事项': '与蔡总同步飞书搭建的技术问题', '状态': '待领取', '优先级建议': 'P1 重要',
      '来源录音': '2026-09-17｜包材价格数据库', '录音日期': '2026-09-17', '来源ID': '192', '主题': 'T05 AI与数字化转型',
      '指派人': '', '命中规则': 'P1原生待办|要务词:落地', '原文摘录': '推进包材管理系统落地', '内容指纹': 'fp2', '创建时间': 2 },
    { _id: 'p3', '事项': '五月的旧事：对接卢老师团队启用工作手机', '状态': '待领取', '优先级建议': 'P2 常规',
      '来源录音': '2026-05-17｜美业公司业务布局', '录音日期': '2026-05-17', '来源ID': '193', '主题': 'T03 三大商学院与课程发行',
      '指派人': '', '命中规则': 'P1原生待办|常规', '原文摘录': '对接卢老师', '内容指纹': 'fp3', '创建时间': 3 },
    { _id: 'p4', '事项': '已经忽略过的一条', '状态': '已忽略', '优先级建议': 'P2 常规',
      '来源录音': '2026-09-10｜某会议', '录音日期': '2026-09-10', '来源ID': '194', '主题': 'T03 三大商学院与课程发行',
      '指派人': '', '命中规则': 'P2行动小标题|常规', '原文摘录': '', '内容指纹': 'fp4', '创建时间': 4 },
    { _id: 'p5', '事项': '上一轮已经领取进计划的一条', '状态': '已领取', '优先级建议': 'P1 重要',
      '来源录音': '2026-09-15｜周例会', '录音日期': '2026-09-15', '来源ID': '195', '主题': 'T06 组织架构与人力管理',
      '指派人': '', '命中规则': 'P1原生待办|常规', '原文摘录': '', '内容指纹': 'fp5', '创建时间': 5,
      '领取时间': 1758000000000, '工作台记录ID': 'm9' },
    { _id: 'p6', '事项': 'AI 精读补录的一条：与郭老师锁定现货不参与分成的口径', '状态': '待领取', '优先级建议': 'P1 重要',
      '来源录音': SRC_BATCH, '录音日期': '2026-09-14', '来源ID': '196',
      '主题': 'T07 财务体系与数据系统', '指派人': '茉莉', '命中规则': 'P4精读补录|AI逐篇精读',
      '原文摘录': '这个我们是要跟郭老师同步的，这个要同步一下。', '内容指纹': 'fp6', '创建时间': 6 },
    { _id: 'p7', '事项': '算定并下发郭老师成交的提成分配方案', '状态': '待领取', '优先级建议': 'P0 紧急',
      '来源录音': SRC_BATCH, '录音日期': '2026-09-14', '来源ID': '196',
      '主题': 'T07 财务体系与数据系统', '指派人': '茉莉', '命中规则': 'P4精读补录|AI逐篇精读',
      '原文摘录': '技术板块利润五五分。', '内容指纹': 'fp7', '创建时间': 7 },
    { _id: 'p8', '事项': '向人事调取四人现行工资待遇明细', '状态': '待领取', '优先级建议': 'P1 重要',
      '来源录音': SRC_BATCH, '录音日期': '2026-09-14', '来源ID': '196',
      '主题': 'T06 组织架构与人力管理', '指派人': '丽常', '命中规则': 'P4精读补录|AI逐篇精读',
      '原文摘录': '调取乔曼、郑小小工资待遇明细。', '内容指纹': 'fp8', '创建时间': 8 }
  ],
  [MAIN_DB]: [
    { _id: 'm1', '标题': '汇总本周高管会待决事项，输出决策清单', '类型': '待办', '状态': '待处理', '优先级': 'P0 紧急',
      '来源': '张董', '关联项目': '集团经营', '计划日期': '2026-09-18', '截止日期': '2026-09-18', '待决策': false, '顺延次数': 0 },
    { _id: 'm9', '标题': '上一轮已经领取进计划的一条', '类型': '待办', '状态': '进行中', '优先级': 'P1 重要',
      '计划日期': '2026-09-15', '仓库ID': 'p5', '来源录音': '2026-09-15｜周例会' },
    /* ---- 已完成分组夹具（完成时间给 1970 年，避开当日 KPI / 本周复盘的断言面） ---- */
    { _id: 'mD1', '标题': '完成项甲', '类型': '待办', '状态': '已完成', '优先级': 'P2 常规',
      '主题': 'T03 三大商学院与课程发行', '关联项目': '商学院课程发行', '完成时间': 3000, '创建时间': 2000, '更新时间': 3000 },
    { _id: 'mD2', '标题': '完成项乙', '类型': '待办', '状态': '已完成', '优先级': 'P2 常规',
      '主题': 'T08 法务风控与合规', '关联项目': '精武陈真案件', '完成结果': '证据清单已固化', '完成时间': 4000, '创建时间': 2001, '更新时间': 4000 },
    { _id: 'mD3', '标题': '完成项丙', '类型': '待办', '状态': '已完成', '优先级': 'P2 常规',
      '主题': 'T08 法务风控与合规', '关联项目': '精武陈真案件', '完成结果': '已签约，下周进场', '完成时间': 5000, '创建时间': 2002, '更新时间': 5000 },
    { _id: 'mD4', '标题': '完成项丁（无主题）', '类型': '待办', '状态': '已完成', '优先级': 'P2 常规',
      '完成时间': 6000, '创建时间': 2003, '更新时间': 6000 },
    /* ---- 沉淀双通道夹具：mDN1 是蒸馏草稿（只该出现在待确认区），mDN2 是正式沉淀 ---- */
    { _id: 'mDN1', '标题': '蒸馏草稿样例', '类型': '沉淀', '状态': '已完成', '标签': '蒸馏草稿,话术',
      '内容': '草稿正文：先给结论再给依据', '主题': 'T08 法务风控与合规', '创建时间': 100, '更新时间': 100 },
    { _id: 'mDN2', '标题': '正式沉淀样例', '类型': '沉淀', '状态': '已完成', '标签': '话术',
      '内容': '正式口径正文', '创建时间': 101, '更新时间': 101 }
  ]
};

const SCHEMAS = {
  [POOL_DB]: { properties: [
    { id: 'f1', name: '状态', type: 'select', config: { options: [
      { id: 'o1', text: '待领取' }, { id: 'o2', text: '已领取' }, { id: 'o3', text: '已忽略' }, { id: 'o4', text: '已完成' }] } },
    { id: 'f2', name: '优先级建议', type: 'select', config: { options: [
      { id: 'q1', text: 'P0 紧急' }, { id: 'q2', text: 'P1 重要' }, { id: 'q3', text: 'P2 常规' }] } }
  ] },
  [MAIN_DB]: { properties: [
    { id: 'g1', name: '类型', type: 'select', config: { options: [{ id: 't1', text: '待办' }, { id: 't2', text: '项目' }, { id: 't3', text: '沉淀' }] } },
    { id: 'g2', name: '状态', type: 'select', config: { options: [
      { id: 's1', text: '待处理' }, { id: 's2', text: '进行中' }, { id: 's3', text: '已完成' }] } },
    { id: 'g3', name: '优先级', type: 'select', config: { options: [
      { id: 'u1', text: 'P0 紧急' }, { id: 'u2', text: 'P1 重要' }, { id: 'u3', text: 'P2 常规' }] } },
    { id: 'g4', name: '来源', type: 'select', config: { options: [{ id: 'v1', text: '自己发起' }, { id: 'v2', text: '张董' }] } }
  ] },
  [LIB_DB]: { properties: [{ id: 'h1', name: '提取状态', type: 'select', config: { options: [
    { id: 'w1', text: '待提取' }, { id: 'w2', text: '已提取' }, { id: 'w3', text: '无待办' },
    { id: 'w4', text: '已精读' }, { id: 'w5', text: '历史不抽取' }] } }] }
};

/* ---------- SDK 桩 ---------- */
const CALLS = { add: [], update: [], query: [], del: [] };
let seq = 0;
/* onUpdated：合并页里只有宿主注册一次（用于「DB 变更 → 自动重载」）。
   桩必须真的把回调存下来并触发，否则「领取后宿主自动刷新」这条链路测不到。 */
let UPD = null;
function notify(id) {
  if (!UPD) return;
  setTimeout(function () { try { UPD({ databaseIds: [id] }); } catch (e) {} }, 0);
}
/* 写入的属性是 {select: optionId} / {text:...} / {date:...} / {checkbox:...} 这种「按类型包一层」的形状，
   但真实平台 query 读回来的 select 字段是【选项文本】——应用里 typeOf()/isDone() 都是直接拿
   r['类型'] === '待办'、r['状态'] === '已完成' 比文本。桩若原样存 option id，
   新写入的记录就会「库里有、页面里一条都不显示」，看起来像应用 bug，其实是桩失真。
   这里按 name→选项文本 还原，保持桩与线上读取形状一致。 */
function optTextById(databaseId, field, id) {
  const sc = SCHEMAS[databaseId];
  if (!sc) return id;
  const f = (sc.properties || []).find(p => p.name === field);
  if (!f || !f.config) return id;
  const o = (f.config.options || []).find(x => x.id === id);
  return o ? o.text : id;
}
function matVal(databaseId, field, v) {
  if (v && typeof v === 'object') {
    if ('select' in v) return optTextById(databaseId, field, v.select);
    if ('text' in v) return v.text;
    if ('date' in v) return v.date;
    if ('checkbox' in v) return !!v.checkbox;
    if ('number' in v) return v.number;
  }
  return v;
}

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
  getSchema({ databaseId }) { return Promise.resolve(SCHEMAS[databaseId] || { properties: [] }); },
  addRecord({ databaseId, properties }) {
    const id = 'new' + (++seq);
    const rec = { _id: id };
    for (const k in properties) rec[k] = matVal(databaseId, k, properties[k]);
    CALLS.add.push({ databaseId, properties, id });
    (TABLES[databaseId] = TABLES[databaseId] || []).push(rec);
    notify(databaseId);
    return Promise.resolve({ id });
  },
  updateRecord({ databaseId, recordId, properties }) {
    CALLS.update.push({ databaseId, recordId, properties });
    const rec = (TABLES[databaseId] || []).find(x => x._id === recordId);
    if (rec) for (const k in properties) rec[k] = matVal(databaseId, k, properties[k]);
    notify(databaseId);
    return Promise.resolve({ id: recordId });
  },
  /* 删除必须真的从 TABLES 里移除 —— 否则「点删除后它还在」这种 bug 测不出来 */
  deleteRecord({ databaseId, recordId }) {
    CALLS.del.push({ databaseId, recordId });
    const arr = TABLES[databaseId] || [];
    const i = arr.findIndex(x => x._id === recordId);
    if (i >= 0) arr.splice(i, 1);
    notify(databaseId);
    return Promise.resolve({ id: recordId });
  },
  onUpdated(cb) { UPD = cb; }
};

/* ---------- DOM 桩（classList 与 className 共享同一状态） ---------- */
/* 事件桩：收集监听器并按类型派发。日历组件的交互是 document 级委托，
   若桩只提供空 addEventListener，就只能靠直接调 API 测，测不到「真的点/敲能生效」。 */
const H = new WeakMap();
function on(node, type, fn) {
  if (!node || typeof fn !== 'function') return;
  let m = H.get(node);
  if (!m) { m = {}; H.set(node, m); }
  (m[type] = m[type] || []).push(fn);
}
function fire(node, type, ev) {
  const m = H.get(node);
  if (!m || !m[type]) return 0;
  let n = 0;
  for (const fn of m[type].slice()) { fn(ev || {}); n++; }
  return n;
}
/* 选择器匹配：只支持本页用到的写法（tag / #id / .cls / [attr] / [attr=value] 的组合）。
   桩的 closest 必须真的沿 parentNode 回溯祖先 —— 否则「事件委托没生效 / 选择器写错」
   这类 bug 在无浏览器环境里永远静默通过，上一次漏掉「任务清单删不掉」就是栽在这里。 */
function matchSel(node, sel) {
  if (!node) return false;
  const m = /^([a-zA-Z]*)(.*)$/.exec(String(sel || '').trim());
  if (!m) return false;
  const tag = m[1], rest = m[2] || '';
  if (tag && String(node.tagName || '').toLowerCase() !== tag.toLowerCase()) return false;
  const tokens = rest.match(/[.#][\w-]+|\[[^\]]+\]/g) || [];
  for (const tk of tokens) {
    if (tk[0] === '.') {
      if (!(node.classList && node.classList.contains(tk.slice(1)))) return false;
    } else if (tk[0] === '#') {
      if (String(node.id || '') !== tk.slice(1)) return false;
    } else {
      const inner = tk.slice(1, -1);
      const eq = inner.indexOf('=');
      if (eq < 0) {
        if (typeof node.getAttribute !== 'function' || node.getAttribute(inner) === null) return false;
      } else {
        const k = inner.slice(0, eq);
        const v = inner.slice(eq + 1).replace(/^["']|["']$/g, '');
        if (String(node.getAttribute ? node.getAttribute(k) : '') !== v) return false;
      }
    }
  }
  return true;
}
const cache = {};
function mkEl(id) {
  const cls = new Set();
  const el = {
    id, tagName: 'DIV', textContent: '', value: '', checked: false, disabled: false,
    style: {}, files: null, children: [], hidden: false, parentNode: null,
    classList: {
      add: c => cls.add(c), remove: c => cls.delete(c),
      contains: c => cls.has(c),
      toggle(c, f) { if (f === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); } else { f ? cls.add(c) : cls.delete(c); } }
    },
    addEventListener(type, fn) { on(el, type, fn); },
    removeEventListener() {},
    dispatchEvent(ev) { return !!fire(el, ev && ev.type, ev); },
    setAttribute(k, v) { this['a_' + k] = String(v); },
    getAttribute(k) { return this['a_' + k] === undefined ? null : this['a_' + k]; },
    focus() {}, click() {},
    closest(sel) { let n = this; while (n) { if (matchSel(n, sel)) return n; n = n.parentNode; } return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    appendChild(c) { if (c && typeof c === 'object') { c.parentNode = el; el.children.push(c); } },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) { el.children.splice(i, 1); c.parentNode = null; } },
    getBoundingClientRect() { return { left: 120, top: 320, right: 340, bottom: 362, width: 220, height: 42 }; },
    select() {}
  };
  Object.defineProperty(el, 'className', {
    get() { return [...cls].join(' '); },
    set(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => cls.add(c)); }
  });
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
  addEventListener(type, fn) { on(doc, type, fn); },
  documentElement: mkEl('html'),
  body: mkEl('body')
};
const store = {};
/* 造一个带属性的按钮并挂到父节点下：closest 会沿 parentNode 真实回溯到自己，
   于是 fire(parent,'click',{target:btn}) 走的是和浏览器一致的分派路径 ——
   而不是像以前那样拿一个「只认某一种选择器」的替身去糊弄过去。 */
function mkBtn(parent, tag, attrs) {
  const b = mkEl('btn:' + (tag || 'button') + ':' + (seq++) );
  b.tagName = String(tag || 'button').toUpperCase();
  Object.keys(attrs || {}).forEach(function (k) { b.setAttribute(k, String(attrs[k])); });
  if (parent) parent.appendChild(b);
  return b;
}
const sb = {
  console, document: doc,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }, clear: () => {}
  },
  navigator: {}, Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  setTimeout, clearTimeout, Date, Math, JSON, Promise, String, Number, Array, Object, RegExp, isNaN, parseFloat,
  confirm: () => true,
  innerWidth: 1440,
  addEventListener(type, fn) { on(sb, type, fn); }, removeEventListener() {},
  Event: function (type, opt) { this.type = type; this.bubbles = !!(opt && opt.bubbles); }
};
sb.window = sb;
sb.window.__SMART_PAGE__ = { database: SDK };
sb.window.scrollTo = function () {};
sb.globalThis = sb;
vm.createContext(sb);

const bad = [];
const log = [];
function t(name, cond, extra) {
  log.push((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  ' + extra : ''));
  if (!cond) bad.push(name + (extra ? ' :: ' + extra : ''));
}

/* ---------- 依序执行两段 IIFE（与浏览器一致：宿主先，脑区后） ---------- */
let fatal = null;
try { vm.runInContext(scripts[0], sb, { filename: 'host.js' }); }
catch (e) { fatal = 'host: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 3).join('\n'); }
t('宿主脚本加载无异常', !fatal, fatal || '');

if (!fatal) {
  try { vm.runInContext(scripts[1], sb, { filename: 'brain.js' }); }
  catch (e) { fatal = 'brain: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 3).join('\n'); }
  t('脑区脚本加载无异常', !fatal, fatal || '');
}

setTimeout(function () {
  const W = sb.window.__WB__, B = sb.window.__BR__;
  t('宿主 __WB__ 已暴露', !!W);
  t('脑区 __BR__ 已暴露', !!B);
  if (!W || !B) { finish(); return; }

  /* ---- 数据各自加载 ---- */
  t('宿主·主台账已载入', W.S.rows.length === TABLES[MAIN_DB].length, W.S.rows.length + ' 条');
  t('脑区·待办仓库已载入', B.S.pool.length === 8, B.S.pool.length + ' 条');
  t('脑区·录音库已载入', B.S.libRows.length === 6, B.S.libRows.length + ' 条');
  t('两模块共用同一个 SDK 实例', W.S.usingSDK === true);

  /* ---- 跨模块 Tab 驱动：宿主 -> 脑区 ---- */
  W.switchTab('pool');
  const pg = (id) => doc.getElementById(id).className;
  t('宿主切到 pool：脑区 pane-pool 可见', !/\bhide\b/.test(pg('pane-pool')), 'class="' + pg('pane-pool') + '"');
  t('宿主切到 pool：脑区 pane-lib 收起', /\bhide\b/.test(pg('pane-lib')));
  t('宿主切到 pool：脑区 pane-flow 收起', /\bhide\b/.test(pg('pane-flow')));
  t('宿主切到 pool：脑区 S.tab 同步', B.S.tab === 'pool', B.S.tab);
  t('宿主切到 pool：标题已更新', doc.getElementById('pageTitle').textContent === '待办仓库',
    doc.getElementById('pageTitle').textContent);
  t('宿主切到 pool：v3 自己的 pane 全部收起',
    doc.getElementById('pane-today').classList.contains('hide') &&
    doc.getElementById('pane-review').classList.contains('hide'));

  /* ---- 切回非脑区 Tab：脑区应全部收起，且不污染 brain 的 S.tab ---- */
  W.switchTab('today');
  t('切回 today：脑区三个 pane 全部收起',
    /\bhide\b/.test(pg('pane-lib')) && /\bhide\b/.test(pg('pane-pool')) && /\bhide\b/.test(pg('pane-flow')));
  t('切回 today：pane-today 可见', !doc.getElementById('pane-today').classList.contains('hide'));
  t('切回 today：脑区 S.tab 未被污染', B.S.tab === 'pool', B.S.tab);
  t('切回 today：标题已更新', doc.getElementById('pageTitle').textContent === '今日推进',
    doc.getElementById('pageTitle').textContent);

  /* ---- 今日焦点卡（v21：今日最重要 3 件事 + 需要关注）----
     没有浏览器内核时 renderToday 由真事件在 switchTab 里驱动过，但为免依赖 init 顺序，
     这里用导出的 TodayFocus.render 显式渲染一次，只验「渲染出来的内容」对不对。 */
  const TF = W.TodayFocus;
  t('宿主暴露 TodayFocus 组件', !!TF && typeof TF.render === 'function');
  if (TF) {
    TF.today();                                  /* 走完整 renderToday 链路（含焦点卡调用） */
    const fh = TF.el().innerHTML;
    t('焦点卡渲染出「今日最重要 3 件事」', fh.indexOf('今日最重要 3 件事') >= 0);
    t('焦点卡渲染出「需要关注」面板', fh.indexOf('需要关注') >= 0);
    t('焦点卡「需要关注」带逾期计数', /逾期\s*<b>\d+<\/b>/.test(fh));
    t('焦点卡最多 3 条（不超 3 个序号位）', (fh.match(/focus-rank/g) || []).length <= 3,
      String((fh.match(/focus-rank/g) || []).length));
    /* 双向：与需求对齐的文案必须出现；被替换掉的旧备份文案必须不出现 */
    t('备份提醒旧文案「数据已积累」已消失', W.S.rows && fh.indexOf('数据已积累') < 0);
    /* 未完成项不该出现在焦点卡（焦点卡只列 over+today 里未完成、非待决策的） */
    t('焦点卡不包含已完成项', fh.indexOf('完成项甲') < 0 && fh.indexOf('完成项乙') < 0);
  }

  /* ---- 备份提醒（v21：7 天节流 + 文案换新）----
     夹具 S.rows.length < 30，正常走不到提示分支；这里直接调 renderAlerts 验「不出假提示」。 */
  W.renderAlerts();
  const ah = doc.getElementById('alertHost').innerHTML;
  t('备份条旧按钮「知道了」已彻底消失', ah.indexOf('知道了') < 0 && W.S.rows.length < 30);
  t('数据量不足 30 条时不弹备份提醒（不误报）', ah.indexOf('建议备份') < 0,
    'rows=' + W.S.rows.length);

  /* ---- 跨模块 Tab 驱动：脑区 -> 宿主 ---- */
  B.goTab('flow');
  t('脑区 goTab(flow)：宿主 S.tab 同步', W.S.tab === 'flow', W.S.tab);
  t('脑区 goTab(flow)：pane-flow 可见', !/\bhide\b/.test(pg('pane-flow')));
  t('脑区 goTab(flow)：标题已更新', doc.getElementById('pageTitle').textContent === '规则与同步',
    doc.getElementById('pageTitle').textContent);

  /* ---- 7 个 Tab 全量轮切不抛异常 ---- */
  let err = null;
  ['today', 'projects', 'notes', 'review', 'lib', 'pool', 'flow'].forEach(function (k) {
    try { W.switchTab(k); } catch (e) { err = k + ': ' + e.message; }
  });
  t('7 个 Tab 全量轮切无异常', !err, err || '');
  t('轮切结束后停在 flow', W.S.tab === 'flow' && B.S.tab === 'flow', W.S.tab + '/' + B.S.tab);

  /* ---- 玫瑰装饰层（add_rose_deco.py）：只装饰、不参与业务，坏了也不能崩 ---- */
  const R = sb.window.__ROSE__;
  t('玫瑰装饰已挂载', !!R);
  if (R) {
    const roseHtml = doc.getElementById('dxSideRose').innerHTML;
    t('侧栏玫瑰已生成（含 26 片花瓣路径）',
      (roseHtml.match(/<path/g) || []).length === 26, (roseHtml.match(/<path/g) || []).length + ' path');
    const petalHtml = doc.getElementById('dxPetals').innerHTML;
    t('花瓣层已生成 7 片', (petalHtml.match(/class="dx-petal"/g) || []).length === 7,
      (petalHtml.match(/class="dx-petal"/g) || []).length + ' 片');
    t('花瓣带随机变量 --sw/--o', /--sw:-?\d+px;--o:0\.\d+/.test(petalHtml));
    t('默认开启：data-fx=on', doc.documentElement.getAttribute('data-fx') === 'on',
      String(doc.documentElement.getAttribute('data-fx')));
    t('默认文案为「玫瑰动效 · 开」', doc.getElementById('dxTgTxt').textContent === '玫瑰动效 · 开',
      doc.getElementById('dxTgTxt').textContent);
    R.setFx(false);
    t('关闭后 data-fx=off', doc.documentElement.getAttribute('data-fx') === 'off');
    t('关闭后文案为「玫瑰动效 · 关」', doc.getElementById('dxTgTxt').textContent === '玫瑰动效 · 关',
      doc.getElementById('dxTgTxt').textContent);
    R.setFx(true);
    t('重开后回到 data-fx=on', doc.documentElement.getAttribute('data-fx') === 'on');
    t('isOn() 与 data-fx 状态一致', R.isOn() === true);
  }

  /* ---- 玫瑰开场层（add_splash.py）：每日一句 + 进入工作台。
         注意：JS 侧算法必须与 Python 侧（add_splash.dist）逐位一致，
         否则「同一天同一句」在两端会各说各话。下面用预置对照值锁死。 ---- */
  const SP = sb.window.__SPLASH__;
  t('玫瑰开场层已挂载', !!SP);
  if (SP) {
    t('名言库条数一致（≥30）', SP.count === SP.quotes.length && SP.count >= 30, SP.count + ' 条');
    t('名言字段齐全', SP.quotes.every(q => q.t && q.a && q.w && q.k));
    t('名言正文无重复', new Set(SP.quotes.map(q => q.t)).size === SP.count);

    /* 跨语言一致性：与 Python 实现对齐 */
    t('dayNum 与 Python 对齐', SP.dayNum(1970, 1, 1) === 0 && SP.dayNum(2026, 9, 18) === 20714,
      SP.dayNum(2026, 9, 18));
    t('hash32 与 Python 对齐', SP.hash32(20700) === 1231900924, SP.hash32(20700));
    t('每日选句与 Python 对齐（2026-09-18 -> 25）', SP.pick(2026, 9, 18) === 25, SP.pick(2026, 9, 18));
    t('每日选句与 Python 对齐（2026-09-19 -> 52）', SP.pick(2026, 9, 19) === 52, SP.pick(2026, 9, 19));

    /* 确定性：同一天永远同一句 */
    t('同一天两次取值相同（确定性）', SP.pick(2026, 9, 18) === SP.pick(2026, 9, 18));
    const yearPicks = [];
    for (let k = 0; k < 400; k++) {
      const dt = new Date(Date.UTC(2026, 0, 1 + k));
      yearPicks.push(SP.pick(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()));
    }
    t('选句始终落在合法区间', yearPicks.every(i => i >= 0 && i < SP.count));
    t('相邻两天不撞句', yearPicks.every((v, i) => i === 0 || v !== yearPicks[i - 1]));
    t('400 天覆盖到多数句子', new Set(yearPicks).size > SP.count * 0.6, new Set(yearPicks).size + '/' + SP.count);

    /* 内容已渲染 */
    t('名言正文已渲染', doc.getElementById('dxSpText').textContent.length >= 8,
      doc.getElementById('dxSpText').textContent.slice(0, 14) + '…');
    t('出处已渲染（作者 · 书名）', /·/.test(doc.getElementById('dxSpBy').textContent),
      doc.getElementById('dxSpBy').textContent);
    t('类别标签已渲染', doc.getElementById('dxSpTag').textContent.length >= 2,
      doc.getElementById('dxSpTag').textContent);
    t('问候含称呼', /，茉莉$/.test(doc.getElementById('dxSpGreet').textContent),
      doc.getElementById('dxSpGreet').textContent);
    t('日期行含月/日/星期', /月\d+日 星期/.test(doc.getElementById('dxSpDate').textContent),
      doc.getElementById('dxSpDate').textContent);
    t('当前句与当日算法一致（非硬编码）', (() => {
      const n0 = new Date();
      return SP.current() === SP.pick(n0.getFullYear(), n0.getMonth() + 1, n0.getDate());
    })(), SP.current() + '');

    /* 默认自动开场 + 入口交互 */
    t('默认自动开场（未点「今日不再显示」）', SP.shouldAuto() === true);
    t('开场后 isOpen=true', SP.isOpen() === true);
    t('开场层已加 .in 与 .on', doc.getElementById('dxSplash').classList.contains('in') &&
      doc.getElementById('dxSplash').classList.contains('on'));
    t('开场时锁定背景滚动', doc.body.classList.contains('dx-splash-lock'));
    t('开场时工作台设为 aria-hidden', doc.querySelector('.app').getAttribute('aria-hidden') === 'true');
    t('开场花瓣已生成（桌面 9 片）',
      (doc.getElementById('dxSplashPetals').innerHTML.match(/class="dx-sp-petal"/g) || []).length === 9,
      (doc.getElementById('dxSplashPetals').innerHTML.match(/class="dx-sp-petal"/g) || []).length + ' 片');

    /* 再换一句 */
    const beforeIdx = SP.current();
    const afterIdx = SP.next();
    t('「再换一句」换到了别的句子', afterIdx !== beforeIdx, beforeIdx + ' -> ' + afterIdx);
    t('换句后正文同步更新', doc.getElementById('dxSpText').textContent === SP.quotes[afterIdx].t);
    t('换句后记录到本机（当天记住）', (store['molly.splash.q'] || '').indexOf(SP.key + ':') === 0,
      String(store['molly.splash.q']));

    /* 进入工作台 */
    t('点「进入工作台」后 isOpen=false', SP.enter() === true && SP.isOpen() === false);
    t('退场后加 .out', doc.getElementById('dxSplash').classList.contains('out'));
    t('退场后解除滚动锁定', !doc.body.classList.contains('dx-splash-lock'));
    t('退场后恢复工作台 aria-hidden=false', doc.querySelector('.app').getAttribute('aria-hidden') === 'false');

    /* 侧栏入口可重新唤出 */
    t('侧栏入口可重新唤出', SP.open() === true && SP.isOpen() === true);
    t('重新唤出后回到 .in 状态', doc.getElementById('dxSplash').classList.contains('in') &&
      !doc.getElementById('dxSplash').classList.contains('out'));
    SP.enter();

    /* 「今日不再自动显示」 */
    t('先置为今日不再显示', SP.skipToday() === SP.key && SP.shouldAuto() === false);
    t('已写入本机跳过记录', store['molly.splash.skip'] === SP.key, String(store['molly.splash.skip']));

    /* 兜底：Math.imul 缺失时的 16 位拆分乘法必须给出完全相同的结果 */
    const src = scripts[0].slice(scripts[0].indexOf('/* ROSE_SPLASH_JS BEGIN */'),
      scripts[0].indexOf('/* ROSE_SPLASH_JS END */'));
    const M2 = {};
    Object.getOwnPropertyNames(Math).forEach(k => { if (k !== 'imul') M2[k] = Math[k]; });
    const sb2 = Object.assign({}, sb, { Math: M2 });
    sb2.window = sb2;
    t('兜底环境确实没有 Math.imul', typeof M2.imul === 'undefined');
    let noImulOK = false, noImulErr = '';
    try {
      vm.createContext(sb2);
      vm.runInContext(src, sb2, { filename: 'splash-no-imul.js' });
      const SP2 = sb2.__SPLASH__;
      noImulOK = !!SP2 && SP2.hash32(20700) === SP.hash32(20700) &&
        SP2.pick(2026, 9, 18) === SP.pick(2026, 9, 18) &&
        SP2.pick(2026, 9, 19) === SP.pick(2026, 9, 19) &&
        SP2.pick(2026, 1, 1) === 55;
    } catch (e) { noImulErr = e.message; }
    t('无 Math.imul 时选句结果不变（兜底乘法正确）', noImulOK, noImulErr);
  }

  /* ---- 开场层不得干扰业务：数据与 Tab 状态仍然正确 ---- */
  t('开场层未影响业务数据', W.S.rows.length === TABLES[MAIN_DB].length && B.S.pool.length === 8);

  /* ---- 装饰层不得干扰业务：轮切后 7 个 Tab 状态仍正确 ---- */
  t('装饰层未影响 Tab 状态', W.S.tab === 'flow' && B.S.tab === 'flow');

  /* ---- 整场领取：仓库 -> 主台账（现在必须先经「批量领取」弹窗确认落点日期） ---- */
  const before = CALLS.add.filter(c => c.databaseId === MAIN_DB).length;
  W.switchTab('pool');
  B.claimBySource(SRC_BATCH);

  /* ① 批量领取不再直接写库：先弹窗让用户确认落点 */
  t('整场领取先打开批量弹窗（打开时不写库）',
    CALLS.add.filter(c => c.databaseId === MAIN_DB).length === before,
    '新增 ' + (CALLS.add.filter(c => c.databaseId === MAIN_DB).length - before));
  t('批量模式下弹窗标题切换为批量',
    doc.getElementById('c-head').textContent.indexOf('批量') >= 0,
    doc.getElementById('c-head').textContent);
  t('批量弹窗写明本次条数',
    doc.getElementById('c-batchBar').innerHTML.indexOf('3') >= 0,
    doc.getElementById('c-batchBar').innerHTML.slice(0, 90));
  t('批量模式隐藏逐条改写字段（不做逐条编辑，避免弹 N 次）',
    doc.getElementById('c-titleWrap').style.display === 'none'
      && doc.getElementById('c-writebackWrap').style.display === 'none'
      && doc.getElementById('c-grid2').style.display === 'none');
  t('批量模式保留落点日期供确认',
    doc.getElementById('c-planWrap').style.display !== 'none'
      && doc.getElementById('c-planWrap').style.gridColumn === '1 / -1');

  /* ② 用户把落点改成 9/25，并能看到「将落在哪一天」 */
  doc.getElementById('c-plan').value = '2026-09-25';
  B.renderDropHint();
  t('落点预览写明将落在 9月25日',
    doc.getElementById('c-drop').textContent.indexOf('9月25日') >= 0,
    doc.getElementById('c-drop').textContent);
  t('落点预览说明日历会同步',
    doc.getElementById('c-drop').textContent.indexOf('日历') >= 0);

  B.doClaimBatch();
  setTimeout(function () {
    const added = CALLS.add.filter(c => c.databaseId === MAIN_DB).length - before;
    t('整场领取写入 3 条主台账', added === 3, '实际 ' + added);
    t('整场领取按用户确认的日期落库（9/25）',
      CALLS.add.filter(c => c.databaseId === MAIN_DB).slice(-3)
        .every(c => c.properties['计划日期'].date === '2026-09-25'),
      CALLS.add.filter(c => c.databaseId === MAIN_DB).slice(-3)
        .map(c => c.properties['计划日期'].date).join(','));
    const titles = CALLS.add.filter(c => c.databaseId === MAIN_DB).slice(-3).map(c => c.properties['标题'].text);
    t('整场领取保留各自标题', titles.length === 3 && titles.every(x => !!x), titles.join(' | '));
    const prios = CALLS.add.filter(c => c.databaseId === MAIN_DB).slice(-3).map(c =>
      (SCHEMAS[MAIN_DB].properties.find(p => p.name === '优先级').config.options.find(o => o.id === c.properties['优先级'].select) || {}).text);
    t('整场领取保留各自优先级（含 P0）', prios.indexOf('P0 紧急') >= 0, prios.join(','));
    const upd = CALLS.update.filter(c => c.databaseId === POOL_DB && c.recordId === 'p7');
    t('整场领取回写仓库为已领取', upd.length > 0, upd.length + ' 次');
    t('整场领取：主台账带来源录音', CALLS.add.filter(c => c.databaseId === MAIN_DB).slice(-3)
      .every(c => c.properties['来源录音'].text === SRC_BATCH));
    /* ---- 空台账：绝不编造数据，只给可执行的下一步 ---- */
    const realRows = W.S.rows.slice();
    W.S.rows = []; W.S.empty = true; W.S.loadFailed = false;
    W.refreshAll(); W.renderAlerts();
    t('空台账时视图返回 0 条（已无演示数据兜底）', W.view().length === 0, W.view().length);
    t('空台账时 KPI 全为 0（不显示假数字）',
      ['kpiOver', 'kpiToday', 'kpiDecide', 'kpiDone']
        .every(id => doc.getElementById(id).textContent === '0'),
      ['kpiOver', 'kpiToday', 'kpiDecide', 'kpiDone'].map(id => doc.getElementById(id).textContent).join('/'));
    const barEmpty = doc.getElementById('alertHost').innerHTML;
    t('空台账时给出空态引导条', barEmpty.indexOf('主台账还是空的') >= 0);
    t('空态条同时提供「去待办仓库领取」与「新建一条」',
      barEmpty.indexOf('data-alert="goPool"') >= 0 && barEmpty.indexOf('data-alert="newFirst"') >= 0);
    t('空态条不再出现「演示」字样', barEmpty.indexOf('演示') === -1);
    t('空台账时领取入口卡仍在（仍能去仓库）', !!doc.getElementById('poolEntryGo'));

    /* 读取失败 ≠ 空台账：故障不能伪装成「你还没有数据」 */
    W.S.rows = []; W.S.empty = false; W.S.loadFailed = true;
    W.renderAlerts();
    const barFail = doc.getElementById('alertHost').innerHTML;
    t('读取失败时提示「读取资料库失败」', barFail.indexOf('读取资料库失败') >= 0);
    t('读取失败时不误报成空台账', barFail.indexOf('主台账还是空的') === -1);

    /* 恢复真实数据 */
    W.S.rows = realRows; W.S.empty = false; W.S.loadFailed = false;
    W.refreshAll(); W.renderAlerts();
    t('恢复数据后空态条消失',
      doc.getElementById('alertHost').innerHTML.indexOf('主台账还是空的') === -1);
    t('恢复数据后视图条数回到真实值', W.view().length === realRows.length, W.view().length);

    /* ================= 自研日历面板（替代被 iframe / overflow 裁切的原生弹层） ================= */
    const CAL = W.Cal;
    t('宿主暴露 Cal 组件', !!CAL && typeof CAL.open === 'function' && typeof CAL.state === 'function');

    if (CAL) {
      /* —— 手输解析：宽容但不放过非法值 —— */
      const P = CAL.parse;
      t('日历·解析 2026-09-01', CAL.fkey(P('2026-09-01')) === '2026-09-01');
      t('日历·解析 2026-9-1（自动补零）', CAL.fkey(P('2026-9-1')) === '2026-09-01');
      t('日历·解析 2026/9/1', CAL.fkey(P('2026/9/1')) === '2026-09-01');
      t('日历·解析 2026.9.1', CAL.fkey(P('2026.9.1')) === '2026-09-01');
      t('日历·解析 2026年9月1日', CAL.fkey(P('2026年9月1日')) === '2026-09-01');
      t('日历·解析 20260901', CAL.fkey(P('20260901')) === '2026-09-01');
      t('日历·解析闰年 2024-02-29', CAL.fkey(P('2024-02-29')) === '2024-02-29');
      t('日历·拒绝越界月份 2026-13-01', P('2026-13-01') === null);
      t('日历·拒绝不存在的日期 2026-02-30', P('2026-02-30') === null);
      t('日历·拒绝空值与乱码', P('') === null && P('明天') === null && P(undefined) === null);

      /* —— 受控日期框（真实 HTML 里这 4 个 input 都带 data-cal，由 verify 静态门负责核对） —— */
      CAL.setToday('2026-09-19');
      const inp = doc.getElementById('e-plan');
      inp.setAttribute('data-cal', '1');
      inp.value = '';
      let changes = 0;
      inp.addEventListener('change', () => { changes++; });
      const nd = (attr, val) => ({ getAttribute: k => (k === attr ? val : null), parentNode: CAL.el() });
      const rowsBefore = W.S.rows.length;

      /* —— 点日期框打开（走 document 级委托，等价于真点，而不是直接调 API） —— */
      t('日历·document 级 click 委托已注册', fire(doc, 'click', { target: inp, preventDefault() {} }) > 0);
      t('日历·点日期框后面板打开', CAL.isOpen());
      const st0 = CAL.state();
      t('日历·默认视图落在当月', st0.view === '2026-09', st0.view);
      t('日历·恒定渲染 42 格（6 行 × 7 列，任何月份都不缺格）', st0.cells === 42, st0.cells);

      const HY = CAL.el().innerHTML;
      const cw = HY.slice(HY.indexOf('class="cw"'), HY.indexOf('class="cg"'));
      t('日历·周一起始的星期表头齐全（周一到周日 7 列）',
        (cw.match(/<span/g) || []).length === 7
        && cw.indexOf('>一<') >= 0 && cw.indexOf('>六<') >= 0 && cw.indexOf('>日<') >= 0);
      t('日历·有年月入口 / 今天 / 清空 / 关闭',
        ['ty', 'tm', 'today', 'clear', 'close'].every(a => HY.indexOf('data-a="' + a + '"') >= 0));
      const inMonth = (HY.match(/data-d="2026-09-\d\d"/g) || []).length;
      t('日历·当月日期一个不缺（2026-09 共 30 天）', inMonth === 30, inMonth);
      const outCells = HY.split('class="cd out').length - 1;
      t('日历·用相邻月灰显补满网格（42 - 30 = 12）', outCells === 12, outCells);

      /* —— 选一天：写回 + 派发 change —— */
      fire(CAL.el(), 'click', { target: nd('data-d', '2026-09-25') });
          t('日历·点日期写回 YYYY-MM-DD', inp.value === '2026-09-25', inp.value);
          t('日历·写回时派发 change（既有保存逻辑照常响应）', changes >= 1, changes);
          /* v19 起语义变了：点日期只落值、**不关**面板 —— 否则「选完日期还想接着选时间」
             根本没有机会。关闭改由「点面板外／关闭按钮」承担；这类「落值即走」的完整
             验收在下面的 timeSuite 里。 */
          t('日历·点日期后仍开着（留出接着选时间点的机会）', CAL.isOpen());

      /* —— 翻月 / 跨年 —— */
      CAL.open(inp);
      fire(CAL.el(), 'click', { target: nd('data-a', 'pm') });
      t('日历·上一月', CAL.state().view === '2026-08', CAL.state().view);
      for (let i = 0; i < 12; i++) fire(CAL.el(), 'click', { target: nd('data-a', 'pm') });
      t('日历·连点上月可跨年（2026-08 → 2025-08）', CAL.state().view === '2025-08', CAL.state().view);

      /* —— 年月选择层：能跳到任意年月，而不是只能在本月里打转 —— */
      fire(CAL.el(), 'click', { target: nd('data-a', 'ty') });
      t('日历·点年月标题进入年月选择层', CAL.state().mode === 'm', CAL.state().mode);
      t('日历·年月层含 12 个月份', (CAL.el().innerHTML.match(/data-m="/g) || []).length === 12);
      fire(CAL.el(), 'click', { target: nd('data-m', '4') });
      t('日历·选月后回到月历且视图已切换', CAL.state().mode === 'd' && CAL.state().view === '2025-05',
        CAL.state().mode + '/' + CAL.state().view);
      fire(CAL.el(), 'click', { target: nd('data-a', 'ty') });
      fire(CAL.el(), 'click', { target: nd('data-y', '2030') });
      t('日历·选年后接月选择层（2030-05）', CAL.state().mode === 'm' && CAL.state().view === '2030-05',
        CAL.state().view);
      fire(CAL.el(), 'click', { target: nd('data-a', 'back') });
      t('日历·可从年月层返回月历', CAL.state().mode === 'd');

      /* —— 今天 / 清空 —— */
      fire(CAL.el(), 'click', { target: nd('data-a', 'tm') });
      t('日历·「今」回到今天所在月并高亮今天',
        CAL.state().view === '2026-09' && CAL.state().sel === '2026-09-19',
        CAL.state().view + ' / ' + CAL.state().sel);
      t('日历·今天带 today 高亮类', /class="cd[^"]*\btoday\b/.test(CAL.el().innerHTML));
      fire(CAL.el(), 'click', { target: nd('data-a', 'clear') });
      t('日历·清空后值为空串', inp.value === '', JSON.stringify(inp.value));

      /* —— 键盘 —— */
      inp.value = '2026-09-19';
      CAL.open(inp);
      fire(doc, 'keydown', { target: inp, key: 'ArrowRight', preventDefault() {} });
      t('日历·方向键右移一天', CAL.state().sel === '2026-09-20', CAL.state().sel);
      fire(doc, 'keydown', { target: inp, key: 'ArrowDown', preventDefault() {} });
      t('日历·方向键下移一周', CAL.state().sel === '2026-09-27', CAL.state().sel);
      fire(doc, 'keydown', { target: inp, key: 'PageDown', preventDefault() {} });
      t('日历·PageDown 换月且保留高亮日',
        CAL.state().view === '2026-10' && CAL.state().sel === '2026-09-27',
        CAL.state().view + ' / ' + CAL.state().sel);
      fire(doc, 'keydown', { target: inp, key: 'Enter', preventDefault() {} });
      t('日历·Enter 提交高亮日并关闭', inp.value === '2026-09-27' && !CAL.isOpen(), inp.value);

      /* —— 点外部关闭 + 手输收口 —— */
      CAL.open(inp);
      fire(doc, 'mousedown', { target: doc.getElementById('somewhereElse') });
      t('日历·点面板外部关闭', !CAL.isOpen());
      inp.value = '2026/9/5';
      CAL.open(inp); CAL.close();
      t('日历·手输 2026/9/5 归一化为 2026-09-05', inp.value === '2026-09-05', inp.value);
      inp.value = '瞎写的';
      CAL.open(inp); CAL.close();
      t('日历·手输非法值被清空（绝不把坏值交给保存逻辑）', inp.value === '', JSON.stringify(inp.value));

      /* —— 定位与翻转：这正是原生弹层「不齐全」的根因所在 —— */
      const rectTop = 320, rectBottom = 362;   /* 桩规定 */
      sb.innerHeight = 1440;
      CAL.open(inp);
      t('日历·空间充足时向下展开', parseInt(CAL.el().style.top, 10) === rectBottom + 6, CAL.el().style.top);
      sb.innerHeight = 424;                    /* 视口很矮，下方放不下 */
      CAL.open(inp);
      const upTop = parseInt(CAL.el().style.top, 10);
      t('日历·下方放不下时向上翻转（不再被裁掉下半截）',
        upTop < rectTop && upTop >= 8, 'top=' + CAL.el().style.top);
      sb.innerWidth = 200;                     /* 视口比面板还窄 */
      CAL.open(inp);
      t('日历·视口过窄时左边界夹紧到 8px', parseInt(CAL.el().style.left, 10) === 8, CAL.el().style.left);
      sb.innerWidth = 1440; sb.innerHeight = 1440;
      CAL.open(inp);
      t('日历·恢复视口后位置正常', parseInt(CAL.el().style.top, 10) === rectBottom + 6
        && parseInt(CAL.el().style.left, 10) === 120, CAL.el().style.top + ',' + CAL.el().style.left);
      CAL.close();

      /* —— 面板不得污染业务 —— */
      t('日历·打开关闭未改动台账数据', W.S.rows.length === rowsBefore, W.S.rows.length + ' vs ' + rowsBefore);
    }

    /* ================= 月历·排期视图（7 天条看完整月 → 内嵌整月 + 按周翻动） =================
       用户反馈两件事：①「日期没有办法看完」②「跟日历一样，我点开可以选择我想要的日期，
       提前先把规划写在里面」。下面按这两条逐项验收，全部走真事件（点按钮、点格子）。 */
    const PC = W.PlanCal;
    const mcRowsBefore = W.S.rows.length;
    t('宿主暴露 PlanCal 组件', !!PC && typeof PC.render === 'function' && typeof PC.state === 'function');

    if (PC) {
      /* —— 回归「NaN/NaN 起」：两处 weekLabel 同作用域重名，日期版被周偏移版覆盖 —— */
      t('周几标签正确（不再是 NaN/NaN 起）', PC.wdLabel('2026-09-19') === '周六', PC.wdLabel('2026-09-19'));
      let nanHit = 0;
      for (let i = 0; i < 400; i++) {
        const k = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
        if (/NaN/.test(PC.wdLabel(k))) nanHit++;
      }
      t('400 天周几标签均无 NaN', nanHit === 0, nanHit + ' 处');

      PC.setToday('2026-09-19');          /* 锁死基准日，断言不随运行日期漂移 */
      PC.setSelDate('2026-09-19');

      /* —— 7 天快捷条：内容正确 + 不再出现 NaN —— */
      const strip = doc.getElementById('dateStrip').innerHTML;
      t('7 天快捷条仍是 7 格', (strip.match(/data-day="/g) || []).length === 7);
      t('日期条不再出现 NaN', strip.indexOf('NaN') === -1);
      /* 标签与位置解耦：选中日就是今天时只出现「今天」，选了别的日子才另起「选中」 */
      t('选中日＝今天时，该格只标「今天」',
        strip.indexOf('>今天<') >= 0 && strip.indexOf('>选中<') === -1);
      t('日期条带当天排期条数（9/18 有 1 项）', /data-day="2026-09-18"[\s\S]{0,220}?1 项/.test(strip));
      PC.setSelDate('2026-09-20');
      const strip2 = doc.getElementById('dateStrip').innerHTML;
      t('选了别的日子后，「今天」与「选中」各标一格',
        strip2.indexOf('>今天<') >= 0 && strip2.indexOf('>选中<') >= 0);
      t('「选中」标在 9/20 那一格', /data-day="2026-09-20"[\s\S]{0,120}?>选中</.test(strip2));
      PC.setSelDate('2026-09-19');
      t('输入框提示落在今天（写规划前先看见落点）',
        /落在今天/.test(doc.getElementById('quickInput').placeholder),
        doc.getElementById('quickInput').placeholder);

      /* —— 两侧箭头按周翻动：这是「日期没有办法看完」的直接解法 —— */
      fire(doc.getElementById('stripPrev'), 'click', {});
      t('往前一周：选中日 -7 天', W.S.selDate === '2026-09-12', W.S.selDate);
      t('翻周后月历视图同步', PC.state().view === '2026-09', PC.state().view);
      fire(doc.getElementById('stripNext'), 'click', {});
      fire(doc.getElementById('stripNext'), 'click', {});
      t('往后两周：落到同一星期几的 9/26', W.S.selDate === '2026-09-26', W.S.selDate);
      t('翻到未来后输入框提示对应日期',
        doc.getElementById('quickInput').placeholder.indexOf('9月26日') >= 0,
        doc.getElementById('quickInput').placeholder);
      fire(doc.getElementById('stripPrev'), 'click', {});
      t('再往前一周回到 9/19', W.S.selDate === '2026-09-19', W.S.selDate);

      /* —— 月历本体：整月不缺格 —— */
      const st0 = PC.state();
      t('月历默认展开（用户就是为了看完整月）', st0.open === true);
      t('月历恒定 42 格（6 行 × 7 列，任何月份都不缺格）', st0.cells === 42, st0.cells);
      t('月历标题与视图一致', st0.title === '2026 年 9 月', st0.title);
      t('月历视图落在选中日所在月', st0.view === '2026-09', st0.view);
      const mHtml = PC.el().innerHTML;
      t('月历有上/下月、上/下年、今、收起入口',
        ['pm', 'nm', 'py', 'ny', 'today', 'collapse'].every(a => mHtml.indexOf('data-mc-act="' + a + '"') >= 0));
      t('星期表头 周一→周日 7 列',
        (mHtml.slice(mHtml.indexOf('mcal-wk'), mHtml.indexOf('mcal-grid')).match(/<span/g) || []).length === 7);
      const inM = (mHtml.match(/data-mc="2026-09-\d\d"/g) || []).length;
      t('当月 30 天一个不缺', inM === 30, inM);
      t('今天带 today 高亮', /class="mc-cell[^"]*\btoday\b/.test(mHtml));
      t('选中日带 sel 高亮', /class="mc-cell[^"]*\bsel\b/.test(mHtml));
      t('逾期日显示红色条数徽标（9/18 有 1 项已逾期）', /class="mc-badge over">1</.test(mHtml));

      /* —— 点格子选日期：「点开可以选择我想要的日期」 —— */
      const mcNode = (attr, val, parent) => ({ getAttribute: k => (k === attr ? val : null), parentNode: parent || PC.el() });
      fire(PC.el(), 'click', { target: mcNode('data-mc', '2026-09-25') });
      t('点月历格子即选中该日', W.S.selDate === '2026-09-25', W.S.selDate);
      t('选中未来日期后输入框改为「给 9月25日 记一条」',
        doc.getElementById('quickInput').placeholder.indexOf('9月25日') >= 0,
        doc.getElementById('quickInput').placeholder);
      t('页头副标题与选中日一致且无 NaN',
        doc.getElementById('pageSub').textContent.indexOf('9月25日 周五') >= 0
        && doc.getElementById('pageSub').textContent.indexOf('NaN') === -1,
        doc.getElementById('pageSub').textContent);
      t('7 天条以选中日重新居中（9/22 ~ 9/28）',
        doc.getElementById('dateStrip').innerHTML.indexOf('data-day="2026-09-22"') >= 0
        && doc.getElementById('dateStrip').innerHTML.indexOf('data-day="2026-09-28"') >= 0);
      t('被选中的格子带 sel 高亮',
        /class="mc-cell[^"]*\bsel\b[^"]*" data-mc="2026-09-25"/.test(PC.el().innerHTML));
      t('空日子给出「还没有安排」的提前排期引导',
        PC.el().innerHTML.indexOf('这一天还没有安排') >= 0);

      fire(PC.el(), 'click', { target: mcNode('data-mc', '2026-09-18') });
      t('点有排期的日子，下面列出当天事项标题',
        PC.el().innerHTML.indexOf('汇总本周高管会待决事项') >= 0);
      t('点有排期的日子，标出排期与逾期条数',
        PC.el().innerHTML.indexOf('排期 1 项') >= 0 && PC.el().innerHTML.indexOf('逾期 1 项') >= 0);

      /* —— 年月导航：任意年月都到得了 —— */
      fire(PC.el(), 'click', { target: mcNode('data-mc-act', 'nm') });
      t('下一月', PC.state().view === '2026-10', PC.state().view);
      fire(PC.el(), 'click', { target: mcNode('data-mc-act', 'pm') });
      fire(PC.el(), 'click', { target: mcNode('data-mc-act', 'pm') });
      t('上一月', PC.state().view === '2026-08', PC.state().view);
      for (let i = 0; i < 8; i++) fire(PC.el(), 'click', { target: mcNode('data-mc-act', 'pm') });
      t('连点上月可跨年（2026-08 → 2025-12）', PC.state().view === '2025-12', PC.state().view);
      fire(PC.el(), 'click', { target: mcNode('data-mc-act', 'py') });
      t('上一年按钮跨到 2024-12', PC.state().view === '2024-12', PC.state().view);
      fire(PC.el(), 'click', { target: mcNode('data-mc-act', 'ny') });
      fire(PC.el(), 'click', { target: mcNode('data-mc-act', 'ny') });
      t('下一年按钮回到 2026-12', PC.state().view === '2026-12', PC.state().view);
      fire(PC.el(), 'click', { target: mcNode('data-mc-act', 'today') });
      t('「今」回到今天所在月', PC.state().view === '2026-09', PC.state().view);
      t('「今」同时把选中日拉回今天（不会选中今天却停在 12 月）', W.S.selDate === '2026-09-19', W.S.selDate);

      /* —— 「给这天记一条」：把规划直接落在选中日 —— */
      PC.setSelDate('2026-09-25');
      fire(PC.el(), 'click', { target: mcNode('data-mc-act', 'add') });
      t('点「给这天记一条」提示落在选中日',
        doc.getElementById('toast').textContent.indexOf('9月25日') >= 0,
        doc.getElementById('toast').textContent);

      /* —— 折叠状态要记住 —— */
      fire(PC.el(), 'click', { target: mcNode('data-mc-act', 'collapse') });
      t('收起后月历隐藏', PC.state().open === false && /\bhide\b/.test(PC.el().className));
      t('收起后按钮文案变回「月历」', doc.getElementById('btnCal').textContent === '月历',
        doc.getElementById('btnCal').textContent);
      t('折叠状态写入 localStorage', sb.localStorage.getItem('molly.plancal') === '0',
        String(sb.localStorage.getItem('molly.plancal')));
      t('readOpen() 反映已保存的折叠状态', PC.readOpen() === false);
      t('收起后不再渲染格子（不留空壳卡片）', PC.state().cells === 0, PC.state().cells);
      fire(doc.getElementById('btnCal'), 'click', {});
      t('点「月历」按钮重新展开', PC.state().open === true);
      t('展开状态写入 localStorage', sb.localStorage.getItem('molly.plancal') === '1');
      t('展开后 42 格重新渲染', PC.state().cells === 42, PC.state().cells);

      /* —— 口径与安全 —— */
      t('排期数与看板同口径（9/18 未完成 1 项）', PC.dayLoad('2026-09-18').open === 1,
        PC.dayLoad('2026-09-18').open);
      t('已逾期的那天被标为逾期（9/15）', PC.dayLoad('2026-09-15').over === 1);
      t('空日子负载为 0', PC.dayLoad('2026-12-24').open === 0);
      t('月历的全部交互都没改动台账数据',
        W.S.rows.length === mcRowsBefore, W.S.rows.length + ' vs ' + mcRowsBefore);
    }

    /* ---- 未连接资料库时：不许把「读不到」装成「没有」 ---- */
    /* 用户真实截图：打开本地 HTML（没有平台数据桥）时页面显示「0 条 + 这个条件下没有待办」，
       他会以为数据丢了。所以未连接态必须逐条断言「诚实的读不到」。 */
    const kbOf = id => doc.getElementById(id).innerHTML;
    t('基线：连上时待办仓库 KPI 是数字', /\d/.test(kbOf('poolKpis')), kbOf('poolKpis').slice(0, 50));

    /* 未连接的真实样子 = 平台桥没给数据 + 表里读不回来，所以行数据也要一并清空 */
    const snap = { lib: B.S.libRows, pool: B.S.pool, main: B.S.main };
    B.S.dbReady = false;
    B.S.libRows = []; B.S.pool = []; B.S.main = [];
    B.renderAll();
    t('未连接：待办仓库 KPI 显示「—」而不是 0',
      kbOf('poolKpis').indexOf('—') >= 0 && kbOf('poolKpis').indexOf('>0<') < 0,
      kbOf('poolKpis').slice(0, 90));
    t('未连接：录音库 KPI 显示「—」而不是 0',
      kbOf('libKpis').indexOf('—') >= 0 && kbOf('libKpis').indexOf('>0<') < 0);
    t('未连接：待办仓库空态明说「读不到」', kbOf('poolList').indexOf('读不到') >= 0,
      kbOf('poolList').slice(0, 90));
    t('未连接：待办仓库不再说「这个条件下没有待办」', kbOf('poolList').indexOf('没有待办') < 0,
      kbOf('poolList').slice(0, 90));
    t('未连接：录音库不再说「当前筛选下没有录音」', kbOf('libList').indexOf('当前筛选下没有录音') < 0,
      kbOf('libList').slice(0, 90));
    t('未连接：录音库空态明说「读不到」', kbOf('libList').indexOf('读不到') >= 0);
    t('未连接：空态给的是「换入口」指引', kbOf('poolList').indexOf('页面列表') >= 0);

    const alertHTML = doc.getElementById('brainAlertHost').innerHTML;
    t('未连接：告警不再说「暂时连不上资料库」', alertHTML.indexOf('暂时连不上') < 0, alertHTML.slice(0, 80));
    t('未连接：告警分两路（按有没有平台桥取词）',
      B.sdk() ? alertHTML.indexOf('同步失败') >= 0 : alertHTML.indexOf('未连接平台') >= 0,
      (B.sdk() ? '有桥' : '无桥') + ' / ' + alertHTML.slice(0, 60));
    t('未连接：规则页状态胶囊不再写「已连接资料库」',
      doc.getElementById('flowHost').innerHTML.indexOf('已连接资料库') < 0);

    B.S.dbReady = true;
    B.S.libRows = snap.lib; B.S.pool = snap.pool; B.S.main = snap.main;
    B.renderAll();
    t('恢复连接后 KPI 回到数字（不留脏状态）',
      /\d/.test(kbOf('poolKpis')) && kbOf('poolKpis').indexOf('—') < 0);
    t('恢复连接后状态胶囊回到「已连接资料库」',
      doc.getElementById('flowHost').innerHTML.indexOf('已连接资料库') >= 0);

    /* ---- 宿主区：读表失败时同样不许把故障显示成 0 ---- */
    W.S.loadFailed = true;
    W.refreshAll();
    t('宿主：读取失败时 KPI 显示「—」而不是 0',
      doc.getElementById('kpiToday').textContent === '—', 'textContent=' + doc.getElementById('kpiToday').textContent);
    W.S.loadFailed = false;
    W.refreshAll();
    t('宿主：恢复后 KPI 回到数字', doc.getElementById('kpiToday').textContent !== '—');

    /* ============ 需求①：领取时可校对（含把修正回写给仓库源头） ============ */
    const addBefore = CALLS.add.filter(c => c.databaseId === MAIN_DB).length;
    B.openClaim(B.findPool('p1'));
    t('单条领取弹窗进入校对模式（逐条字段可见）',
      doc.getElementById('c-titleWrap').style.display !== 'none'
        && doc.getElementById('c-writebackWrap').style.display !== 'none'
        && doc.getElementById('c-tagWrap').style.display !== 'none');
    t('单条领取带入原文摘录（作为录音凭证）',
      doc.getElementById('c-content').value.indexOf('尽快把劳动合同整理出来') >= 0,
      doc.getElementById('c-content').value.slice(0, 30));
        t('单条领取默认落点=今天', doc.getElementById('c-plan').value === W.todayKey(),
          doc.getElementById('c-plan').value + ' / 今天=' + W.todayKey());
    t('回写仓库默认勾选（用户诉求就是顺手把源头改对）',
      doc.getElementById('c-writeback').checked === true);

    /* 录音把标题提取错了 → 改写；落点改到「今天+2 天」（必须在本周视图内，且永远是未来日）。
       早期版本写死 2026-09-26，日子一过整组掉进「逾期」，断言随时间腐烂 —— 改为相对今天。 */
    const dFmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const dCN = d => (d.getMonth() + 1) + '月' + d.getDate() + '日';
    const claimDate = new Date(); claimDate.setDate(claimDate.getDate() + 2);
    const moveDate = new Date(); moveDate.setDate(moveDate.getDate() + 12);
    const CLAIM_D = dFmt(claimDate), CLAIM_CN = dCN(claimDate);
    const MOVE_D = dFmt(moveDate), MOVE_CN = dCN(moveDate);
    doc.getElementById('c-title').value = '整理精武陈真在职人员劳动合同（按人名逐条核对）';
    doc.getElementById('c-tag').value = '合同';
    doc.getElementById('c-plan').value = CLAIM_D;
    B.renderDropHint();
    t('落点预览跟着改成 ' + CLAIM_CN,
      doc.getElementById('c-drop').textContent.indexOf(CLAIM_CN) >= 0,
      doc.getElementById('c-drop').textContent);

    B.doClaim();
    setTimeout(function () {
      t('单条领取写入 1 条主台账',
        CALLS.add.filter(c => c.databaseId === MAIN_DB).length - addBefore === 1,
        '实际 ' + (CALLS.add.filter(c => c.databaseId === MAIN_DB).length - addBefore));
      const lastAdd = CALLS.add.filter(c => c.databaseId === MAIN_DB).slice(-1)[0];
      t('落库的是改写后的标题（不是录音原提取）',
        lastAdd.properties['标题'].text === '整理精武陈真在职人员劳动合同（按人名逐条核对）',
        lastAdd.properties['标题'].text);
      t('落库的落点日期是用户确认的 ' + CLAIM_D,
        lastAdd.properties['计划日期'].date === CLAIM_D, lastAdd.properties['计划日期'].date);
      t('落库带上了领取时补的标签', lastAdd.properties['标签'].text === '合同',
        lastAdd.properties['标签'].text);
      t('落库带着仓库来源（仓库ID）', lastAdd.properties['仓库ID'].text === 'p1');

      const wb = CALLS.update.filter(c => c.databaseId === POOL_DB && c.recordId === 'p1'
        && c.properties && c.properties['事项']).slice(-1)[0];
      t('勾选后：仓库「事项」同步修正为改写后的写法',
        !!wb && wb.properties['事项'].text === '整理精武陈真在职人员劳动合同（按人名逐条核对）',
        wb ? wb.properties['事项'].text : '没有回写');
      t('回写只动事项与优先级，绝不覆盖原文摘录',
        !!wb && !wb.properties['原文摘录'] && Object.keys(wb.properties).join(',') === '事项,优先级建议',
        wb ? Object.keys(wb.properties).join(',') : '');

      /* ============ 需求②：任务清单（跨日期总览 + 行内改期） ============ */
      const TL = W.TaskList;
      TL.setView('open');
      const tg = TL.groups();
      t('任务清单按落点日期分组（' + CLAIM_D + ' 组里正是刚领取那 1 条）',
        tg.days.some(d => d.key === CLAIM_D && d.list.length === 1),
        tg.days.map(d => d.key + ':' + d.list.length).join(' '));
      t('与看板同口径：逾期项一律进「逾期」组，不按日期重复出现',
        tg.days.every(d => d.key >= W.todayKey()) && tg.over.length >= 2,
        'over=' + tg.over.length + ' days=' + tg.days.map(d => d.key).join(','));
      t('任务清单渲染出分组标题', TL.el().innerHTML.indexOf('group-head') >= 0);
      t('任务清单渲染出「逾期未完成」组', TL.el().innerHTML.indexOf('逾期未完成') >= 0);
      const unfinished = tg.over.length + tg.days.reduce((n, d) => n + d.list.length, 0) + tg.noPlan.length;
      t('每条未完成任务都带行内改期控件',
        (TL.el().innerHTML.match(/data-rs=/g) || []).length === unfinished,
        (TL.el().innerHTML.match(/data-rs=/g) || []).length + ' vs ' + unfinished);

      /* 行内改期：把 CLAIM_D 那条改到 MOVE_D —— 清单、日历必须同步 */
      const day926 = tg.days.find(d => d.key === CLAIM_D);
      t('DIAG ' + CLAIM_D + ' 组存在', !!day926,
        'days=[' + tg.days.map(d => d.key).join(',') + '] over=' + tg.over.length
        + ' unsched=' + tg.noPlan.length + ' rows=' + W.S.rows.length
        + ' addDates=[' + CALLS.add.filter(c => c.databaseId === MAIN_DB)
          .map(c => c.properties['计划日期'].date).join('|') + ']');
      if (!day926) { finish(); return; }
      const row926 = day926.list[0];
      const boxOf = v => ({ getAttribute: k => (k === 'data-rs' ? row926._id : null), value: v });
      fire(TL.el(), 'change', { target: boxOf(MOVE_D) });
      setTimeout(function () {
        const g2 = TL.groups();
        t('改期后不再落在 ' + CLAIM_D + '（这一组整组消失）',
          !g2.days.some(d => d.key === CLAIM_D),
          g2.days.map(d => d.key).join(','));
        t('改期后落进 ' + MOVE_D + ' 组',
          g2.days.some(d => d.key === MOVE_D && d.list.some(r => r._id === row926._id)));
        const u = CALLS.update.filter(c => c.databaseId === MAIN_DB && c.recordId === row926._id).slice(-1)[0];
        t('改期只写「计划日期 + 更新时间」两个字段',
          !!u && !!u.properties['计划日期'] && Object.keys(u.properties).length === 2,
          u ? Object.keys(u.properties).join(',') : '无');
        t('日历同步：' + MOVE_D + ' 当天排期数变成 1（同一份数据推导）',
          W.PlanCal.dayLoad(MOVE_D).open === 1, W.PlanCal.dayLoad(MOVE_D).open);
        t('日历同步：' + CLAIM_D + ' 当天排期归零', W.PlanCal.dayLoad(CLAIM_D).open === 0);

        /* 清空落点要被拒绝，否则任务会掉进「未排期」黑洞 */
        fire(TL.el(), 'change', { target: boxOf('') });
        t('清空落点日期被拒绝并给出提示',
          doc.getElementById('toast').textContent.indexOf('保留一个落点日期') >= 0,
          doc.getElementById('toast').textContent);

        /* 视图切换与持久化 */
        TL.setView('unsched');
        t('视图选择写入 localStorage', sb.localStorage.getItem('molly.taskview') === 'unsched',
          String(sb.localStorage.getItem('molly.taskview')));
        t('readView() 读得回（刷新后不跳回默认）', TL.readView() === 'unsched');
        TL.setView('week');
        t('「未来 7 天」不显示第 8 天以后的任务',
          TL.el().innerHTML.indexOf(CLAIM_CN) < 0 && TL.el().innerHTML.indexOf(MOVE_CN) < 0,
          TL.el().innerHTML.slice(0, 90));
        TL.setView('done');
        const dd = TL.groups().done;
        t('「已完成」视图按完成时间倒序',
          dd.every((r, i) => i === 0 || Number(dd[i - 1]['完成时间'] || 0) >= Number(r['完成时间'] || 0)));

        /* ---- v20：done 按主题分组 + 组内按项目归类 ---- */
        const doneHtml = TL.el().innerHTML;
        const iT03 = doneHtml.indexOf('T03 三大商学院与课程发行');
        const iT08 = doneHtml.indexOf('T08 法务风控与合规');
        const iNA = doneHtml.indexOf('未分类');
        t('「已完成」按主题分组（T03 组在 T08 组之前）',
          iT03 >= 0 && iT08 > iT03, 'T03@' + iT03 + ' T08@' + iT08);
        t('「已完成」无主题的进「未分类」且排在主题组之后',
          iNA > iT08, '未分类@' + iNA + ' T08@' + iT08);
        t('「已完成」组内同项目归类（乙、丙同属一案且相邻，丁在未分类组）',
          (function () {
            const h = TL.el().innerHTML;
            const iB = h.indexOf('完成项乙'), iC = h.indexOf('完成项丙'), iD = h.indexOf('完成项丁');
            if (iB < 0 || iC < 0 || iD < 0 || iD < Math.max(iB, iC)) return false;
            const lo = Math.min(iB, iC), hi = Math.max(iB, iC);
            /* 相邻 = 两者之间没有其他「完成项」条目（跳过开头那条自身的标题） */
            return h.slice(lo + 3, hi).indexOf('完成项') === -1;
          })());

        /* ---- v20：完成结果行内展示（CSS line-clamp，文本必须原样出现） ---- */
        t('已完成的「完成结果」渲染在行内',
          TL.el().innerHTML.indexOf('t-result') >= 0 &&
          TL.el().innerHTML.indexOf('已签约，下周进场') >= 0);

        /* ---- v20：打钩完成 → 弹「完成结果」输入框 → 确认后同帧落库 ---- */
        const updBeforeDone = CALLS.update.filter(c => c.databaseId === MAIN_DB).length;
        const chkBtn = {
          getAttribute: function (k) {
            if (k === 'data-act') return 'toggle';
            if (k === 'data-id') return 'm1';
            return null;
          },
          closest: function (sel) { return sel === 'button[data-act]' ? chkBtn : null; }
        };
        fire(TL.el(), 'click', { target: chkBtn });
        t('打钩完成先弹「完成结果」输入框', doc.getElementById('doneMask').classList.contains('on'));
        doc.getElementById('doneInput').value = '已输出清单并邮件同步';
        fire(doc.getElementById('doneOk'), 'click', {});
        const updDone = CALLS.update.filter(c => c.databaseId === MAIN_DB).slice(-1)[0];
        t('「完成结果」与状态同帧落库',
          !!updDone && updDone.recordId === 'm1'
            && updDone.properties['完成结果'] && updDone.properties['完成结果'].text === '已输出清单并邮件同步'
            && updDone.properties['状态'] && updDone.properties['状态'].select === '已完成',
          JSON.stringify(updDone && updDone.properties));

        /* ---- v20：弹窗取消 = 零写库（「必须不出现」侧） ---- */
        const chkBtn2 = {
          getAttribute: function (k) {
            if (k === 'data-act') return 'toggle';
            if (k === 'data-id') return 'm9';
            return null;
          },
          closest: function (sel) { return sel === 'button[data-act]' ? chkBtn2 : null; }
        };
        const updBeforeCancel = CALLS.update.filter(c => c.databaseId === MAIN_DB).length;
        fire(TL.el(), 'click', { target: chkBtn2 });
        t('m9 打钩也弹输入框', doc.getElementById('doneMask').classList.contains('on'));
        fire(doc.getElementById('doneCancel'), 'click', {});
        t('取消完成不写库',
          CALLS.update.filter(c => c.databaseId === MAIN_DB).length === updBeforeCancel,
          String(CALLS.update.filter(c => c.databaseId === MAIN_DB).length - updBeforeCancel));

        /* ---- v20：取消勾选已完成项 → 「完成结果」一并清空 ---- */
        const chkBtn3 = {
          getAttribute: function (k) {
            if (k === 'data-act') return 'toggle';
            if (k === 'data-id') return 'mD1';
            return null;
          },
          closest: function (sel) { return sel === 'button[data-act]' ? chkBtn3 : null; }
        };
        fire(TL.el(), 'click', { target: chkBtn3 });
        const updUncheck = CALLS.update.filter(c => c.databaseId === MAIN_DB).slice(-1)[0];
        t('取消勾选清空「完成结果」',
          !!updUncheck && updUncheck.recordId === 'mD1'
            && updUncheck.properties['完成结果'] && updUncheck.properties['完成结果'].text === ''
            && updUncheck.properties['状态'] && updUncheck.properties['状态'].select === '待处理',
          JSON.stringify(updUncheck && updUncheck.properties));

        /* ---- v20：沉淀双通道 —— 草稿只出现在待确认区，普通视图必须不出现 ---- */
        W.switchTab('notes');
        const draftsHtml = doc.getElementById('noteDrafts').innerHTML;
        t('待确认区列出蒸馏草稿与转正按钮',
          draftsHtml.indexOf('蒸馏草稿样例') >= 0 && draftsHtml.indexOf('确认转正') >= 0);
        t('草稿在普通视图不可见（必须不出现）',
          doc.getElementById('noteList').innerHTML.indexOf('蒸馏草稿样例') < 0);
        t('正式沉淀仍在普通视图', doc.getElementById('noteList').innerHTML.indexOf('正式沉淀样例') >= 0);
        t('草稿在「按标签」视图也不可漏出', (function () {
          const seg = doc.getElementById('noteViews');
          fire(seg, 'click', { target: { getAttribute: function (k) { return k === 'data-nv' ? 'tag' : null; }, closest: function (s) { return s === 'button[data-nv]' ? this : null; } } });
          return doc.getElementById('noteList').innerHTML.indexOf('蒸馏草稿样例') < 0;
        })());
        const dnBtn = {
          getAttribute: function (k) {
            if (k === 'data-nact') return 'confirm';
            if (k === 'data-id') return 'mDN1';
            return null;
          },
          closest: function (sel) { return sel === 'button[data-nact]' ? dnBtn : null; }
        };
        fire(doc.getElementById('noteDrafts'), 'click', { target: dnBtn });
        const updConfirm = CALLS.update.filter(c => c.databaseId === MAIN_DB).slice(-1)[0];
        t('确认转正摘掉「蒸馏草稿」标签',
          !!updConfirm && updConfirm.recordId === 'mDN1'
            && updConfirm.properties['标签'] && updConfirm.properties['标签'].text.indexOf('蒸馏草稿') < 0,
          JSON.stringify(updConfirm && updConfirm.properties));
        W.switchTab('today');
        TL.setView('open');

        /* 故障态：读不到 ≠ 没有 */
        W.S.loadFailed = true;
        TL.render();
        t('读取失败时清单标「—」而不是 0 项',
          doc.getElementById('taskCnt').textContent === '—'
            && TL.el().innerHTML.indexOf('读取资料库失败') >= 0,
          doc.getElementById('taskCnt').textContent);
        t('读取失败时清单不说「没有未完成的任务」',
          TL.el().innerHTML.indexOf('没有未完成的任务') < 0);
        W.S.loadFailed = false;
        W.refreshAll();
        t('恢复后清单回到真实条数', doc.getElementById('taskCnt').textContent.indexOf('项') > 0,
          doc.getElementById('taskCnt').textContent);
        t('任务清单是只读视图：改期不会产生额外记录',
          TABLES[MAIN_DB].length === W.S.rows.length,
          TABLES[MAIN_DB].length + ' vs ' + W.S.rows.length);

        /* ============ 需求③：整理重复 / 任务清单能真的删 / 领取写入锁 ============ */

        /* --- ③-1 整理重复。
           线上事故形态：点一次领取，主台账落两行，两条除 _id 外逐字段一致。
           判定只看「仓库ID」—— 手工新建的同名记录绝不能算重复（不同录音里
           真的可能有两件同名的事，误删就是真丢数据）。 */
        TABLES[MAIN_DB].push(
          { _id: 'dupA', '标题': '重复项', '类型': '待办', '状态': '待处理', '优先级': 'P2 常规',
            '计划日期': '2026-09-20', '仓库ID': 'p3', '创建时间': 500, '更新时间': 500 },
          { _id: 'dupB', '标题': '重复项', '类型': '待办', '状态': '已完成', '优先级': 'P2 常规',
            '计划日期': '2026-09-20', '仓库ID': 'p3', '创建时间': 501, '更新时间': 501 },
          { _id: 'dupC', '标题': '重复项', '类型': '待办', '状态': '待处理', '优先级': 'P2 常规',
            '计划日期': '2026-09-20', '创建时间': 502, '更新时间': 502 }
        );
        W.reload().then(function () {
          return B.findDups();
        }).then(function (rep) {
          t('盘点出 1 组重复、1 条多余', rep.groups === 1 && rep.extra === 1, JSON.stringify(rep));
          t('盘点阶段不写入（确认前不动数据）',
            TABLES[MAIN_DB].filter(r => r['仓库ID'] === 'p3').length === 2,
            String(TABLES[MAIN_DB].filter(r => r['仓库ID'] === 'p3').length));
          return B.sweepDups();
        }).then(function (n) {
          t('清理掉 1 条多余记录', n === 1, String(n));
          const left = TABLES[MAIN_DB].filter(r => r['仓库ID'] === 'p3');
          t('每组只留一条', left.length === 1, left.map(r => r._id).join(','));
          t('留下的是已勾完成的那条（保住真实进度）', !!left[0] && left[0]._id === 'dupB',
            left[0] ? left[0]._id : '(空)');
          t('没有 仓库ID 的同名记录不参与去重（不误删手工项）',
            TABLES[MAIN_DB].some(r => r._id === 'dupC'));
          const fix = CALLS.update.filter(c => c.databaseId === POOL_DB && c.recordId === 'p3'
            && c.properties['工作台记录ID']).slice(-1)[0];
          t('仓库的「工作台记录ID」被校正到留下的那条',
            !!fix && fix.properties['工作台记录ID'].text === 'dupB',
            fix ? fix.properties['工作台记录ID'].text : '(没有修正调用)');
          return W.reload();
        }).then(function () {
          /* --- ③-2 任务清单里的删除按钮必须真的能删。
             早先这里只绑了 change 委托，按钮点了毫无反应、控制台也不报错 ——
             用户的原话就是「还没办法删除」。 */
          const delBefore = CALLS.del.filter(c => c.databaseId === MAIN_DB).length;
          const btn = {
            getAttribute: function (k) {
              if (k === 'data-act') return 'del';
              if (k === 'data-id') return 'm9';
              return null;
            },
            closest: function (sel) { return sel === 'button[data-act]' ? btn : null; }
          };
          fire(W.TaskList.el(), 'click', { target: btn });
          t('任务清单的删除会先弹确认（原生 confirm 在 iframe 里可能被静默拦掉）',
            doc.getElementById('cfMask').classList.contains('on'));
          const delNow = CALLS.del.filter(c => c.databaseId === MAIN_DB).length;
          t('确认之前一条都不会删', delNow === delBefore, String(delNow - delBefore));
          fire(doc.getElementById('cfYes'), 'click', {});
          setTimeout(function () {
            t('确认后任务清单的删除真的生效', CALLS.del.length > 0 && CALLS.del.filter(c => c.databaseId === MAIN_DB).length > delBefore,
              String(CALLS.del.filter(c => c.databaseId === MAIN_DB).length - delBefore));
            t('被删记录真的从台账里消失了', !TABLES[MAIN_DB].some(r => r._id === 'm9'));
            const back = CALLS.update.filter(c => c.databaseId === POOL_DB && c.recordId === 'p5'
              && c.properties['状态']).slice(-1)[0];
            t('来源仓库项退回「待领取」（不留悬空引用）',
              !!back && back.properties['状态'].select === 'o1',
              back ? back.properties['状态'].select : '(没有回退调用)');
            const p5 = TABLES[POOL_DB].find(p => p._id === 'p5');
            t('仓库项的关联 ID 已清空', !!p5 && p5['工作台记录ID'] === '',
              p5 ? String(p5['工作台记录ID']) : '(无此条)');

            /* --- ③-3 领取写入锁：同一 tick 连点两次「确认领取」只允许写一条。
               线上 38 条主台账 = 19 组、每组两条逐字段一致，就是缺了这把锁。 */
            const lockPool = TABLES[POOL_DB].find(p => p['状态'] === '待领取');
            const lockBefore = CALLS.add.filter(c => c.databaseId === MAIN_DB).length;
            B.openClaim(lockPool);
            B.doClaim();
            B.doClaim();
            const wrote = CALLS.add.filter(c => c.databaseId === MAIN_DB).length - lockBefore;
            t('同一 tick 连点两次只提交一次写入（写入锁生效）', wrote === 1, '实际 ' + wrote + ' 条');

            /* --- ④ 项目推进台：卡片能不能改、改名会不会把项目改散 --- */
            projectSuite(W);
          }, 400);
        }).catch(function (e) {
          t('重复治理链路不抛异常', false, String((e && e.stack) || e));
          finish();
        });
      }, 500);
    }, 500);
  }, 120);
}, 200);

/* ---------- ④ 项目推进台 ----------
   线上真实数据：项目记录的「标题」是行动描述（"监管所有股东与高管的出差计划落地执行"），
   而待办是靠自由文本「关联项目」找到项目的（"股东月计划"）—— 两者根本不是同一套命名。
   于是 3 张真项目卡全是空的，另外 9 张是只有名字、没有项目本体的「空壳卡」，
   而空壳卡过去只有「立项」按钮、没有任何改名入口：这就是「项目改不了」的现场。
   另外展开明细后的待办按钮走 onItemAction，而 #projectList 只绑了 onProjectAction。 */
function projectSuite(W) {
  const list = W.projEl();
  TABLES[MAIN_DB].push(
    { _id: 'prj1', '标题': '股东月计划', '类型': '项目', '状态': '进行中', '关联项目': '股东月计划', '计划日期': '2026-09-20' },
    { _id: 'pj1', '标题': '股东的出差计划落地', '类型': '待办', '状态': '待处理', '关联项目': '股东月计划', '计划日期': '2026-09-20' },
    { _id: 'pj2', '标题': '提交月度出差计划', '类型': '待办', '状态': '待处理', '关联项目': '股东月计划', '计划日期': '2026-09-21' },
    { _id: 'pjm', '标题': '名字没立项的那条', '类型': '待办', '状态': '待处理', '关联项目': '没立项的项目', '计划日期': '2026-09-22' }
  );
  W.reload().then(function () {
    W.renderProjects();
    const html = list.innerHTML;
    const rnCount = (html.match(/data-pact="rename"/g) || []).length;
    t('每张项目卡都有「改名」入口（含只有名字的空壳卡）', rnCount >= 2, 'rename 按钮 ' + rnCount + ' 个');
    t('没立项的空壳项目也能改名，不再是死路',
      /data-pact="rename" data-name="没立项的项目">/.test(html),
      String((html.match(/data-pact="rename"[^>]*data-name="没立项的项目"[^>]*>/) || ['(没有)'])[0]).slice(0, 100));
    t('空壳项目不给「编辑项目」（它还没有项目本体，给了会造出第二条同名项目）',
      !/data-pact="edit"[^>]*data-name="没立项的项目"/.test(html));

    /* 点空壳卡的「改名」→ 弹窗要开，并说清会影响哪些记录 */
    list.children.length = 0;
    fire(list, 'click', { target: mkBtn(list, 'button', { 'data-pact': 'rename', 'data-name': '没立项的项目' }) });
    t('点「改名」真的打开了改名弹窗', doc.getElementById('rnMask').classList.contains('on'));
    const hint1 = doc.getElementById('rnHint').textContent || '';
    t('改名弹窗讲清了影响面（1 条待办 + 还没立项）',
      /1 条待办/.test(hint1) && /还没立项/.test(hint1), hint1.slice(0, 120));
    doc.getElementById('rnName').value = '没立项的项目v2';
    W.doRename();

    setTimeout(function () {
      /* 改名是 Promise 链，同步读 CALLS 会读空 —— 断言必须等链路跑完 */
      const fixM = CALLS.update.filter(c => c.databaseId === MAIN_DB && c.recordId === 'pjm').slice(-1)[0];
      t('空壳改名把那条待办的「关联项目」跟着改了',
        !!fixM && fixM.properties['关联项目'].text === '没立项的项目v2',
        fixM ? JSON.stringify(fixM.properties) : '(没有 update 调用)');
      W.renderProjects();
      const html2 = list.innerHTML;
      t('改名后旧名字卡片消失、新名字长出来',
        !/data-name="没立项的项目"/.test(html2) && /data-name="没立项的项目v2"/.test(html2));
      t('改名只改归属、不新建记录',
        TABLES[MAIN_DB].filter(r => r['标题'] === '没立项的项目v2').length === 0,
        '主台账里同名记录 ' + TABLES[MAIN_DB].filter(r => r['标题'] === '没立项的项目v2').length + ' 条');

      /* 有项目本体的改名：标题 + 它名下所有记录的归属必须一起改 */
      list.children.length = 0;
      fire(list, 'click', { target: mkBtn(list, 'button', { 'data-pact': 'rename', 'data-name': '股东月计划', 'data-id': 'prj1' }) });
      t('已立项的卡片点改名，弹窗说明会连项目记录标题一起改',
        /已立项/.test(doc.getElementById('rnHint').textContent || ''),
        (doc.getElementById('rnHint').textContent || '').slice(0, 120));
      doc.getElementById('rnName').value = '股东月计划（2026）';
      W.doRename();

      setTimeout(function () {
        const head = CALLS.update.filter(c => c.databaseId === MAIN_DB && c.recordId === 'prj1'
          && c.properties['标题']).slice(-1)[0];
        t('项目记录本身的标题改成了新名',
          !!head && head.properties['标题'].text === '股东月计划（2026）',
          head ? head.properties['标题'].text : '(没有改标题)');
        const selfRef = CALLS.update.filter(c => c.databaseId === MAIN_DB && c.recordId === 'prj1'
          && c.properties['关联项目']).slice(-1)[0];
        t('项目记录自己的「关联项目」也对齐了（否则会以旧名再长一张空壳卡）',
          !!selfRef && selfRef.properties['关联项目'].text === '股东月计划（2026）',
          selfRef ? selfRef.properties['关联项目'].text : '(没有对齐)');
        ['pj1', 'pj2'].forEach(function (id) {
          const u = CALLS.update.filter(c => c.databaseId === MAIN_DB && c.recordId === id
            && c.properties['关联项目']).slice(-1)[0];
          t('挂在项目下的待办 ' + id + ' 归属跟着改了',
            !!u && u.properties['关联项目'].text === '股东月计划（2026）',
            u ? u.properties['关联项目'].text : '(没有改)');
        });

        W.reload().then(function () {
          const pi = W.projectIndex();
          const it = pi.filter(function (p) { return p.name === '股东月计划（2026）'; })[0];
          t('改名后仍是同一张项目卡，名下 2 条待办没被甩掉',
            !!it && !!it.row && it.todos.length === 2,
            it ? ('row=' + !!it.row + ' todos=' + it.todos.length) : '没找到新名字的卡片');
          t('旧名字没残留成空壳卡', !pi.some(function (p) { return p.name === '股东月计划'; }),
            pi.map(function (p) { return p.name; }).join(' / '));

          /* 展开明细里的待办按钮：data-act 走 onItemAction，必须和 onProjectAction 一起被委托。
             删除现在先过自研确认弹窗 —— 原生 confirm 在 iframe 里可能被静默拦掉，
             那样按钮就算接上了也永远删不掉。 */
          const delBefore = CALLS.del.filter(c => c.databaseId === MAIN_DB).length;
          list.children.length = 0;
          fire(list, 'click', { target: mkBtn(list, 'button', { 'data-act': 'del', 'data-id': 'pj2' }) });
          t('点删除先弹确认，不直接删', doc.getElementById('cfMask').classList.contains('on'));
          t('确认之前一条都不会删',
            CALLS.del.filter(c => c.databaseId === MAIN_DB).length === delBefore,
            String(CALLS.del.filter(c => c.databaseId === MAIN_DB).length - delBefore));
          fire(doc.getElementById('cfYes'), 'click', {});

          setTimeout(function () {
            t('确认后删除真的生效（按钮接上了 + 弹窗放行）',
              CALLS.del.filter(c => c.databaseId === MAIN_DB).length > delBefore);
            t('被删的待办确实从台账消失了', !TABLES[MAIN_DB].some(function (r) { return r._id === 'pj2'; }));
            list.children.length = 0;
            fire(list, 'click', { target: mkBtn(list, 'button', { 'data-act': 'edit', 'data-id': 'pj1' }) });
            t('项目明细里的编辑按钮能打开编辑弹窗',
              doc.getElementById('editMask').classList.contains('on')
              && doc.getElementById('e-title').value === '股东的出差计划落地',
              '弹窗标题=' + doc.getElementById('e-title').value);
            W.closeRename();
            mergeSuite(W);
          }, 320);
        }).catch(function (e) { t('项目台改名链路不抛异常', false, String((e && e.stack) || e)); finish(); });
      }, 320);
    }, 320);
  }).catch(function (e) { t('项目台用例不抛异常', false, String((e && e.stack) || e)); finish(); });
}

/* ==================== ⑤ 整理项目 · 防重复 · 通用确认弹窗 ====================
   事故（用户原话「项目分类你帮我整合一下 我感觉我搞重复了」）：线上 14 张项目卡里 11 张是
   空壳 —— 「小黄蜂&健医师」和「小黄蜂&健医师项目」各挂一条待办，两张卡谁也看不见谁。
   根子是「关联项目」这个自由文本框：datalist 只提示不拦截，手打一个变体照样入库。 */
function mergeSuite(W) {
  const M = W.ProjMerge;
  TABLES[MAIN_DB].push(
    { _id: 'dup1', '标题': '小黄蜂包装打样跟进', '类型': '待办', '状态': '待处理', '关联项目': '小黄蜂&健医师', '计划日期': '2026-09-23' },
    { _id: 'dup2', '标题': '小黄蜂价格定位复核', '类型': '待办', '状态': '待处理', '关联项目': '小黄蜂&健医师项目', '计划日期': '2026-09-24' },
    { _id: 'prc1', '标题': '梳理采购到货流程', '类型': '待办', '状态': '待处理', '关联项目': '采购部', '计划日期': '2026-09-25' },
    { _id: 'prc2', '标题': '采购流程梳理的跟进', '类型': '待办', '状态': '待处理', '关联项目': '采购流程梳理', '计划日期': '2026-09-26' }
  );
  W.S.editingId = '';
  doc.getElementById('editMask').classList.remove('on');
  t('资料库已连接（合并与拦截的前提）', W.Store.hasDB === true, String(W.Store.hasDB));

  W.reload().then(function () {
    /* ---- 归一化：能不能抓出「XX项目」这种变体，全看这一步 ---- */
    t('归一化剥掉「项目」后缀', M.kind('小黄蜂&健医师项目') === '小黄蜂健医师', M.kind('小黄蜂&健医师项目'));
    t('归一化做全角转半角 + 去标点', M.kind('采购部（流程）') === '采购部流程', M.kind('采购部（流程）'));
    t('归一化可叠加剥离（「XX项目计划」剥两次）', M.kind('车鲁班项目计划') === '车鲁班', M.kind('车鲁班项目计划'));

    /* ---- 成对判定 ---- */
    t('归一后相同 → 判为重复', /完全一样/.test(M.reason('小黄蜂&健医师', '小黄蜂&健医师项目')),
      M.reason('小黄蜂&健医师', '小黄蜂&健医师项目'));
    t('包含关系也判得出来', /包含/.test(M.reason('采购', '采购流程梳理')), M.reason('采购', '采购流程梳理'));
    t('2-gram 能抓「新媒体 / 社交媒体」这类共用词',
      /共用/.test(M.reason('新媒体', '社交媒体')), M.reason('新媒体', '社交媒体'));
    t('不相干的名字绝不误判', M.reason('股东月计划（2026）', '小黄蜂&健医师') === '',
      M.reason('股东月计划（2026）', '小黄蜂&健医师'));

    /* ---- 聚类成组 ---- */
    const sg = M.suggest(M.items());
    const gX = sg.filter(g => g.members.some(m => m.name === '小黄蜂&健医师项目'))[0];
    t('把「小黄蜂&健医师项目」和「小黄蜂&健医师」聚成一组',
      !!gX && gX.members.length === 2,
      sg.map(g => g.members.map(m => m.name).join(' + ')).join(' | ') || '(没有建议)');
    const gC = sg.filter(g => g.members.some(m => m.name === '采购部'))[0];
    t('也聚出了「采购部 / 采购流程梳理」', !!gC && gC.members.length === 2,
      gC ? gC.members.map(m => m.name).join(' + ') : '(没有)');
    t('每组都指定了保留项', !!gX && !!gX.keep, gX ? gX.keep : '');
    t('每组都写了判断依据', !!gX && /完全一样|包含|共用/.test(gX.reason), gX ? gX.reason : '');

    /* ---- 弹窗（走真事件：点入口按钮）---- */
    fire(doc.getElementById('btnProjMerge'), 'click', {});
    t('点「整理项目」打开了弹窗', doc.getElementById('pjMask').classList.contains('on'));
    t('弹窗顶部说清了找出几组',
      /找出 \d+ 组/.test(doc.getElementById('pjLead').textContent || ''),
      (doc.getElementById('pjLead').textContent || '').slice(0, 90));
    const st = M.state();
    t('建议组默认全勾', st.filter(x => x.on).length >= 4, '勾了 ' + st.filter(x => x.on).length + ' 项');
    t('每组默认有「保留」', st.filter(x => x.keep).length >= 2, '保留 ' + st.filter(x => x.keep).length + ' 项');
    t('列表里带出判断依据', /判断依据：/.test(doc.getElementById('pjList').innerHTML));
    t('项目名进了 data-pj 且 & 已转义',
      /data-pj="小黄蜂&amp;健医师项目"/.test(doc.getElementById('pjList').innerHTML));
    t('「其他项目」也列出来（算法抓不到的允许手动勾）',
      /其他项目（也可勾上一起合并）/.test(doc.getElementById('pjList').innerHTML));

    /* ---- 勾选态：DOM 只负责显示，判断一律读 state ---- */
    const fakeBox = mkBtn(null, 'div', { 'data-pj': '小黄蜂&健医师项目' });
    fakeBox.checked = false;
    fire(doc.getElementById('pjList'), 'change', { target: fakeBox });
    t('取消勾选会写回 state（change 委托生效）',
      M.state().filter(x => x.name === '小黄蜂&健医师项目')[0].on === false,
      String(M.state().filter(x => x.name === '小黄蜂&健医师项目')[0].on));

    /* ---- 只勾小黄蜂那组执行合并 ---- */
    st.forEach(function (x) {
      x.on = (x.name === '小黄蜂&健医师' || x.name === '小黄蜂&健医师项目');
      x.keep = (x.name === '小黄蜂&健医师');
    });
    M.doIt();

    setTimeout(function () {
      t('点合并后弹窗关闭', !doc.getElementById('pjMask').classList.contains('on'));
      const u = CALLS.update.filter(c => c.databaseId === MAIN_DB && c.recordId === 'dup2'
        && c.properties['关联项目']).slice(-1)[0];
      t('被并名字下的记录，归属改到了保留项',
        !!u && u.properties['关联项目'].text === '小黄蜂&健医师',
        u ? u.properties['关联项目'].text : '(没有改)');

      W.reload().then(function () {
        const pi = W.projectIndex();
        const names = pi.map(p => p.name);
        t('合并后只剩一张小黄蜂卡，变体名字消失',
          names.indexOf('小黄蜂&健医师') !== -1 && names.indexOf('小黄蜂&健医师项目') === -1,
          names.join(' / '));
        const it = pi.filter(p => p.name === '小黄蜂&健医师')[0];
        t('保留项把两条待办都收进来了', !!it && it.todos.length === 2, it ? String(it.todos.length) : '没找到');
        t('没勾的「采购」那组原样不动（没被顺手合并）',
          names.indexOf('采购部') !== -1 && names.indexOf('采购流程梳理') !== -1, names.join(' / '));

        /* ---- 防重复：内联提示 ---- */
        t('相似名判定：变体能被认出来', W.similarProj('集团经营项目') === '集团经营', W.similarProj('集团经营项目'));
        /* 卡上已经没有这个变体了，但用户再手打它依然会被拦到保留项 —— 这才是防重复该有的效果 */
        t('合并后用户再手打同一个变体，依然会被拦到保留项',
          W.similarProj('小黄蜂&健医师项目') === '小黄蜂&健医师',
          W.similarProj('小黄蜂&健医师项目'));
        t('无关名字不会被误判', W.similarProj('车鲁班项目') === '', W.similarProj('车鲁班项目'));

        doc.getElementById('e-project').value = '集团经营项目';
        W.renderProjHint();
        const hp = doc.getElementById('eProjHint');
        t('输入相似名时给出内联提示', /就用它/.test(hp.innerHTML), String(hp.innerHTML).slice(0, 110));
        t('提示里带出已有项目名', /集团经营/.test(hp.innerHTML));
        fire(doc.getElementById('editMask'), 'click',
          { target: mkBtn(null, 'b', { 'class': 'useproj', 'data-useproj': '集团经营' }) });
        t('点「就用它」把输入框换成已有名字',
          doc.getElementById('e-project').value === '集团经营', doc.getElementById('e-project').value);
        t('采用后提示自动收起', hp.style.display === 'none', String(hp.style.display));

        /* ---- 防重复：保存时硬拦截 ---- */
        doc.getElementById('e-title').value = '拦截测试的一条';
        doc.getElementById('e-project').value = '集团经营项目';
        const addBefore = CALLS.add.filter(c => c.databaseId === MAIN_DB).length;
        fire(doc.getElementById('editSave'), 'click', {});
        t('保存时撞名先弹确认，不直接入库',
          doc.getElementById('cfMask').classList.contains('on') &&
          CALLS.add.filter(c => c.databaseId === MAIN_DB).length === addBefore,
          '弹窗=' + doc.getElementById('cfMask').classList.contains('on'));
        t('确认弹窗给出两条明确出路',
          /归到/.test(doc.getElementById('cfYes').textContent || '') &&
          /仍按我填的/.test(doc.getElementById('cfNo').textContent || ''),
          (doc.getElementById('cfYes').textContent || '') + ' / ' + (doc.getElementById('cfNo').textContent || ''));
        fire(doc.getElementById('cfYes'), 'click', {});
        t('选「归到已有」后输入框被改成已有名字',
          doc.getElementById('e-project').value === '集团经营', doc.getElementById('e-project').value);

        setTimeout(function () {
          const added = CALLS.add.filter(c => c.databaseId === MAIN_DB).slice(-1)[0];
          t('确认之后才真正入库，且存的是已有项目名',
            !!added && added.properties['关联项目'].text === '集团经营',
            added ? added.properties['关联项目'].text : '(没有新增)');

          /* ---- 通用确认弹窗本身 ---- */
          let got = null;
          W.askConfirm({ title: '测试标题', text: '测试正文', yes: '好的', no: '算了' }, function (ok) { got = ok; });
          t('askConfirm 打开弹窗并写入文案',
            doc.getElementById('cfMask').classList.contains('on') &&
            doc.getElementById('cfTitle').textContent === '测试标题' &&
            doc.getElementById('cfYes').textContent === '好的' &&
            doc.getElementById('cfNo').textContent === '算了');
          W.closeConfirm(false);
          t('closeConfirm(false) 回传 false', got === false, String(got));
          t('回调后弹窗已关闭', !doc.getElementById('cfMask').classList.contains('on'));
          W.askConfirm({}, function (ok) { got = ok; });
          fire(doc.getElementById('cfYes'), 'click', {});
          t('点「确定」回传 true', got === true, String(got));
          W.askConfirm({}, function (ok) { got = ok; });
          fire(doc.getElementById('cfNo'), 'click', {});
          t('点「取消」回传 false', got === false, String(got));

          timeSuite(W);
        }, 300);
      }).catch(function (e) { t('整理项目链路不抛异常', false, String((e && e.stack) || e)); finish(); });
    }, 300);
  }).catch(function (e) { t('整理项目用例不抛异常', false, String((e && e.stack) || e)); finish(); });
}

/* ==================== ⑥ 时间点 · 排期精确到小时与分钟 ====================
   用户原话：「当前只能按天选择日期，无法选择具体的时间点。例如预约下午 14:30 时，
   界面没有提供时间选项。」—— 约人、开会这类事光有日期根本没法用。
   这一节里的弹层交互全部走真事件（点面板上的日期格与时间点），不直接改内部状态，
   所以「用户真的点得到」是被证明过的，而不是「代码里写了」。 */
function timeSuite(W) {
  const CAL = W.Cal;

  /* ---- ① 解析层：口径必须是「00:00 等于没设时间」 ---- */
  t('时间·带时间取出 HH:mm', W.timeOf('2026-09-21 14:30') === '14:30', W.timeOf('2026-09-21 14:30'));
  t('时间·ISO 形态同样认', W.timeOf('2026-09-21T14:30:00Z') === '14:30');
  t('时间·纯日期取不到时间', W.timeOf('2026-09-21') === '');
  t('时间·旧数据的零点视为「未设」（否则存量记录会冒出满屏 00:00）',
    W.timeOf('2026-09-21T00:00:00Z') === '');
  t('时间·时间戳数字不误判', W.timeOf(1789798763281) === '');
  t('时间·个位自动补零', W.timeOf('2026-09-21 9:05') === '09:05');
  t('时间·非法小时拒绝', W.timeOf('2026-09-21 25:00') === '');
  t('时间·非法分钟拒绝', W.timeOf('2026-09-21 12:75') === '');
  t('时间·空值安全', W.timeOf('') === '' && W.timeOf(null) === '' && W.timeOf(undefined) === '');

  t('时间·输入框标准写法', W.dtText('2026-09-21T14:30:00Z') === '2026-09-21 14:30',
    W.dtText('2026-09-21T14:30:00Z'));
  t('时间·旧数据回显成纯日期（不显示 00:00）', W.dtText('2026-09-21T00:00:00Z') === '2026-09-21');
  t('时间·给人看的写法', W.dtFriendly('2026-09-21 14:30') === '9月21日 14:30',
    W.dtFriendly('2026-09-21 14:30'));

  /* ---- ② 落库格式：date 列只认这两种形态（已对线上表实测「写 14:30 读回 14:30」） ---- */
  t('时间·纯日期原样交给 date 列', W.toApiDate('2026-09-21') === '2026-09-21');
  t('时间·带时间转成 ISO', W.toApiDate('2026-09-21 14:30') === '2026-09-21T14:30:00Z',
    W.toApiDate('2026-09-21 14:30'));
  t('时间·读出来再写回去保持不变（幂等，不会把 14:30 磨成 00:00）',
    W.toApiDate('2026-09-21T14:30:00Z') === '2026-09-21T14:30:00Z');
  t('时间·旧数据读回仍是纯日期', W.toApiDate('2026-09-21T00:00:00Z') === '2026-09-21');

  /* ---- ③ 按天分组的老逻辑不能被子时间后缀打破 ---- */
  t('回归·dayKey 带时间仍取到那一天', W.dayKey('2026-09-21 14:30') === '2026-09-21');
  t('回归·planKey 带时间仍归到那一天',
    W.planKey({ '计划日期': '2026-09-21T14:30:00Z' }) === '2026-09-21');
  const yK = W.shiftKey(W.todayKey(), -1), tK = W.shiftKey(W.todayKey(), 1);
  t('回归·逾期判断不受时间点影响',
    W.isOverdue({ '类型': '待办', '状态': '待处理', '计划日期': yK + 'T18:00:00Z' }) === true
    && W.isOverdue({ '类型': '待办', '状态': '待处理', '计划日期': tK + 'T08:00:00Z' }) === false,
    '昨天带时间=' + yK + 'T18:00:00Z 明天带时间=' + tK + 'T08:00:00Z');

  /* ---- ④ 弹层交互：先选日期、再点时间，全程走真事件 ---- */
  const inp = doc.getElementById('e-plan');
  inp.setAttribute('data-cal', '1');
  CAL.setToday('2026-09-19');
  CAL.close();
  inp.value = '';
  const nd = (attr, val) => ({ getAttribute: k => (k === attr ? val : null), parentNode: CAL.el() });

  CAL.open(inp);
  t('时间·日期面板能打开', CAL.isOpen());
  const h0 = CAL.el().innerHTML;
  t('时间·弹层里有「时间」手输框', h0.indexOf('data-a="tin"') >= 0);
  t('时间·弹层里有常用时间点快捷选', h0.indexOf('data-t="14:30"') >= 0 && h0.indexOf('data-t="09:00"') >= 0);
  t('时间·弹层里有「全天」开关', h0.indexOf('data-a="tall"') >= 0);
  t('时间·默认就是全天（只选日期的老用法完全不受影响）',
    CAL.state().time === '', String(CAL.state().time));
  t('时间·未选日期时预览提示「未选择日期」', h0.indexOf('未选择日期') >= 0);

  fire(CAL.el(), 'click', { target: nd('data-d', '2026-09-21') });
  t('时间·点日期即刻落值', inp.value === '2026-09-21', inp.value);
  t('时间·点日期后面板不关（否则紧接着没法接着选时间）', CAL.isOpen());
  t('时间·预览显示已选日期', CAL.el().innerHTML.indexOf('已选 2026-09-21') >= 0,
    (CAL.el().innerHTML.match(/已选 [^<]*/) || ['(无)'])[0]);

  fire(CAL.el(), 'click', { target: nd('data-t', '14:30') });
  t('时间·点快捷时间点后合成「日期 + 时间」', inp.value === '2026-09-21 14:30', inp.value);
  t('时间·点时间点也不会关掉面板', CAL.isOpen());
  t('时间·面板内状态同步到 14:30', CAL.state().time === '14:30', String(CAL.state().time));
  t('时间·预览显示完整时间点', CAL.el().innerHTML.indexOf('已选 2026-09-21 14:30') >= 0);

  fire(CAL.el(), 'click', { target: nd('data-d', '2026-09-23') });
  t('时间·换日期时已选的时间点跟着走（不被日期覆盖掉）',
    inp.value === '2026-09-23 14:30', inp.value);

  fire(CAL.el(), 'click', { target: nd('data-a', 'tall') });
  t('时间·点「全天」把时间点撤回成纯日期', inp.value === '2026-09-23', inp.value);

  /* ---- ⑤ 手输：1430 / 14.30 / 全角冒号都要认，认不出绝不写坏值 ---- */
  t('时间·手输 1430 归一为 14:30', CAL.normTime('1430') === '14:30', CAL.normTime('1430'));
  t('时间·手输 930 归一为 09:30', CAL.normTime('930') === '09:30', CAL.normTime('930'));
  t('时间·手输 14.30 归一为 14:30', CAL.normTime('14.30') === '14:30', CAL.normTime('14.30'));
  t('时间·手输全角冒号也认', CAL.normTime('14：30') === '14:30', CAL.normTime('14：30'));
  t('时间·手输 9:5 归一为 09:05', CAL.normTime('9:5') === '09:05', CAL.normTime('9:5'));
  t('时间·手输 14:30 不被误解析成 00:14（match 长度判形态的坑）',
    CAL.normTime('14:30') === '14:30', CAL.normTime('14:30'));
  t('时间·手输非法值返回空', CAL.normTime('2500') === '' && CAL.normTime('abc') === ''
    && CAL.normTime('') === '');

  CAL.onTimeInput({ value: '1430' });
  t('时间·手输 1430 后输入框带上时间点', inp.value === '2026-09-23 14:30', inp.value);
  CAL.onTimeInput({ value: '这不是时间' });
  t('时间·手输认不出时退回全天（绝不留坏值）', inp.value === '2026-09-23', inp.value);

  /* 手输整串日期时间也要能被 normalize 认出来 */
  inp.value = '2026-09-24 14:30';
  CAL.open(inp);
  t('时间·手输整串能被解析出日期与时间点',
    CAL.state().sel === '2026-09-24' && CAL.state().time === '14:30',
    CAL.state().sel + ' / ' + CAL.state().time);
  CAL.close();
  t('时间·关闭后归一化成标准写法', inp.value === '2026-09-24 14:30', inp.value);

  /* ---- ⑥ 端到端：保存必须把「日期 时间」转成 date 列认的 ISO ---- */
  const row = TABLES[MAIN_DB].find(r => r['类型'] === '待办' && r['状态'] !== '已完成')
    || TABLES[MAIN_DB][0];
  W.openEdit(row);
  doc.getElementById('e-plan').value = '2026-09-24 14:30';
  const before = CALLS.update.filter(c => c.databaseId === MAIN_DB).length;
  fire(doc.getElementById('editSave'), 'click', {});
  setTimeout(function () {
    const upd = CALLS.update
      .filter(c => c.databaseId === MAIN_DB && String(c.recordId) === String(row._id)).slice(-1)[0];
    t('端到端·保存时把「日期 + 时间」转成 date 列的 ISO',
      !!upd && !!upd.properties['计划日期']
      && upd.properties['计划日期'].date === '2026-09-24T14:30:00Z',
      upd && upd.properties['计划日期'] ? String(upd.properties['计划日期'].date) : '(没有更新调用)');
    t('端到端·确实发生了一次写入', CALLS.update.filter(c => c.databaseId === MAIN_DB).length > before);

    /* ---- ⑦ 行内改期：只调时间点也要能存下去 ---- */
    const trow = TABLES[MAIN_DB].find(r => r['类型'] === '待办');
    if (trow) {
      const n0 = CALLS.update.filter(c => c.databaseId === MAIN_DB).length;
      W.reschedule(trow._id, '2026-09-25 16:45');
      setTimeout(function () {
        const u2 = CALLS.update
          .filter(c => c.databaseId === MAIN_DB && String(c.recordId) === String(trow._id)).slice(-1)[0];
        t('行内改期·能把时间点一起写下去',
          !!u2 && u2.properties['计划日期'].date === '2026-09-25T16:45:00Z',
          u2 && u2.properties['计划日期'] ? String(u2.properties['计划日期'].date) : '(无)');
        t('行内改期·确实发生了一次写入',
          CALLS.update.filter(c => c.databaseId === MAIN_DB).length > n0);

        /* 只把时间点挪一挪（日期不变）也必须算「改了」——否则会被当成没变而静默跳过 */
        const n1 = CALLS.update.filter(c => c.databaseId === MAIN_DB).length;
        W.reschedule(trow._id, '2026-09-25 09:00');
        setTimeout(function () {
          t('行内改期·仅调整时间点也算改动（不会被当成没改而跳过）',
            CALLS.update.filter(c => c.databaseId === MAIN_DB).length > n1);
          finish();
        }, 60);
      }, 60);
    } else {
      finish();
    }
  }, 320);
}

function finish() {
  console.log(log.join('\n'));
  console.log('\n__FAILED__ ' + bad.length + (bad.length ? '\n' + bad.join('\n') : ''));
  fs.writeFileSync('smoke_merged_log.txt', log.join('\n') + '\n\n__FAILED__ ' + bad.length + '\n', 'utf8');
  process.exit(bad.length ? 1 : 0);
}
