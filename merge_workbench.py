# -*- coding: utf-8 -*-
"""
把「得到大脑」页（workbench_brain.html）与主工作台（workbench_v3.html）合并成
单一页面 workbench.html —— 7 个 Tab 共用一个外壳。

核心手法：
  1. CSS：brain 的样式整体加 `#brainZone ` 前缀做作用域隔离；`:root` 改写成 `#brainZone`
     以便在脑区保留青绿主题（v3 是蓝色主题），两套主题在同一页面共存而不互相污染。
  2. DOM：v3 的骨架 + brain 的 3 个 pane / 3 个弹窗，包进 <div id="brainZone">。
  3. JS：两段 IIFE 依序拼接。v3 的 switchTab 成为唯一导航入口，brain 的 switchTab 降级为
     仅供内部调用的 showPane；宿主通过 window.__WB__.switchTab 反向驱动。
"""
import io
import os
import re

BASE = os.path.dirname(os.path.abspath(__file__))


def rd(name):
    with io.open(os.path.join(BASE, name), encoding='utf-8') as f:
        return f.read()


def wr(name, text):
    with io.open(os.path.join(BASE, name), 'w', encoding='utf-8') as f:
        f.write(text)


def seg(s, a, b):
    """取 a 与 b 之间的内容（不含 a、b）"""
    i = s.index(a) + len(a)
    j = s.index(b, i)
    return s[i:j]


def seg_incl(s, a, b):
    """取从 a 开始到 b 结束的内容（含 a、b）"""
    i = s.index(a)
    j = s.index(b, i) + len(b)
    return s[i:j]


# ---------------------------------------------------------------- CSS 作用域
GLOBAL_SKIP = {'*', 'html', 'body', 'button', 'input', 'select', 'textarea'}
AT_NESTED = ('@media', '@supports', '@layer', '@container', '@document')
AT_RAW = ('@keyframes', '@-webkit-keyframes', '@font-face', '@charset', '@import')


def _split_blocks(css):
    """把 CSS 拆成 [(prelude, block_or_None)]；注释单独成项，block 为花括号内文本。"""
    items, i, n = [], 0, len(css)
    while i < n:
        buf = []
        while i < n:
            if css.startswith('/*', i):
                k = css.find('*/', i)
                k = n if k < 0 else k + 2
                buf.append(css[i:k])
                i = k
                continue
            if css[i] in '{;}':
                break
            buf.append(css[i])
            i += 1

        chunk = ''.join(buf)
        comments = re.findall(r'/\*.*?\*/', chunk, flags=re.S)
        plain = re.sub(r'/\*.*?\*/', '', chunk, flags=re.S)

        def _flush(extra=''):
            for c in comments:
                items.append((c, None))
            if (plain.strip() or extra):
                items.append((plain + extra, None))

        if i >= n:
            _flush()
            break
        if css[i] in ';}':
            _flush(css[i])
            i += 1
            continue
        # css[i] == '{'
        k, depth = i + 1, 1
        while k < n and depth > 0:
            if css.startswith('/*', k):
                kk = css.find('*/', k)
                k = n if kk < 0 else kk + 2
                continue
            if css[k] == '{':
                depth += 1
            elif css[k] == '}':
                depth -= 1
            k += 1
        for c in comments:
            items.append((c, None))
        items.append((plain, css[i + 1:k - 1]))
        i = k
    return items


def _scope_selector(sel, scope):
    sel = sel.strip()
    if not sel:
        return sel
    if sel == ':root':
        return scope
    out = []
    for part in sel.split(','):
        p = part.strip()
        if not p:
            continue
        if p in GLOBAL_SKIP or p.startswith('::-webkit') or p.startswith(':root'):
            out.append(p)
        else:
            out.append(scope + ' ' + p)
    return ', '.join(out)


