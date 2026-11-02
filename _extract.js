
(function () {
  'use strict';

  /* ==================== 常量与状态 ==================== */
  var DATABASE_ID = 'ggytTE4Cvh4Nyi3nBAcdxD';
  /* 得到大脑·每日录音库 g0T2Bz3L9LmINPC1YhLPg6：仅用于「主题精力分布」的长期重心对照列，只读。
     注意：该 id 必须在 loadLib() 里以字面量出现，才能被 lint 的 databaseId 字面量集合收录，
     否则 data-sp-database-id 标注会判定为「与 HTML 中出现的 databaseId 不一致」。 */
  var LS_ROWS = 'wb_wb3_rows';
  var LS_DRAFT = 'wb_wb3_draft';
  var LS_PREFS = 'wb_wb3_prefs';

  var TYPE_TODO = '待办', TYPE_PROJ = '项目', TYPE_NOTE = '沉淀';

  /* 「得到大脑·录音与待办仓库」页面地址：部署后回填，改这一处即可 */
  var BRAIN_URL = 'https://www.workbuddy.cn/space/d/rXvod19M11iTeZ7udPWCdf';

  /* 主题码表（T01—T12）：与知识库 frontmatter 的 themes 同口径，
     与「得到大脑」页面共用同一份，避免两页各写一套造成口径漂移 */
  var THEME_NAME = {
    T01: '精武陈真退股纠纷', T02: '美博会与展会作战', T03: '三大商学院与课程发行',
    T04: '新媒体矩阵与投流', T05: 'AI与数字化转型', T06: '组织架构与人力管理',
    T07: '财务体系与数据系统', T08: '法务风控与合规', T09: '会务统筹与商务接待',
    T10: '产品供应链与工厂', T11: '渠道运营与招商体系', T12: '手机系统与客户管理'
  };
  var PRIO_KEYS = ['P0 紧急', 'P1 重要', 'P2 常规'];

  var S = {
    rows: [],
    selDate: '',
    /* 月历视图锚点（0 基月份）：只影响「看哪个月」，选中日仍由 selDate 决定 */
    calY: 0,
    calM: 0,
    /* 月历展开状态：用户就是为了「看完整月」，故默认展开，选择记在 localStorage */
    calOpen: true,
    tab: 'today',
    /* 任务清单的视图：open 全部未完成 / week 未来 7 天 / unsched 未排期 / done 已完成 */
    taskView: 'open',
    noteView: 'all',
    noteQ: '',
    editingId: '',
    schemaOpts: {},
    usingSDK: false,
    /* empty = 主台账里一条记录都没有。仅用于渲染空态引导，绝不据此伪造数据 */
    empty: false,
    /* loadFailed = 这次读取失败（网络/权限）。与 empty 严格区分：读不到 ≠ 没有 */
    loadFailed: false,
    ready: false,
    /* 每周复盘：weekOff = 相对本周的偏移，0 本周 / -1 上一周 / 1 下一周 */
    weekOff: 0,
    libRows: [],
    libLoaded: false
  };

  /* ==================== 工具函数 ==================== */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayKey() { return keyOf(new Date()); }
  function shiftKey(key, days) {
    var p = String(key || '').split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + Number(days || 0));
    return keyOf(d);
  }
  function dayKey(v) {
    if (!v) return '';
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var n = Number(v);
    if (!isNaN(n) && n > 0) return keyOf(new Date(n));
    return '';
  }
  function stampKey(v) {
    var n = Number(v);
    if (!n || isNaN(n)) return '';
    return keyOf(new Date(n));
  }
  /* ==================== 时间点支持（v19）====================
     需求：只按「天」排期不够用 —— 约人下午 14:30，界面上没有地方填时间。
     落地约定（三句话，改这块前先读）：
       ① 输入框值的格式只有两种：'YYYY-MM-DD'（全天）或 'YYYY-MM-DD HH:mm'（带时间点）。
          前者就是旧格式，所以老记录、老代码路径零改动。
       ② 落库走 date 列，官方接受 'YYYY-MM-DD' 与 'YYYY-MM-DDTHH:mm:00Z' 两种形态
          （见 params-reference.md §PropertyValue）。转换只在 toApiDate() 一处发生。
       ③ 「00:00」一律当作「没设时间」。因为旧数据的存量值全是 T00:00:00Z，
          若把零点当成有效时间，整页历史记录会突然冒出满屏 00:00。
       另：dayKey() 本就是 /^\d{4}-\d{2}-\d{2}/ 前缀截取，所以带上时间后缀后，
       月历分格、当日清单、任务清单、逾期判断这些「按天」的逻辑全都不用改。 */
  function timeOf(v) {
    if (v === null || v === undefined || v === '') return '';
    var m = String(v).match(/(\d{1,2}):(\d{2})/);
    if (!m) return '';
    var h = Number(m[1]), mi = Number(m[2]);
    if (isNaN(h) || isNaN(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return '';
    if (h === 0 && mi === 0) return '';          /* 零点 = 未设时间（见约定③） */
    return pad(h) + ':' + pad(mi);
  }
  function dtText(v) {                            /* 输入框与清单里的标准写法 */
    var d = dayKey(v), t = timeOf(v);
    return d ? (t ? d + ' ' + t : d) : '';
  }
  function dtFriendly(v) {                        /* 给人看的中文写法：9月21日 14:30 */
    var d = dayKey(v);
    if (!d) return '';
    var t = timeOf(v);
    return dLabel(d) + (t ? ' ' + t : '');
  }
  function toApiDate(v) {                         /* 输入框值 → date 列可写值 */
    var d = dayKey(v), t = timeOf(v);
    if (!d) return '';
    return t ? (d + 'T' + t + ':00Z') : d;
  }
  function dLabel(key) {
    var p = String(key || '').split('-');
    return Number(p[1]) + '月' + Number(p[2]) + '日';
  }
  /* 注意：本名曾是 weekLabel，与「每周复盘」模块的 weekLabel(off)（按周偏移取标签）
     在同一作用域里重名 —— 函数声明提升后后者覆盖前者，于是「选日期」条和页头副标题
     都拿到 NaN（表现为「NaN/NaN 起」）。故日期版改名 wdLabel（weekday label）并锁死在硬门里。 */
  function wdLabel(key) {
    var p = String(key || '').split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return '周' + '日一二三四五六'.charAt(d.getDay());
  }
  function isDone(r) { return r['状态'] === '已完成'; }
  function isDecide(r) { return r['待决策'] === true; }
  function typeOf(r) { return r['类型'] || TYPE_TODO; }
  function todos() { return view().filter(function (r) { return typeOf(r) === TYPE_TODO; }); }
  function projects() { return view().filter(function (r) { return typeOf(r) === TYPE_PROJ; }); }
  function notes() { return view().filter(function (r) { return typeOf(r) === TYPE_NOTE; }); }
  function tagsOf(r) {
    return String(r['标签'] || '').split(/[,，、;；\s]+/).filter(function (t) { return t; });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nowStamp() { return Date.now(); }
  function planKey(r) { return dayKey(r['计划日期']) || dayKey(r['截止日期']) || ''; }
  function dueKey(r) { return dayKey(r['截止日期']) || ''; }
  function isOverdue(r) {
    if (isDone(r) || typeOf(r) !== TYPE_TODO) return false;
    var d = dueKey(r) || planKey(r);
    return !!d && d < todayKey();
  }

  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('on'); }, 2100);
  }

  /* ==================== 自研日历面板（CAL_UI_JS BEGIN）====================
     替代浏览器原生的日期弹层（依附输入框定位，会被 iframe 与 overflow 裁切）：
     会被 iframe 边界和 .dlg 的 overflow:auto 裁掉一块 → 表现为「日历不齐全」。
     本组件把弹层挂到 body 上、position:fixed 相对视口定位，不参与任何父级裁剪；
     月历恒定渲染 6 行 42 格，任何月份都完整。事件委托到 document，故对脑区同样生效。 */
  var CalPop = (function () {
    var pop = null, inp = null, cur = null, curT = '', view = null, mode = 'd', yR = 0, _today = null;
    var WK = ['一', '二', '三', '四', '五', '六', '日'];
    /* 常用时间点：预约/开会的高频整点与半点，点一下就填好，省得手打 */
    var QUICK_T = ['09:00', '10:00', '14:00', '14:30', '15:00', '16:00', '18:00', '20:00'];

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    /* 时间手输容错：1430 / 930 / 14:30 / 14.30 / 14：30 / 9:5 → HH:mm
       注意别用 match 结果的 length 判断形态 —— 它的长度是「完整匹配 + 捕获组数」，
       两个捕获组时是 3 而不是 2，按 length 分支会把 14:30 解析成 00:14。 */
    function normTime(s) {
      if (s === null || s === undefined) return '';
      s = String(s).trim();
      if (!s) return '';
      var h, mi, m = s.match(/^(\d{1,2})\s*[:：.．,，]\s*(\d{1,2})$/);
      if (m) { h = Number(m[1]); mi = Number(m[2]); }
      else {
        m = s.match(/^(\d{3,4})$/);
        if (!m) return '';
        var g = m[1];
        if (g.length === 3) { h = Number(g.slice(0, 1)); mi = Number(g.slice(1)); }
        else { h = Number(g.slice(0, 2)); mi = Number(g.slice(2)); }
      }
      if (isNaN(h) || isNaN(mi) || h < 0 || h > 23 || mi < 0 || mi > 59) return '';
      return pad(h) + ':' + pad(mi);
    }
    /* 弹层里的当前组合值：'YYYY-MM-DD' 或 'YYYY-MM-DD HH:mm' */
    function combo(d, t) {
      var k = d ? fkey(d) : '';
      if (!k) return '';
      t = t || '';
      return (t && !(t === '00:00')) ? (k + ' ' + t) : k;
    }
    function fkey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function sameD(a, b) {
      return !!a && !!b && a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    }
    function todayD() {
      if (_today) return new Date(_today.getFullYear(), _today.getMonth(), _today.getDate());
      var t = new Date();
      return new Date(t.getFullYear(), t.getMonth(), t.getDate());
    }
    /* 手输容错：2026-09-01 / 2026-9-1 / 2026/9/1 / 2026.9.1 / 2026年9月1日 / 20260901
       末尾允许跟一个时间点（手输「2026-09-01 14:30」也认，时间部分由 timeOf 单独取） */
    function parseStr(s) {
      if (s === null || s === undefined) return null;
      s = String(s).trim();
      if (!s) return null;
      var m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
           || s.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:\s*[T\s]\s*\d{1,2}\s*[:：.]\s*\d{1,2})?\s*$/);
      if (!m) return null;
      var y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]), d;
      if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
      d = new Date(y, mo - 1, da);
      if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null;
      return d;
    }
    function isCalInput(n) {
      return !!(n && n.getAttribute && n.getAttribute('data-cal') !== null);
    }
    function mk(n, c) {
      var e = document.createElement(n);
      if (c) e.className = c;
      return e;
    }

    function build() {
      if (pop) return;
      pop = mk('div', 'calpop');
      pop.id = 'calPop';
      if (pop.setAttribute) {
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', '选择日期');
      }
      /* 阻止默认 mousedown：输入框不丢焦点，点面板也不会走到「点外部即关闭」。
         但「时间」那个手输框例外 —— 它必须能点进去、能聚焦、能选字，
         若一并 preventDefault，时间框就成了点不动的摆设。 */
      pop.addEventListener('mousedown', function (e) {
        var t = e && e.target;
        var tag = (t && t.tagName) ? String(t.tagName).toUpperCase() : '';
        if (tag === 'INPUT') return;
        if (e && e.preventDefault) e.preventDefault();
      });
      pop.addEventListener('click', onClick);
      /* 时间手输框：填完（失焦或回车）即刻归一化并落值。
         1430 / 14:30 / 14.30 都认；认不出来就当作没填时间，绝不留坏值。 */
      pop.addEventListener('change', function (e) {
        var t = e && e.target;
        if (!t || !t.getAttribute || t.getAttribute('data-a') !== 'tin') return;
        onTimeInput(t);
      });
      pop.addEventListener('keydown', function (e) {
        if (!e || e.keyCode !== 13) return;
        var t = e.target;
        if (!t || !t.getAttribute || t.getAttribute('data-a') !== 'tin') return;
        onTimeInput(t);
      });
      if (document.body && document.body.appendChild) document.body.appendChild(pop);
    }

    /* 从 e.target 向上找最近的带某 data 属性的节点（不依赖 closest） */
    function hit(node, attr) {
      while (node && node !== pop) {
        if (node.getAttribute && node.getAttribute(attr) !== null) return node;
        node = node.parentNode;
      }
      return null;
    }

    function render() {
      var y = view.getFullYear(), m = view.getMonth(), t = todayD();
      var h = '', i, d, cls, lead, start, n;
      if (mode === 'y') {
        h += '<div class="ch"><button class="nb" data-a="yp" aria-label="上一年">‹</button>'
          + '<span class="tt" data-a="back">' + y + ' 年</span>'
          + '<button class="nb" data-a="yn" aria-label="下一年">›</button><span class="sp"></span>'
          + '<button class="nb" data-a="back" aria-label="返回日历">✓</button></div>'
          + '<div class="rng">' + yR + ' — ' + (yR + 15) + '</div><div class="gr">';
        for (i = 0; i < 16; i++) {
          n = yR + i;
          h += '<b data-y="' + n + '"' + (n === y ? ' class="on"' : '') + '>' + n + '</b>';
        }
        h += '</div>';
      } else if (mode === 'm') {
        h += '<div class="ch"><button class="nb" data-a="yp" aria-label="上一年">‹</button>'
          + '<span class="tt" data-a="back">' + y + ' 年</span>'
          + '<button class="nb" data-a="yn" aria-label="下一年">›</button><span class="sp"></span>'
          + '<button class="nb" data-a="back" aria-label="返回日历">✓</button></div><div class="gr">';
        for (i = 0; i < 12; i++) {
          h += '<b data-m="' + i + '"' + (i === m ? ' class="on"' : '') + '>' + (i + 1) + ' 月</b>';
        }
        h += '</div>';
      } else {
        h += '<div class="ch"><button class="nb" data-a="pm" aria-label="上个月">‹</button>'
          + '<span class="tt" data-a="ty" title="点击选择年月">' + y + ' 年 ' + (m + 1) + ' 月</span>'
          + '<button class="nb" data-a="nm" aria-label="下个月">›</button><span class="sp"></span>'
          + '<button class="nb" data-a="tm" aria-label="回到今天" title="回到今天">今</button></div>'
          + '<div class="cw">';
        for (i = 0; i < 7; i++) h += '<span' + (i > 4 ? ' class="wk"' : '') + '>' + WK[i] + '</span>';
        h += '</div><div class="cg">';
        lead = (new Date(y, m, 1).getDay() + 6) % 7;   /* 周一为第一列 */
        start = new Date(y, m, 1 - lead);
        for (i = 0; i < 42; i++) {                     /* 恒定 6 行 × 7 列 = 42 格 */
          d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
          cls = 'cd';
          if (d.getMonth() !== m) cls += ' out';
          if (d.getDay() === 0 || d.getDay() === 6) cls += ' wk';
          if (sameD(d, t)) cls += ' today';
          if (sameD(d, cur)) cls += ' sel';
          h += '<div class="' + cls + '" data-d="' + fkey(d) + '">' + d.getDate() + '</div>';
        }
        h += '</div>';
        h += timeRow();
      }
      h += '<div class="cf"><button data-a="today">今天</button>'
        + '<button data-a="clear">清空</button><span class="sp"></span>'
        + '<button data-a="close">关闭</button></div>';
      pop.innerHTML = h;
      return h;
    }

    /* 时间点选择行：一个手输框 + 「全天」开关 + 常用时间点。
       显示规则：默认全天（curT 为空）—— 只想选日期的老用法完全不受影响，
       要精确到点的再点一下时间即可。 */
    function timeRow() {
      var h = '<div class="ct"><span class="cl">时间</span>'
        + '<input class="tin" type="text" inputmode="numeric" autocomplete="off" data-a="tin"'
        + ' placeholder="HH:mm" value="' + esc(curT) + '" aria-label="时间点，可留空">'
        + '<button class="clr' + (curT ? '' : ' on') + '" data-a="tall">全天</button>'
        + '<span class="sp"></span></div>';
      h += '<div class="tc">';
      for (var i = 0; i < QUICK_T.length; i++) {
        h += '<b data-t="' + QUICK_T[i] + '"' + (curT === QUICK_T[i] ? ' class="on"' : '') + '>'
          + QUICK_T[i] + '</b>';
      }
      h += '</div>';
      var v = combo(cur, curT);
      h += '<div class="pv">' + (v ? ('已选 ' + esc(v)) : '未选择日期') + '</div>';
      return h;
    }

    function place() {
      if (!pop || !inp) return;
      var r = inp.getBoundingClientRect
        ? inp.getBoundingClientRect() : { left: 8, top: 8, bottom: 48, right: 8 };
      var W = pop.offsetWidth || 290, H = pop.offsetHeight || 340;
      var vw = window.innerWidth || 0, vh = window.innerHeight || 0;
      var l = r.left, t = r.bottom + 6;
      if (vw && l + W > vw - 8) l = vw - 8 - W;
      if (l < 8) l = 8;
      if (vh && t + H > vh - 8) {                 /* 下方放不下 → 上翻 */
        t = r.top - 6 - H;
        if (t < 8) t = vh - 8 - H;
      }
      if (t < 8) t = 8;
      pop.style.left = Math.round(l) + 'px';
      pop.style.top = Math.round(t) + 'px';
      return { left: pop.style.left, top: pop.style.top };
    }

    /* 写回输入框：值仍是 YYYY-MM-DD，既有保存逻辑零改动 */
    function setVal(v) {
      if (!inp) return;
      inp.value = v;
      try {
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) {
        try {
          if (document.createEvent) {
            var ev = document.createEvent('Event');
            ev.initEvent('change', true, false);
            inp.dispatchEvent(ev);
          }
        } catch (e2) {}
      }
    }

    /* 手输收口：合法归一成 'YYYY-MM-DD' 或 'YYYY-MM-DD HH:mm'，非法清空
       —— 绝不把坏值交给保存逻辑 */
    function normalize(input) {
      var raw = String(input.value || '').trim();
      if (!raw) { input.value = ''; return true; }
      var d = parseStr(raw);
      if (d) {
        var t = timeOf(raw);                       /* 手输的时间要带冒号，如 14:30 */
        input.value = t ? (fkey(d) + ' ' + t) : fkey(d);
        return true;
      }
      input.value = '';
      try { toast('日期格式无法识别，已清空（示例：2026-09-01 或 2026-09-01 14:30）'); } catch (e) {}
      return false;
    }

    function isOpen() {
      return !!(pop && pop.classList && pop.classList.contains('on'));
    }

    function open(input) {
      if (!isCalInput(input)) return false;
      build();
      if (!pop) return false;
      inp = input;
      cur = parseStr(input.value);
      curT = timeOf(input.value);                  /* 已有时间就带出来，方便微调 */
      var base = cur || todayD();
      view = new Date(base.getFullYear(), base.getMonth(), 1);
      yR = Math.floor(view.getFullYear() / 16) * 16;
      mode = 'd';
      render();
      pop.classList.add('on');
      place();
      if (input.setAttribute) input.setAttribute('aria-expanded', 'true');
      return true;
    }

    function close() {
      if (pop) pop.classList.remove('on');
      if (inp) {
        normalize(inp);
        if (inp.setAttribute) inp.setAttribute('aria-expanded', 'false');
      }
      inp = null; cur = null; curT = ''; mode = 'd';
      return true;
    }

    /* 落值。keepOpen=true 时只写入不关面板 —— 「先点日期、再点时间」才能连续操作；
       只要日期的老习惯也没变：点日期即刻生效，随手点面板外就关掉了。 */
    function commit(d, keepOpen) {
      var v = combo(d, curT);
      setVal(v);
      cur = d;
      if (keepOpen) {
        if (d) view = new Date(d.getFullYear(), d.getMonth(), 1);
        render(); place();
        return v;
      }
      close();
      return v;
    }

    /* 只改时间点：日期沿用当前选中（没选过就落到今天），点了即时生效 */
    function commitTime(t) {
      curT = (t === null || t === undefined) ? '' : String(t);
      if (!cur) {
        var b = todayD();
        cur = b;
        view = new Date(b.getFullYear(), b.getMonth(), 1);
      }
      return commit(cur, true);
    }

    /* 时间框的收口：认得出来就用它；认不出来退回「全天」并给一句提示，
       绝不把「1430」这种半成品写进输入框。 */
    function onTimeInput(el) {
      var raw = String((el && el.value) || '').trim();
      if (!raw) { commitTime(''); return; }
      var t = normTime(raw);
      if (!t) {
        try { toast('时间没认出（示例：14:30），已按全天处理'); } catch (e) {}
        commitTime('');
        return;
      }
      commitTime(t);
    }

    /* 键盘移动高亮日（按天位移） */
    function moveKey(step) {
      var base = cur || todayD();
      var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + step);
      cur = d;
      view = new Date(d.getFullYear(), d.getMonth(), 1);
      render(); place();
      return fkey(d);
    }

    function shiftMonth(n) {
      view.setMonth(view.getMonth() + n);
      render(); place();
      return view.getFullYear() + '-' + pad(view.getMonth() + 1);
    }
    function shiftYear(n) {
      view.setFullYear(view.getFullYear() + n);
      render(); place();
      return view.getFullYear();
    }
    function setMode(m) { mode = m; render(); place(); return mode; }
    function state() {
      return {
        open: isOpen(), mode: mode,
        view: view ? view.getFullYear() + '-' + pad(view.getMonth() + 1) : '',
        sel: cur ? fkey(cur) : '', value: inp ? inp.value : '',
        time: curT, combo: combo(cur, curT),
        cells: pop && pop.innerHTML ? (pop.innerHTML.match(/class="cd/g) || []).length : 0
      };
    }

    function onClick(e) {
      var tg = e && e.target;
      var el = hit(tg, 'data-t');
      if (el) { commitTime(el.getAttribute('data-t')); return; }
      el = hit(tg, 'data-d');
      /* 点日期只落值、不关面板（keepOpen），这样才能「选完日期接着点时间」；
         只要日期的老用法依旧一步到位：点日期即生效，随手点面板外就关掉了。 */
      if (el) { commit(parseStr(el.getAttribute('data-d')), true); return; }
      el = hit(tg, 'data-y');
      if (el) {
        view.setFullYear(Number(el.getAttribute('data-y')));
        mode = 'm';                       /* 选完年接着选月 */
        render(); place();
        return;
      }
      el = hit(tg, 'data-m');
      if (el) {
        view.setMonth(Number(el.getAttribute('data-m')));
        mode = 'd';
        render(); place();
        return;
      }
      el = hit(tg, 'data-a');
      if (!el) return;
      var a = el.getAttribute('data-a');
      if (a === 'tin') return;            /* 时间手输框：点击交给原生输入，不做拦截 */
      if (a === 'pm') shiftMonth(-1);
      else if (a === 'nm') shiftMonth(1);
      else if (a === 'yp') shiftYear(-1);
      else if (a === 'yn') shiftYear(1);
      else if (a === 'ty') setMode('m');
      else if (a === 'back') setMode('d');
      else if (a === 'tm') {
        var t1 = todayD();
        cur = t1;
        view = new Date(t1.getFullYear(), t1.getMonth(), 1);
        render(); place();
      } else if (a === 'tall') commitTime('');        /* 回到全天：把时间点撤掉 */
      else if (a === 'today') commit(todayD(), true);
      else if (a === 'clear') commit(null);
      else if (a === 'close') close();
    }

    /* 事件委托到 document：宿主与脑区 #brainZone 的日期框都能用 */
    if (document.addEventListener) {
      document.addEventListener('mousedown', function (e) {
        if (!isOpen()) return;
        var n = e.target;
        while (n) { if (n === pop) return; n = n.parentNode; }
        if (isCalInput(e.target)) return;     /* 换另一个日期框：交给 click 重开 */
        close();
      }, true);
      document.addEventListener('click', function (e) {
        if (isCalInput(e.target)) { e.preventDefault(); open(e.target); }
      }, true);
      document.addEventListener('focusin', function (e) {
        if (!isCalInput(e.target)) { if (isOpen()) close(); return; }
        if (e.target !== inp) open(e.target);
      });
      document.addEventListener('input', function (e) {
        if (!isCalInput(e.target) || !isOpen()) return;
        var d = parseStr(e.target.value);
        if (d) { cur = d; view = new Date(d.getFullYear(), d.getMonth(), 1); render(); place(); }
      }, true);
      document.addEventListener('keydown', function (e) {
        if (isOpen() && e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (!isCalInput(e.target)) return;
        var k = e.key, step = 0;
        if (k === 'Escape') { close(); return; }
        if (k === 'Enter') { e.preventDefault(); commit(cur || parseStr(e.target.value)); return; }
        if (k === 'PageUp' || k === 'PageDown') {
          e.preventDefault();
          if (!isOpen()) open(e.target);
          shiftMonth(k === 'PageUp' ? -1 : 1);
          return;
        }
        if (k === 'ArrowLeft') step = -1;
        else if (k === 'ArrowRight') step = 1;
        else if (k === 'ArrowUp') step = -7;
        else if (k === 'ArrowDown') step = 7;
        else return;
        e.preventDefault();
        if (!isOpen()) open(e.target);
        moveKey(step);
      }, true);
      window.addEventListener('resize', function () { if (isOpen()) place(); });
      window.addEventListener('scroll', function () { if (isOpen()) close(); }, true);
    }

    return {
      open: open, close: close, isOpen: isOpen, state: state, place: place,
      commit: commit, moveKey: moveKey, shiftMonth: shiftMonth, shiftYear: shiftYear,
      setMode: setMode, parse: parseStr, fkey: fkey, render: render,
      today: todayD, el: function () { return pop; },
      commitTime: commitTime, normTime: normTime, quick: QUICK_T,
      timeRow: timeRow, onTimeInput: onTimeInput,
      setToday: function (s) { _today = parseStr(s); return _today ? fkey(_today) : null; }
    };
  })();

  /* ==================== 存储层（SDK 优先，localStorage 兜底） ==================== */
  var Store = (function () {
    var db = (window.__SMART_PAGE__ && window.__SMART_PAGE__.database) ? window.__SMART_PAGE__.database : null;
    S.usingSDK = !!db;

    function lsAll() {
      try {
        var raw = localStorage.getItem(LS_ROWS);
        var arr = raw ? JSON.parse(raw) : [];
        return Object.prototype.toString.call(arr) === '[object Array]' ? arr : [];
      } catch (e) { return []; }
    }
    function lsSave(rows) {
      try { localStorage.setItem(LS_ROWS, JSON.stringify(rows)); } catch (e) {}
    }

    function loadAll(startCursor, acc, guard) {
      if (!db) return Promise.resolve(lsAll());
      acc = acc || []; guard = guard || 0;
      if (guard > 100) return Promise.resolve(acc);
      return db.query({ databaseId: DATABASE_ID, pageSize: 200, startCursor: startCursor })
        .then(function (result) {
          var list = (result && result.results) || [];
          acc = acc.concat(list);
          var next = result && result.nextCursor;
          if (result && result.hasMore && next && next !== startCursor && list.length) {
            return loadAll(next, acc, guard + 1);
          }
          return acc;
        });
    }

    /* 只读拉取「得到大脑·每日录音库」，供每周复盘的「主题精力分布」对照列使用。
       分页续页游标固定为 startCursor；失败时静默降级为空数组，不影响主台账功能。 */
    function loadLib(startCursor, acc, guard) {
      if (!db) return Promise.resolve([]);
      acc = acc || []; guard = guard || 0;
      if (guard > 100) return Promise.resolve(acc);
      return db.query({ databaseId: 'g0T2Bz3L9LmINPC1YhLPg6', pageSize: 200, startCursor: startCursor })
        .then(function (result) {
          var list = (result && result.results) || [];
          acc = acc.concat(list);
          var next = result && result.nextCursor;
          if (result && result.hasMore && next && next !== startCursor && list.length) {
            return loadLib(next, acc, guard + 1);
          }
          return acc;
        });
    }

    function addRow(props) {
      if (!db) {
        var rows = lsAll();
        props._id = 'L' + Date.now() + Math.floor(Math.random() * 1000);
        rows.push(props); lsSave(rows);
        return Promise.resolve({ id: props._id });
      }
      return db.addRecord({ databaseId: DATABASE_ID, properties: props });
    }

    function patchRow(id, props) {
      if (!db) {
        var rows = lsAll();
        for (var i = 0; i < rows.length; i++) {
          if (rows[i]._id === id) {
            for (var k in props) { if (Object.prototype.hasOwnProperty.call(props, k)) rows[i][k] = props[k]; }
          }
        }
        lsSave(rows);
        return Promise.resolve({ id: id });
      }
      return db.updateRecord({ databaseId: DATABASE_ID, recordId: id, properties: props });
    }

    function removeRow(id) {
      if (!db) {
        var rows = lsAll().filter(function (r) { return r._id !== id; });
        lsSave(rows);
        return Promise.resolve({});
      }
      return db.deleteRecord({ databaseId: DATABASE_ID, recordId: id });
    }

    function loadSchema() {
      if (!db) return Promise.resolve({ properties: [] });
      return db.getSchema({ databaseId: DATABASE_ID });
    }

    return { loadAll: loadAll, loadLib: loadLib, add: addRow, patch: patchRow, remove: removeRow, schema: loadSchema, hasDB: !!db };
  })();

  function setSync(state, text) {
    var dot = document.getElementById('syncDot');
    var txt = document.getElementById('syncTxt');
    if (dot) dot.className = 'dot ' + state;
    if (txt) txt.textContent = text;
  }

  /* ==================== 读取与刷新（唯一刷新入口） ==================== */
  var reloading = false;
  /* 录音库是只读的对照数据，只在首次进入时拉一次；拉取失败不阻断主流程 */
  function ensureLib() {
    if (S.libLoaded || !S.usingSDK) return Promise.resolve();
    return Store.loadLib().then(function (rows) {
      S.libRows = rows || [];
      S.libLoaded = true;
    }).catch(function () {
      S.libRows = [];
      S.libLoaded = true;
    });
  }

  function reload() {
    if (reloading) return Promise.resolve();
    reloading = true;
    setSync('wait', '同步中…');
    return Store.loadAll().then(function (rows) {
      S.rows = rows || [];
      S.empty = S.rows.length === 0;
      S.loadFailed = false;
      S.ready = true;
      reloading = false;
      if (S.usingSDK) setSync('ok', '已同步 · 资料库');
      else setSync('off', '未连接平台 · 仅本机');
      refreshAll();
      renderAlerts();
      return ensureLib().then(function () { renderReview(); });
    }).catch(function (err) {
      reloading = false;
      console.error('[workbench] 读取失败', err);
      S.rows = [];
      S.empty = false;
      S.loadFailed = true;
      S.ready = true;
      setSync('off', '同步失败 · 点重试');
      refreshAll();
      renderAlerts();
    });
  }

  function refreshAll() {
    renderNavCounts();
    renderDateStrip();
    renderPlanCal();
    renderKpis();
    renderPoolEntry();
    renderToday();
    renderTaskList();
    renderProjects();
    renderNotes();
    renderProjOptions();
    renderReview();
  }

  /* 台账为空时返回空数组——绝不拿假数据 / 占位数据充数，
     页面据 S.empty 渲染空态引导，用户看到的每一条都必须是自己真实的数据 */
  function view() { return S.rows; }

  /* 计算层：纯函数，只读数据 */
  function todayGroups() {
    var rows = view();
    var day = S.selDate || todayKey();
    var over = [], today = [], decide = [], done = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (typeOf(r) !== TYPE_TODO) continue;
      if (isDecide(r) && !isDone(r)) decide.push(r);
      if (isDone(r)) {
        if (stampKey(r['完成时间']) === day) done.push(r);
        continue;
      }
      if (isOverdue(r)) over.push(r);
      else if (planKey(r) === day || dueKey(r) === day) today.push(r);
    }
    return { over: over, today: today, decide: decide, done: done };
  }

  function projectIndex() {
    var rows = view();
    var ps = [], byName = {};
    var i, r;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (typeOf(r) !== TYPE_PROJ) continue;
      var item = { row: r, name: r['标题'] || '未命名项目', todos: [], notes: [] };
      ps.push(item);
      byName[item.name] = item;
    }
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      var pn = String(r['关联项目'] || '').trim();
      if (!pn) continue;
      if (!byName[pn]) {
        byName[pn] = { row: null, name: pn, todos: [], notes: [] };
        ps.push(byName[pn]);
      }
      if (typeOf(r) === TYPE_TODO) byName[pn].todos.push(r);
      else if (typeOf(r) === TYPE_NOTE) byName[pn].notes.push(r);
    }
    ps.sort(function (a, b) {
      var av = a.row ? 0 : 1, bv = b.row ? 0 : 1;
      if (av !== bv) return av - bv;
      return a.name.localeCompare(b.name, 'zh');
    });
    return ps;
  }

  function linksIn(text) {
    var out = [], re = /\[\[([^\[\]]{1,40})\]\]/g, m;
    while ((m = re.exec(String(text || ''))) !== null) {
      var t = m[1].trim();
      if (t && out.indexOf(t) === -1) out.push(t);
    }
    return out;
  }
  function linkTargetsAll() {
    var map = {}, rows = view();
    for (var i = 0; i < rows.length; i++) {
      var t = rows[i]['标题'];
      if (t) map[t] = rows[i];
    }
    return map;
  }
  function backlinksOf(title) {
    var rows = view(), out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r['标题'] === title) continue;
      var ls = linksIn(r['内容']).concat(linksIn(r['标题']));
      if (ls.indexOf(title) !== -1) out.push(r);
    }
    return out;
  }

  /* ==================== 渲染：导航 / 日期条 / KPI ==================== */
  function renderNavCounts() {
    var g = todayGroups();
    var el = document.querySelector('[data-cnt="today"]');
    if (el) el.textContent = String(g.over.length + g.today.length);
    var e2 = document.querySelector('[data-cnt="projects"]');
    if (e2) e2.textContent = String(projectIndex().length);
    var e3 = document.querySelector('[data-cnt="notes"]');
    if (e3) e3.textContent = String(notes().length);
    var e4 = document.querySelector('[data-cnt="review"]');
    if (e4) e4.textContent = String(weekDoneRows(S.weekOff).length);
  }

  function renderDateStrip() {
    var host = document.getElementById('dateStrip');
    if (!host) return;
    var rows = view();
    var base = S.selDate || todayKey();
    /* 一律走 mcTodayKey()：它优先返回注入的基准日（MC_TODAY），没注入时才退回真实今天。
       生产环境 MC_TODAY 为空，两者等价；但月历已经备了这套注入口，这里若直接用
       todayKey() 就会绕开它 —— 表现为「测试锁死了基准日，日期条的今天标记却仍在漂」。 */
    var tk = mcTodayKey();
    var html = '';
    for (var i = -3; i <= 3; i++) {
      var k = shiftKey(base, i);
      var n = 0;
      for (var j = 0; j < rows.length; j++) {
        var r = rows[j];
        if (typeOf(r) !== TYPE_TODO || isDone(r)) continue;
        if (planKey(r) === k || dueKey(r) === k) n++;
      }
      var isOn = k === base ? ' on' : '';
      var has = n > 0 ? ' has' : '';
      /* 标签与位置无关地判定：否则一旦「选中」不在正中（翻周后仍是正中，但未来
         若改成别的锚点）就会同时出现两个语义标签 */
      var lbl = k === tk ? '今天' : (k === base ? '选中' : wdLabel(k));
      html += '<button class="dchip' + isOn + has + '" data-day="' + k + '" type="button">' +
        '<span class="w">' + lbl + '</span>' +
        '<span class="d">' + Number(k.slice(5, 7)) + '/' + Number(k.slice(8, 10)) + '</span>' +
        '<span class="n">' + (n ? n + ' 项' : '—') + '</span></button>';
    }
    host.innerHTML = html;

    var hint = document.getElementById('stripHint');
    if (hint) {
      hint.textContent = '当前选中 ' + dLabel(base) + ' ' + wdLabel(base)
        + (base === tk ? '（今天）' : '（' + (base > tk ? '未来' : '已过') + '）')
        + ' · 两侧箭头按周翻动，整月排期看下方月历';
    }
    /* 输入框跟着选中日走：这是「提前把规划写进去」的落点，必须让人看见落在哪一天 */
    var qi = document.getElementById('quickInput');
    if (qi) {
      qi.placeholder = base === tk
        ? '快速记一条待办，回车即存（落在今天）'
        : '给 ' + dLabel(base) + ' 记一条待办，回车即存';
    }
  }

  /* ==================== 月历·排期视图（PLAN_CAL BEGIN）====================
     7 天快捷条只能看一周（用户反馈「日期没有办法看完」），故给一整月：
     · 恒定 6 行 × 42 格，任何月份都不缺格（与 CalPop 同一约定）
     · 每格显示当天排期条数：逾期红 / 常规粉 / 已完成灰点，点格子即选中该日
     · 「提前把规划写进去」＝选中未来某天，再用上面的输入框记一条
     · 折叠状态记在 localStorage['molly.plancal']，默认展开
     内嵌而非弹层：不需要点开就能看完，也不受 iframe 与父级 overflow 裁切。 */
  var MC_WK = ['一', '二', '三', '四', '五', '六', '日'];
  var MC_LS = 'molly.plancal';
  /* 「今天」可被测试注入（与 CalPop 同一手法）：冒烟脚本要能锁死一个基准日，
     否则断言会随运行日期漂移（周末/跨月/跨年时全红）*/
  var MC_TODAY = null;
  function mcTodayKey() { return MC_TODAY ? keyOf(MC_TODAY) : todayKey(); }
  function setMcToday(k) {
    MC_TODAY = k ? new Date(Number(String(k).slice(0, 4)), Number(String(k).slice(5, 7)) - 1, Number(String(k).slice(8, 10))) : null;
  }
  function planCalState() {
    var host = document.getElementById('planCal');
    var inner = (host && host.innerHTML) || '';
    return {
      open: !!S.calOpen, y: S.calY, m: S.calM,
      view: S.calY + '-' + pad(S.calM + 1),
      sel: S.selDate, today: mcTodayKey(),
      cells: (inner.match(/class="mc-cell/g) || []).length,
      title: (inner.match(/<b class="mcal-title">([^<]*)</) || ['', ''])[1]
    };
  }

  function mcReadOpen() {
    try {
      var v = window.localStorage ? window.localStorage.getItem(MC_LS) : null;
      return (v === null || v === undefined || v === '') ? true : v !== '0';
    } catch (e) { return true; }
  }
  function mcWriteOpen(on) {
    try { if (window.localStorage) window.localStorage.setItem(MC_LS, on ? '1' : '0'); } catch (e) {}
  }

  /* 某一天的排期负载：未完成（计划或截止落在这天）/ 其中已逾期 / 当天完成 */
  function dayLoadOf(k) {
    var rows = view(), tk = mcTodayKey();
    var open = 0, over = 0, done = 0, list = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (typeOf(r) !== TYPE_TODO) continue;
      if (isDone(r)) { if (stampKey(r['完成时间']) === k) done++; continue; }
      if (planKey(r) !== k && dueKey(r) !== k) continue;
      open++;
      if (k < tk) over++;
      list.push(r);
    }
    return { open: open, over: over, done: done, list: list };
  }

  function renderPlanDay(k) {
    var ld = dayLoadOf(k), tk = mcTodayKey();
    var h = '<div class="mcal-day"><div class="mcal-day-head">'
      + '<b>' + dLabel(k) + ' ' + wdLabel(k) + '</b>'
      + '<span class="meta">' + (k === tk ? '今天' : (k > tk ? '未来' : '已过'))
      + ' · 排期 ' + ld.open + ' 项'
      + (ld.done ? ' · 已完成 ' + ld.done + ' 项' : '')
      + (ld.over ? ' · 逾期 ' + ld.over + ' 项' : '') + '</span>'
      + '<span class="mcal-sp"></span>'
      + '<button class="btn sm pri" type="button" data-mc-act="add">给这天记一条</button>'
      + '</div>';
    if (!ld.list.length) {
      h += '<div class="mcal-day-list"><div class="mcal-empty">'
        + (k >= tk
          ? '这一天还没有安排 —— 点「给这天记一条」，或在上面输入框写一句，回车就落在 ' + dLabel(k) + '。'
          : '这一天没有留下未完成的记录。')
        + '</div></div>';
    } else {
      var n = Math.min(ld.list.length, 5);
      h += '<div class="mcal-day-list">';
      for (var i = 0; i < n; i++) {
        h += '<div class="mc-row' + (ld.over ? ' isover' : '') + '"><span class="mk"></span><span class="tx">'
          + esc(ld.list[i]['标题'] || '(无标题)') + '</span></div>';
      }
      if (ld.list.length > n) {
        h += '<div class="mcal-empty">还有 ' + (ld.list.length - n) + ' 项，切到这一天看全部。</div>';
      }
      h += '</div>';
    }
    return h + '</div>';
  }

  function renderPlanCal() {
    var host = document.getElementById('planCal');
    var btn = document.getElementById('btnCal');
    if (btn) {
      btn.textContent = S.calOpen ? '收起月历' : '月历';
      if (btn.setAttribute) btn.setAttribute('aria-expanded', S.calOpen ? 'true' : 'false');
    }
    if (!host) return;
    if (!S.calOpen) { host.className = 'mcal hide'; host.innerHTML = ''; return; }
    host.className = 'mcal';

    var sel = S.selDate || todayKey();
    var tk = mcTodayKey();
    /* 自愈：任何调用路径（含首屏、单元格数据变更触发的重渲染）都不会掉进 0 年 0 月 */
    if (!S.calY) { var p0 = String(sel).split('-'); S.calY = Number(p0[0]); S.calM = Number(p0[1]) - 1; }
    var y = S.calY, m = S.calM;
    var lead = (new Date(y, m, 1).getDay() + 6) % 7;      /* 周一为第一列 */
    var start = new Date(y, m, 1 - lead);
    var h = '<div class="mcal-head">'
      + '<button class="mcal-nav" type="button" data-mc-act="py" title="上一年" aria-label="上一年">«</button>'
      + '<button class="mcal-nav" type="button" data-mc-act="pm" title="上个月" aria-label="上个月">‹</button>'
      + '<b class="mcal-title">' + y + ' 年 ' + (m + 1) + ' 月</b>'
      + '<button class="mcal-nav" type="button" data-mc-act="nm" title="下个月" aria-label="下个月">›</button>'
      + '<button class="mcal-nav" type="button" data-mc-act="ny" title="下一年" aria-label="下一年">»</button>'
      + '<button class="mcal-dl" type="button" data-mc-act="today" title="回到今天所在月">今</button>'
      + '<span class="mcal-sp"></span>'
      + '<button class="mcal-hide" type="button" data-mc-act="collapse">收起</button>'
      + '</div><div class="mcal-wk">';
    for (var w = 0; w < 7; w++) h += '<span' + (w > 4 ? ' class="wk"' : '') + '>' + MC_WK[w] + '</span>';
    h += '</div><div class="mcal-grid">';
    for (var i = 0; i < 42; i++) {                        /* 恒定 6 行 × 7 列 = 42 格 */
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      var k = keyOf(d);
      var inM = d.getMonth() === m;
      var ld = inM ? dayLoadOf(k) : null;                 /* 邻月格子只做灰显补位，不显示负载 */
      var cls = 'mc-cell';
      if (!inM) cls += ' out';
      if (d.getDay() === 0 || d.getDay() === 6) cls += ' wk';
      if (k === tk) cls += ' today';
      if (k === sel) cls += ' sel';
      var badge = '';
      if (ld && ld.open) badge = '<b class="mc-badge' + (ld.over ? ' over' : '') + '">' + ld.open + '</b>';
      else if (ld && ld.done) badge = '<i class="mc-dot"></i>';
      h += '<button type="button" class="' + cls + '" data-mc="' + k + '">'
        + '<span class="mc-d">' + d.getDate() + '</span>' + badge + '</button>';
    }
    h += '</div><div class="mcal-legend">'
      + '<span class="it"><b class="mc-badge">3</b>当天排期 3 项</span>'
      + '<span class="it"><b class="mc-badge over">1</b>其中已逾期</span>'
      + '<span class="it"><i class="mc-dot"></i>当天已完成</span>'
      + '</div>';
    h += renderPlanDay(sel);
    host.innerHTML = h;
  }

  function setCalOpen(on, quiet) {
    S.calOpen = !!on;
    mcWriteOpen(S.calOpen);
    renderPlanCal();
    if (!quiet) toast(S.calOpen ? '月历已展开，可看整月排期' : '月历已收起');
  }

  /* 选中某一天：所有视图（7 天条 / 月历 / 今日推进 / 日报）都以 S.selDate 为准，
     故只改这一个状态再整体重渲染，避免出现「条上选中 9/25、列表还是 9/19」。 */
  function setSelDate(k) {
    if (!k) return;
    S.selDate = k;
    var p = String(k).split('-');
    S.calY = Number(p[0]);
    S.calM = Number(p[1]) - 1;
    refreshAll();
  }

  function focusQuick(msg) {
    var qi = document.getElementById('quickInput');
    if (qi && qi.focus) {
      qi.focus();
      toast(msg || ('写好回车，就落在 ' + dLabel(S.selDate || todayKey())));
    }
  }

  /* 从 e.target 向上找到最近的带某属性节点（与 CalPop 同一手法，不依赖 closest，
     便于无浏览器环境的冒烟桩驱动；真实 DOM 里也能走到 #planCal 为止） */
  function mcHit(node, attr) {
    var host = document.getElementById('planCal');
    while (node && node !== host) {
      if (node.getAttribute && node.getAttribute(attr) !== null) return node;
      node = node.parentNode;
    }
    return null;
  }

  function bindPlanCal() {
    var host = document.getElementById('planCal');
    if (host && host.addEventListener) {
      host.addEventListener('click', function (e) {
        var node = e && e.target;
        if (!node) return;
        var b = mcHit(node, 'data-mc');
        if (b) { setSelDate(b.getAttribute('data-mc')); return; }
        var a = mcHit(node, 'data-mc-act');
        if (!a) return;
        var act = a.getAttribute('data-mc-act');
        if (act === 'pm' || act === 'nm') {
          var d = new Date(S.calY, S.calM + (act === 'nm' ? 1 : -1), 1);
          S.calY = d.getFullYear(); S.calM = d.getMonth();
          renderPlanCal();
        } else if (act === 'py') { S.calY--; renderPlanCal(); }
        else if (act === 'ny') { S.calY++; renderPlanCal(); }
        else if (act === 'today') { setSelDate(mcTodayKey()); }
        else if (act === 'collapse') { setCalOpen(false); }
        else if (act === 'add') { focusQuick(); }
      });
    }
    var tp = document.getElementById('stripPrev');
    var tn = document.getElementById('stripNext');
    if (tp && tp.addEventListener) tp.addEventListener('click', function () { setSelDate(shiftKey(S.selDate || todayKey(), -7)); });
    if (tn && tn.addEventListener) tn.addEventListener('click', function () { setSelDate(shiftKey(S.selDate || todayKey(), 7)); });
    var cb = document.getElementById('btnCal');
    if (cb && cb.addEventListener) cb.addEventListener('click', function () { setCalOpen(!S.calOpen); });
  }
  /* ==================== 月历·排期视图（PLAN_CAL END）==================== */

  function renderKpis() {
    var g = todayGroups();
    var na = S.loadFailed;   /* 读不到 ≠ 没有：故障时显示「—」而不是 0 */
    var map = { kpiOver: g.over.length, kpiToday: g.today.length, kpiDecide: g.decide.length, kpiDone: g.done.length };
    for (var id in map) {
      if (!Object.prototype.hasOwnProperty.call(map, id)) continue;
      var el = document.getElementById(id);
      if (el) el.textContent = na ? '—' : String(map[id]);
    }
  }

  /* ==================== 公共渲染片段 ==================== */
  function icoCheck() {
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="M5 12.5 10 17.5 19 7.5"/></svg>';
  }
  function icoEdit() {
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="m14.5 5.5 4 4"/></svg>';
  }
  function icoTrash() {
    return '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M9.5 7V5h5v2M7 7l1 12h8l1-12"/></svg>';
  }
  function pillPri(r) {
    var p = r['优先级'] || '';
    if (!p) return '';
    var cls = p.indexOf('P0') === 0 ? 'p0' : (p.indexOf('P1') === 0 ? 'p1' : 'p2');
    return '<span class="pill ' + cls + '">' + esc(p) + '</span>';
  }
  function metaLine(r) {
    var out = '';
    if (r['来源']) out += '<span class="pill src">' + esc(r['来源']) + '</span>';
    if (r['关联项目']) out += '<span class="pill proj">' + esc(r['关联项目']) + '</span>';
    var dk = dueKey(r);
    /* 有具体时间点的就把时间一起显示出来（下午 14:30 约的事，光看日期看不出来） */
    if (dk && !isDone(r)) out += '<span class="pill' + (dk < todayKey() ? ' due' : '') + '">截止 ' + esc(dtFriendly(r['截止日期'])) + '</span>';
    var pk = dayKey(r['计划日期']);
    if (pk && pk !== dk) out += '<span class="pill">计划 ' + esc(dtFriendly(r['计划日期'])) + '</span>';
    var n = Number(r['顺延次数'] || 0);
    if (n > 0) out += '<span class="pill">顺延 ' + n + ' 次</span>';
    if (r['关联人物']) out += '<span class="pill">' + esc(r['关联人物']) + '</span>';
    return out;
  }
  /* opts.withDate：任务清单里用 —— 每条挂一个只读日期框，点开走同一个日历面板改期。
     放进操作区而不是另加按钮，是为了「看见日期就能改」，少一次点击。 */
  function itemHTML(r, opts) {
    var done = isDone(r) ? ' isdone' : '';
    var over = isOverdue(r) ? ' over' : '';
    var dec = (isDecide(r) && !isDone(r)) ? ' dec' : '';
    var title = esc(r['标题'] || '(无标题)');
    var dateCtl = '';
    if (opts && opts.withDate && typeOf(r) === TYPE_TODO && !done) {
      var pk = dtText(r['计划日期'] || r['截止日期']);
      dateCtl = '<span class="tl-dt"><input type="text" inputmode="numeric" autocomplete="off" readonly'
        + ' data-cal="1" data-rs="' + esc(r._id) + '" value="' + esc(pk) + '" placeholder="未排期"'
        + ' aria-label="改期" title="点开选日期与时间点，改完日历与当日清单同步">'
        + '<svg class="cico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/></svg></span>';
    }
    return '<div class="item' + done + over + dec + '" data-id="' + esc(r._id) + '">' +
      '<button class="chk' + (done ? ' on' : '') + '" data-act="toggle" data-id="' + esc(r._id) + '" aria-label="切换完成">' + icoCheck() + '</button>' +
      '<div class="t-body">' +
        '<div class="t-title"><span data-k="标题" data-sp-bindable="database" data-sp-database-id="ggytTE4Cvh4Nyi3nBAcdxD">' + title + '</span>' +
        (isDecide(r) && !isDone(r) ? '<span class="pill dec">待决策</span>' : '') + pillPri(r) + '</div>' +
        '<div class="t-meta" data-k="状态" data-sp-bindable="database" data-sp-database-id="ggytTE4Cvh4Nyi3nBAcdxD">' + metaLine(r) + '</div>' +
        (isDone(r) && r['完成结果'] ? '<div class="t-result" data-act="expand" data-id="' + esc(r._id) + '" title="完成结果，点击展开/收起">' + esc(r['完成结果']) + '</div>' : '') +
      '</div>' +
      '<div class="t-acts">' + dateCtl +
        '<button class="iBtn" data-act="edit" data-id="' + esc(r._id) + '" aria-label="编辑">' + icoEdit() + '</button>' +
        '<button class="iBtn dz" data-act="del" data-id="' + esc(r._id) + '" aria-label="删除">' + icoTrash() + '</button>' +
      '</div></div>';
  }
  function groupHTML(cls, label, list, emptyTxt) {
    var body = list.length
      ? list.map(itemHTML).join('')
      : '<div class="mini muted" style="padding:6px 2px">' + emptyTxt + '</div>';
    return '<div class="group ' + cls + '"><div class="group-head"><span class="tag">' + esc(label) + '</span>' +
      '<span data-sp-bindable="database" data-sp-database-id="ggytTE4Cvh4Nyi3nBAcdxD">' + list.length + ' 项</span></div>' + body + '</div>';
  }

  function renderToday() {
    var host = document.getElementById('todayList');
    if (!host) return;
    var g = todayGroups();
    renderTodayFocus(g);
    var html = '';
    if (g.over.length) html += groupHTML('g-over', '逾期未完成', g.over, '');
    html += groupHTML('g-today', '当日待办', g.today,
      S.empty ? '台账还是空的。点上方提示条里的「去待办仓库领取」，或用这个输入框记一条。'
              : '这一天没有待办，上面的输入框可以随时记一条。');
    if (g.decide.length) html += groupHTML('g-dec', '待上级决策（卡在别人身上）', g.decide, '');
    if (g.done.length) html += groupHTML('g-done', '当日已完成', g.done, '');
    host.innerHTML = html;

    var sub = document.getElementById('pageSub');
    if (sub) {
      var d = S.selDate || todayKey();
      sub.textContent = dLabel(d) + ' ' + wdLabel(d) + ' · 逾期 ' + g.over.length + ' · 待办 ' + g.today.length + ' · 待决策 ' + g.decide.length + ' · 已完成 ' + g.done.length;
    }
  }

  function focusScore(r) {
    var p = String(r['优先级'] || '');
    var score = p.indexOf('P0') === 0 ? 300 : (p.indexOf('P1') === 0 ? 200 : 100);
    if (isOverdue(r)) score += 80;
    if (dueKey(r) === todayKey()) score += 35;
    return score;
  }

  function renderTodayFocus(g) {
    var host = document.getElementById('todayFocus');
    if (!host) return;
    var candidates = g.over.concat(g.today).filter(function (r) { return !isDone(r) && !isDecide(r); });
    candidates.sort(function (a, b) { return focusScore(b) - focusScore(a); });
    var top = candidates.slice(0, 3);
    var h = '<div class="focus-panel"><div class="focus-kicker">今日最重要 3 件事</div>';
    if (!top.length) {
      h += '<div class="focus-empty">今天没有待推进事项。可以快速记一条，或从待办仓库领取。</div>';
    } else {
      for (var i = 0; i < top.length; i++) {
        var r = top[i];
        var meta = [];
        if (r['优先级']) meta.push(r['优先级']);
        if (r['关联项目']) meta.push(r['关联项目']);
        if (r['关联人物']) meta.push(r['关联人物']);
        h += '<div class="focus-row"><span class="focus-rank">' + (i + 1) + '</span><div class="focus-copy">'
          + '<div class="focus-title">' + esc(r['标题'] || '(无标题)') + '</div>'
          + '<div class="focus-meta">' + esc(meta.join(' · ') || '今日推进') + '</div></div></div>';
      }
    }
    h += '</div><div class="focus-panel attn"><div class="focus-kicker">需要关注</div>'
      + '<div class="focus-counts"><span class="focus-count">逾期 <b>' + g.over.length + '</b></span>'
      + '<span class="focus-count">待决策 <b>' + g.decide.length + '</b></span>'
      + '<span class="focus-count">今日完成 <b>' + g.done.length + '</b></span></div>'
      + '<div class="focus-empty" style="margin-top:9px">先处理阻塞与决策，再进入普通任务；完成后下方清单会自动同步。</div></div>';
    host.innerHTML = h;
  }

  /* ==================== 任务清单（TASKLIST_JS BEGIN）====================
     同一个主台账的跨日期视图。分组全部从 planKey()/isDone() 推导，不引入任何独立存储
     —— 所以清单、月历、「今天要处理」说的永远是同一件事（改一处三处同步）。
     为什么需要它：「今天要处理」只看得到选中日一天，排到别的日期的任务没有管理入口。 */
  var TV_KEYS = { open: 1, week: 1, unsched: 1, done: 1 };
  var TV_LS = 'molly.taskview';

  function tvRead() {
    try {
      var v = window.localStorage ? window.localStorage.getItem(TV_LS) : '';
      return TV_KEYS[v] ? v : 'open';
    } catch (e) { return 'open'; }
  }

  function setTaskView(v) {
    if (!TV_KEYS[v]) return;
    S.taskView = v;
    try { if (window.localStorage) window.localStorage.setItem(TV_LS, v); } catch (e) {}
    renderTaskList();
  }

  /* 分组：逾期 / 按落点日期升序 / 未排期 / 已完成（完成时间倒序）。
     逾期项单独成组、不再按日期重复出现 —— 与「今天要处理」的分组口径一致。 */
  function taskGroups() {
    var rows = view(), tk = todayKey();
    var over = [], noPlan = [], done = [], map = {}, keys = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (typeOf(r) !== TYPE_TODO) continue;
      if (isDone(r)) { done.push(r); continue; }
      var k = planKey(r);
      if (!k) { noPlan.push(r); continue; }
      if (k < tk) { over.push(r); continue; }
      if (!map[k]) { map[k] = []; keys.push(k); }
      map[k].push(r);
    }
    keys.sort();
    done.sort(function (a, b) { return Number(b['完成时间'] || 0) - Number(a['完成时间'] || 0); });
    var days = [];
    for (var j = 0; j < keys.length; j++) days.push({ key: keys[j], list: map[keys[j]] });
    return { over: over, days: days, noPlan: noPlan, done: done };
  }

  /* done 视图二级分组：主题(T01–T12) → 组内按「关联项目」归类，项目内完成时间倒序。
     两次稳定排序：先完成时间倒序，再按项目名归组 —— 相同项目自然相邻且保持时间次序。
     空主题归「未分类」且永远排最后；组内无项目的记录排最后。 */
  function groupDoneByTheme(done) {
    var byTheme = {}, order = [];
    for (var i = 0; i < done.length; i++) {
      var r = done[i];
      var k = String(r['主题'] || '').trim() || '未分类';
      if (!byTheme[k]) { byTheme[k] = []; order.push(k); }
      byTheme[k].push(r);
    }
    order.sort(function (a, b) {
      if (a === '未分类') return 1;
      if (b === '未分类') return -1;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
    var out = [];
    for (var j = 0; j < order.length; j++) {
      var list = byTheme[order[j]].slice().sort(function (a, b) {
        return Number(b['完成时间'] || 0) - Number(a['完成时间'] || 0);
      });
      var keyed = [];
      for (var m = 0; m < list.length; m++) keyed.push({ p: String(list[m]['关联项目'] || '').trim(), r: list[m] });
      keyed.sort(function (a, b) {
        if (!a.p) return 1;
        if (!b.p) return -1;
        return a.p < b.p ? -1 : (a.p > b.p ? 1 : 0);
      });
      out.push({ theme: order[j], list: keyed.map(function (x) { return x.r; }) });
    }
    return out;
  }

  function tlGroupHTML(label, hint, list) {
    var body = '';
    for (var i = 0; i < list.length; i++) body += itemHTML(list[i], { withDate: true });
    return '<div class="group"><div class="group-head"><span class="tag">' + esc(label) + '</span>'
      + '<span class="tl-hint">' + esc(hint || '') + '</span></div>' + body + '</div>';
  }

  function renderTaskList() {
    var host = document.getElementById('taskList');
    if (!host) return;
    var v = TV_KEYS[S.taskView] ? S.taskView : 'open';

    var seg = document.getElementById('taskViews');
    if (seg && seg.querySelectorAll) {
      var bs = seg.querySelectorAll('button[data-tv]');
      for (var b = 0; b < bs.length; b++) {
        var tv = bs[b].getAttribute ? bs[b].getAttribute('data-tv') : '';
        if (tv === v) { if (bs[b].classList) bs[b].classList.add('on'); }
        else { if (bs[b].classList) bs[b].classList.remove('on'); }
      }
    }

    var cnt = document.getElementById('taskCnt');
    /* 读不到 ≠ 没有：故障时报「—」，绝不显示「0 项」（那会让用户以为清单被清空了） */
    if (S.loadFailed) {
      host.innerHTML = '<div class="tl-empty">读取资料库失败，暂时看不到清单。恢复网络后点上方提示条里的「重试」。</div>';
      if (cnt) cnt.textContent = '—';
      return;
    }

    var g = taskGroups(), tk = todayKey(), html = '', n = 0, i, d;

    if (v === 'done') {
      if (!g.done.length) html = '<div class="tl-empty">还没有已完成的任务。在任意列表里勾选左侧圆圈，这里就会留下记录。</div>';
      else {
        var dg = groupDoneByTheme(g.done);
        for (i = 0; i < dg.length; i++)
          html += tlGroupHTML(dg[i].theme, dg[i].list.length + ' 项 · 组内按项目归类、完成时间倒序', dg[i].list);
        n = g.done.length;
      }
    } else if (v === 'unsched') {
      if (!g.noPlan.length) html = '<div class="tl-empty">没有「未排期」的任务 —— 每条都已经有落点日期。</div>';
      else { html = tlGroupHTML('未排期', '还没有落点日期 · ' + g.noPlan.length + ' 项', g.noPlan); n = g.noPlan.length; }
    } else if (v === 'week') {
      var end = shiftKey(tk, 6);
      if (g.over.length) { html += tlGroupHTML('逾期未完成', '已过落点日期 · ' + g.over.length + ' 项', g.over); n += g.over.length; }
      for (i = 0; i < g.days.length; i++) {
        d = g.days[i];
        if (d.key < tk || d.key > end) continue;
        html += tlGroupHTML(dLabel(d.key) + ' ' + wdLabel(d.key) + (d.key === tk ? ' · 今天' : ''),
          d.list.length + ' 项', d.list);
        n += d.list.length;
      }
      if (!n) html = '<div class="tl-empty">未来 7 天还没有排期。用上面的月历点一天，或在这里给任务改个日期。</div>';
    } else {
      if (g.over.length) { html += tlGroupHTML('逾期未完成', '已过落点日期 · ' + g.over.length + ' 项', g.over); n += g.over.length; }
      for (i = 0; i < g.days.length; i++) {
        d = g.days[i];
        html += tlGroupHTML(dLabel(d.key) + ' ' + wdLabel(d.key) + (d.key === tk ? ' · 今天' : ''),
          d.list.length + ' 项', d.list);
        n += d.list.length;
      }
      if (g.noPlan.length) { html += tlGroupHTML('未排期', '还没有落点日期 · ' + g.noPlan.length + ' 项', g.noPlan); n += g.noPlan.length; }
      if (!n) {
        html = S.empty
          ? '<div class="tl-empty">主台账还是空的 —— 从「得到大脑 · 待办仓库」领取，或在上面的输入框记一条。</div>'
          : '<div class="tl-empty">没有未完成的任务了。点上面的月历给未来排一天，或在输入框随手记一条。</div>';
      }
    }
    host.innerHTML = html;
    if (cnt) cnt.textContent = n + ' 项';
  }

  /* 行内改期：写回主台账的「计划日期」—— 这是唯一的排期权威字段。
     月历格子、当日清单、本清单都从它推导，所以改一处三处同步，不需要额外写日历。 */
  function reschedule(id, k) {
    var rows = view(), row = null;
    for (var i = 0; i < rows.length; i++) if (String(rows[i]._id) === String(id)) row = rows[i];
    if (!row) { toast('找不到这条记录了，刷新看看'); return; }
    var kd = dayKey(k), kt = timeOf(k);
    if (!kd) return;
    /* 日期和时间点都比一遍才算「没变」——只比日期会把「仅调时间点」误判成没改 */
    if ((dayKey(row['计划日期']) || '') === kd && timeOf(row['计划日期']) === kt) return;
    Store.patch(row._id, {
      '计划日期': { date: toApiDate(k) }, '更新时间': { number: nowStamp() }
    }).then(function () {
      toast('已改到 ' + dtFriendly(k) + ' ' + wdLabel(kd) + '，日历同步更新');
      return reload();
    }).catch(function () { toast('改期失败，请重试'); });
  }

  function bindTaskList() {
    var host = document.getElementById('taskList');
    if (host && host.addEventListener) {
      /* 操作按钮（勾完成 / 编辑 / 删除）走与「今天要处理」同一个 onItemAction ——
         两处说的是同一批记录，动作必须同一套。
         早先这里只绑了 change，于是清单里的按钮全是死的：点了没反应、也没报错。 */
      host.addEventListener('click', onItemAction);
      /* 事件委托：日期框由日历面板写回后派发 change，冒泡到这里统一处理 */
      host.addEventListener('change', function (e) {
        var t = e && e.target;
        if (!t || !t.getAttribute) return;
        var id = t.getAttribute('data-rs');
        if (!id) return;
        if (!String(t.value || '').trim()) {
          toast('任务要保留一个落点日期 —— 换一天即可，不支持清空');
          renderTaskList();
          return;
        }
        reschedule(id, String(t.value).trim());
      });
    }
    var seg = document.getElementById('taskViews');
    if (seg && seg.addEventListener) {
      seg.addEventListener('click', function (e) {
        var n = e && e.target;
        while (n && n !== seg) {
          if (n.getAttribute && n.getAttribute('data-tv')) break;
          n = n.parentNode;
        }
        if (!n || n === seg) return;
        setTaskView(n.getAttribute('data-tv'));
      });
    }
    /* 整理重复：判定口径是「同一条待办仓库记录被领进来多次」，不是标题相同就算重复
       —— 不同录音里真的可能有两件同名的事。零信息损失：删掉的和留下的内容完全一致。 */
    var dedup = document.getElementById('btnDedupe');
    if (dedup && dedup.addEventListener) {
      dedup.addEventListener('click', function () {
        var br = window.__BR__;
        if (!br || typeof br.findDups !== 'function') { toast('这个动作要在完整工作台里用'); return; }
        toast('正在检查重复…');
        br.findDups().then(function (rep) {
          if (!rep || !rep.groups) { toast('没有发现重复记录'); return; }
          askConfirm({
            title: '清理重复记录',
            text: '发现 ' + rep.groups + ' 组重复，共 ' + rep.extra + ' 条多余记录。\n\n' +
              '保留规则：每组留一条 —— 优先留已勾完成的（保住进度），否则留最早创建的那条。\n' +
              '被删掉的记录与保留项逐字段一致，不会丢信息。',
            yes: '确认清理'
          }, function (ok) {
            if (!ok) return;
            br.sweepDups().then(function (n) {
              toast(n ? ('已清理 ' + n + ' 条重复记录') : '没有需要清理的');
              return reload();
            });
          });
        }).catch(function () { toast('检查失败，请稍后重试'); });
      });
    }
  }
  /* ==================== 任务清单（TASKLIST_JS END）==================== */

  function renderProjOptions() {
    var dl = document.getElementById('projList');
    if (!dl) return;
    var names = [], ps = projectIndex();
    for (var i = 0; i < ps.length; i++) if (names.indexOf(ps[i].name) === -1) names.push(ps[i].name);
    var seen = {}, extra = view();
    for (var j = 0; j < extra.length; j++) {
      var pn = String(extra[j]['关联项目'] || '').trim();
      if (pn && names.indexOf(pn) === -1) names.push(pn);
    }
    dl.innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '"></option>'; }).join('');
  }

  /* ==================== 告警条 ==================== */
  function renderAlerts() {
    var host = document.getElementById('alertHost');
    if (!host) return;
    var html = '';
    /* 读不到数据 ≠ 没有数据：两者必须分开展示，否则会把「连不上」误报成「空台账」 */
    if (S.loadFailed) {
      html += '<div class="bar off"><b>读取资料库失败</b>　已切到离线模式，页面不展示数据。' +
        '恢复网络后点「重试」重新同步。<span class="spacer"></span>' +
        '<button class="btn sm" data-alert="retry">重试</button></div>';
    } else if (S.empty) {
      html += '<div class="bar empty"><b>主台账还是空的</b>　这里的数据有两条来路：从「得到大脑 · 待办仓库」领取，或自己新建一条。' +
        '<span class="spacer"></span>' +
        '<button class="btn sm pri" data-alert="goPool">去待办仓库领取</button>' +
        '<button class="btn sm" data-alert="newFirst">新建一条</button></div>';
    }
    if (!S.usingSDK) {
      html += '<div class="bar off">未连接平台 · <b>仅本机</b>　这次打开没拿到资料库数据通道，读不到云端数据' +
        '（常见于直接打开本地 HTML 文件，或不在 WorkBuddy 里打开）。请从「资料库」的页面列表打开线上页面。</div>';
    }
    var lastBackup = 0;
    try { lastBackup = Number(window.localStorage && window.localStorage.getItem('molly.lastBackup') || 0); } catch (e) {}
    var backupDue = !lastBackup || (Date.now() - lastBackup > 7 * 86400000);
    if (S.rows.length >= 30 && backupDue) {
      html += '<div class="bar backup"><b>建议备份</b>　已有 ' + S.rows.length + ' 条数据，且超过 7 天未导出备份。' +
        '<span class="spacer"></span><button class="btn sm" data-alert="hideBackup">稍后提醒</button></div>';
    }
    host.innerHTML = html;
  }

  /* ==================== 初始化 ==================== */
  function init() {
    S.selDate = todayKey();
    var p0 = S.selDate.split('-');
    S.calY = Number(p0[0]); S.calM = Number(p0[1]) - 1;
    S.calOpen = mcReadOpen();
    S.taskView = tvRead();
    bindShell();
    bindHashRoute();
    var h0 = tabFromHash();
    if (h0 && h0 !== 'today') switchTab(h0);
    Store.schema().then(function (schema) {
      var props = (schema && schema.properties) || [];
      for (var i = 0; i < props.length; i++) {
        var f = props[i];
        if ((f.type === 'select' || f.type === 'multi_select') && f.config && f.config.options) {
          S.schemaOpts[f.name] = f.config.options;
        }
      }
      fillSelects();
      bindDbUpdates();
      return reload();
    }).catch(function (err) {
      console.error('[workbench] schema 失败', err);
      fillSelects();
      bindDbUpdates();
      return reload();
    });
  }

  function bindDbUpdates() {
    var db = (window.__SMART_PAGE__ && window.__SMART_PAGE__.database) ? window.__SMART_PAGE__.database : null;
    if (!db || typeof db.onUpdated !== 'function') return;
    var timer = null;
    db.onUpdated(function (payload) {
      var ids = (payload && payload.databaseIds) || [];
      if (ids.indexOf(DATABASE_ID) === -1) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; reload(); }, 300);
    });
  }

  /* 提供给后续模块使用的最小接口 */
  window.__WB__ = {
    S: S, Store: Store, reload: reload, refreshAll: refreshAll, toast: toast,
    todayKey: todayKey, shiftKey: shiftKey, keyOf: keyOf, dLabel: dLabel, dayKey: dayKey,
    isDone: isDone, isDecide: isDecide, typeOf: typeOf, todos: todos, projects: projects,
    notes: notes, view: view, tagsOf: tagsOf, esc: esc,
    planKey: planKey, dueKey: dueKey, isOverdue: isOverdue, stampKey: stampKey, linksIn: linksIn,
    /* 时间点支持（v19）：日期与「几点几分」的统一口径，宿主与脑区共用同一套规则 */
    timeOf: timeOf, dtText: dtText, dtFriendly: dtFriendly, toApiDate: toApiDate,
    reschedule: reschedule,
    linkTargetsAll: linkTargetsAll, backlinksOf: backlinksOf, DATABASE_ID: DATABASE_ID,
    fillSelects: function () {}, setSync: setSync, renderAlerts: renderAlerts,
    TYPE_TODO: TYPE_TODO, TYPE_PROJ: TYPE_PROJ, TYPE_NOTE: TYPE_NOTE, nowStamp: nowStamp,
    Cal: CalPop,
    /* 月历·排期视图：暴露给冒烟测试驱动（无浏览器内核时也能走真事件验收） */
    PlanCal: {
      render: renderPlanCal, setSelDate: setSelDate, setOpen: setCalOpen,
      dayLoad: dayLoadOf, readOpen: mcReadOpen, el: function () { return document.getElementById('planCal'); },
      wdLabel: wdLabel, shift: shiftKey,
      state: planCalState, setToday: setMcToday, todayKey: mcTodayKey
    },
    /* 任务清单（跨日期总览 + 行内改期）：同样暴露，便于无浏览器环境走真事件验收 */
    TaskList: {
      render: renderTaskList, setView: setTaskView, readView: tvRead,
      groups: taskGroups, resched: reschedule, wdLabel: wdLabel, dLabel: dLabel,
      el: function () { return document.getElementById('taskList'); }
    },
    /* 删除后要把来源仓库项退回「待领取」，冒烟里要单独验这条链路 */
    releasePool: releasePool,
    deleteRow: deleteRow,
    onItemAction: onItemAction,
    /* 项目推进台：卡片动作 + 改名联动，都要能走真事件验收 */
    renderProjects: renderProjects, onProjectAction: onProjectAction, projectIndex: projectIndex,
    openRename: openRename, closeRename: closeRename, doRename: doRename,
    renameAffected: renameAffected, renameLinked: renameLinked,
    projEl: function () { return document.getElementById('projectList'); },
    /* 整理项目：归并算法是纯函数，冒烟里可以直接验；合并走真事件 */
    ProjMerge: {
      open: openProjMerge, close: closeProjMerge, render: renderProjMerge,
      suggest: projSuggest, items: projMergeItems, pickKeep: pickKeep,
      kind: projKind, reason: projPairReason, merge: mergeProj, doIt: doProjMerge,
      state: function () { return pjState; },
      el: function () { return document.getElementById('pjList'); }
    },
    /* 防重复（内联提示 + 保存拦截）与通用确认弹窗，都要能走真事件验收 */
    similarProj: similarProj, renderProjHint: renderProjHint, bindProjHint: bindProjHint,
    askConfirm: askConfirm, closeConfirm: closeConfirm, saveEditNow: saveEditNow,
    currentPj: currentPj,
    /* 今日焦点卡（今日最重要 3 件事 + 需要关注）：暴露给冒烟直接驱动，验双向文案 */
    TodayFocus: {
      render: renderTodayFocus, today: renderToday, score: focusScore,
      el: function () { return document.getElementById('todayFocus'); }
    }
  };

  var FALLBACK_OPTS = {
    '类型': ['待办', '项目', '沉淀'],
    '状态': ['待处理', '进行中', '已完成', '已搁置'],
    '优先级': ['P0 紧急', 'P1 重要', 'P2 常规'],
    '来源': ['张董', '英董', '赖总', '各部门', '外部机构', '自己发起']
  };

  function optsOf(field) {
    var o = S.schemaOpts[field];
    if (o && o.length) {
      var out = [];
      for (var i = 0; i < o.length; i++) out.push({ id: o[i].id, text: o[i].text, value: o[i].id });
      return out;
    }
    var fb = FALLBACK_OPTS[field] || [];
    var arr = [];
    for (var j = 0; j < fb.length; j++) arr.push({ id: '', text: fb[j], value: fb[j] });
    return arr;
  }

  function fillSelects() {
    var defs = {
      'e-type': '类型', 'e-status': '状态', 'e-priority': '优先级', 'e-source': '来源'
    };
    for (var id in defs) {
      if (!Object.prototype.hasOwnProperty.call(defs, id)) continue;
      var el = document.getElementById(id);
      if (!el) continue;
      var opts = optsOf(defs[id]);
      var h = '<option value="">未设置</option>';
      for (var i = 0; i < opts.length; i++) {
        h += '<option value="' + esc(opts[i].value) + '" data-text="' + esc(opts[i].text) + '">' + esc(opts[i].text) + '</option>';
      }
      el.innerHTML = h;
    }
  }

  function bindShell() {
    document.getElementById('nav').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]');
      if (b) switchTab(b.getAttribute('data-tab'));
    });
    document.getElementById('tabbar').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]');
      if (b) switchTab(b.getAttribute('data-tab'));
    });
    document.getElementById('dateStrip').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-day]');
      if (!b) return;
      /* 走 setSelDate 而非直接改 S.selDate：月历视图必须跟着选中的月份走 */
      setSelDate(b.getAttribute('data-day'));
    });
    document.getElementById('btnToday').addEventListener('click', function () {
      setSelDate(mcTodayKey());   /* 同时把月历视图拉回今天所在月，避免「选中今天但月历还停在 12 月」 */
    });
    document.getElementById('todayList').addEventListener('click', onItemAction);
    document.getElementById('alertHost').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-alert]');
      if (!b) return;
      var a = b.getAttribute('data-alert');
      /* 「去待办仓库领取」：合并页里待办仓库是同页的 Tab；源页里它是独立页面 → 走外链 */
      if (a === 'goPool') {
        if (document.getElementById('pane-pool') && typeof switchTab === 'function') switchTab('pool');
        else if (typeof window.open === 'function') window.open(BRAIN_URL, '_blank');
        return;
      }
      if (a === 'newFirst') {
        var qi = document.getElementById('quickInput');
        if (qi && qi.focus) { qi.focus(); toast('写一句就行，回车即存'); }
        else if (typeof openEdit === 'function') openEdit(null);
        return;
      }
      if (a === 'retry') { reload(); return; }
      if (a === 'hideBackup') { b.closest('.bar').classList.add('hide'); }
    });
    document.getElementById('btnExport').addEventListener('click', doExport);
    document.getElementById('btnImport').addEventListener('click', function () {
      document.getElementById('fileImport').click();
    });
    document.getElementById('fileImport').addEventListener('change', doImport);

    bindQuickAdd();
    bindEditDialog();
    bindDailyDialog();
    bindReviewDialog();
    bindModalBasics();
    bindPlanCal();
  }

  /* Tab 深链：让「得到大脑」页或任意外部链接可以用 #review / #projects 直达某个模块。
     用 replaceState 回写而非直接赋值 location.hash，避免触发 hashchange 造成自我循环。 */
  var TAB_KEYS = { today: 1, projects: 1, notes: 1, review: 1 };
  function tabFromHash() {
    var h = String((window.location && window.location.hash) || '').replace(/^#/, '');
    return TAB_KEYS[h] ? h : '';
  }
  function syncHash(tab) {
    if (!window.history || typeof window.history.replaceState !== 'function') return;
    try { window.history.replaceState(null, '', '#' + tab); } catch (e) {}
  }
  function bindHashRoute() {
    if (typeof window.addEventListener === 'function') {
      window.addEventListener('hashchange', function () {
        var t = tabFromHash();
        if (t && t !== S.tab) switchTab(t);
      });
    }
  }

  function switchTab(tab) {
    S.tab = tab;
    syncHash(tab);
    var panes = { today: 'pane-today', projects: 'pane-projects', notes: 'pane-notes', review: 'pane-review' };
    var titles = { today: '今日推进', projects: '项目推进', notes: '知识沉淀', review: '每周复盘' };
    for (var k in panes) {
      if (!Object.prototype.hasOwnProperty.call(panes, k)) continue;
      var el = document.getElementById(panes[k]);
      if (el) el.classList.toggle('hide', k !== tab);
    }
    var btns = document.querySelectorAll('[data-tab]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].getAttribute('data-tab') === tab);
    }
    var t = document.getElementById('pageTitle');
    if (t) t.textContent = titles[tab] || '';
    var sub = document.getElementById('pageSub');
    if (sub && tab !== 'today') {
      if (tab === 'projects') sub.textContent = '项目 ' + projectIndex().length + ' 个 · 点卡片展开明细';
      if (tab === 'notes') sub.textContent = '沉淀 ' + notes().length + ' 条 · [[双链]]已启用';
      if (tab === 'review') sub.textContent = '按周汇总完成 / 精力 / 卡点 / 待决策，一键生成可落入 Obsidian 的复盘稿';
    }
    refreshAll();
    if (tab === 'review' && !S.libLoaded) ensureLib().then(function () { renderReview(); });
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }

  function onItemAction(e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var id = b.getAttribute('data-id');
    var act = b.getAttribute('data-act');
    var row = null, rows = view();
    for (var i = 0; i < rows.length; i++) if (rows[i]._id === id) row = rows[i];
    if (!row) return;
    if (act === 'toggle') toggleDone(row);
    else if (act === 'edit') openEdit(row);
    else if (act === 'del') deleteRow(row);
    else if (act === 'expand') {
      var it = b.closest ? b.closest('.item') : null;
      if (it && it.classList) it.classList.toggle('ropen');
    }
  }

  function toggleDone(row) {
    /* 已完成 → 取消勾选：恢复待处理，「完成结果」一并清空（与编辑弹窗可补填的语义一致） */
    if (isDone(row)) {
      var props0 = {};
      props0['状态'] = { select: '待处理' };
      props0['完成时间'] = { number: 0 };
      props0['完成结果'] = { text: '' };
      props0['更新时间'] = { number: nowStamp() };
      Store.patch(row._id, props0).then(function () {
        toast('已恢复为待处理');
        return reload();
      }).catch(function () { toast('保存失败，请重试'); });
      return;
    }
    /* 未完成 → 完成：先问一句「完成结果」，可留空；取消则什么都不写 */
    openDonePrompt(row['标题'] || '', function (val) {
      if (val === null) return;
      var props = {};
      props['状态'] = { select: '已完成' };
      props['完成时间'] = { number: nowStamp() };
      props['完成结果'] = { text: val || '' };
      props['更新时间'] = { number: nowStamp() };
      Store.patch(row._id, props).then(function () {
        toast(val ? '已完成，结果已记录' : '已完成');
        return reload();
      }).catch(function () { toast('保存失败，请重试'); });
    });
  }

  /* 删掉工作台记录后，把来源仓库项退回「待领取」并清空它的「工作台记录ID」。
     不做这一步的话，仓库会一直显示「已领取」、关联 ID 却指向一条已不存在的记录 ——
     用户回头去仓库看，会以为根本没删掉，也没有入口把它重新领回来。 */
  function releasePool(poolId) {
    if (!poolId) return Promise.resolve(false);
    var br = window.__BR__;
    if (br && typeof br.releasePool === 'function') {
      try { return br.releasePool(poolId); } catch (e) {}
    }
    return Promise.resolve(false);
  }

  function deleteRow(row) {
    var pid = String(row['仓库ID'] || '').trim();
    askConfirm({
      title: '删除记录',
      text: '确认删除「' + (row['标题'] || '') + '」？删除后不可恢复。' +
        (pid ? '\n\n它来自「待办仓库」：删掉后仓库里那一条会退回「待领取」，随时能再领回来。' : ''),
      yes: '删除'
    }, function (ok) {
      if (!ok) return;
      Store.remove(row._id).then(function () {
        if (!pid) { toast('已删除'); return reload(); }
        return releasePool(pid).then(function (x) {
          toast(x ? '已删除，来源仓库项退回「待领取」' : '已删除（仓库项状态回退失败，可在仓库里手动改回待领取）');
          return reload();
        });
      }).catch(function () { toast('删除失败'); });
    });
  }

  function bindQuickAdd() {
    var inp = document.getElementById('quickInput');
    function addNow() {
      var v = String(inp.value || '').trim();
      if (!v) { toast('先写点什么'); return; }
      var props = {};
      props['标题'] = { text: v };
      props['类型'] = { select: TYPE_TODO };
      props['状态'] = { select: '待处理' };
      props['计划日期'] = { date: S.selDate || todayKey() };
      props['创建时间'] = { number: nowStamp() };
      props['更新时间'] = { number: nowStamp() };
      props['顺延次数'] = { number: 0 };
      props['待决策'] = { checkbox: false };
      Store.add(props).then(function () {
        inp.value = '';
        toast('已记下');
        return reload();
      }).catch(function () { toast('保存失败'); });
    }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addNow(); } });
    document.getElementById('btnQuick').addEventListener('click', addNow);
    document.getElementById('btnNewFull').addEventListener('click', function () { openEdit(null); });
  }

  /* ==================== 编辑弹窗 ==================== */
  function bindModalBasics() {
    document.getElementById('editClose').addEventListener('click', closeEdit);
    document.getElementById('editCancel').addEventListener('click', closeEdit);
    document.getElementById('editMask').addEventListener('click', function (e) {
      if (e.target === this) closeEdit();
    });
  }

  function optIdByName(field, text) {
    if (!text) return '';
    var opts = optsOf(field);
    for (var i = 0; i < opts.length; i++) if (opts[i].text === text) return opts[i].value;
    return text;
  }
  function optTextById(field, v) {
    if (!v) return '';
    var opts = optsOf(field);
    for (var i = 0; i < opts.length; i++) if (opts[i].value === v || opts[i].id === v || opts[i].text === v) return opts[i].text;
    return '';
  }

  /* 把主台账里的修正回写给「待办仓库」的原始提取（只改 事项 / 优先级建议，
     「原文摘录」永远保留录音原话）。合并页里优先交给脑区实现 —— 它加载了仓库表的
     schema，能把优先级写成正确的 option id；独立打开宿主源页时退回文本兜底。 */
  function writeBackPool(poolId, title, prioText) {
    if (!poolId) return Promise.resolve(false);
    var br = window.__BR__;
    if (br && typeof br.writeBackPool === 'function') {
      try { return br.writeBackPool({ _id: poolId }, title, prioText); } catch (e) {}
    }
    var db = (window.__SMART_PAGE__ && window.__SMART_PAGE__.database) || null;
    if (!db) return Promise.resolve(false);
    var props = { '事项': { text: String(title || '') } };
    if (prioText) props['优先级建议'] = { text: String(prioText) };
    return db.updateRecord({ databaseId: 'fONLTaaLixhK3YpW5ExBJO', recordId: poolId, properties: props })
      .then(function () { return true; }, function () { return false; });
  }

  function openEdit(row) {
    S.editingId = row ? row._id : '';
    document.getElementById('editTitle').textContent = row ? '编辑' : '新建';
    var g = function (id) { return document.getElementById(id); };
    g('e-title').value = row ? (row['标题'] || '') : '';
    g('e-type').value = row ? optIdByName('类型', row['类型']) : optIdByName('类型', TYPE_TODO);
    g('e-status').value = row ? optIdByName('状态', row['状态']) : optIdByName('状态', '待处理');
    g('e-priority').value = row ? optIdByName('优先级', row['优先级']) : optIdByName('优先级', 'P2 常规');
    g('e-source').value = row ? optIdByName('来源', row['来源']) : '';
    g('e-project').value = row ? (row['关联项目'] || '') : '';
    g('e-person').value = row ? (row['关联人物'] || '') : '';
    g('e-plan').value = row ? dtText(row['计划日期']) : (S.selDate || todayKey());
    g('e-due').value = row ? dtText(row['截止日期']) : '';
    g('e-tags').value = row ? (row['标签'] || '') : '';
    g('e-content').value = row ? (row['内容'] || '') : '';
    g('e-next').value = row ? (row['下一步'] || '') : '';
    g('e-block').value = row ? (row['卡点'] || '') : '';
    g('e-result').value = row ? (row['完成结果'] || '') : '';
    g('e-decide').checked = !!(row && row['待决策']);
    /* 只有「从待办仓库领取进来」的记录才有回写对象（仓库ID 非空）。
       默认勾选：用户的实际场景就是录音提取有偏差、需要顺手把源头改对。 */
    var poolId = (row && row['仓库ID']) ? String(row['仓库ID']) : '';
    var wbWrap = g('e-wbWrap');
    if (wbWrap) wbWrap.classList.toggle('hide', !poolId);
    var wbCk = g('e-writeback');
    if (wbCk) wbCk.checked = !!poolId;
    syncNextBlockVisibility();
    restoreDraft();
    /* 草稿会把「关联项目」也还原，所以提示必须在草稿之后算 */
    renderProjHint();
    document.getElementById('editMask').classList.add('on');
    g('e-title').focus();
  }
  function closeEdit() {
    document.getElementById('editMask').classList.remove('on');
    S.editingId = '';
  }
  function syncNextBlockVisibility() {
    var isProj = optTextById('类型', document.getElementById('e-type').value) === TYPE_PROJ;
    document.getElementById('wrapNext').classList.toggle('hide', !isProj);
    document.getElementById('wrapBlock').classList.toggle('hide', !isProj);
  }
  function numericOrZero(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

  /* 保存前先拦一次「项目名撞车」。抽成独立函数是因为确认弹窗是回调式的：
     用户点完「归到已有的」，还要回来接着把这条存下去。 */
  function currentPj() {
    if (!S.editingId) return '';
    var rows = view();
    for (var i = 0; i < rows.length; i++) {
      if (rows[i]._id === S.editingId) return String(rows[i]['关联项目'] || '').trim();
    }
    return '';
  }
  function saveEditNow() {
    var g = function (id) { return document.getElementById(id); };
      var title = String(g('e-title').value || '').trim();
      if (!title) { toast('标题不能为空'); return; }
      var typeText = optTextById('类型', g('e-type').value) || TYPE_TODO;
      var props = {};
      props['标题'] = { text: title };
      props['类型'] = { select: g('e-type').value || TYPE_TODO };
      props['状态'] = { select: g('e-status').value || '待处理' };
      if (g('e-priority').value) props['优先级'] = { select: g('e-priority').value };
      if (g('e-source').value) props['来源'] = { select: g('e-source').value };
      props['关联项目'] = { text: String(g('e-project').value || '').trim() };
      props['关联人物'] = { text: String(g('e-person').value || '').trim() };
      if (g('e-plan').value) props['计划日期'] = { date: toApiDate(g('e-plan').value) };
      if (g('e-due').value) props['截止日期'] = { date: toApiDate(g('e-due').value) };
      props['标签'] = { text: String(g('e-tags').value || '').trim() };
      props['内容'] = { text: String(g('e-content').value || '') };
      props['待决策'] = { checkbox: !!g('e-decide').checked };
      props['更新时间'] = { number: nowStamp() };
      if (typeText === TYPE_PROJ) {
        props['下一步'] = { text: String(g('e-next').value || '').trim() };
        props['卡点'] = { text: String(g('e-block').value || '').trim() };
      }
      props['完成结果'] = { text: String(g('e-result').value || '').trim() };
      var p;
      var backPool = '';
      var renameFrom = '';
      var prioText = optTextById('优先级', g('e-priority').value);
      if (S.editingId) {
        p = Store.patch(S.editingId, props);
        /* 从仓库领取来的记录：勾了就顺手把源头（事项 / 优先级）改对 */
        var srcRow = null, allRows = view();
        for (var q = 0; q < allRows.length; q++) if (allRows[q]._id === S.editingId) srcRow = allRows[q];
        if (srcRow && srcRow['仓库ID'] && g('e-writeback') && g('e-writeback').checked) {
          backPool = String(srcRow['仓库ID']);
        }
        /* 项目改名必须联动：待办是靠「关联项目」这个文本找到项目的，
           只改项目记录的标题会把原先挂在它下面的待办全部甩掉，等于把项目改散了。
           顺带把项目记录自己的「关联项目」也对齐（若它写的是旧名），
           否则它会以旧名再长出一张空壳卡。 */
        if (srcRow && optTextById('类型', srcRow['类型']) === TYPE_PROJ) {
          var oldTitle = String(srcRow['标题'] || '');
          if (oldTitle && oldTitle !== title) {
            renameFrom = oldTitle;
            if (String(props['关联项目'].text || '').trim() === oldTitle) {
              props['关联项目'] = { text: title };
            }
          }
        }
      } else {
        props['创建时间'] = { number: nowStamp() };
        props['顺延次数'] = { number: 0 };
        props['完成时间'] = { number: 0 };
        p = Store.add(props);
      }
      var btn = g('editSave');
      btn.disabled = true;
      p.then(function () {
        if (!backPool) return false;
        return writeBackPool(backPool, title, prioText);
      }).then(function (wb) {
        if (!renameFrom) return { wb: wb, n: 0 };
        return renameLinked(renameFrom, title, S.editingId).then(function (n) { return { wb: wb, n: n }; });
      }).then(function (r) {
        btn.disabled = false;
        clearDraft();
        closeEdit();
        var msg = r.wb ? '已保存，并同步修正了「待办仓库」的原始提取' : '已保存';
        if (r.n) msg += '；挂在这个项目下的 ' + r.n + ' 条记录归属也跟着改了';
        toast(msg);
        return reload();
      }).catch(function () {
        btn.disabled = false;
        toast('保存失败，请重试');
      });
  }

  function bindEditDialog() {
    var g = function (id) { return document.getElementById(id); };
    g('e-type').addEventListener('change', syncNextBlockVisibility);
    ['e-title', 'e-project', 'e-person', 'e-tags', 'e-content', 'e-next', 'e-block'].forEach(function (id) {
      g(id).addEventListener('input', function () { saveDraft(); });
    });
    g('editSave').addEventListener('click', function () {
      var t0 = String(g('e-title').value || '').trim();
      if (!t0) { toast('标题不能为空'); return; }
      /* 项目名防重复：撞上已有名字就先问一句 —— 重复卡的根子就是这个自由文本框，
         datalist 只提示不拦截，手打一个「XX项目」照样入库。 */
      var pjv = String(g('e-project').value || '').trim();
      var pjSim = pjv ? similarProj(pjv) : '';
      if (pjSim && pjv !== currentPj()) {
        askConfirm({
          title: '项目名可能重复',
          text: '已有「' + pjSim + '」，和你填的「' + pjv + '」像是同一个项目。\n\n' +
            '归到已有的下面，项目才不会再被拆成两张卡；若确实是两件事，选「仍按我填的保存」。',
          yes: '归到「' + pjSim + '」',
          no: '仍按我填的保存'
        }, function (ok) {
          if (ok) {
            g('e-project').value = pjSim;
            renderProjHint();
          }
          saveEditNow();
        });
        return;
      }
      saveEditNow();
    });
  }

  /* 表单草稿本地缓存（防登录重定向丢失） */
  var draftTimer = null;
  function saveDraft() {
    var g = function (id) { return document.getElementById(id); };
    var o = {
      t: g('e-title').value, ty: g('e-type').value, st: g('e-status').value,
      pr: g('e-priority').value, sr: g('e-source').value, pj: g('e-project').value,
      pe: g('e-person').value, pl: g('e-plan').value, du: g('e-due').value,
      tg: g('e-tags').value, ct: g('e-content').value, nx: g('e-next').value,
      bk: g('e-block').value, dc: g('e-decide').checked ? 1 : 0, ts: Date.now()
    };
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      try { localStorage.setItem(LS_DRAFT, JSON.stringify(o)); } catch (e) {}
    }, 300);
  }
  function restoreDraft() {
    if (S.editingId) return;
    try {
      var raw = localStorage.getItem(LS_DRAFT);
      if (!raw) return;
      var o = JSON.parse(raw);
      if (!o || !o.ts || (Date.now() - o.ts) > 48 * 3600 * 1000) return;
      var g = function (id) { return document.getElementById(id); };
      if (o.t) g('e-title').value = o.t;
      if (o.pj) g('e-project').value = o.pj;
      if (o.pe) g('e-person').value = o.pe;
      if (o.tg) g('e-tags').value = o.tg;
      if (o.ct) g('e-content').value = o.ct;
      if (o.nx) g('e-next').value = o.nx;
      if (o.bk) g('e-block').value = o.bk;
    } catch (e) {}
  }
  function clearDraft() {
    try { localStorage.removeItem(LS_DRAFT); } catch (e) {}
  }

  /* ==================== 日报 ==================== */
  function bindDailyDialog() {
    var open = function () {
      document.getElementById('dailyText').textContent = buildDaily();
      document.getElementById('dailyMask').classList.add('on');
    };
    document.getElementById('btnDaily').addEventListener('click', open);
    document.getElementById('dailyClose').addEventListener('click', function () {
      document.getElementById('dailyMask').classList.remove('on');
    });
    document.getElementById('dailyOk').addEventListener('click', function () {
      document.getElementById('dailyMask').classList.remove('on');
    });
    document.getElementById('dailyCopy').addEventListener('click', function () {
      var txt = document.getElementById('dailyText').textContent;
      copyText(txt, '日报已复制，可直接粘贴到微信');
    });
  }

  /* ==================== 每周复盘：交互绑定 ==================== */
  function bindReviewDialog() {
    var bind = function (id, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };
    bind('rvPrev', function () { setWeekOff(S.weekOff - 1); });
    bind('rvCur', function () { setWeekOff(0); });
    bind('rvNext', function () { setWeekOff(S.weekOff + 1); });
    bind('rvDraft', openReview);
    bind('reviewClose', function () {
      var m = document.getElementById('reviewMask');
      if (m) m.classList.remove('on');
    });
    bind('reviewOk', function () {
      var m = document.getElementById('reviewMask');
      if (m) m.classList.remove('on');
    });
    bind('reviewCopy', function () {
      var el = document.getElementById('reviewText');
      copyText(el ? el.textContent : '', '复盘稿已复制，可直接落入 Obsidian「工作复盘/」');
    });
    bind('reviewFallback', function () {
      copyText(buildReviewPlain(), '已复制纯文本降级版（表格已展开为逐行）');
    });
    /* 点遮罩空白处关闭 */
    var mask = document.getElementById('reviewMask');
    if (mask) mask.addEventListener('click', function (e) {
      if (e.target === mask) mask.classList.remove('on');
    });
  }

  function copyText(txt, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast(okMsg); }, function () { fallbackCopy(txt, okMsg); });
    } else fallbackCopy(txt, okMsg);
  }
  function fallbackCopy(txt, okMsg) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); toast(okMsg); } catch (e) { toast('复制失败，请手动选中'); }
    document.body.removeChild(ta);
  }

  function buildDaily() {
    var day = S.selDate || todayKey();
    var rows = view();
    var doneToday = [], planTomorrow = [], pending = [];
    var tmr = shiftKey(day, 1);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (typeOf(r) !== TYPE_TODO) continue;
      if (isDone(r) && stampKey(r['完成时间']) === day) doneToday.push(r);
      else if (!isDone(r) && planKey(r) === tmr) planTomorrow.push(r);
      else if (!isDone(r) && isOverdue(r)) pending.push(r);
    }
    var L = [];
    L.push('日期：' + dLabel(day));
    L.push('汇报人：茉莉');
    L.push('');
    L.push('今日工作内容：');
    if (doneToday.length) {
      for (var a = 0; a < doneToday.length; a++) L.push((a + 1) + '. ' + (doneToday[a]['标题'] || ''));
    } else {
      L.push('（暂无勾选完成的事项，可在今日列表中勾选后重新生成）');
    }
    L.push('');
    L.push('明日工作安排：');
    var idx = 0, used = {};
    for (var b = 0; b < planTomorrow.length; b++) { L.push(++idx + '. ' + (planTomorrow[b]['标题'] || '')); used[planTomorrow[b]._id] = 1; }
    for (var c = 0; c < pending.length; c++) {
      if (used[pending[c]._id]) continue;
      L.push(++idx + '. ' + (pending[c]['标题'] || '') + '（顺延）');
    }
    if (!idx) L.push('（暂无明日安排）');
    var dec = [];
    for (var d = 0; d < rows.length; d++) {
      if (typeOf(rows[d]) === TYPE_TODO && !isDone(rows[d]) && isDecide(rows[d])) dec.push(rows[d]);
    }
    if (dec.length) {
      L.push('');
      L.push('待决策事项（需上级拍板）：');
      for (var e = 0; e < dec.length; e++) L.push((e + 1) + '. ' + (dec[e]['标题'] || ''));
    }
    return L.join('\n');
  }

  /* ============================================================
     模块四：每周复盘（自 v2.1 workbench_v4.html 移植，字段口径适配本表）
     调用链严格单向：计算层 → 渲染层 → refreshAll()；
     渲染函数之间不互调，交互只改 S 后走 refreshAll()（铁律 9）
     ============================================================ */

  /* ---------- 计算层：纯函数，只读数据 ---------- */
  function weekStartKey(off) {
    var t = todayKey();
    var p = t.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var wd = d.getDay();                 /* 0=周日 */
    var back = (wd === 0 ? 6 : wd - 1);  /* 周一为一周之始 */
    d.setDate(d.getDate() - back + Number(off || 0) * 7);
    return keyOf(d);
  }
  function weekEndKey(off) { return shiftKey(weekStartKey(off), 6); }
  function weekLabel(off) {
    if (!off) return '本周';
    if (off === -1) return '上一周';
    if (off === 1) return '下一周';
    return weekStartKey(off).slice(5).replace('-', '/') + ' 起';
  }
  function inWeekKey(key, off) {
    if (!key) return false;
    var ws = weekStartKey(off), we = weekEndKey(off);
    return key >= ws && key <= we;
  }
  function themeCodeOf(v) {
    var m = String(v || '').match(/T\d{2}/);
    return m ? m[0] : '';
  }
  function themeLabelOf(code) { return code ? code + ' ' + (THEME_NAME[code] || '') : ''; }

  function weekDoneRows(off) {
    var rows = view(), out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (typeOf(r) !== TYPE_TODO || !isDone(r)) continue;
      if (inWeekKey(stampKey(r['完成时间']), off)) out.push(r);
    }
    return out;
  }
  function weekCreatedCount(off) {
    var rows = view(), n = 0;
    for (var i = 0; i < rows.length; i++) if (inWeekKey(stampKey(rows[i]['创建时间']), off)) n++;
    return n;
  }
  function weekNoteRows(off) {
    var rows = view(), out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (typeOf(r) !== TYPE_NOTE) continue;
      if (inWeekKey(stampKey(r['创建时间']), off)) out.push(r);
    }
    return out;
  }
  function weekPrioDist(off) {
    var d = { 'P0 紧急': 0, 'P1 重要': 0, 'P2 常规': 0 }, rows = weekDoneRows(off);
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i]['优先级'];
      /* 只统计三档已知优先级；未标优先级的走 weekPrioUntagged 单独提示，
         否则柱状图三档之和会小于「本周完成」总数，用户会以为漏算 */
      if (d[p] !== undefined) d[p]++;
    }
    return d;
  }
  function weekPrioUntagged(off) {
    var rows = weekDoneRows(off), n = 0;
    for (var i = 0; i < rows.length; i++) if (PRIO_KEYS.indexOf(rows[i]['优先级']) < 0) n++;
    return n;
  }
  /* 主题精力分布：本周完成数 + 录音库同主题收录篇数（长期重心对照） */
  function weekThemeDist(off) {
    var rows = weekDoneRows(off), byT = {}, untagged = 0;
    for (var i = 0; i < rows.length; i++) {
      var c = themeCodeOf(rows[i]['主题']);
      if (c) byT[c] = (byT[c] || 0) + 1; else untagged++;
    }
    var libCount = libThemeCount();
    var keys = Object.keys(byT);
    for (var k in libCount) if (keys.indexOf(k) < 0) keys.push(k);
    keys.sort(function (a, b) { return (byT[b] || 0) - (byT[a] || 0) || (libCount[b] || 0) - (libCount[a] || 0); });
    return { items: keys.map(function (c) {
      return { code: c, done: byT[c] || 0, lib: libCount[c] || 0 };
    }), untagged: untagged, hasLib: S.libLoaded && S.libRows.length > 0 };
  }
  function libThemeCount() {
    var out = {};
    for (var i = 0; i < S.libRows.length; i++) {
      var c = themeCodeOf(S.libRows[i]['主题']);
      if (c) out[c] = (out[c] || 0) + 1;
    }
    return out;
  }
  function weekSusRows() {
    var rows = view(), out = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (typeOf(r) === TYPE_TODO && !isDone(r) && isDecide(r)) out.push(r);
    }
    return out;
  }
  function weekStuckProjects() {
    var idx = projectIndex(), out = [];
    for (var i = 0; i < idx.length; i++) {
      /* projectIndex() 会为「只在关联项目里被提到、但没有项目记录」的名称补一条
         row:null 的虚拟项——这类没有卡点字段可取，必须跳过，否则整条刷新链会抛错 */
      var p = idx[i].row;
      if (!p) continue;
      if (isDone(p)) continue;
      if (String(p['卡点'] || '').trim()) out.push(idx[i]);
    }
    return out;
  }
  function weekOverdueRows() {
    var rows = view(), out = [];
    for (var i = 0; i < rows.length; i++) if (isOverdue(rows[i])) out.push(rows[i]);
    return out;
  }
  function overdueDays(r) {
    var d = dueKey(r) || planKey(r);
    if (!d) return 0;
    var a = new Date(d + 'T00:00:00'), b = new Date(todayKey() + 'T00:00:00');
    return Math.max(0, Math.round((b - a) / 86400000));
  }
  function bestDoneDay(off) {
    var rows = weekDoneRows(off), m = {};
    for (var i = 0; i < rows.length; i++) {
      var k = stampKey(rows[i]['完成时间']);
      if (k) m[k] = (m[k] || 0) + 1;
    }
    var best = '', n = 0;
    for (var k2 in m) if (m[k2] > n) { n = m[k2]; best = k2; }
    return best ? { key: best, n: n } : null;
  }

  /* ---------- 渲染层：只写 DOM，不调用其它渲染函数 ---------- */
  /* 今日推进页的「待办仓库领取入口」回显：只统计已从录音库领取进来的事项 */
  function poolClaimedRows() {
    var rows = view(), out = [];
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i]['仓库ID'] || '').trim()) out.push(rows[i]);
    }
    return out;
  }
  function renderPoolEntry() {
    var host = document.getElementById('poolEntryStats');
    var go = document.getElementById('poolEntryGo');
    if (go) go.setAttribute('href', BRAIN_URL);
    if (!host) return;
    var claimed = poolClaimedRows();
    var open = 0, todayN = 0, dec = 0, themeSet = {};
    var t = todayKey();
    for (var i = 0; i < claimed.length; i++) {
      var r = claimed[i];
      var c = themeCodeOf(r['主题']);
      if (c) themeSet[c] = 1;
      if (!isDone(r)) {
        open++;
        var d = planKey(r);
        if (d && d <= t) todayN++;
        if (isDecide(r)) dec++;
      }
    }
    var themeN = 0;
    for (var k in themeSet) themeN++;
    var cells = [
      ['已领取进本台', claimed.length, ''],
      ['其中未完成', open, ''],
      ['需今天处理', todayN, todayN ? 'red' : ''],
      ['其中待决策', dec, dec ? 'red' : ''],
      ['覆盖主题数', themeN, ''],
      ['录音库篇数', S.libLoaded ? S.libRows.length : 0, '']
    ];
    var h = '';
    for (var j = 0; j < cells.length; j++) {
      h += '<div class="rv-stat ' + cells[j][2] + '"><b data-sp-bindable="database" data-sp-database-id="ggytTE4Cvh4Nyi3nBAcdxD">' + cells[j][1] + '</b><span>' + cells[j][0] + '</span></div>';
    }
    host.innerHTML = h;
    var meta = document.getElementById('poolEntryMeta');
    if (meta) {
      meta.textContent = claimed.length
        ? '已从录音库领取 ' + claimed.length + ' 条'
        : (S.usingSDK ? '还没领取过，点右侧去仓库' : '本机模式下不读取录音库');
    }
  }

  function rvBar(label, val, max, extra, title) {
    var pct = max > 0 ? Math.round(val / max * 100) : 0;
    return '<div class="rv-row">' +
      '<span class="rv-lab" title="' + esc(title || label) + '">' + esc(label) + '</span>' +
      '<span class="rv-track"><span class="rv-fill" style="width:' + pct + '%"></span></span>' +
      '<span class="rv-val">' + val + (extra === undefined || extra === null ? '' : '<i>/' + extra + '</i>') + '</span>' +
      '</div>';
  }

  function renderReview() {
    var off = S.weekOff;
    var done = weekDoneRows(off);
    var created = weekCreatedCount(off);
    var noteRows = weekNoteRows(off);
    var od = weekOverdueRows(), st = weekStuckProjects(), su = weekSusRows();

    var rng = document.getElementById('rvRange');
    if (rng) rng.textContent = weekLabel(off) + '：' + weekStartKey(off).replace(/-/g, '/') + ' — ' + weekEndKey(off).replace(/-/g, '/') + '（周一至周日）';

    var stats = document.getElementById('rvStats');
    if (stats) {
      var cells = [
        ['本周完成事项', done.length, ''],
        ['本周新建事项', created, ''],
        ['本周录入沉淀', noteRows.length, ''],
        ['当前逾期未完成', od.length, od.length ? 'red' : ''],
        ['卡点项目', st.length, st.length ? 'red' : ''],
        ['挂起待决策', su.length, su.length ? 'red' : '']
      ];
      var h = '';
      for (var i = 0; i < cells.length; i++) {
        h += '<div class="rv-stat ' + cells[i][2] + '"><b data-sp-bindable="database" data-sp-database-id="ggytTE4Cvh4Nyi3nBAcdxD">' + cells[i][1] + '</b><span>' + cells[i][0] + '</span></div>';
      }
      stats.innerHTML = h;
    }

    var rate = document.getElementById('rvRate');
    if (rate) {
      var bd = bestDoneDay(off);
      rate.textContent = done.length
        ? '本周共完成 ' + done.length + ' 项' +
          (created ? '，新建 ' + created + ' 项' : '') +
          (bd ? '；产出最多的一天是 ' + bd.key.slice(5).replace('-', '/') + '（' + bd.n + ' 项）' : '') + '。'
        : '本周还没有勾选完成的事项。在「今日推进」里勾选后，这里会自动汇总。';
    }

    var pd = weekPrioDist(off);
    var pmax = Math.max(1, pd['P0 紧急'] || 0, pd['P1 重要'] || 0, pd['P2 常规'] || 0);
    var prioHost = document.getElementById('rvPrio');
    if (prioHost) {
      var total = done.length;
      var ph = '';
      for (var p = 0; p < PRIO_KEYS.length; p++) {
        var k = PRIO_KEYS[p];
        ph += rvBar(k, pd[k] || 0, pmax, null, k + '：' + (pd[k] || 0) + ' 项');
      }
      prioHost.innerHTML = total ? ph : '<div class="empty">本周没有完成事项，暂无分布</div>';
    }
    var ph2 = document.getElementById('rvPrioHint');
    if (ph2) {
      var p0 = pd['P0 紧急'] || 0, pu = weekPrioUntagged(off);
      ph2.textContent = done.length
        ? (p0 ? 'P0 占 ' + Math.round(p0 / done.length * 100) + '%' : '本周没有 P0 完成项') +
          (pu ? ' · 另有 ' + pu + ' 项未标优先级' : '')
        : '';
    }

    var td = weekThemeDist(off);
    var thost = document.getElementById('rvTheme');
    if (thost) {
      if (!td.items.length) {
        thost.innerHTML = '<div class="empty">本周完成的事项还没标主题。去记录里补上「主题」（如 T01），就能看到精力分布。</div>';
      } else {
        var tmax = 1;
        for (var q = 0; q < td.items.length; q++) if (td.items[q].done > tmax) tmax = td.items[q].done;
        var t1 = td.hasLib ? tmax : 1;
        var th = '';
        for (var w = 0; w < td.items.length; w++) {
          var it = td.items[w];
          th += rvBar(themeLabelOf(it.code), it.done, t1, td.hasLib ? it.lib : null,
            themeLabelOf(it.code) + '：本周完成 ' + it.done + ' 项' + (td.hasLib ? '，录音库收录 ' + it.lib + ' 篇' : ''));
        }
        thost.innerHTML = th;
      }
    }
    var th2 = document.getElementById('rvThemeHint');
    if (th2) {
      th2.textContent = td.hasLib
        ? '对照录音库 ' + S.libRows.length + ' 篇' + (td.untagged ? ' · 另有 ' + td.untagged + ' 项未标主题' : '')
        : (S.usingSDK ? '录音库读取中…' : '本机模式下无录音库对照');
    }

    var suHost = document.getElementById('rvSus');
    var suCnt = document.getElementById('rvSusCnt');
    if (suCnt) suCnt.textContent = su.length + ' 项';
    if (suHost) {
      if (!su.length) suHost.innerHTML = '<div class="empty">没有挂起待决策的事项，很好。</div>';
      else {
        var sh = '';
        for (var s1 = 0; s1 < su.length; s1++) {
          var r1 = su[s1];
          sh += '<div class="rv-blk"><b>' + esc(r1['标题'] || '') + '</b>' +
            '<span>等：' + esc(r1['关联人物'] || r1['来源'] || '未填写等待对象') +
            (overdueDays(r1) > 0 ? ' · 已挂 ' + overdueDays(r1) + ' 天' : '') + '</span></div>';
        }
        suHost.innerHTML = sh;
      }
    }

    var blkHost = document.getElementById('rvBlock');
    var blkCnt = document.getElementById('rvBlkCnt');
    if (blkCnt) blkCnt.textContent = (od.length + st.length) + ' 项';
    if (blkHost) {
      if (!od.length && !st.length) blkHost.innerHTML = '<div class="empty">本周没有卡点与逾期。</div>';
      else {
        var bh = '';
        for (var s2 = 0; s2 < st.length; s2++) {
          var pi = st[s2];
          bh += '<div class="rv-blk"><b>' + esc(pi.name) + ' <span class="pill proj" style="font-size:10px">项目卡点</span></b>' +
            '<span>' + esc(pi.row['卡点'] || '未填写') +
            (pi.row['下一步'] ? '<br>下一步：' + esc(pi.row['下一步']) : '') +
            '<br>关联事项 ' + pi.todos.length + ' 条 · 其中逾期 ' + countOverdue(pi.todos) + ' 条</span></div>';
        }
        for (var s3 = 0; s3 < od.length; s3++) {
          var r3 = od[s3];
          bh += '<div class="rv-blk"><b>' + esc(r3['标题'] || '') +
            (r3['关联项目'] ? ' <span class="pill proj" style="font-size:10px">' + esc(r3['关联项目']) + '</span>' : '') +
            ' <span class="pill due" style="font-size:10px">逾期 ' + overdueDays(r3) + ' 天</span></b>' +
            '<span>计划 ' + (planKey(r3) || '—') + ' · 截止 ' + (dueKey(r3) || '—') +
            (Number(r3['顺延次数'] || 0) > 0 ? ' · 已顺延 ' + r3['顺延次数'] + ' 次' : '') + '</span></div>';
        }
        blkHost.innerHTML = bh;
      }
    }

    var srcHost = document.getElementById('rvSrc');
    var srcCnt = document.getElementById('rvSrcCnt');
    if (srcCnt) srcCnt.textContent = noteRows.length ? noteRows.length + ' 条' : '';
    if (srcHost) {
      if (!noteRows.length) srcHost.innerHTML = '<div class="empty">本周还没录入沉淀。在「知识沉淀」里记一条，会在这里汇总。</div>';
      else {
        var nh = '';
        for (var s4 = 0; s4 < noteRows.length; s4++) {
          var r4 = noteRows[s4];
          nh += '<div class="rv-src"><b>' + esc(r4['标题'] || '(无标题)') + '</b>' +
            (r4['关联项目'] ? '<span class="pill proj">' + esc(r4['关联项目']) + '</span>' : '') +
            (themeCodeOf(r4['主题']) ? '<span class="pill">' + esc(themeLabelOf(themeCodeOf(r4['主题']))) + '</span>' : '') +
            '<em>' + (stampKey(r4['创建时间']) || '') + '</em></div>';
        }
        srcHost.innerHTML = nh;
      }
    }
  }
  function countOverdue(arr) {
    var n = 0;
    for (var i = 0; i < arr.length; i++) if (isOverdue(arr[i])) n++;
    return n;
  }

  /* ---------- 文本层：生成可直接落入 Obsidian「工作复盘/」的复盘稿 ---------- */
  function buildReview() {
    var off = S.weekOff, ws = weekStartKey(off), we = weekEndKey(off);
    var done = weekDoneRows(off), created = weekCreatedCount(off), noteRows = weekNoteRows(off);
    var pd = weekPrioDist(off), td = weekThemeDist(off);
    var od = weekOverdueRows(), st = weekStuckProjects(), su = weekSusRows();

    var L = [];
    L.push('# 周复盘｜' + ws + ' ~ ' + we);
    L.push('');
    L.push('> 口径：与知识库 frontmatter `themes` 同口径（T01—T12）；本篇由工作台自动生成，可直接落入 `工作复盘/` 目录。');
    L.push('');
    L.push('## 一、本周完成（' + done.length + ' 项）');
    if (done.length) {
      for (var i = 0; i < done.length; i++) {
        var r = done[i];
        var c = themeCodeOf(r['主题']);
        L.push('- [x] ' + (r['标题'] || '') + (c ? '（' + c + '）' : '') + (r['关联项目'] ? '〔' + r['关联项目'] + '〕' : ''));
      }
    } else L.push('- ');
    L.push('');
    L.push('## 二、优先级分布');
    for (var p = 0; p < PRIO_KEYS.length; p++) L.push('- ' + PRIO_KEYS[p] + '：' + (pd[PRIO_KEYS[p]] || 0) + ' 项');
    var pu = weekPrioUntagged(off);
    if (pu) L.push('- 未标优先级：' + pu + ' 项');
    if (created) L.push('- （本周新建 ' + created + ' 项，完成 ' + done.length + ' 项）');
    L.push('');
    L.push('## 三、主题精力分布（对照录音库篇数）');
    if (td.items.length) {
      L.push('| 主题 | 本周完成 | 录音库收录 |');
      L.push('|---|---|---|');
      for (var t = 0; t < td.items.length; t++) {
        var it = td.items[t];
        L.push('| ' + themeLabelOf(it.code) + ' | ' + it.done + ' | ' + (td.hasLib ? it.lib + ' 篇' : '—') + ' |');
      }
      if (td.untagged) L.push('');
      if (td.untagged) L.push('> 另有 ' + td.untagged + ' 项完成事项未标注主题。');
    } else L.push('（本周完成事项未标注主题，去记录里补「主题」即可）');
    L.push('');
    L.push('## 四、卡点与逾期');
    if (st.length || od.length) {
      for (var s = 0; s < st.length; s++) L.push('- 项目「' + st[s].name + '」受阻：' + (st[s].row['卡点'] || '未填写') + (st[s].row['下一步'] ? '｜下一步：' + st[s].row['下一步'] : ''));
      for (var o = 0; o < od.length; o++) L.push('- 逾期「' + (od[o]['标题'] || '') + '」' + overdueDays(od[o]) + ' 天' + (Number(od[o]['顺延次数'] || 0) > 0 ? '（已顺延 ' + od[o]['顺延次数'] + ' 次）' : ''));
    } else L.push('- ');
    L.push('');
    L.push('## 五、挂起待决策（等老板 / 等外部）');
    if (su.length) {
      for (var u = 0; u < su.length; u++) L.push('- ' + (su[u]['标题'] || '') + '｜等：' + (su[u]['关联人物'] || su[u]['来源'] || '待补充'));
    } else L.push('- ');
    L.push('');
    L.push('## 六、本周录入的沉淀（' + noteRows.length + ' 条）');
    if (noteRows.length) {
      for (var n = 0; n < noteRows.length; n++) L.push('- [[' + (noteRows[n]['标题'] || '无标题') + ']]');
    } else L.push('- ');
    return L.join('\n');
  }

  /* ---------- 交互：周切换与复盘稿 ---------- */
  function setWeekOff(off) {
    S.weekOff = Math.min(0, Number(off || 0));   /* 不允许看未来周 */
    refreshAll();
  }
  function openReview() {
    var el = document.getElementById('reviewText');
    if (el) el.textContent = buildReview();
    var t = document.getElementById('reviewTitle');
    if (t) t.textContent = '周复盘稿 · ' + weekStartKey(S.weekOff) + ' ~ ' + weekEndKey(S.weekOff);
    var m = document.getElementById('reviewMask');
    if (m) m.classList.add('on');
  }
  /* Obsidian 降级版：把 Markdown 表格转成纯文本行，避免部分编辑器粘贴后表格错位 */
  function buildReviewPlain() {
    var s = buildReview();
    var out = [];
    var lines = s.split('\n');
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (/^\|[\s\-|]+\|$/.test(ln)) continue;
      if (/^\|/.test(ln)) {
        out.push('· ' + ln.replace(/^\||\|$/g, '').split('|').map(function (x) {
          return x.trim();
        }).filter(function (x) { return x; }).join('：'));
      } else out.push(ln);
    }
    return out.join('\n');
  }

  /* ==================== 备份导出 / 导入 ==================== */
  function doExport() {
    var rows = S.rows.length ? S.rows : view();
    var payload = { app: 'molly-workbench', version: 3, exportedAt: new Date().toISOString(), rows: rows };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '工作台备份_' + todayKey() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    toast('已导出 JSON 备份');
    try { if (window.localStorage) window.localStorage.setItem('molly.lastBackup', String(Date.now())); } catch (e) {}
    renderAlerts();
  }

  function doImport(ev) {
    var input = ev.target;
    var file = input.files && input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data = null;
      try { data = JSON.parse(String(reader.result)); } catch (e) { toast('文件解析失败，请确认是导出的 JSON'); return; }
      var rows = (data && data.rows) || (Object.prototype.toString.call(data) === '[object Array]' ? data : []);
      if (!rows.length) { toast('文件里没有可导入的记录'); return; }
      var ok = 0, fail = 0, i = 0;
      var CH = 50;
      function step() {
        if (i >= rows.length) {
          toast('导入完成：成功 ' + ok + ' 条，失败 ' + fail + ' 条');
          input.value = '';
          reload();
          return;
        }
        var slice = rows.slice(i, i + CH);
        i += CH;
        var chain = Promise.resolve();
        slice.forEach(function (r) {
          chain = chain.then(function () {
            var props = {};
            var src = r;
            props['标题'] = { text: String(src['标题'] || '(无标题)') };
            props['类型'] = { select: src['类型'] || TYPE_TODO };
            props['状态'] = { select: src['状态'] || '待处理' };
            props['优先级'] = { select: src['优先级'] || 'P2 常规' };
            if (src['来源']) props['来源'] = { select: src['来源'] };
            props['关联项目'] = { text: String(src['关联项目'] || '') };
            props['关联人物'] = { text: String(src['关联人物'] || '') };
            props['计划日期'] = { date: toApiDate(src['计划日期']) };
            props['截止日期'] = { date: toApiDate(src['截止日期']) };
            props['标签'] = { text: String(src['标签'] || '') };
            props['内容'] = { text: String(src['内容'] || '') };
            props['下一步'] = { text: String(src['下一步'] || '') };
            props['卡点'] = { text: String(src['卡点'] || '') };
            props['待决策'] = { checkbox: !!src['待决策'] };
            props['顺延次数'] = { number: numericOrZero(src['顺延次数']) };
            props['完成时间'] = { number: numericOrZero(src['完成时间']) };
            props['创建时间'] = { number: numericOrZero(src['创建时间']) || Date.now() };
            props['更新时间'] = { number: Date.now() };
            return Store.add(props).then(function () { ok++; }, function () { fail++; });
          });
        });
        chain.then(step);
      }
      step();
    };
    reader.readAsText(file);
  }

  /* ==================== 顺延未完成 ==================== */
  function bindRoll() {
    document.getElementById('btnRoll').addEventListener('click', function () {
        var rows = view(), target = S.selDate || todayKey(), list = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (typeOf(r) !== TYPE_TODO || isDone(r)) continue;
        var d = dueKey(r) || planKey(r);
        if (d && d < target) list.push(r);
      }
      if (!list.length) { toast('没有需要顺延的事项'); return; }
      askConfirm({
        title: '顺延逾期事项',
        text: '将 ' + list.length + ' 条逾期未完成事项的计划日期顺延到 ' + dLabel(target) + '？\n\n' +
          '每条的「顺延次数」会 +1，方便回头看哪些事一直在往后拖。',
        yes: '确认顺延'
      }, function (ok) {
        if (!ok) return;
        var chain = Promise.resolve(), n = 0;
        list.forEach(function (r) {
          chain = chain.then(function () {
            var props = {};
            /* 顺延只挪日期，原来的时间点跟着一起走
               （约的是每天 14:30，顺延一天还得是 14:30） */
            var _t = timeOf(r['计划日期']);
            props['计划日期'] = { date: toApiDate(_t ? (target + ' ' + _t) : target) };
            props['顺延次数'] = { number: Number(r['顺延次数'] || 0) + 1 };
            props['更新时间'] = { number: nowStamp() };
            return Store.patch(r._id, props).then(function () { n++; });
          });
        });
        chain.then(function () { toast('已顺延 ' + n + ' 条'); reload(); });
      });
    });
  }

  window.__WB__.bindRoll = bindRoll;
  /* 注意：bindExtra 只在文件末尾统一赋值一次（下面还挂了 bindProjects/bindNotes/bindTaskList）。
     这里以前还有一行只挂 bindRoll 的同名赋值，它会被末尾那处覆盖、是死代码 ——
     留着只会让后来的人改错地方（改它不生效）。已删掉。 */
  window.__WB__.openEdit = openEdit;
  window.__WB__.itemHTML = itemHTML;
  window.__WB__.groupHTML = groupHTML;
  window.__WB__.optIdByName = optIdByName;
  window.__WB__.optTextById = optTextById;
  window.__WB__.copyText = copyText;
  window.__WB__.deleteRow = deleteRow;
  window.__WB__.toggleDone = toggleDone;
  window.__WB__.saveDraft = saveDraft;
  window.__WB__.numericOrZero = numericOrZero;
  window.__WB__.fillSelects = fillSelects;
  window.__WB__.S = S;

  /* 每周复盘对外暴露（供冒烟测试） */
  window.__WB__.renderReview = renderReview;
  window.__WB__.buildReview = buildReview;
  window.__WB__.buildReviewPlain = buildReviewPlain;
  window.__WB__.openReview = openReview;
  window.__WB__.setWeekOff = setWeekOff;
  window.__WB__.ensureLib = ensureLib;
  window.__WB__.weekStartKey = weekStartKey;
  window.__WB__.weekEndKey = weekEndKey;
  window.__WB__.weekLabel = weekLabel;
  window.__WB__.weekDoneRows = weekDoneRows;
  window.__WB__.weekCreatedCount = weekCreatedCount;
  window.__WB__.weekNoteRows = weekNoteRows;
  window.__WB__.weekPrioDist = weekPrioDist;
  window.__WB__.weekPrioUntagged = weekPrioUntagged;
  window.__WB__.weekThemeDist = weekThemeDist;
  window.__WB__.weekSusRows = weekSusRows;
  window.__WB__.weekStuckProjects = weekStuckProjects;
  window.__WB__.weekOverdueRows = weekOverdueRows;
  window.__WB__.overdueDays = overdueDays;
  window.__WB__.libThemeCount = libThemeCount;
  window.__WB__.bestDoneDay = bestDoneDay;
  window.__WB__.themeCodeOf = themeCodeOf;
  window.__WB__.themeLabelOf = themeLabelOf;
  window.__WB__.bindReviewDialog = bindReviewDialog;
  window.__WB__.switchTab = switchTab;
  window.__WB__.tabFromHash = tabFromHash;
  window.__WB__.syncHash = syncHash;
  window.__WB__.bindHashRoute = bindHashRoute;

  /* ==== MODULE_1_JS ==== */
  /* ==================== 模块二：项目推进台 ==================== */
  function ringSVG(pct) {
    var r = 16, c = 2 * Math.PI * r;
    var off = c * (1 - Math.max(0, Math.min(1, pct)));
    var color = pct >= 1 ? '#1F7F66' : '#B0577B';
    return '<svg class="ring" viewBox="0 0 40 40" aria-hidden="true">' +
      '<circle cx="20" cy="20" r="16" fill="none" stroke="#F1E1E8" stroke-width="4"></circle>' +
      '<circle cx="20" cy="20" r="16" fill="none" stroke="' + color + '" stroke-width="4" stroke-linecap="round" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 20 20)"></circle>' +
      '<text x="20" y="23.5" text-anchor="middle" font-size="10.5" fill="#6D5A73">' + Math.round(pct * 100) + '%</text></svg>';
  }

  function projStats(item) {
    var list = item.todos, done = 0, over = 0;
    for (var i = 0; i < list.length; i++) {
      if (isDone(list[i])) done++;
      else if (isOverdue(list[i])) over++;
    }
    return { total: list.length, done: done, over: over, pct: list.length ? done / list.length : 0 };
  }

  function statusPill(row) {
    var st = row ? (row['状态'] || '') : '';
    if (!st) return '<span class="pill">未立项</span>';
    var cls = st === '已完成' ? 'due' : (st === '进行中' ? 'src' : (st === '已搁置' ? '' : ''));
    var style = st === '已完成' ? 'background:var(--green-weak);color:var(--green)' : (st === '进行中' ? 'background:var(--pri-weak);color:var(--pri2)' : '');
    return '<span class="pill" style="' + style + '">' + esc(st) + '</span>';
  }

  function projCardHTML(item) {
    var st = projStats(item);
    var row = item.row;
    var open = (S.openProj === item.name) ? ' open' : '';
    var next = row ? (row['下一步'] || '') : '';
    var block = row ? (row['卡点'] || '') : '';
    var h = '<div class="pcard' + open + '" data-proj="' + esc(item.name) + '">';
    h += '<div class="phead">' +
      '<h3 data-k="标题" data-sp-bindable="database" data-sp-database-id="ggytTE4Cvh4Nyi3nBAcdxD">' + esc(item.name) + '</h3>' +
      ringSVG(st.pct) + '</div>';
    h += '<div style="display:flex;gap:6px;flex-wrap:wrap" data-k="状态" data-sp-bindable="database" data-sp-database-id="ggytTE4Cvh4Nyi3nBAcdxD">' +
      statusPill(row) + '<span class="pill">待办 ' + st.total + '</span><span class="pill">完成 ' + st.done + '</span>' +
      (st.over ? '<span class="pill due">逾期 ' + st.over + '</span>' : '') +
      '<span class="pill proj">沉淀 ' + item.notes.length + '</span></div>';
    if (next) h += '<div class="line"><span class="k">下一步</span><span data-k="下一步">' + esc(next) + '</span></div>';
    if (block) h += '<div class="line"><span class="k">卡点</span><span data-k="卡点" style="color:var(--red)">' + esc(block) + '</span></div>';
    if (!row) h += '<div class="line"><span class="k">提示</span><span class="muted mini">由记录中的「关联项目」自动聚合，尚未建立项目本体</span></div>';
    h += '<div class="pfoot">' +
      '<button class="btn sm ghost" data-pact="toggle" data-name="' + esc(item.name) + '">' + (open ? '收起明细' : '展开明细') + '</button>' +
      (row ? '<button class="btn sm ghost" data-pact="edit" data-id="' + esc(row._id) + '">编辑项目</button>'
           : '<button class="btn sm ghost" data-pact="create" data-name="' + esc(item.name) + '">立项</button>') +
      /* 「改名」对已立项和未立项的卡片都开放：未立项的卡片只有这一条路能纠名，
         否则用户看着一个名字写错的项目却无从下手（这正是「改不了」的现场）。 */
      '<button class="btn sm ghost" data-pact="rename" data-name="' + esc(item.name) + '"' +
        (row ? ' data-id="' + esc(row._id) + '"' : '') + '>改名</button>' +
      '</div>';
    if (open) {
      h += '<div class="pdetail">';
      h += '<div class="dh">该项目下的待办（' + item.todos.length + '）</div>';
      h += item.todos.length ? item.todos.map(itemHTML).join('') : '<div class="mini muted">暂无待办</div>';
      h += '<div class="dh" style="margin-top:10px">该项目下的沉淀（' + item.notes.length + '）</div>';
      h += item.notes.length
        ? item.notes.map(function (n) {
            return '<div class="mini" style="padding:4px 0;border-bottom:1px dashed var(--line)">' +
              '<b>' + esc(n['标题'] || '') + '</b>' + (n['内容'] ? ' — <span class="muted">' + esc(String(n['内容']).slice(0, 70)) + '</span>' : '') + '</div>';
          }).join('')
        : '<div class="mini muted">暂无沉淀</div>';
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function renderProjects() {
    var host = document.getElementById('projectList');
    if (!host) return;
    var ps = projectIndex();
    var hint = document.getElementById('projHint');
    if (hint) hint.textContent = '共 ' + ps.length + ' 个项目';
    if (!ps.length) {
      host.innerHTML = '<div class="card"><div class="empty">' +
        '<svg class="ico lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:30px;height:30px"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3l2 2.5h8A2.5 2.5 0 0 1 21 10v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17V7.5Z"/></svg>' +
        '<div>还没有项目。点上方「新建项目」，或在待办里填「关联项目」，这里会自动聚合。</div></div></div>';
      return;
    }
    host.innerHTML = '<div class="pgrid" data-sp-bindable="database" data-sp-database-id="ggytTE4Cvh4Nyi3nBAcdxD">' +
      ps.map(projCardHTML).join('') + '</div>';
  }

  function onProjectAction(e) {
    var b = e.target.closest('button[data-pact]');
    if (!b) return;
    var act = b.getAttribute('data-pact');
    if (act === 'toggle') {
      var nm = b.getAttribute('data-name');
      S.openProj = (S.openProj === nm) ? '' : nm;
      renderProjects();
      return;
    }
    if (act === 'edit') {
      var id = b.getAttribute('data-id'), rows = view(), row = null;
      for (var i = 0; i < rows.length; i++) if (rows[i]._id === id) row = rows[i];
      if (!row) return;
        openEdit(row);
      return;
    }
    if (act === 'rename') {
      openRename(b.getAttribute('data-name') || '', b.getAttribute('data-id') || '');
      return;
    }
    if (act === 'create') {
      openEdit(null);
      var t = document.getElementById('e-type');
      if (t) {
        var pid = optIdByName('类型', TYPE_PROJ);
        if (pid) t.value = pid;
        syncNextBlockVisibility();
      }
      document.getElementById('e-title').value = b.getAttribute('data-name') || '';
      document.getElementById('e-project').value = b.getAttribute('data-name') || '';
      toast('已带出项目名，补上下一步与卡点即可');
    }
  }
  /* ==================== 改项目名（联动归属） ====================
     项目名就是聚合键：待办/沉淀靠「关联项目」这个文本框指向项目。所以改名不能只改
     项目记录自己的标题 —— 那样原先挂在它下面的待办会全部脱钩，项目看起来「被改散了」。
     这里把两边一起改：① 有项目记录 → 顺带改它的标题；② 所有「关联项目」= 旧名的记录
     → 把「关联项目」改成新名。未立项的空壳卡片也走同一条路，所以只有名字的项目也能纠名。 */
  var rnOld = '', rnRowId = '';
  function renameAffected(name) {
    var rows = view(), out = [], todos = 0, notes = 0, other = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (String(r['关联项目'] || '').trim() !== name) continue;
      out.push(r);
      if (typeOf(r) === TYPE_TODO) todos++;
      else if (typeOf(r) === TYPE_NOTE) notes++;
      else other++;
    }
    return { rows: out, todos: todos, notes: notes, other: other };
  }
  function renderRenameHint() {
    var el = document.getElementById('rnHint');
    if (!el) return;
    var a = renameAffected(rnOld), who = [];
    if (a.todos) who.push(a.todos + ' 条待办');
    if (a.notes) who.push(a.notes + ' 条沉淀');
    if (a.other) who.push(a.other + ' 条其他记录');
    var h = '项目名就是聚合键：待办靠「关联项目」这个名字找到所属项目。';
    h += who.length
      ? '改名后，挂在它下面的 ' + who.join('、') + ' 会跟着改归属。'
      : '目前还没有记录挂在这个名字下，改名不会影响其他记录。';
    h += rnRowId ? ' 已立项，项目记录本身的标题也会一起改。'
                 : ' 还没立项，只改归属（随时可以再点「立项」补上项目本体）。';
    el.textContent = h;
  }
  function openRename(name, rowId) {
    rnOld = String(name || '').trim();
    rnRowId = String(rowId || '');
    var mask = document.getElementById('rnMask');
    var inp = document.getElementById('rnName');
    if (!mask || !inp) return;
    inp.value = rnOld;
    renderRenameHint();
    mask.classList.add('on');
    try { inp.focus(); } catch (e) {}
  }
  function closeRename() {
    var mask = document.getElementById('rnMask');
    if (mask) mask.classList.remove('on');
    rnOld = ''; rnRowId = '';
  }
  /* 只改「关联项目」一个字段，不动别的 —— 项目名是唯一的聚合键，改了它就换了归属 */
  function renameLinked(oldName, newName, exceptId) {
    var aff = renameAffected(oldName).rows, chain = Promise.resolve(), n = 0;
    for (var i = 0; i < aff.length; i++) {
      (function (r) {
        if (exceptId && r._id === exceptId) return;
        chain = chain.then(function () {
          return Store.patch(r._id, { '关联项目': { text: newName } })
            .then(function () { n++; }, function () {});
        });
      })(aff[i]);
    }
    return chain.then(function () { return n; });
  }
  function doRename() {
    var inp = document.getElementById('rnName');
    var nn = String((inp && inp.value) || '').trim();
    if (!nn) { toast('项目名不能为空'); return; }
    if (nn === rnOld) { closeRename(); return; }
    if (!Store.hasDB) { toast('资料库未连接，无法改名'); return; }
    var old = rnOld, rid = rnRowId;
    var btn = document.getElementById('rnOk');
    if (btn) btn.disabled = true;
    var head;
    if (rid) {
      var patch = { '标题': { text: nn }, '更新时间': { number: nowStamp() } };
      var rs = view();
      for (var i = 0; i < rs.length; i++) {
        /* 项目记录自己的「关联项目」若写着旧名，一并对齐：
           否则它自己会以旧名再长出一张空壳卡，用户看到的是「改了又多一个」 */
        if (rs[i]._id === rid && String(rs[i]['关联项目'] || '').trim() === old) {
          patch['关联项目'] = { text: nn };
        }
      }
      head = Store.patch(rid, patch);
    } else {
      head = Promise.resolve(true);
    }
    head.then(function () { return renameLinked(old, nn, rid); }).then(function (n) {
      if (btn) btn.disabled = false;
      closeRename();
      toast('已改名为「' + nn + '」' + (n ? '，' + n + ' 条记录的归属跟着改了' : ''));
      return reload();
    }).catch(function () {
      if (btn) btn.disabled = false;
      toast('改名失败，请重试');
    });
  }
  function bindRenameDialog() {
    var g = function (id) { return document.getElementById(id); };
    if (!g('rnMask')) return;
    g('rnClose').addEventListener('click', closeRename);
    g('rnCancel').addEventListener('click', closeRename);
    g('rnMask').addEventListener('click', function (e) { if (e.target === this) closeRename(); });
    g('rnOk').addEventListener('click', doRename);
    g('rnName').addEventListener('keydown', function (e) {
      /* 回车即确认：这个弹窗只有一个字段，多一次点击没有意义 */
      if (e.key === 'Enter' || e.keyCode === 13) doRename();
    });
  }
  /* ==================== 整理项目（归并建议 + 合并） ====================
     项目名是聚合键，写歪一个名字就多一张卡。整段不依赖任何外部服务，全在本地算：
       ① 归一化 —— 全角转半角、去标点空格、剥「项目 / 专项 / 计划」等通用后缀
       ② 中文 2-gram 重叠 —— 中文没分词也能抓住「新媒体 / 社交媒体」共用的「媒体」
       ③ 归一后字面相同 —— 判定重复的最高置信度
     算法只给建议，绝不自动合并：合并是业务判断（「投流」和「新媒体」在算法眼里没有共同词，
     但你知道它们是不是一回事），所以留了手动勾选兜底。 */

  var pjState = null;   /* 渲染时的勾选态；DOM 只负责显示，判断一律读这里 */

  function projKind(s) {
    var t = String(s == null ? '' : s).toLowerCase();
    /* 全角 → 半角 */
    t = t.replace(/[\uff01-\uff5e]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xfee0);
    });
    t = t.replace(/\u3000/g, ' ');
    /* 去分隔符（含中英文标点与常见装饰符） */
    t = t.replace(/[\s·・,，.。、;；:：!！?？'"“”‘’()（）\[\]【】{}《》<>_—\-+※*&#@\/\\|~]/g, '');
    /* 剥通用后缀：可叠加（「XX项目计划」要剥两次） */
    var tail = /(项目|专项|计划|方案|事宜|工作|事项|相关)$/;
    for (var i = 0; i < 3; i++) {
      var n = t.replace(tail, '');
      if (n === t || !n) break;
      t = n;
    }
    return t;
  }

  function bgOf(s) {
    var o = [], i;
    if (s.length < 2) return s.length ? [s] : [];
    for (i = 0; i < s.length - 1; i++) o.push(s.substr(i, 2));
    return o;
  }

  /* 两个项目名为什么可能是同一个；返回空串表示「不像」 */
  function projPairReason(a, b) {
    var ka = projKind(a), kb = projKind(b);
    if (!ka || !kb || ka === kb && String(a) === String(b)) return '';
    if (ka === kb) return '去掉大小写、标点与「项目」这类后缀之后，两个名字完全一样';
    if (ka.length >= 2 && kb.length >= 2 && (ka.indexOf(kb) !== -1 || kb.indexOf(ka) !== -1)) {
      return '一个名字包含了另一个（' + (ka.length <= kb.length ? ka : kb) + '）';
    }
    if (ka.length < 2 || kb.length < 2) return '';
    var A = bgOf(ka), B = bgOf(kb), seen = {}, shared = [], i;
    for (i = 0; i < A.length; i++) seen[A[i]] = 1;
    for (i = 0; i < B.length; i++) {
      if (seen[B[i]] === 1) { shared.push(B[i]); seen[B[i]] = 2; }
    }
    var minN = Math.min(A.length, B.length);
    if (shared.length && minN && shared.length / minN >= 0.5) {
      return '共用了「' + shared.join('」「') + '」，可能是同一件事的不同叫法';
    }
    return '';
  }

  /* 保留哪一个：有项目本体的优先（说明真建过、有下一步/卡点）> 挂记录多的 > 名字更具体的 */
  function pickKeep(ms) {
    var best = ms[0];
    for (var i = 1; i < ms.length; i++) {
      var b = ms[i];
      if (!!b.hasBody !== !!best.hasBody) { if (b.hasBody) best = b; continue; }
      if (b.n !== best.n) { if (b.n > best.n) best = b; continue; }
      if (String(b.name).length > String(best.name).length) best = b;
    }
    return best;
  }

  /* 并查集聚类：把互相「像」的名字合成一组 */
  function projSuggest(items) {
    var n = items.length, parent = [], i, j;
    for (i = 0; i < n; i++) parent.push(i);
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function uni(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
    var pairs = [];
    for (i = 0; i < n; i++) {
      for (j = i + 1; j < n; j++) {
        var r = projPairReason(items[i].name, items[j].name);
        if (r) { uni(i, j); pairs.push([i, j, r]); }
      }
    }
    var byRoot = {};
    for (i = 0; i < n; i++) {
      var rt = find(i);
      if (!byRoot[rt]) byRoot[rt] = { members: [], reason: '' };
      byRoot[rt].members.push(items[i]);
    }
    for (i = 0; i < pairs.length; i++) {
      var gr = byRoot[find(pairs[i][0])];
      if (gr && !gr.reason) gr.reason = pairs[i][2];
    }
    var out = [];
    for (var k in byRoot) {
      if (!Object.prototype.hasOwnProperty.call(byRoot, k)) continue;
      var g = byRoot[k];
      if (g.members.length < 2) continue;
      g.members.sort(function (a, b) { return b.n - a.n; });
      g.keep = pickKeep(g.members).name;
      out.push(g);
    }
    out.sort(function (a, b) { return b.members.length - a.members.length; });
    return out;
  }

  function projMergeItems() {
    return projectIndex().map(function (p) {
      return { name: p.name, n: p.todos.length + p.notes.length, hasBody: !!p.row, on: false, keep: false };
    });
  }

  function renderProjMerge() {
    var host = document.getElementById('pjList');
    var lead = document.getElementById('pjLead');
    if (!host) return;
    var items = projMergeItems();
    if (items.length < 2) {
      pjState = items;
      if (lead) lead.textContent = '项目太少，还不需要整理。';
      host.innerHTML = '';
      return;
    }
    var groups = projSuggest(items);
    var inGroup = {}, i, j;
    for (i = 0; i < groups.length; i++) {
      for (j = 0; j < groups[i].members.length; j++) inGroup[groups[i].members[j].name] = 1;
    }
    /* 建议组默认全勾、推荐项默认当保留；其他项目默认不勾，等用户自己动手 */
    for (i = 0; i < groups.length; i++) {
      for (j = 0; j < groups[i].members.length; j++) {
        groups[i].members[j].on = true;
        groups[i].members[j].keep = (groups[i].members[j].name === groups[i].keep);
      }
    }
    var rest = items.filter(function (x) { return !inGroup[x.name]; });

    var flat = [];
    var h = '';
    if (groups.length) {
      if (lead) {
        lead.textContent = '我找出 ' + groups.length + ' 组可能重复的名字，已帮你勾好；确认「保留」哪一个，点右下角合并即可。';
      }
      for (i = 0; i < groups.length; i++) {
        h += '<div class="pjgrp">';
        for (j = 0; j < groups[i].members.length; j++) {
          var m = groups[i].members[j];
          m.slot = flat.length; flat.push(m);
          h += '<div class="pjrow' + (m.keep ? ' on' : '') + '">' +
            '<label class="pjc"><input type="checkbox" id="pjc-' + m.slot + '" data-pj="' + esc(m.name) + '"' + (m.on ? ' checked' : '') + '>' +
            '<span class="nm">' + esc(m.name) + '</span></label>' +
            '<span class="cnt">' + m.n + ' 条' + (m.hasBody ? ' · 有本体' : '') + '</span>' +
            '<label class="pjkeep"><input type="radio" id="pjk-' + m.slot + '" name="pjkeep" data-pjk="' + esc(m.name) + '"' + (m.keep ? ' checked' : '') + '>保留</label>' +
            '</div>';
        }
        h += '<div class="pjreason">判断依据：' + esc(groups[i].reason) + '</div>';
        h += '</div>';
      }
    } else if (lead) {
      lead.textContent = '没找出明显重复的名字。如果还有你想合并成同一个项目的，在下面勾选，选一个「保留」即可。';
    }
    if (rest.length) {
      h += '<div class="pjleadsep">其他项目（也可勾上一起合并）</div>';
      for (i = 0; i < rest.length; i++) {
        var r2 = rest[i];
        r2.slot = flat.length; flat.push(r2);
        h += '<div class="pjrow">' +
          '<label class="pjc"><input type="checkbox" id="pjc-' + r2.slot + '" data-pj="' + esc(r2.name) + '">' +
          '<span class="nm">' + esc(r2.name) + '</span></label>' +
          '<span class="cnt">' + r2.n + ' 条' + (r2.hasBody ? ' · 有本体' : '') + '</span>' +
          '<label class="pjkeep"><input type="radio" id="pjk-' + r2.slot + '" name="pjkeep" data-pjk="' + esc(r2.name) + '">保留</label>' +
          '</div>';
      }
    }
    pjState = flat;
    host.innerHTML = h;
  }

  function openProjMerge() {
    var mask = document.getElementById('pjMask');
    if (!mask) return;
    renderProjMerge();
    mask.classList.add('on');
  }
  function closeProjMerge() {
    var mask = document.getElementById('pjMask');
    if (mask) mask.classList.remove('on');
  }

  /* 勾选态同步：DOM 只是显示层，判断一律读 pjState —— 这样不用依赖桩/浏览器的选择器能力 */
  function pjOnChange(e) {
    var t = e.target;
    if (!t || !t.getAttribute || !pjState) return;
    var nm = t.getAttribute('data-pj');
    if (nm != null) {
      for (var i = 0; i < pjState.length; i++) {
        if (pjState[i].name === nm) { pjState[i].on = !!t.checked; }
      }
      return;
    }
    var kn = t.getAttribute('data-pjk');
    if (kn != null) {
      for (var j = 0; j < pjState.length; j++) {
        var pick = (pjState[j].name === kn);
        pjState[j].keep = pick;
        if (pick) {
          pjState[j].on = true;
          var cb = document.getElementById('pjc-' + pjState[j].slot);
          if (cb) cb.checked = true;
        }
      }
    }
  }

  /* 把 from 归并到 to：只动「关联项目」这一个字段，记录本体一条不删。
     项目本体三种情况分开处理，否则会出现「两条同名项目记录」这种新的脏数据。 */
  function mergeProj(fromName, toName) {
    var rows = view(), src = null, dst = null, i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (typeOf(r) !== TYPE_PROJ) continue;
      var t = String(r['标题'] || '').trim();
      if (t === fromName) src = r;
      else if (t === toName) dst = r;
    }
    var head;
    if (src && !dst) {
      /* 只有被并方有本体 → 把本体改名搬过来，下一步 / 卡点 / 内容全部保留 */
      head = Store.patch(src._id, {
        '标题': { text: toName },
        '关联项目': { text: toName },
        '更新时间': { number: nowStamp() }
      });
    } else if (src && dst) {
      /* 两边都有本体 → 先把被并方的推进信息并进保留项，再删掉它的记录（避免同名两条） */
      var old = String(dst['内容'] || '').trim(), lines = [];
      ['内容', '下一步', '卡点'].forEach(function (k) {
        var v = String(src[k] || '').trim();
        if (v) lines.push('〔原「' + fromName + '」的' + k + '〕' + v);
      });
      var patch = { '更新时间': { number: nowStamp() } };
      if (lines.length) patch['内容'] = { text: (old ? old + '\n' : '') + lines.join('\n') };
      head = Store.patch(dst._id, patch).then(function () {
        return Store.remove(src._id).then(function () { return true; }, function () { return true; });
      });
    } else {
      head = Promise.resolve(true);
    }
    return head.then(function () {
      return renameLinked(fromName, toName, src ? src._id : null);
    });
  }

  function doProjMerge() {
    if (!pjState || pjState.length < 2) { toast('没有可整理的项目'); return; }
    var sel = [], keep = '', i;
    for (i = 0; i < pjState.length; i++) if (pjState[i].on) sel.push(pjState[i]);
    if (sel.length < 2) { toast('至少勾选两个项目名才能合并'); return; }
    for (i = 0; i < sel.length; i++) if (sel[i].keep) keep = sel[i].name;
    if (!keep) keep = sel[0].name;              /* 没点「保留」就默认第一个，不挡用户 */
    var from = [];
    for (i = 0; i < sel.length; i++) {
      if (sel[i].name === keep) continue;
      from.push(sel[i].name);
    }
    if (!from.length) { toast('除了保留项没有别的了，再勾一个要并进去的'); return; }
    if (!Store.hasDB) { toast('资料库未连接，无法合并'); return; }
    var btn = document.getElementById('pjOk');
    if (btn) btn.disabled = true;
    var chain = Promise.resolve(), moved = 0;
    from.forEach(function (nm) {
      chain = chain.then(function () {
        return mergeProj(nm, keep).then(function (x) { moved += (x || 0); });
      });
    });
    chain.then(function () {
      if (btn) btn.disabled = false;
      closeProjMerge();
      toast('已把 ' + from.length + ' 个项目名并入「' + keep + '」' +
        (moved ? '，' + moved + ' 条记录的归属跟着改了' : ''));
      return reload();
    }).catch(function () {
      if (btn) btn.disabled = false;
      toast('合并中断了，刷新后重试（已合并的不会回滚）');
    });
  }

  function bindProjMerge() {
    var g = function (id) { return document.getElementById(id); };
    if (!g('pjMask')) return;
    g('pjClose').addEventListener('click', closeProjMerge);
    g('pjCancel').addEventListener('click', closeProjMerge);
    g('pjMask').addEventListener('click', function (e) { if (e.target === this) closeProjMerge(); });
    g('pjOk').addEventListener('click', doProjMerge);
    g('pjList').addEventListener('change', pjOnChange);
    var b = g('btnProjMerge');
    if (b) b.addEventListener('click', openProjMerge);
  }

  /* ==================== 「关联项目」防重复（内联提示 + 保存拦截） ====================
     重复的根子是这个自由文本框：datalist 只是软提示，手打一个「小黄蜂&健医师项目」
     照样入库，于是多出一张谁也看不见谁的卡。这里补两道：
       ① 输入时就提示「已有 X · 就用它」，一键采用，不用手动敲回去；
       ② 保存时若仍与已有名字撞上，拦一次让用户明确选（并入 / 确实要新建）。
     判定刻意收窄到「归一后相同」与「包含关系」—— 2-gram 相似太松（「新媒体」和
     「社交媒体」也只是"可能"），那种只进「整理项目」的建议，不拿来拦人。 */
  function similarProj(name) {
    var nn = String(name || '').trim();
    if (!nn) return '';
    var k = projKind(nn);
    if (!k) return '';
    var ps = projectIndex();
    for (var i = 0; i < ps.length; i++) {
      var ex = String(ps[i].name || '').trim();
      if (!ex || ex === nn) continue;
      var ke = projKind(ex);
      if (!ke) continue;
      if (ke === k) return ex;
      if (ke.length >= 2 && k.length >= 2 &&
          (ke.indexOf(k) !== -1 || k.indexOf(ke) !== -1)) return ex;
    }
    return '';
  }

  function renderProjHint() {
    var el = document.getElementById('eProjHint');
    var inp = document.getElementById('e-project');
    if (!el || !inp) return;
    var v = String(inp.value || '').trim();
    var hit = v ? similarProj(v) : '';
    if (!hit) { el.textContent = ''; el.style.display = 'none'; return; }
    el.innerHTML = '已有「' + esc(hit) + '」，像是同一个项目。' +
      '<b class="useproj" data-useproj="' + esc(hit) + '">就用它</b>';
    el.style.display = '';
  }

  function bindProjHint() {
    var inp = document.getElementById('e-project');
    if (inp && !S.ePhBound) {
      S.ePhBound = 1;
      inp.addEventListener('input', renderProjHint);
      inp.addEventListener('change', renderProjHint);
    }
    var host = document.getElementById('editMask');
    if (host && !S.ePhClick) {
      S.ePhClick = 1;
      host.addEventListener('click', function (e) {
        var t = e.target;
        var b = (t && t.closest) ? t.closest('[data-useproj]') : null;
        if (!b) return;
        var i2 = document.getElementById('e-project');
        if (i2) i2.value = b.getAttribute('data-useproj') || '';
        renderProjHint();
      });
    }
  }

  /* ==================== 通用确认弹窗（替代 window.confirm） ====================
     原生的 confirm 在 iframe 里可能被 sandbox 静默拦掉：不弹、直接返回 false。
     后果很隐蔽 —— 「删除」永远删不掉、「顺延」点了没反应，而且控制台干干净净。
     这里自己画一个，回调式（同步阻塞做不到，也不该做）。 */
  var cfCb = null;
  function askConfirm(o, cb) {
    o = o || {};
    var mask = document.getElementById('cfMask');
    if (!mask) { if (cb) cb(false); return; }
    cfCb = cb || null;
    var el;
    el = document.getElementById('cfTitle'); if (el) el.textContent = o.title || '请确认';
    el = document.getElementById('cfText'); if (el) el.textContent = o.text || '';
    el = document.getElementById('cfYes'); if (el) el.textContent = o.yes || '确定';
    el = document.getElementById('cfNo'); if (el) el.textContent = o.no || '取消';
    mask.classList.add('on');
  }
  function closeConfirm(yes) {
    var mask = document.getElementById('cfMask');
    if (mask) mask.classList.remove('on');
    var cb = cfCb;
    cfCb = null;
    if (cb) cb(!!yes);          /* 先清空再回调：回调里可能又弹一个确认 */
  }
  function bindConfirmDialog() {
    var g = function (id) { return document.getElementById(id); };
    if (!g('cfMask') || S.cfBound) return;
    S.cfBound = 1;
    g('cfYes').addEventListener('click', function () { closeConfirm(true); });
    g('cfNo').addEventListener('click', function () { closeConfirm(false); });
    g('cfClose').addEventListener('click', function () { closeConfirm(false); });
    g('cfMask').addEventListener('click', function (e) { if (e.target === this) closeConfirm(false); });
  }

  /* ---- 完成结果输入弹窗：cb 收到输入文本；取消/点遮罩收到 null（绝不写库） ---- */
  var doneCb = null;
  function openDonePrompt(title, cb) {
    var mask = document.getElementById('doneMask');
    if (!mask) { if (cb) cb(''); return; }   /* 弹窗缺失时降级为直接完成，不阻塞打钩 */
    doneCb = cb || null;
    var el;
    el = document.getElementById('doneTitle'); if (el) el.textContent = '完成 · ' + (title || '');
    el = document.getElementById('doneInput'); if (el) el.value = '';
    mask.classList.add('on');
    if (el && el.focus) { try { el.focus(); } catch (e) {} }
  }
  function closeDonePrompt(val) {
    var mask = document.getElementById('doneMask');
    if (mask) mask.classList.remove('on');
    var cb = doneCb;
    doneCb = null;
    if (cb) cb(val);            /* 先清空再回调：回调里可能再弹别的框 */
  }
  function bindDonePrompt() {
    var g = function (id) { return document.getElementById(id); };
    if (!g('doneMask') || S.doneBound) return;
    S.doneBound = 1;
    g('doneOk').addEventListener('click', function () {
      var el = g('doneInput');
      closeDonePrompt(el ? String(el.value || '').trim() : '');
    });
    g('doneCancel').addEventListener('click', function () { closeDonePrompt(null); });
    g('doneClose').addEventListener('click', function () { closeDonePrompt(null); });
    g('doneMask').addEventListener('click', function (e) { if (e.target === this) closeDonePrompt(null); });
    g('doneInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') closeDonePrompt(String(e.target.value || '').trim());
    });
  }
  /* ==================== 模块三：知识沉淀库（双链） ==================== */
  function renderWiki(raw) {
    var safe = esc(raw);
    var targets = linkTargetsAll();
    return safe.replace(/\[\[([^\[\]]{1,40})\]\]/g, function (m, name) {
      var t = String(name).trim();
      var live = Object.prototype.hasOwnProperty.call(targets, t);
      return '<span class="wl' + (live ? '' : ' dead') + '" data-wl="' + esc(t) + '">[[' + esc(t) + ']]</span>';
    });
  }

  function noteMatches(n) {
    var q = String(S.noteQ || '').trim().toLowerCase();
    if (!q) return true;
    var hay = String(n['标题'] || '') + ' ' + String(n['内容'] || '') + ' ' + String(n['标签'] || '') + ' ' +
      String(n['关联项目'] || '') + ' ' + String(n['关联人物'] || '');
    return hay.toLowerCase().indexOf(q) !== -1;
  }

  function noteCardHTML(n) {
    var bl = backlinksOf(n['标题'] || '');
    var h = '<div class="ncard">';
    h += '<h3 data-k="标题" data-sp-bindable="database" data-sp-database-id="ggytTE4Cvh4Nyi3nBAcdxD">' + esc(n['标题'] || '(无标题)') + '</h3>';
    if (n['内容']) h += '<div class="nbody">' + renderWiki(n['内容']) + '</div>';
    h += '<div class="nmeta">';
    if (n['关联项目']) h += '<span class="pill proj">' + esc(n['关联项目']) + '</span>';
    if (n['关联人物']) h += '<span class="pill">' + esc(n['关联人物']) + '</span>';
    var ts = tagsOf(n);
    for (var i = 0; i < ts.length; i++) h += '<span class="pill">#' + esc(ts[i]) + '</span>';
    h += '</div>';
    if (bl.length) {
      h += '<div class="bl"><b>被 ' + bl.length + ' 条引用：</b>' +
        bl.map(function (x) { return esc(x['标题'] || ''); }).join(' · ') + '</div>';
    }
    h += '<div style="display:flex;gap:6px;justify-content:flex-end">' +
      '<button class="btn sm ghost" data-nact="edit" data-id="' + esc(n._id) + '">编辑</button>' +
      '<button class="btn sm ghost" data-nact="del" data-id="' + esc(n._id) + '">删除</button></div>';
    h += '</div>';
    return h;
  }

  function sectionHTML(title, list) {
    return '<div class="card"><div class="card-head"><h2>' + esc(title) + '</h2>' +
      '<span class="mini muted" data-sp-bindable="database" data-sp-database-id="ggytTE4Cvh4Nyi3nBAcdxD">' + list.length + ' 条</span></div>' +
      '<div class="ngrid">' + list.map(noteCardHTML).join('') + '</div></div>';
  }

  /* ---- 蒸馏草稿：本地 distill_notes.py 生成、带「蒸馏草稿」标签的沉淀。
     它们只是待确认的草稿 —— 在普通视图一律不可见，只在待确认区出现；
     确认转正 = 摘掉「蒸馏草稿」标签，进入正式知识库。 ---- */
  var DRAFT_TAG = '蒸馏草稿';
  function isDraftNote(n) { return tagsOf(n).indexOf(DRAFT_TAG) !== -1; }

  function draftCardHTML(n) {
    var bl = backlinksOf(n['标题'] || '');
    var h = '<div class="ncard draft">';
    h += '<h3>' + esc(n['标题'] || '(无标题)') + '</h3>';
    h += '<div class="nmeta"><span class="pill dec">' + DRAFT_TAG + '</span>';
    if (n['关联项目']) h += '<span class="pill proj">' + esc(n['关联项目']) + '</span>';
    if (n['主题']) h += '<span class="pill">' + esc(n['主题']) + '</span>';
    h += '</div>';
    if (n['内容']) h += '<div class="nbody">' + renderWiki(n['内容']) + '</div>';
    if (bl.length) {
      h += '<div class="bl"><b>被 ' + bl.length + ' 条引用：</b>' +
        bl.map(function (x) { return esc(x['标题'] || ''); }).join(' · ') + '</div>';
    }
    h += '<div style="display:flex;gap:6px;justify-content:flex-end">' +
      '<button class="btn sm pri" data-nact="confirm" data-id="' + esc(n._id) + '">确认转正</button>' +
      '<button class="btn sm ghost" data-nact="editdraft" data-id="' + esc(n._id) + '">编辑后再确认</button></div>';
    h += '</div>';
    return h;
  }

  function renderDraftZone(drafts) {
    var cnt = document.getElementById('draftCnt');
    if (cnt) cnt.textContent = drafts.length ? drafts.length + ' 条待确认' : '';
    var zone = document.getElementById('noteDrafts');
    if (!zone) return;
    zone.innerHTML = drafts.length
      ? '<div class="ngrid">' + drafts.map(draftCardHTML).join('') + '</div>'
      : '<div class="mini muted" style="padding:4px 2px">暂无待确认的蒸馏草稿。本地 distill_notes.py 跑完后，草稿会出现在这里。</div>';
  }

  function confirmDraft(row) {
    var ts = tagsOf(row).filter(function (t) { return t !== DRAFT_TAG; });
    var props = {};
    props['标签'] = { text: ts.join(',') };
    props['更新时间'] = { number: nowStamp() };
    Store.patch(row._id, props).then(function () {
      toast('已转正，进入知识库');
      return reload();
    }).catch(function () { toast('保存失败，请重试'); });
  }

  function renderNotes() {
    var host = document.getElementById('noteList');
    if (!host) return;
    var raw = notes().filter(noteMatches);
    var drafts = raw.filter(isDraftNote);
    /* 草稿在普通视图一律不可见 —— 这是「AI 只提议、人来确认」闸门的显示层 */
    var all = raw.filter(function (n) { return !isDraftNote(n); });
    renderDraftZone(drafts);
    if (!all.length) {
      host.innerHTML = '<div class="empty">' +
        '<svg class="ico lg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:30px;height:30px"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z"/></svg>' +
        '<div>' + (S.noteQ ? '没有匹配的沉淀，换个关键词试试。' : '知识库还是空的。上面「记一条沉淀」写下今天的结论或口径，慢慢就会长成体系。') + '</div></div>';
      return;
    }
    all.sort(function (a, b) { return (Number(b['创建时间'] || 0)) - (Number(a['创建时间'] || 0)); });

    if (S.noteView === 'all') {
      host.innerHTML = '<div class="ngrid" data-sp-bindable="database" data-sp-database-id="ggytTE4Cvh4Nyi3nBAcdxD">' +
        all.map(noteCardHTML).join('') + '</div>';
      return;
    }

    var groups = {}, order = [];
    for (var i = 0; i < all.length; i++) {
      var n = all[i], keys = [];
      if (S.noteView === 'project') keys = [String(n['关联项目'] || '未归属').trim() || '未归属'];
      else if (S.noteView === 'person') keys = [String(n['关联人物'] || '未标注').trim() || '未标注'];
      else keys = tagsOf(n);
      if (!keys.length) keys = ['未打标签'];
      for (var j = 0; j < keys.length; j++) {
        var k = keys[j];
        if (!groups[k]) { groups[k] = []; order.push(k); }
        groups[k].push(n);
      }
    }
    order.sort(function (a, b) { return groups[b].length - groups[a].length; });
    var html = '';
    for (var m = 0; m < order.length; m++) html += sectionHTML(order[m], groups[order[m]]);
    host.innerHTML = html;
  }

  function onNoteAction(e) {
    var wl = e.target.closest('[data-wl]');
    if (wl) {
      var name = wl.getAttribute('data-wl');
      var targets = linkTargetsAll();
      if (Object.prototype.hasOwnProperty.call(targets, name)) {
        S.noteQ = name;
        var box = document.getElementById('noteSearch');
        if (box) box.value = name;
        S.noteView = 'all';
        setNoteViewBtn('all');
        renderNotes();
        toast('已筛选到「' + name + '」相关沉淀');
      } else {
        toast('「' + name + '」还没有对应条目，可先记一条同名沉淀');
      }
      return;
    }
    var b = e.target.closest('button[data-nact]');
    if (!b) return;
    var id = b.getAttribute('data-id'), rows = view(), row = null;
    for (var i = 0; i < rows.length; i++) if (rows[i]._id === id) row = rows[i];
    if (!row) return;
    var nact = b.getAttribute('data-nact');
    if (nact === 'edit') openEdit(row);
    else if (nact === 'confirm') confirmDraft(row);
    else if (nact === 'editdraft') openEdit(row);
    else deleteRow(row);
  }

  function setNoteViewBtn(v) {
    var btns = document.querySelectorAll('#noteViews button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('on', btns[i].getAttribute('data-nv') === v);
  }

  function bindNotes() {
    var views = document.getElementById('noteViews');
    if (views) {
      views.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-nv]');
        if (!b) return;
        S.noteView = b.getAttribute('data-nv');
        setNoteViewBtn(S.noteView);
        renderNotes();
      });
    }
    var box = document.getElementById('noteSearch');
    if (box) {
      box.addEventListener('input', function () {
        S.noteQ = box.value;
        renderNotes();
      });
    }
    var list = document.getElementById('noteList');
    if (list) list.addEventListener('click', onNoteAction);
    /* 待确认草稿区是另一个容器，委托必须单独绑 —— 只绑 noteList 的话草稿按钮全是死的 */
    var drafts = document.getElementById('noteDrafts');
    if (drafts) drafts.addEventListener('click', onNoteAction);

    var save = document.getElementById('btnSaveNote');
    if (save) {
      save.addEventListener('click', function () {
        var t = String(document.getElementById('nTitle').value || '').trim();
        var body = String(document.getElementById('nBody').value || '').trim();
        if (!t && !body) { toast('写个标题或正文吧'); return; }
        var props = {};
        props['标题'] = { text: t || body.slice(0, 24) };
        props['类型'] = { select: TYPE_NOTE };
        props['状态'] = { select: '已完成' };
        props['关联项目'] = { text: String(document.getElementById('nProject').value || '').trim() };
        props['关联人物'] = { text: String(document.getElementById('nPerson').value || '').trim() };
        props['标签'] = { text: String(document.getElementById('nTags').value || '').trim() };
        props['内容'] = { text: body };
        props['创建时间'] = { number: nowStamp() };
        props['更新时间'] = { number: nowStamp() };
        save.disabled = true;
        Store.add(props).then(function () {
          save.disabled = false;
          document.getElementById('nTitle').value = '';
          document.getElementById('nBody').value = '';
          document.getElementById('nTags').value = '';
          toast('已存入知识库');
          return reload();
        }).catch(function () {
          save.disabled = false;
          toast('保存失败，请重试');
        });
      });
    }
  }

  function bindProjects() {
    /* 幂等：万一 bindExtra 被重复调用，重复绑定会让「展开明细」执行两次而看起来毫无反应 */
    if (S.projBound) return;
    S.projBound = 1;
    var list = document.getElementById('projectList');
    if (list) {
      /* 卡片自身的动作：展开明细 / 编辑项目 / 立项 / 改名 */
      list.addEventListener('click', onProjectAction);
      /* 展开明细后，里面的待办与沉淀是 itemHTML 渲染的，动作跟「今天要处理」是同一套。
         这里原先只绑了 onProjectAction，于是明细里的完成 / 编辑 / 删除按钮点了全无反应。 */
      list.addEventListener('click', onItemAction);
    }
    var np = document.getElementById('btnNewProj');
    if (np) {
      np.addEventListener('click', function () {
          openEdit(null);
        var t = document.getElementById('e-type');
        if (t) {
          var pid = optIdByName('类型', TYPE_PROJ);
          if (pid) t.value = pid;
          syncNextBlockVisibility();
        }
      });
    }
    bindRenameDialog();
    bindProjMerge();
    /* 编辑弹窗里的「关联项目」防重复提示。挂在项目台这条链上是因为
       bindProjects 只跑一次（S.projBound 幂等），而通用弹窗本身没有 bind 入口 */
    bindProjHint();
    bindConfirmDialog();
    bindDonePrompt();
  }

  window.__WB__.bindExtra = function () {
    bindRoll();
    bindProjects();
    bindNotes();
    bindTaskList();
  };

  function boot() {
    var W = window.__WB__;
    if (W && typeof W.bindExtra === 'function') W.bindExtra();
    init();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();/* ROSE_SPLASH_JS BEGIN */
/* 玫瑰开场层：每日一句 + 进入工作台。整段防御式，任何一步失败都不影响工作台。 */
(function(){
  var QUOTES = [{"t":"仅仅凭借锲而不舍的意志力，你就可以让世界精疲力尽，把你想要的东西给你。","a":"苏世民","w":"《我的经验与教训》","k":"坚持"},{"t":"那些杀不死我的，使我更强大。","a":"尼采","w":"《偶像的黄昏》","k":"坚持"},{"t":"在隆冬，我终于知道，我身上有一个不可战胜的夏天。","a":"加缪","w":"《夏》","k":"心性"},{"t":"世界上只有一种英雄主义，就是看清生活的真相之后，依然热爱生活。","a":"罗曼·罗兰","w":"《米开朗基罗传》","k":"勇气"},{"t":"一个人可以被毁灭，但不能被打败。","a":"海明威","w":"《老人与海》","k":"坚持"},{"t":"世界打垮每一个人，但在许多地方，许多人后来变得更坚强。","a":"海明威","w":"《永别了，武器》","k":"坚持"},{"t":"我只怕一件事：配不上自己所受的苦难。","a":"陀思妥耶夫斯基","w":"《卡拉马佐夫兄弟》","k":"担当"},{"t":"使沙漠显得美丽的，是它在某个地方藏着一口井。","a":"圣埃克苏佩里","w":"《小王子》","k":"远见"},{"t":"生活不是我们活过的日子，而是我们记住的日子。","a":"马尔克斯","w":"《活着为了讲述》","k":"时间"},{"t":"走自己的路，让别人去说吧。","a":"但丁","w":"《神曲》","k":"勇气"},{"t":"凡是自强不息者，终能得救。","a":"歌德","w":"《浮士德》","k":"坚持"},{"t":"自由是上天赐予人类最珍贵的礼物之一。","a":"塞万提斯","w":"《堂吉诃德》","k":"心性"},{"t":"如果你因失去了太阳而流泪，那么你也将失去群星了。","a":"泰戈尔","w":"《飞鸟集》","k":"心性"},{"t":"让生如夏花之绚烂，死如秋叶之静美。","a":"泰戈尔","w":"《飞鸟集》","k":"心性"},{"t":"你的痛楚，是打破包裹你认知的那层外壳。","a":"纪伯伦","w":"《先知》","k":"心性"},{"t":"要对一切尚未解决的事保持耐心，要学会热爱提问本身。","a":"里尔克","w":"《给一个青年诗人的信》","k":"心性"},{"t":"他们能，因为他们相信自己能。","a":"维吉尔","w":"《埃涅阿斯纪》","k":"勇气"},{"t":"你拥有支配自己心灵的力量，而不受外物支配。","a":"马可·奥勒留","w":"《沉思录》","k":"心性"},{"t":"困扰人们的不是事物本身，而是他们对事物的看法。","a":"爱比克泰德","w":"《手册》","k":"心性"},{"t":"不是我们拥有的时间太少，而是我们浪费的太多。","a":"塞内加","w":"《论生命之短暂》","k":"时间"},{"t":"你只有行动的权利，而无权占有行动的果实。","a":"《薄伽梵歌》","w":"第二章","k":"行动"},{"t":"顺境的美德是节制，逆境的美德是坚忍。","a":"培根","w":"《论厄运》","k":"心性"},{"t":"效率是把事情做对，效能是做对的事情。","a":"彼得·德鲁克","w":"《卓有成效的管理者》","k":"行动"},{"t":"要得到你想要的东西，最可靠的办法是让自己配得上它。","a":"查理·芒格","w":"《穷查理宝典》","k":"心性"},{"t":"人生的道路，都是由心来描绘的。","a":"稻盛和夫","w":"《活法》","k":"心性"},{"t":"不做准备，就是在准备失败。","a":"富兰克林","w":"《穷理查年鉴》","k":"行动"},{"t":"你的时间有限，不要把它浪费在重复别人的生活上。","a":"乔布斯","w":"2005 年斯坦福演讲","k":"时间"},{"t":"成功不是终点，失败不是终结，唯有继续前行的勇气才是永恒。","a":"丘吉尔","w":"演讲","k":"坚持"},{"t":"我们唯一值得恐惧的，是恐惧本身。","a":"罗斯福","w":"1933 年就职演说","k":"勇气"},{"t":"事情在成功之前，看起来总是那么难。","a":"曼德拉","w":"《漫漫自由路》","k":"坚持"},{"t":"衡量一个人的最终标准，不是他在安逸时的立场，而是他在挑战中的立场。","a":"马丁·路德·金","w":"《爱的力量》","k":"担当"},{"t":"我要扼住命运的咽喉，它绝不能使我完全屈服。","a":"贝多芬","w":"书信","k":"坚持"},{"t":"并不是我很聪明，只是我和问题相处得更久一些。","a":"爱因斯坦","w":"访谈","k":"心性"},{"t":"生活中没有什么可怕的东西，只有需要理解的东西。","a":"居里夫人","w":"演讲","k":"心性"},{"t":"人须在事上磨，方立得住。","a":"王阳明","w":"《传习录》","k":"行动"},{"t":"天行健，君子以自强不息。","a":"《周易》","w":"乾卦","k":"坚持"},{"t":"士不可以不弘毅，任重而道远。","a":"《论语》","w":"泰伯篇","k":"担当"},{"t":"人固有一死，或重于泰山，或轻于鸿毛。","a":"司马迁","w":"《报任安书》","k":"担当"},{"t":"老骥伏枥，志在千里；烈士暮年，壮心不已。","a":"曹操","w":"《龟虽寿》","k":"远见"},{"t":"古之立大事者，不惟有超世之才，亦必有坚忍不拔之志。","a":"苏轼","w":"《晁错论》","k":"坚持"},{"t":"天下事，在局外呐喊议论，总是无益，必须躬身入局。","a":"曾国藩","w":"《曾国藩家书》","k":"行动"},{"t":"千里之行，始于足下。","a":"《老子》","w":"第六十四章","k":"累积"},{"t":"天下难事，必作于易；天下大事，必作于细。","a":"《老子》","w":"第六十三章","k":"行动"},{"t":"投之亡地然后存，陷之死地然后生。","a":"《孙子兵法》","w":"九地篇","k":"勇气"},{"t":"红日初升，其道大光。","a":"梁启超","w":"《少年中国说》","k":"担当"},{"t":"路漫漫其修远兮，吾将上下而求索。","a":"屈原","w":"《离骚》","k":"坚持"},{"t":"纸上得来终觉浅，绝知此事要躬行。","a":"陆游","w":"《冬夜读书示子聿》","k":"行动"},{"t":"天将降大任于是人也，必先苦其心志，劳其筋骨。","a":"《孟子》","w":"告子下","k":"坚持"},{"t":"愿中国青年都摆脱冷气，只是向上走，不必听自暴自弃者流的话。","a":"鲁迅","w":"《热风》","k":"担当"},{"t":"宠辱不惊，闲看庭前花开花落；去留无意，漫随天外云卷云舒。","a":"《菜根谭》","w":"闲适篇","k":"心性"},{"t":"穷且益坚，不坠青云之志。","a":"王勃","w":"《滕王阁序》","k":"坚持"},{"t":"长风破浪会有时，直挂云帆济沧海。","a":"李白","w":"《行路难》","k":"远见"},{"t":"千磨万击还坚劲，任尔东西南北风。","a":"郑板桥","w":"《竹石》","k":"坚持"},{"t":"粉骨碎身浑不怕，要留清白在人间。","a":"于谦","w":"《石灰吟》","k":"心性"},{"t":"尽吾志也而不能至者，可以无悔矣。","a":"王安石","w":"《游褒禅山记》","k":"行动"},{"t":"会当凌绝顶，一览众山小。","a":"杜甫","w":"《望岳》","k":"远见"},{"t":"为天地立心，为生民立命，为往圣继绝学，为万世开太平。","a":"张载","w":"《横渠语录》","k":"担当"},{"t":"大寒既至，霜雪既降，吾是以知松柏之茂也。","a":"《淮南子》","w":"俶真训","k":"坚持"},{"t":"非淡泊无以明志，非宁静无以致远。","a":"诸葛亮","w":"《诫子书》","k":"心性"},{"t":"苟利国家生死以，岂因祸福避趋之。","a":"林则徐","w":"《赴戍登程口占示家人》","k":"担当"},{"t":"业精于勤，荒于嬉；行成于思，毁于随。","a":"韩愈","w":"《进学解》","k":"行动"}];
  var N = QUOTES.length;
  if (!N) return;

  /* ---- 工具：全部逐项能力探测 ---- */
  function byId(id){ try { return document.getElementById(id); } catch (e) { return null; } }
  function txt(id, v){ var el = byId(id); if (el) el.textContent = v; }
  function lsGet(k){ try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v){ try { localStorage.setItem(k, v); } catch (e) {} }
  function pad(n){ return (n < 10 ? '0' : '') + n; }

  /* 32 位低位乘法：优先 Math.imul，缺失时用 16 位拆分兜底（结果一致） */
  function mul32(a, b){
    if (Math.imul) return Math.imul(a, b);
    var ah = (a >>> 16) & 0xffff, al = a & 0xffff,
        bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
    return (al * bl + (((ah * bl + al * bh) & 0xffff) << 16)) | 0;
  }
  /* murmur3 终混器：把「日序号」这种只差 1 的输入彻底打散 */
  function hash32(x){
    x = x >>> 0;
    x = mul32(x ^ (x >>> 16), 0x7feb352d);
    x = mul32(x ^ (x >>> 15), 0x846ca68b);
    return (x ^ (x >>> 16)) >>> 0;
  }
  function dayNum(y, m, d){ return Math.floor(Date.UTC(y, m - 1, d) / 86400000); }
  /* 每日选句：同一天永远同一句；若与昨天撞了则顺移一位（确定性，无随机态） */
  function pickFor(y, m, d){
    var n = dayNum(y, m, d), i = hash32(n) % N;
    if (i === hash32(n - 1) % N) i = (i + 1) % N;
    return i;
  }
  function ymd(dt){ return [dt.getFullYear(), dt.getMonth() + 1, dt.getDate(), dt.getDay()]; }
  function dayKey(dt){ var a = ymd(dt); return a[0] + '-' + pad(a[1]) + '-' + pad(a[2]); }
  function greetOf(h){
    if (h < 5) return '夜深了';
    if (h < 11) return '早上好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    if (h < 23) return '晚上好';
    return '夜深了';
  }

  var FX = 'molly.rose.fx', SKIP = 'molly.splash.skip', QK = 'molly.splash.q';
  var st = { idx: 0, open: false, timer: 0 };

  /* ---- 选句：先算当天，再让「上次换过的」优先 ---- */
  var now = new Date();
  var key = dayKey(now);
  st.idx = pickFor(ymd(now)[0], ymd(now)[1], ymd(now)[2]);
  var memo = lsGet(QK) || '';
  if (memo.indexOf(key + ':') === 0){
    var v = parseInt(memo.slice(key.length + 1), 10);
    if (!isNaN(v) && v >= 0 && v < N) st.idx = v;
  }
  function say(){
    var q = QUOTES[st.idx];
    if (!q) return;
    txt('dxSpText', q.t);
    txt('dxSpBy', q.a + ' · ' + q.w);
    txt('dxSpTag', q.k);
  }
  function remember(){ lsSet(QK, key + ':' + st.idx); }

  /* ---- 花瓣（几何路径由注入脚本算好，此处只摆位） ---- */
  var PETAL_D = 'M10.0 23.5L6.8 21.6L5.0 19.8L3.7 17.9L2.7 16.0L2.2 14.1L2.0 12.2L2.2 10.4L2.7 8.5L3.7 6.6L5.0 4.8L6.8 2.9L10.0 1.0L10.0 1.0L13.2 2.9L15.0 4.8L16.3 6.6L17.3 8.5L17.8 10.4L18.0 12.2L17.8 14.1L17.3 16.0L16.3 17.9L15.0 19.8L13.2 21.6L10.0 23.5Z';
  var PC = ['#E7A9C6', '#D98BAE', '#F0C3D6', '#C97FA3'];
  function petals(){
    var host = byId('dxSplashPetals');
    if (!host || host.innerHTML === undefined) return 0;
    var vw = window.innerWidth || 1280;
    var n = vw < 760 ? 5 : 9, html = '', i;
    for (i = 0; i < n; i++){
      var dur = 16 + Math.random() * 12, delay = -Math.random() * dur * 0.92;
      var left = 3 + Math.random() * 94, size = Math.round(12 + Math.random() * 14);
      var sw = Math.round((Math.random() * 2 - 1) * 90), op = (0.16 + Math.random() * 0.2).toFixed(2);
      html += '<span class="dx-sp-petal" style="left:' + left.toFixed(1) + '%;width:' + size
        + 'px;color:' + PC[i % 4] + ';--sw:' + sw + 'px;--o:' + op
        + ';animation-duration:' + dur.toFixed(1) + 's;animation-delay:' + delay.toFixed(1) + 's">'
        + '<svg viewBox="0 0 20 25"><path d="' + PETAL_D + '" fill="currentColor"'
        + ' stroke="#B0577B" stroke-opacity=".16" stroke-width=".7"/></svg></span>';
    }
    host.innerHTML = html;
    return n;
  }

  /* ---- 开 / 关 ---- */
  function lock(on){
    var b = document.body;
    if (b && b.classList) b.classList[on ? 'add' : 'remove']('dx-splash-lock');
    var app = null;
    try { app = document.querySelector('.app'); } catch (e) {}
    if (app && app.setAttribute) app.setAttribute('aria-hidden', on ? 'true' : 'false');
  }
  function open(){
    var el = byId('dxSplash');
    if (!el || !el.classList) return false;
    st.open = true;
    el.classList.remove('out');
    el.classList.add('on');
    /* 先让 display:flex 生效再开过渡，否则 opacity 不会 transition */
    if (el.offsetWidth !== undefined) void el.offsetWidth;
    el.classList.add('in');
    if (el.setAttribute) el.setAttribute('aria-hidden', 'false');
    lock(true);
    petals();
    var g = byId('dxSpGo');
    if (g && g.focus) { try { g.focus(); } catch (e) {} }
    return true;
  }
  function enter(){
    if (!st.open) return false;
    st.open = false;
    var el = byId('dxSplash');
    lock(false);
    if (!el || !el.classList){ return true; }
    el.classList.remove('in');
    el.classList.add('out');
    if (el.setAttribute) el.setAttribute('aria-hidden', 'true');
    if (st.timer) { clearTimeout(st.timer); }
    st.timer = setTimeout(function(){
      el.classList.remove('on');
      el.classList.remove('out');
      st.timer = 0;
    }, 560);
    return true;
  }
  function nextQuote(){
    if (N > 1){
      var step = 1 + Math.floor(Math.random() * (N - 1));
      st.idx = (st.idx + step) % N;
    }
    say();
    remember();
    var bq = byId('dxSpQuote');
    if (bq && bq.classList){
      bq.classList.remove('dx-sp-swap');
      if (bq.offsetWidth !== undefined) void bq.offsetWidth;
      bq.classList.add('dx-sp-swap');
    }
    return st.idx;
  }
  function skipToday(){ lsSet(SKIP, key); return key; }
  function shouldAuto(){ return lsGet(SKIP) !== key; }

  /* ---- 绑定 ---- */
  function bind(id, fn){
    var el = byId(id);
    if (el && el.addEventListener) el.addEventListener('click', fn);
  }
  say();
  txt('dxSpGreet', greetOf(now.getHours()) + '，茉莉');
  var DOW = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  txt('dxSpDate', (now.getMonth() + 1) + '月' + now.getDate() + '日 ' + DOW[now.getDay()]);
  bind('dxSpGo', function(){ enter(); });
  bind('dxSpNext', function(){ nextQuote(); });
  bind('dxSpSkip', function(){ skipToday(); enter(); });
  bind('dxSplashBtn', function(){ open(); });
  if (typeof window.addEventListener === 'function'){
    window.addEventListener('keydown', function(e){
      if (!st.open) return;
      if (e && (e.key === 'Escape' || e.key === 'Esc')) enter();
    });
    window.addEventListener('resize', function(){
      if (!st.open) return;
      clearTimeout(st.resizeT);
      st.resizeT = setTimeout(petals, 400);
    });
    /* 点遮罩空白处也进工作台 */
    var el = byId('dxSplash');
    if (el && el.addEventListener) el.addEventListener('click', function(e){
      if (e && e.target === el) enter();
    });
  }
  if (shouldAuto()) open();

  window.__SPLASH__ = {
    quotes: QUOTES, count: N,
    pick: pickFor, hash32: hash32, mul32: mul32, dayNum: dayNum,
    current: function(){ return st.idx; },
    quote: function(){ return QUOTES[st.idx]; },
    isOpen: function(){ return st.open; },
    shouldAuto: shouldAuto, skipToday: skipToday, key: key,
    open: open, enter: enter, next: nextQuote, petals: petals,
    say: say
  };
})();
/* ROSE_SPLASH_JS END */
/* ROSE_DECO_JS BEGIN */
/* 玫瑰装饰层：玫瑰线描 / 飘落花瓣 / 动效开关 */
(function(){
  var TAU = 137.508, DEG = Math.PI / 180;
  function petal(cx, cy, ang, r0, r1, hw, n, exp){
    n = n || 12; exp = exp || 0.7;
    var a = ang * DEG, dx = Math.sin(a), dy = -Math.cos(a), px = Math.cos(a), py = Math.sin(a);
    var L = [], R = [], k, t, rr, w, bx, by;
    for (k = 0; k <= n; k++){
      t = k / n; rr = r0 + (r1 - r0) * t; w = hw * Math.pow(Math.sin(Math.PI * t), exp);
      bx = cx + dx * rr; by = cy + dy * rr;
      L.push([bx - px * w, by - py * w]); R.push([bx + px * w, by + py * w]);
    }
    var p = L.concat(R.reverse()), d = 'M' + p[0][0].toFixed(1) + ' ' + p[0][1].toFixed(1);
    for (k = 1; k < p.length; k++){ d += 'L' + p[k][0].toFixed(1) + ' ' + p[k][1].toFixed(1); }
    return d + 'Z';
  }
  function roseSVG(size, N, sw){
    var c = size / 2, s = '<svg viewBox="0 0 ' + size + ' ' + size + '" fill="none" stroke="currentColor"'
      + ' stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round">';
    for (var i = 0; i < N; i++){
      var u = i / (N - 1);
      var br = c * 0.06 + c * 0.46 * Math.sqrt(u);
      var tr = br + c * (0.13 + 0.12 * u);
      var hw = c * (0.030 + 0.060 * u);
      s += '<path d="' + petal(c, c, i * TAU, br, tr, hw, 12, 0.82) + '"/>';
    }
    return s + '</svg>';
  }

  /* 1) 侧栏玫瑰水印（斐波那契螺旋排布，瓣数越多越像玫瑰） */
  var roseHost = document.getElementById('dxSideRose');
  if (roseHost){ roseHost.innerHTML = roseSVG(240, 26, 1.5); }

  /* 2) 飘落花瓣 */
  var COLORS = ['#E7A9C6', '#D98BAE', '#F0C3D6', '#C97FA3'];
  var petalHost = document.getElementById('dxPetals');
  function rebuild(){
    if (!petalHost || petalHost.innerHTML === undefined) return 0;
    var vw = window.innerWidth || 1280;
    var n = vw < 700 ? 4 : 7, html = '', i;
    for (i = 0; i < n; i++){
      var dur = 14 + Math.random() * 11, delay = -Math.random() * dur * 0.9;
      var left = 4 + Math.random() * 92, size = Math.round(11 + Math.random() * 13);
      var sw = Math.round((Math.random() * 2 - 1) * 70), op = (0.20 + Math.random() * 0.24).toFixed(2);
      html += '<span class="dx-petal" style="left:' + left.toFixed(1) + '%;width:' + size + 'px;color:'
        + COLORS[i % 4] + ';--sw:' + sw + 'px;--o:' + op
        + ';animation-duration:' + dur.toFixed(1) + 's;animation-delay:' + delay.toFixed(1) + 's">'
        + '<svg viewBox="0 0 20 25"><path d="' + petal(10, 25, 0, 1.5, 24, 8, 12, 0.68) + '"'
        + ' fill="currentColor" stroke="#B0577B" stroke-opacity=".18" stroke-width=".7"/></svg></span>';
    }
    petalHost.innerHTML = html;
    return n;
  }

  /* 3) 动效开关 */
  var KEY = 'molly.rose.fx', on = true;
  try { on = localStorage.getItem(KEY) !== '0'; } catch (e) {}
  function apply(){
    /* 装饰层必须「宁可不生效也不能报错」：宿主/桩环境缺 API 时静默降级 */
    var root = document.documentElement;
    if (root && root.setAttribute) root.setAttribute('data-fx', on ? 'on' : 'off');
    var t = document.getElementById('dxTgTxt');
    if (t) t.textContent = on ? '玫瑰动效 · 开' : '玫瑰动效 · 关';
    var b = document.getElementById('dxToggle');
    if (b && b.setAttribute) b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  rebuild(); apply();
  var tg = document.getElementById('dxToggle');
  if (tg && tg.addEventListener){
    tg.addEventListener('click', function(){
      on = !on;
      try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
      apply();
    });
  }
  var rz;
  if (window.addEventListener){
    window.addEventListener('resize', function(){ clearTimeout(rz); rz = setTimeout(rebuild, 400); });
  }

  window.__ROSE__ = { petal: petal, roseSVG: roseSVG, rebuild: rebuild,
    setFx: function(v){ on = !!v; apply(); }, isOn: function(){ return on; } };
})();
/* ROSE_DECO_JS END */