def scope_css(css, scope='#brainZone'):
    out = []
    for prelude, block in _split_blocks(css):
        if block is None:
            p = prelude.strip()
            if p:
                out.append(p + '\n')
            continue
        head = prelude.strip()
        if head.startswith('@'):
            low = head.lower()
            if low.startswith(AT_RAW):
                out.append(head + '{' + block + '}\n')
            elif low.startswith(AT_NESTED):
                out.append(head + '{\n' + scope_css(block, scope) + '}\n')
            else:
                out.append(head + '{' + block + '}\n')
        else:
            out.append(_scope_selector(head, scope) + '{' + block + '}\n')
    return ''.join(out)


# ---------------------------------------------------------------- 读源文件
v3 = rd('workbench_v3.html')
br = rd('workbench_brain.html')

v3_css = seg(v3, '<style>', '</style>')
br_css = seg(br, '<style>', '</style>')
v3_body = seg(v3, '<body>', '<script>')
v3_js = seg(v3, '<script>', '</script>')
br_js = seg(br, '<script>', '</script>')

v3_nav = seg_incl(v3, '<nav class="nav" id="nav">', '</nav>')
br_nav = seg_incl(br, '<nav class="nav" id="nav">', '</nav>')
v3_tabbar = seg_incl(v3, '<nav class="tabbar" id="tabbar">', '</nav>')
br_tabbar = seg_incl(br, '<nav class="tabbar" id="tabbar">', '</nav>')

br_panes = seg(br, '<!-- ============ 模块一：录音流 ============ -->', '</main>')
br_masks = seg(br, '<!-- 领取弹窗 -->', '<div class="toast"')

assert '<div class="app">' in v3_body
assert 'id="pane-lib"' in br_panes
assert 'id="claimMask"' in br_masks

# ---------------------------------------------------------------- 组装 nav
br_nav_btns = re.sub(r'^\s*<nav[^>]*>|</nav>\s*$', '', br_nav).strip()
v3_nav_btns = re.sub(r'^\s*<nav[^>]*>|</nav>\s*$', '', v3_nav).strip()

new_nav = (
    '<nav class="nav" id="nav">\n'
    '      ' + v3_nav_btns + '\n'
    '      <div class="nav-sep">得到大脑</div>\n'
    '      ' + br_nav_btns + '\n'
    '    </nav>'
)

# ---------------------------------------------------------------- 组装 tabbar
br_tabbar_btns = re.sub(r'^\s*<nav[^>]*>|</nav>\s*$', '', br_tabbar).strip()
v3_tabbar_btns = re.sub(r'^\s*<nav[^>]*>|</nav>\s*$', '', v3_tabbar).strip()
new_tabbar = (
    '<nav class="tabbar" id="tabbar">\n'
    '      ' + v3_tabbar_btns + '\n'
    '      ' + br_tabbar_btns + '\n'
    '    </nav>'
)

# ---------------------------------------------------------------- 脑区 DOM
# pane-lib 原本首屏可见（无 hide），合并后须初始隐藏，交给 switchTab 控制
br_panes_fixed = br_panes.replace(
    '<section class="pane" id="pane-lib">',
    '<section class="pane hide" id="pane-lib">'
)
assert 'class="pane hide" id="pane-lib"' in br_panes_fixed
assert br_panes_fixed.count('class="pane') == 3

# brain 原本的 #alertHost 落在模块一之前，未被 br_panes 捕获；
# 而 v3 的同名 #alertHost 已被占用（渲染 + 点击绑定），故脑区单独给一个容器。
assert 'id="alertHost"' not in br_panes_fixed

brain_zone = (
    '\n    <!-- ============ 得到大脑 · 脑区（录音流 / 待办仓库 / 规则与同步） ============ -->\n'
    '    <div id="brainZone">\n'
    '      <div id="brainAlertHost"></div>\n'
    + br_panes_fixed.rstrip() + '\n'
    + br_masks.rstrip() + '\n'
    '    </div>\n  '
)

# ---------------------------------------------------------------- 组装 body
new_body = v3_body

# 脑区已并入本页：今日推进里的「去领取待办」由外链改为站内切 Tab
OLD_ENTRY = ('<a class="btn sm pri" id="poolEntryGo" href="#" target="_blank" rel="noopener">\n'
             '            <span class="ic"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'
             '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/></svg></span>去领取待办</a>')
NEW_ENTRY = ('<button class="btn sm pri" id="poolEntryGo" type="button">\n'
             '            <span class="ic"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'
             '<path d="M5 12h13"/><path d="m12.5 6 6 6-6 6"/></svg></span>去待办仓库领取</button>')
assert OLD_ENTRY in new_body, 'poolEntryGo 锚点未命中'
new_body = new_body.replace(OLD_ENTRY, NEW_ENTRY, 1)

OLD_HINT = '「得到大脑」的每日录音里自动提取出来的待办，在「待办仓库」里领取后会直接写入本工作台并出现在今天；本页只读回显，避免两处重复记账。'
NEW_HINT = '「得到大脑」每天 12:00 与 18:00 直连云端取回录音、自动提取待办，放进「待办仓库」等你领取；领取后直接写入本工作台并出现在今天，也可按某一场录音整场领取，不必逐条点。'
assert OLD_HINT in new_body, '领取入口提示文案未命中'
new_body = new_body.replace(OLD_HINT, NEW_HINT, 1)

new_body = new_body.replace(v3_nav, new_nav, 1)
new_body = new_body.replace(v3_tabbar, new_tabbar, 1)
new_body = new_body.replace('  </main>', brain_zone + '</main>', 1)
assert new_body.count('id="brainZone"') == 1
assert new_body.count('id="pane-lib"') == 1
assert new_body.count('id="tabbar"') == 1

# ---------------------------------------------------------------- 组装 CSS
MERGED_EXTRA = """
/* ============ 合并页补充（7 Tab 外壳） ============ */
.nav-sep{font-size:10.5px;color:var(--ink3);letter-spacing:.8px;font-weight:700;padding:14px 10px 5px;text-transform:uppercase}
#brainZone{display:block}
#brainZone .filters{background:transparent}
.tabbar{overflow-x:auto;-webkit-overflow-scrolling:touch}
.tabbar button{min-width:58px}
@media (max-width:900px){
  .tabbar button{font-size:10px;min-width:52px;padding:7px 2px}
}

/* ---- 玫瑰装饰层·跨区补齐 ----
   宿主侧 .card/.kpi 规则在脑区作用域之外；脑区自带 #brainZone .card{background:...}
   会重置 background-image，故这里必须用同等(或更高)特异性再声明一次，否则两区观感不统一。 */
#brainZone .card,#brainZone .kpi{
  background-image:linear-gradient(180deg,rgba(233,185,206,.13),rgba(233,185,206,0) 88px);
}
#brainZone .card{transition:box-shadow .22s ease,border-color .22s ease}
#brainZone .card:hover{
  box-shadow:0 1px 2px rgba(92,42,68,.05),0 12px 30px rgba(92,42,68,.11);border-color:#F0D8E4;
}

/* ---- 自研日历·跨区补齐 ----
   脑区自带的 #brainZone input[type=text]{padding:11px 12px} 特异性(1,1,1) 高于宿主的
   .calwrap>input(0,1,1)，会把给日历图标预留的右内边距吃掉 → 图标压住文字。
   故须以同等特异性再声明一次。弹层 .calpop 挂在 body 上，不在此作用域内，无需补齐。 */
#brainZone .calwrap>input{padding-right:36px}
#brainZone .calwrap>.cico{right:11px}
"""

new_css = (
    v3_css.rstrip()
    + '\n\n/* ============================================================\n'
    '   得到大脑样式 · 作用域隔离到 #brainZone\n'
    '   防止 .card/.kpi/.dlg/.pcard 等与主工作台同名类互相污染\n'
    '   ============================================================ */\n'
    + scope_css(br_css).strip()
    + '\n'
    + MERGED_EXTRA
)

# 自检：前缀化后不应再有裸露的顶层 .card{ 之类
assert '\n#brainZone{' in new_css
assert '\n.card{' in new_css  # v3 自己的仍在
if '\n#brainZone .card{' not in new_css:
    _k = new_css.find('通用块')
    raise AssertionError('CARD SCOPE MISS -> ' + repr(new_css[max(0, _k - 40):_k + 160]))

# ---------------------------------------------------------------- 改造 JS
# ---- v3: TAB_KEYS 扩到 7 个
v3_js = v3_js.replace(
    "var TAB_KEYS = { today: 1, projects: 1, notes: 1, review: 1 };",
    "var TAB_KEYS = { today: 1, projects: 1, notes: 1, review: 1, lib: 1, pool: 1, flow: 1 };"
)
assert 'flow: 1' in v3_js

# ---- v3: switchTab 头段
OLD_HEAD = """  function switchTab(tab) {
    S.tab = tab;
    syncHash(tab);
    var panes = { today: 'pane-today', projects: 'pane-projects', notes: 'pane-notes', review: 'pane-review' };
    var titles = { today: '今日推进', projects: '项目推进', notes: '知识沉淀', review: '每周复盘' };
"""
NEW_HEAD = """  function switchTab(tab) {
    S.tab = tab;
    syncHash(tab);
    var panes = {
      today: 'pane-today', projects: 'pane-projects', notes: 'pane-notes', review: 'pane-review',
      lib: 'pane-lib', pool: 'pane-pool', flow: 'pane-flow'
    };
    var titles = {
      today: '今日推进', projects: '项目推进', notes: '知识沉淀', review: '每周复盘',
      lib: '录音流', pool: '待办仓库', flow: '规则与同步'
    };
    var brainTab = (tab === 'lib' || tab === 'pool' || tab === 'flow');
"""
assert OLD_HEAD in v3_js
v3_js = v3_js.replace(OLD_HEAD, NEW_HEAD, 1)

# ---- v3: switchTab 中段（副标题 + 渲染分流）
OLD_MID = """    var sub = document.getElementById('pageSub');
    if (sub && tab !== 'today') {
      if (tab === 'projects') sub.textContent = '项目 ' + projectIndex().length + ' 个 · 点卡片展开明细';
      if (tab === 'notes') sub.textContent = '沉淀 ' + notes().length + ' 条 · [[双链]]已启用';
      if (tab === 'review') sub.textContent = '按周汇总完成 / 精力 / 卡点 / 待决策，一键生成可落入 Obsidian 的复盘稿';
    }
    refreshAll();
    if (tab === 'notes' && !S.libLoaded) ensureLib().then(function () { renderNotes(); });
    if (tab === 'review' && !S.libLoaded) ensureLib().then(function () { renderReview(); });
"""
NEW_MID = """    var sub = document.getElementById('pageSub');
    if (sub) {
      if (tab === 'projects') sub.textContent = '项目 ' + projectIndex().length + ' 个 · 点卡片展开明细';
      if (tab === 'notes') sub.textContent = '沉淀 ' + notes().length + ' 条 · [[双链]]已启用';
      if (tab === 'review') sub.textContent = '按周汇总完成 / 精力 / 卡点 / 待决策，一键生成可落入 Obsidian 的复盘稿';
      if (tab === 'lib') sub.textContent = '来自得到大脑的录音纪要 · 云端直连，每日 12:00 / 18:00 自动同步';
      if (tab === 'pool') sub.textContent = '从录音里提取的行动项，领取后进入当天计划';
      if (tab === 'flow') sub.textContent = '提取规则、数据流向与同步方式';
    }
    /* 无论切到哪个 Tab 都通知脑区同步显隐；只有非脑区 Tab 才需要重渲染宿主视图 */
    if (window.__BR__ && typeof window.__BR__.showPane === 'function') window.__BR__.showPane(tab);
    if (!brainTab) refreshAll();
    if (tab === 'notes' && !S.libLoaded) ensureLib().then(function () { renderNotes(); });
    if (tab === 'review' && !S.libLoaded) ensureLib().then(function () { renderReview(); });
"""
assert OLD_MID in v3_js
v3_js = v3_js.replace(OLD_MID, NEW_MID, 1)

# ---- v3: onUpdated 整页只注册一次（三表统一监听，命中后驱动两侧重载）
OLD_UPD = """  function bindDbUpdates() {
    var db = (window.__SMART_PAGE__ && window.__SMART_PAGE__.database) ? window.__SMART_PAGE__.database : null;
    if (!db || typeof db.onUpdated !== 'function') return;
    var timer = null;
    db.onUpdated(function (payload) {
      var ids = (payload && payload.databaseIds) || [];
      if (ids.indexOf(DATABASE_ID) === -1) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; reload(); }, 300);
    });
  }"""
NEW_UPD = """  /* 整页只允许注册一个 onUpdated handler（DSDK013）：
     宿主统一监听三张表，命中后同时驱动宿主与脑区重载 —— 脑区依赖
     录音库 / 待办仓库 / 主台账，宿主依赖主台账 + 录音库。 */
  var BRAIN_LIB_ID = 'g0T2Bz3L9LmINPC1YhLPg6';
  var BRAIN_POOL_ID = 'fONLTaaLixhK3YpW5ExBJO';
  function bindDbUpdates() {
    var db = (window.__SMART_PAGE__ && window.__SMART_PAGE__.database) ? window.__SMART_PAGE__.database : null;
    if (!db || typeof db.onUpdated !== 'function') return;
    var timer = null;
    db.onUpdated(function (payload) {
      var ids = (payload && payload.databaseIds) || [];
      var hit = ids.indexOf(DATABASE_ID) >= 0 ||
                ids.indexOf(BRAIN_LIB_ID) >= 0 ||
                ids.indexOf(BRAIN_POOL_ID) >= 0;
      if (!hit) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        if (window.__BR__ && typeof window.__BR__.reload === 'function') window.__BR__.reload();
        reload();
      }, 300);
    });
  }"""
assert OLD_UPD in v3_js, 'bindDbUpdates 锚点未命中'
v3_js = v3_js.replace(OLD_UPD, NEW_UPD, 1)

# ---- brain: 撤掉自己的 onUpdated 注册
OLD_BR_UPD = """  /* ==================== 初始化 ==================== */
  function bindDbUpdates() {
    var db = sdk();
    if (!db || typeof db.onUpdated !== 'function') return;
    var timer = null;
    db.onUpdated(function (payload) {
      var ids = (payload && payload.databaseIds) || [];
      var hit = ids.indexOf(LIB_DB) >= 0 || ids.indexOf(POOL_DB) >= 0 || ids.indexOf(MAIN_DB) >= 0;
      if (!hit) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { reload(); }, 400);
    });
  }"""
NEW_BR_UPD = """  /* ==================== 初始化 ==================== */
  /* 数据变更监听由宿主统一注册（整页只允许一个 onUpdated handler，DSDK013）；
     宿主命中录音库 / 待办仓库 / 主台账任一后，会回调 window.__BR__.reload()。 */"""
assert OLD_BR_UPD in br_js, 'brain bindDbUpdates 锚点未命中'
br_js = br_js.replace(OLD_BR_UPD, NEW_BR_UPD, 1)
assert 'db.onUpdated' not in br_js, 'brain 仍残留 onUpdated 注册'

# ---- v3: 领取入口不再跳外链，改为站内切 Tab
OLD_GO = """    var host = document.getElementById('poolEntryStats');
    var go = document.getElementById('poolEntryGo');
    if (go) go.setAttribute('href', BRAIN_URL);
    if (!host) return;"""
NEW_GO = """    var host = document.getElementById('poolEntryStats');
    if (!host) return;"""
assert OLD_GO in v3_js, 'renderPoolEntry 锚点未命中'
v3_js = v3_js.replace(OLD_GO, NEW_GO, 1)

# ---- v3: 绑定入口按钮 + 在 bindExtra 里注册
OLD_BINDEXTRA = """  window.__WB__.bindExtra = function () {
    bindRoll();
    bindProjects();
    bindNotes();
    bindTaskList();
  };"""
NEW_BINDEXTRA = """  /* 脑区已并入本页：入口按钮直接切换 Tab */
  function bindBrainEntry() {
    var pgo = document.getElementById('poolEntryGo');
    if (pgo) pgo.addEventListener('click', function () { switchTab('pool'); });
  }

  window.__WB__.bindExtra = function () {
    bindRoll();
    bindProjects();
    bindNotes();
    bindTaskList();
    bindBrainEntry();
  };"""
assert OLD_BINDEXTRA in v3_js, 'bindExtra 锚点未命中'
v3_js = v3_js.replace(OLD_BINDEXTRA, NEW_BINDEXTRA, 1)
assert 'bindBrainEntry();' in v3_js

# ---- v3: 暴露 setSync 给脑区复用同一个同步指示灯
v3_js = v3_js.replace(
    "  window.__WB__.switchTab = switchTab;",
    "  window.__WB__.switchTab = switchTab;\n  window.__WB__.setSync = setSync;"
)
assert 'window.__WB__.setSync = setSync;' in v3_js

# ---- brain: alertHost 改名
br_js = br_js.replace("var host = g('alertHost');", "var host = g('brainAlertHost');")
assert "g('brainAlertHost')" in br_js

# ---- brain: setSync 复用宿主指示灯
OLD_SETSYNC = """  function setSync(state, text) {
    var d = g('syncDot'), t = g('syncText');
    if (d) d.className = 'dot' + (state === 'busy' ? ' busy' : state === 'off' ? ' off' : '');
    if (t) t.textContent = text;
  }
"""
NEW_SETSYNC = """  /* 合并后全页只有一个同步指示灯，交回宿主维护 */
  function setSync(state, text) {
    if (window.__WB__ && typeof window.__WB__.setSync === 'function') {
      window.__WB__.setSync(state === 'busy' ? 'wait' : state, text);
    }
  }

  /* 脑区内部需要跳 Tab 时，统一交给宿主，保证导航高亮与 pane 显隐一致 */
  function goTab(t) {
    if (window.__WB__ && typeof window.__WB__.switchTab === 'function') window.__WB__.switchTab(t);
    else showPane(t);
  }
"""
assert OLD_SETSYNC in br_js
br_js = br_js.replace(OLD_SETSYNC, NEW_SETSYNC, 1)

# ---- brain: switchTab -> showPane
OLD_SW = """  function switchTab(tab) {
    S.tab = tab;
    var titles = { lib: ['录音流', '来自得到大脑的录音纪要 · 云端直连，每日 12:00 / 18:00 自动同步'], pool: ['待办仓库', '从录音里提取的行动项，领取后进入当天计划'], flow: ['规则与同步', '提取规则、数据流向与同步方式'] };
    var t = titles[tab] || titles.lib;
    var h = g('pageTitle'), sub = g('pageSub');
    if (h) h.textContent = t[0];
    if (sub) sub.textContent = t[1];
    ['lib', 'pool', 'flow'].forEach(function (k) {
      var p = g('pane-' + k);
      if (p) p.className = 'pane' + (k === tab ? '' : ' hide');
    });
    document.querySelectorAll('#nav button,#tabbar button').forEach(function (b) {
      if (b.getAttribute('data-tab') === tab) b.classList.add('on');
      else b.classList.remove('on');
    });
    if (typeof window.scrollTo === 'function') window.scrollTo(0, 0);
  }
"""
NEW_SW = """  /* 合并后导航由宿主统一接管：这里只负责脑区三个 pane 的显隐 */
  function showPane(tab) {
    if (tab === 'lib' || tab === 'pool' || tab === 'flow') S.tab = tab;
    ['lib', 'pool', 'flow'].forEach(function (k) {
      var p = g('pane-' + k);
      if (p) p.className = 'pane' + (k === tab ? '' : ' hide');
    });
  }

  /* 兼容旧调用点 */
  function switchTab(tab) { goTab(tab); }
"""
assert OLD_SW in br_js
br_js = br_js.replace(OLD_SW, NEW_SW, 1)

# ---- brain: bindShell 去掉导航绑定与跨页链接
OLD_SHELL = """  function bindShell() {
    document.querySelectorAll('#nav button,#tabbar button').forEach(function (b) {
      b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
    });
    document.querySelectorAll('[data-close]').forEach(function (b) {
"""
NEW_SHELL = """  function bindShell() {
    /* 导航点击已由宿主统一绑定，此处不再重复 */
    document.querySelectorAll('#brainZone [data-close]').forEach(function (b) {
"""
assert OLD_SHELL in br_js
br_js = br_js.replace(OLD_SHELL, NEW_SHELL, 1)

OLD_SHELL2 = """    document.querySelectorAll('.mask').forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('on'); });
    });
    g('btnReload').addEventListener('click', function () { reload(); toast('已重新同步'); });
    g('btnExport').addEventListener('click', doExport);
"""
NEW_SHELL2 = """    document.querySelectorAll('#brainZone .mask').forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('on'); });
    });
    var br = g('brBtnReload');
    if (br) br.addEventListener('click', function () { reload(); toast('已重新同步'); });
    var be = g('brBtnExport');
    if (be) be.addEventListener('click', doExport);
"""
assert OLD_SHELL2 in br_js
br_js = br_js.replace(OLD_SHELL2, NEW_SHELL2, 1)

OLD_SHELL3 = """    var go = g('goWorkbench');
    if (go) go.setAttribute('href', WORKBENCH_TODAY);
    var gr = g('goReview');
    if (gr) gr.setAttribute('href', WORKBENCH_REVIEW);
  }
"""
NEW_SHELL3 = """  }
"""
assert OLD_SHELL3 in br_js
br_js = br_js.replace(OLD_SHELL3, NEW_SHELL3, 1)

# ---- brain: init 不再决定初始 Tab（宿主决定）
OLD_INIT = """  function init() {
    S.libF.open = {};
    bindShell();
    bindModule1();
    bindModule2();
    bindModule3();
    switchTab('lib');
    bindDbUpdates();
    reload();
  }
"""
NEW_INIT = """  function init() {
    S.libF.open = {};
    bindShell();
    bindModule1();
    bindModule2();
    bindModule3();
    reload();
  }
"""
assert OLD_INIT in br_js
br_js = br_js.replace(OLD_INIT, NEW_INIT, 1)
assert 'bindDbUpdates' not in br_js, 'brain 仍残留 bindDbUpdates 引用'

# ---- brain: 内部跳 Tab 改走宿主
br_js = br_js.replace(
    "          switchTab('pool');\n          renderAll();",
    "          goTab('pool');\n          renderAll();"
)
br_js = br_js.replace(
    "if (act === 'go-pool') { switchTab('pool'); renderAll(); return; }",
    "if (act === 'go-pool') { goTab('pool'); renderAll(); return; }"
)

# ---- brain: 导出补 showPane / goTab
br_js = br_js.replace(
    "    switchTab: switchTab, doExport: doExport, fileInfoText: fileInfoText,",
    "    switchTab: switchTab, showPane: showPane, goTab: goTab, doExport: doExport, fileInfoText: fileInfoText,"
)
assert 'showPane: showPane' in br_js

# ---- brain: 顶部注释说明合并关系
br_js = br_js.replace(
    "<script>\n(function () {",
    "<script>\n/* 得到大脑模块 · 已并入统一工作台；导航交宿主，本段只管脑区数据与渲染 */\n(function () {",
    1
)

# brain 的 doExport 会触发下载，保留；br 里的 syncText 引用已随 setSync 重写而消失
assert "g('syncText')" not in br_js

# ---------------------------------------------------------------- 拼装成品
head_common = seg(v3, '<!DOCTYPE html>', '<style>')
br_head_meta = seg(br, '<!DOCTYPE html>', '<style>')

new_html = (
    head_common
    + '<style>' + new_css.rstrip() + '\n</style>\n</head>\n<body>'
    + new_body.rstrip()
    + '\n\n<script>'
    + v3_js.rstrip()
    + '\n</script>\n\n<script>'
    + br_js.rstrip()
    + '\n</script>\n</body>\n</html>\n'
)

wr('workbench.html', new_html)
print('OK  ->  workbench.html')
print('size:', len(new_html), 'bytes')
print('lines:', new_html.count('\n') + 1)
