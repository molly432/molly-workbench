# -*- coding: utf-8 -*-
"""合并页体检：id 唯一性 / JS 语法 / CSS 括号平衡 / 关键结构。"""
import io
import os
import re
import subprocess
import json

import shutil

BASE = os.path.dirname(os.path.abspath(__file__))
NODE = shutil.which('node') or r'C:\Users\Administrator\.workbuddy\binaries\node\versions\current\node.exe'

html = io.open(os.path.join(BASE, 'workbench.html'), encoding='utf-8').read()
report = []
fail = 0


def chk(name, ok, extra=''):
    global fail
    report.append(('PASS' if ok else 'FAIL') + '  ' + name + (('  ' + extra) if extra else ''))
    if not ok:
        fail += 1


# ---------- 1. id 唯一性（只看真实 HTML 属性，排除 data-*-id= 与 JS 拼接串） ----------
html_only = re.sub(r'<script>.*?</script>', '', html, flags=re.S)
ids = re.findall(r'(?<![\w-])id="([^"<>+]+)"', html_only)
dupes = sorted({i for i in ids if ids.count(i) > 1})
chk('id 唯一性', not dupes, ('重复: ' + ', '.join(dupes)) if dupes else '共 %d 个 id' % len(ids))

# ---------- 2. script 抽取 + 语法 ----------
scripts = re.findall(r'<script>(.*?)</script>', html, flags=re.S)
chk('script 块数量=2', len(scripts) == 2, str(len(scripts)))

tmpdir = os.path.join(BASE, '_chk')
os.makedirs(tmpdir, exist_ok=True)
for idx, s in enumerate(scripts):
    p = os.path.join(tmpdir, 's%d.js' % idx)
    io.open(p, 'w', encoding='utf-8').write(s)
    r = subprocess.run([NODE, '--check', p], capture_output=True, text=True)
    chk('script[%d] 语法' % idx, r.returncode == 0,
        (r.stderr or '').strip().split('\n')[0][:160] if r.returncode else '%d 行' % (s.count('\n') + 1))

# ---------- 3. CSS 括号平衡 ----------
css = re.findall(r'<style>(.*?)</style>', html, flags=re.S)
chk('style 块数量=1', len(css) == 1, str(len(css)))
if css:
    c = css[0]
    body = re.sub(r'/\*.*?\*/', '', c, flags=re.S)
    o, cl = body.count('{'), body.count('}')
    chk('CSS 花括号平衡', o == cl, 'open=%d close=%d' % (o, cl))

# ---------- 4. 关键结构 ----------
for cond, label in [
    ('id="brainZone"' in html, '存在 #brainZone'),
    ('id="brainAlertHost"' in html, '存在 #brainAlertHost'),
    ('id="alertHost"' in html, '存在 #alertHost（宿主）'),
    ('window.__WB__.setSync = setSync;' in html, '宿主暴露 setSync'),
    ('showPane: showPane' in html, '脑区暴露 showPane'),
    ('flow: 1' in html, 'TAB_KEYS 含 flow'),
    ('.nav-sep' in html, '有分组小标题 .nav-sep'),
    # ---- 玫瑰装饰层（add_rose_deco.py 注入，两区统一观感的第二条不变量） ----
    ('id="dxPetals"' in html, '存在飘落花瓣层'),
    ('class="dx-side-rose"' in html, '存在侧栏玫瑰水印'),
    ('data-dx="rose"' in html, '品牌标已换成玫瑰'),
    ('#brainZone .card:hover' in html, '脑区卡片吃同一套悬停（跨区补齐）'),
    # ---- 玫瑰开场层（add_splash.py 注入：一屏一花一句 + 进入工作台入口） ----
    ('id="dxSplash"' in html, '存在玫瑰开场层'),
    ('id="dxSpGo"' in html, '开场层有「进入工作台」按钮'),
    ('id="dxSpNext"' in html, '开场层有「再换一句」'),
    ('id="dxSplashBtn"' in html, '侧栏有玫瑰开场入口'),
    ('var QUOTES = [' in html, '名言库已内嵌'),
    ('ROSE_SPLASH_JS END' in html, '开场 JS 已注入'),
]:
    chk(label, cond)

# ---- 开场层专项：默认不显示 + 层级最高 + 每日选句确定性 ----
_sp_css = re.search(r'\.dx-splash\{[^}]*\}', html)
chk('开场层默认 display:none（JS 失败也不白屏，不会挡住工作台）',
    bool(_sp_css) and 'display:none' in _sp_css.group(0))
_z = re.findall(r'z-index:(\d+)', html)
chk('开场层层级为全站最高', bool(_z) and max(int(v) for v in _z) == 9000,
    'max z-index=%s' % (max(int(v) for v in _z) if _z else '无'))
_mq = re.search(r'var QUOTES = (\[.*?\]);\n  var N =', html, re.S)
if _mq:
    import json as _json
    _q = _json.loads(_mq.group(1))
    chk('名言条数 ≥ 30', len(_q) >= 30, '%d 条' % len(_q))
    chk('名言字段齐全（正文/作者/出处/类别）',
        all(q.get('t') and q.get('a') and q.get('w') and q.get('k') for q in _q))
    chk('名言正文无重复', len({q['t'] for q in _q}) == len(_q))
else:
    chk('名言库可解析', False, '未匹配到内嵌数组')
for frag, label in [
    ('function pickFor(', '每日选句为确定性函数（同一天同一句）'),
    ('molly.splash.skip', '支持「今日不再自动显示」'),
    ('function hash32(', '日期哈希已实现（避免相邻两天撞句）'),
]:
    chk(label, frag in html)

# ---------- 4b. 文案事实门（防止过时链路措辞回流） ----------
# 取数链路已从「Obsidian 通稿」改为「直连得到云端」，且页面并无本机离线暂存
# → 页面上任何一处旧措辞都会误导操作。这里把「必须出现」与「必须不出现」都钉住。
for frag, label in [
    ('直连云端取回录音', '领取入口提示已写清直连链路'),
    ('点「刷新」重新同步', '离线行为描述与实际一致（无自动重连）'),
]:
    chk(label, frag in html)

for frag, label in [
    ('从 Obsidian', '无「从 Obsidian 提取」旧链路措辞'),
    ('暂存本机', '无「断网暂存本机」虚构能力'),
    ('转为只读展示', '离线时是不展示数据，不是只读展示'),
    ('正文可在下方', '无「正文可在下方…里了解」语病句'),
    ('getnote 转写时', '转写来源统一表述为「得到云端」'),
]:
    chk(label, frag not in html)

# ---------- 4c. 空台账门：交付物里不得存在「没有数据就编造数据」的路径 ----------
# 台账为空时曾经回退成 5 条演示数据，用户打开正式页面看到的是假记录 —— 这类兜底一律不许存在。
# 「读不到」与「没有」也必须分开：前者是故障，后者才是空态。
for frag, label in [
    ('主台账还是空的', '空台账有引导性空态'),
    ('data-alert="goPool"', '空态提供「去待办仓库领取」'),
    ('data-alert="newFirst"', '空态提供「新建一条」'),
    ('loadFailed', '读取失败与空台账分开建模'),
    ('读取资料库失败', '读取失败有独立提示'),
]:
    chk(label, frag in html)

for frag, label in [
    ('DEMO_ROWS', '无演示数据常量'),
    ('S.demo', '无演示模式开关'),
    ('演示数据', '页面不出现「演示数据」字样'),
    ('currentRows(', '无演示取数分支'),
]:
    chk(label, frag not in html)

# ---------- 4d. 日期选择门：日历必须完整、且不被任何容器裁切 ----------
# 用户反馈「选日期的日历不齐全」。根因：原生日期控件的弹层由浏览器渲染、依附输入框定位，
# 会被 iframe 边界与 .dlg 的 overflow:auto 裁掉一块。故一律改用自研 fixed 弹层 ——
# 它挂在 body 上、相对视口定位、恒定 6 行 42 格，因此「齐全」是可静态验证的。
for frag, label in [
    ('自研日历面板（CAL_UI BEGIN）', '日历组件样式已注入'),
    ('var CalPop = (function', '日历逻辑已注入'),
    ('Cal: CalPop', '日历组件已对外暴露（可被测试驱动）'),
    ('position:fixed;left:0;top:0;z-index:70', '弹层 fixed 定位，不参与父级裁剪'),
    ('i < 42', '月历恒定 6 行 × 7 列 = 42 格，任何月份都不缺格'),
    ('r.top - 6 - H', '下方放不下时自动向上翻转'),
    ('document.addEventListener', '日历走 document 级事件委托（脑区同样生效）'),
    ('#brainZone .calwrap>input', '脑区日期框已做跨区样式补齐'),
]:
    chk(label, frag in html)

# 原生日期控件必须彻底清空：只要还在，弹层就还会被裁
chk('页面已无原生日期控件', 'type="date"' not in html, '仍出现 %d 处' % html.count('type="date"'))
# 4 个静态表单框（新建/编辑的计划·截止 + 领取的计划·截止）+ 1 处任务清单的行内改期模板
chk("日历接管的日期框齐备（4 个表单框 + 1 处行内改期模板）",
    html.count("data-cal=\"1\"") == 5, str(html.count("data-cal=\"1\"")))

# 每个日期框：已是文本框（可手输）+ 带 data-cal（可弹日历）
for _id in ['e-plan', 'e-due', 'c-plan', 'c-due']:
    _m = re.search(r'<input[^>]*id="%s"[^>]*>' % _id, html)
    chk('日期框 %s 已接管且可手输' % _id,
        bool(_m) and 'data-cal' in _m.group(0) and 'type="text"' in _m.group(0),
        (_m.group(0)[:64] if _m else '未找到'))

# 层叠顺序：必须高于遮罩(.mask)才看得见，低于开场层(.dx-splash)才不会被盖住
_z = re.search(r'\.calpop\{[^}]*z-index:(\d+)', html)
_mz = re.search(r'\.mask\{[^}]*z-index:(\d+)', html)
_sz = re.search(r'\.dx-splash\{[^}]*z-index:(\d+)', html)
chk('日历弹层层叠正确（遮罩 < 日历 < 开场层）',
    bool(_z) and bool(_mz) and bool(_sz)
    and int(_mz.group(1)) < int(_z.group(1)) < int(_sz.group(1)),
    '%s < %s < %s' % (_mz and _mz.group(1), _z and _z.group(1), _sz and _sz.group(1)))

# ---------- 4e. 月历门：7 天条看完整月 → 内嵌整月 + 按周翻动 ----------
# 用户反馈「日期没有办法看完，我希望它跟日历一样，我点开可以选择我想要的日期，
# 提前先把规划写在里面」。三件事都要可静态验证：
#   ① 看完整月：恒定 6×7=42 格（与 CalPop 同一约定），且默认就是展开的
#   ② 点开可选任意日期：月/年可翻，任意格子可点，选中日驱动整页
#   ③ 能提前写规划：选中日之后有输入框落点提示 + 空日子有排期引导
for frag, label in [
    ('id="planCal"', '存在内嵌月历容器'),
    ('id="btnCal"', '有「月历」展开/收起入口'),
    ('id="stripPrev"', '7 天条有往前一周按钮'),
    ('id="stripNext"', '7 天条有往后一周按钮'),
    ('id="stripHint"', '有「当前选中哪一天」的说明行'),
    ('月历 · 排期视图（PLAN_CAL BEGIN）', '月历样式已注入'),
    ('PLAN_CAL END', '月历代码块有闭合标记'),
    ('function renderPlanCal(', '月历渲染函数存在'),
    ('function setSelDate(', '选中日只有一个入口（避免各视图各改一份状态）'),
    ('function dayLoadOf(', '排期负载计算为独立纯函数'),
    ("data-mc-act=\"add\"", '选中日面板有「给这天记一条」'),
    ('这一天还没有安排', '空日子给出提前排期的引导文案'),
    ('molly.plancal', '折叠状态持久化（记住用户选择）'),
    ('PlanCal: {', '月历已对外暴露（可被测试驱动）'),
    # ---- 排期数必须与「今日推进」同口径：都按未完成的计划/截止日归集 ----
    ("if (planKey(r) !== k && dueKey(r) !== k) continue;", '排期按计划日/截止日归集（与看板同口径）'),
    # ---- 默认展开：用户要的就是「不用点开就看完」 ----
    ('calOpen: true', '月历默认展开'),
]:
    chk(label, frag in html)

# 折叠态入口：静态 HTML 里必须是 hide（JS 关了最坏只是「月历没出现」，不会留空壳卡片）
_mc = re.search(r'<div class="mcal([^"]*)" id="planCal"', html)
chk('月历静态初始为隐藏（由 JS 展开，JS 失败不留空壳）',
    bool(_mc) and 'hide' in _mc.group(1), _mc.group(1) if _mc else '未找到')

# 三个组件在卡片里的先后：日期条 → 月历 → 输入框（顺序错了会让「选中即落点」读不懂）
_i_strip = html.find('id="dateStrip"')
_i_cal = html.find('id="planCal"')
_i_qk = html.find('id="quickInput"')
chk('卡片内顺序为 日期条 → 月历 → 输入框',
    -1 < _i_strip < _i_cal < _i_qk, '%d / %d / %d' % (_i_strip, _i_cal, _i_qk))

# 重名回归门：同作用域两处 function weekLabel 会让日期版被周偏移版覆盖 → 页面出现
# 「NaN/NaN 起」。这是被用户截图抓到过的真实故障，必须钉死：各只允许一处，且日期版不得再叫 weekLabel。
chk('weekLabel 只声明一次（不再与周偏移版重名）', html.count('function weekLabel(') == 1,
    str(html.count('function weekLabel(')))
chk('wdLabel 只声明一次（日期版已改名）', html.count('function wdLabel(') == 1,
    str(html.count('function wdLabel(')))
for frag, label in [
    ('wdLabel(base)', '日期条用 wdLabel 取周几'),
    ('wdLabel(d)', '页头副标题用 wdLabel 取周几'),
]:
    chk(label, frag in html)
for frag, label in [
    ('weekLabel(k)', '无「按日期调用 weekLabel」的旧写法'),
    ('weekLabel(d)', '无「按日期调用 weekLabel」的旧写法（副标题）'),
]:
    chk(label, frag not in html)

# ---------- 4f. 未连接态门：读不到 ≠ 没有 ----------
# 用户截图反馈「怎么全是空的」：他打开的是本地 HTML（无平台数据桥），页面却把「读不到」
# 表现成「0 条 + 没有待办」。§4c 只钉住了宿主区，脑区（录音库/待办仓库）当时仍在装空。
# 这里把「未连接时的诚实表达」钉死：指标显示「—」、空态改口径、角标与告警分两路。
for frag, label in [
    ('var ok = !!S.dbReady;', '脑区 KPI 读数按连接状态分路'),
    ('#brainZone .kpi .n.na{', '未连接时指标用弱化样式标注'),
    ('var pMsg = S.dbReady', '待办仓库空态按连接状态分路'),
    ('var lMsg = S.dbReady', '录音库空态按连接状态分路'),
    ('没连上资料库，<b>读不到</b>待办仓库的数据', '待办仓库明说「读不到」而非「没有」'),
    ('没连上资料库，<b>读不到</b>录音库的数据', '录音库明说「读不到」而非「没有」'),
    ('未连接平台 · 仅本机', '角标/告警区分「没拿到平台通道」'),
    ('同步失败 · 点重试', '角标/告警区分「连上但读表失败」'),
    ('var na = S.loadFailed;', '宿主 KPI 故障时显示「—」'),
    ('请从「资料库」的页面列表打开线上页面', '未连接时给的是「换入口」指引，不是空态引导'),
]:
    chk(label, frag in html)
for frag, label in [
    ('离线模式：仅本机', '无混指一团的旧角标文案'),
    ('已切换为<b>本机模式</b>', '无「已切换为本机模式」的含糊表述'),
    ('暂时连不上资料库', '告警不再把「没通道」与「读表失败」混为一谈'),
]:
    chk(label, frag not in html)

# ---------- 4g. 领取校对门 + 任务清单门 ----------
# 用户两条需求的原话：
#   ①「在领取任务时，我需要具备编辑能力，因为在录音过程中有时会出现任务汇总错误，
#       我需要能够对这些错误任务进行调整和修正」
#   ②「当我领取任务后，请根据我确认的时间，将该任务同步到对应当天的日历以及待办事项中；
#       现在的页面只有今天要处理的是不够的，可以额外增加一项任务清单来进行管理」
# 于是要钉住三件事：领取环节可改（含回写源头）、落点日期由用户确认、有一个跨日期的清单。
for frag, label in [
    # ---- ① 领取即可校对 ----
    ('id="c-head"', '领取弹窗标题可切换（单条 / 批量）'),
    ('领取并校对', '弹窗明说是「领取并校对」，不是单纯领取'),
    ('可改写，这里写下的就是最终版本', '事项可改写且说清改写即最终版本'),
    ('id="c-tag"', '领取时可补标签'),
    ('id="c-drop"', '有「落点预览」区'),
    ('将落在 ', '落点预览写明会落在哪一天'),
    ('日历这一天会亮起排期标记', '落点预览说明日历会同步'),
    ('id="c-writeback"', '可把修正回写给待办仓库'),
    ('把改动同步回「待办仓库」的原始提取', '回写范围有明确文案'),
    ('保留录音原话作为凭证', '原文摘录作为录音凭证保留'),
    ('function writeBackPool(', '回写仓库已实现'),
    ('function openClaimBatch(', '批量领取走弹窗（可确认日期）而不是直接 confirm'),
    ('function doClaimBatch(', '批量领取提交逻辑存在'),
    ('function setClaimMode(', '弹窗支持单条 / 批量两种模式'),
    ('function renderDropHint(', '落点预览有独立渲染函数'),
    # ---- ② 落点日期由用户确认，且写进唯一权威字段 ----
    ('claimRows(list, planK,', '批量领取接受用户确认的落点日期'),
    # 落库格式随「时间点」一起升级：一律经 toApiDate 转成 date 列认的形态，
    # 这样落点既能是纯日期、也能精确到「2026-09-21T14:30:00Z」。
    ("'计划日期': { date: toApiDate(planK) }", '批量领取按用户确认的日期落库（保留时间点）'),
    ("'计划日期'] = { date: toApiDate(g('c-plan').value) }", '单条领取按用户确认的日期落库（保留时间点）'),
    # ---- ② 任务清单模块 ----
    ('id="taskCard"', '存在「任务清单」卡片'),
    ('id="taskList"', '任务清单有列表容器'),
    ('id="taskViews"', '任务清单有视图切换'),
    ('data-tv="open"', '任务清单有「全部未完成」视图'),
    ('data-tv="week"', '任务清单有「未来 7 天」视图'),
    ('data-tv="unsched"', '任务清单有「未排期」视图'),
    ('data-tv="done"', '任务清单有「已完成」视图'),
    ('任务清单（TASKLIST_JS BEGIN）', '任务清单样式已注入'),
    ('TASKLIST_JS END', '任务清单代码块有闭合标记'),
    ('function renderTaskList(', '任务清单渲染函数存在'),
    ('function taskGroups(', '任务清单分组为独立纯函数'),
    ('function reschedule(', '行内改期有独立实现'),
    ('function bindTaskList(', '任务清单事件已绑定'),
    ('TaskList: {', '任务清单已对外暴露（可被测试驱动）'),
    ('molly.taskview', '任务清单视图选择持久化（记住用户选择）'),
    ('data-rs=', '每条任务带行内改期控件'),
    ('没有「未排期」的任务', '未排期视图有独立空态'),
    # ---- 编辑弹窗也能反向修正源头 ----
    ('id="e-writeback"', '编辑弹窗可把修正回写给待办仓库'),
    ('同步修正到「待办仓库」的原始提取', '编辑弹窗回写有明确文案'),
]:
    chk(label, frag in html)

# 任务清单必须与「今天要处理」同口径：都按未完成的计划日/截止日归集，逾期不重复出现
for frag, label in [
    ('var k = planKey(r);', '任务清单按 planKey 归集（与看板同口径）'),
    ('if (k < tk) { over.push(r); continue; }', '逾期项单独成组、不按日期重复出现'),
    ("function tvRead()", '视图选择可读回（刷新后不跳回默认）'),
]:
    chk(label, frag in html)

# 行内改期必须复用同一个日历组件，而不是另起一套日期选择
_rsi = re.search(r'<span class="tl-dt">(<input[^>]*>)', html)
chk('行内改期控件复用同一个日历面板',
    bool(_rsi) and 'data-cal="1"' in _rsi.group(1) and 'data-rs=' in _rsi.group(1),
    (_rsi.group(1)[:80] if _rsi else '未找到'))
chk('行内改期控件为可手输文本框且只读（点开即弹日历）',
    bool(_rsi) and 'type="text"' in _rsi.group(1) and 'readonly' in _rsi.group(1))

# 回写两条路径共用同一个实现：脑区（有仓库 schema，写 option id）+ 宿主兜底
chk('回写仓库的实现同时存在于脑区与宿主兜底', html.count('function writeBackPool(') == 2,
    str(html.count('function writeBackPool(')))

# 反回归：批量领取不得再「直接 confirm + 硬编码今天」
for frag, label in [
    ('全部领取进今日的工作计划', '批量领取不再走「直接确认落今天」的旧路径'),
    ('已进入今日计划', '领取成功的提示不再含糊说「进今日计划」（要说清落在哪天）'),
]:
    chk(label, frag not in html)

# ---------- 4h. 重复治理门（写入锁 / 自动复查 / 整理重复 / 删除回退仓库）----------
# 真实事故：领取一次，主台账落两行 —— 两条除 record_id 外逐字段一致、连毫秒时间戳都相同。
# 时间戳相同只能来自同一个 tick 内的两次同步调用，所以先在入口上一把同步锁。
chk('领取写入锁已就位', 'var claimBusy = false;' in html and 'function claimEnter(' in html
    and 'function claimLeave()' in html, str(html.count('claimBusy')))
chk('doClaim 入口先夺锁，抢不到就直接退出',
    bool(re.search(r"function doClaim\(\)\s*\{\s*if \(!claimEnter\(\)\) return;", html)))
chk('锁在每条出口都释放（不锁死页面）', html.count('claimLeave();') >= 8,
    str(html.count('claimLeave();')))
chk('批量领取的每个早退分支也释放锁',
    bool(re.search(r"无法领取'\); claimLeave\(\); return;", html)))
# 写入后延迟复查：若第二次写入比我们更晚落库，只有延迟才能查到
chk('写入后会自动复查重复',
    bool(re.search(r"function afterWrite\(\)[\s\S]{0,400}sweepDups\(\)\.then", html)))
chk('复查确有延迟（防第二次写入后到）', '}, 900);' in html)
chk('自动清理有明确提示', '检测到重复写入，已自动清理 ' in html)

for frag, label in [
    ('function findDups(', '整理重复：先盘点不写入'),
    ('function sweepDups(', '整理重复：执行清理'),
    ('function pickDupKeep(', '整理重复：组内保留规则'),
    ('function poolRowById(', '整理重复：反查仓库来源项'),
    ("String(grp[i]['状态'] || '') === '已完成'", '保留规则：已完成优先（保住真实进度）'),
    ("Number(pool[i]['创建时间'] || 0) < Number(best['创建时间'] || 0)", '保留规则：其次最早创建'),
    ("if (grp.length < 2) continue;", '只处理真正重复的组'),
    ('id="btnDedupe"', '任务清单有「整理重复」入口'),
    ('整理重复', '入口文案'),
]:
    chk(label, frag in html)

# 判定口径必须钉死：只按 仓库ID 分组，标题相同不算重复；手工新建的记录一律不参与
chk('去重只按 仓库ID 判定（手工新建的不参与）', html.count('if (!pid) continue;') == 2,
    str(html.count('if (!pid) continue;')))
chk('清理后会校正仓库的「工作台记录ID」指向保留项',
    "properties: { '工作台记录ID': { text: String(f.keep) } }" in html)
chk('单条删除失败不中断整批清理',
    '宁可留下一条重复，也不要清到一半停下' in html)

# 任务清单里的操作按钮必须是活的（曾被漏绑 → 删除/编辑点了没反应）
chk('任务清单已接上 onItemAction（删除/编辑/完成可用）',
    html.count("host.addEventListener('click', onItemAction);") == 1,
    str(html.count("host.addEventListener('click', onItemAction);")))
chk('删除主台账记录会回退来源仓库项状态',
    bool(re.search(r"function deleteRow\(row\)[\s\S]{0,700}releasePool\(pid\)", html)))
chk('回退仓库的实现同时存在于脑区与宿主',
    html.count('function releasePool(poolId)') == 2, str(html.count('function releasePool(poolId)')))
chk('删除提示说清了仓库项的去向', '来源仓库项退回「待领取」' in html)

# ---------- 4i. 项目推进台门（卡片能改 + 改名必须联动归属）----------
# 真实事故（用户原话「怎么项目推进的项目改不了」）：项目卡的名字取自项目记录的「标题」，
# 而待办是靠自由文本「关联项目」找到项目的 —— 两者根本不是同一套命名。线上 3 条项目记录
# 的标题是行动描述、关联项目才是项目名，于是 3 张真项目卡全空，另外 9 张是只有名字的
# 「空壳卡」；而空壳卡当时只有「立项」按钮、没有任何改名入口，用户看着名字写错的项目
# 无从下手。且展开明细里的待办按钮走 onItemAction，而 #projectList 只绑了 onProjectAction。
chk('项目卡有「改名」入口（含未立项的空壳卡）',
    '<button class="btn sm ghost" data-pact="rename" data-name="' in html)
chk('改名入口对空壳卡也开放（不再只有「立项」一条路）',
    bool(re.search(r"data-pact=\"rename\" data-name=\"' \+ esc\(item\.name\) \+ '\"'" , html))
    and bool(re.search(r"data-pact=\"rename\"[\s\S]{0,90}row \?", html)))
chk('点「改名」会打开改名弹窗',
    bool(re.search(r"if \(act === 'rename'\)[\s\S]{0,140}openRename\(", html)))

for frag, label in [
    ('function renameAffected(', '改名：先算出会影响哪些记录'),
    ('function renderRenameHint(', '改名：把影响面讲给用户'),
    ('function renameLinked(', '改名：联动改写「关联项目」归属'),
    ('function closeRename(', '改名：可取消'),
    ('function bindRenameDialog(', '改名：弹窗事件已绑定'),
    ('id="rnMask"', '改名弹窗存在'),
    ('id="rnName"', '改名输入框'),
    ('id="rnHint"', '改名影响面提示'),
    ('id="rnOk"', '改名确认按钮'),
    ('项目名就是聚合键：待办靠「关联项目」这个名字找到所属项目。', '改名：提示里讲清了聚合口径'),
    ('已立项，项目记录本身的标题也会一起改。', '改名：说明会连项目记录标题一起改'),
    ('还没立项，只改归属', '改名：未立项时说明只改归属'),
]:
    chk(label, frag in html)

chk('改名只改「关联项目」这一个字段（项目名是唯一聚合键）',
    "Store.patch(r._id, { '关联项目': { text: newName } })" in html)
chk('已立项时连项目记录自己的「关联项目」一起对齐（否则它会以旧名再长一张空壳卡）',
    bool(re.search(r"rs\[i\]\['关联项目'\] \|\| ''\)\.trim\(\) === old", html)))
chk('编辑弹窗改项目标题时同样联动（否则改名等于把名下待办全甩掉）',
    bool(re.search(r"renameLinked\(renameFrom, title, S\.editingId\)", html)))
chk('联动改名的结果会告诉用户改了几条',
    "挂在这个项目下的 ' + r.n" in html)
chk('空壳卡改名不新建记录（只改归属）',
    bool(re.search(r"renameFrom, title, S\.editingId\)[\s\S]{0,160}", html))
    and "head = Promise.resolve(true);" in html)

# 项目明细里的按钮必须真的活着（与「今天要处理」同一套动作）
chk('项目明细里的待办/沉淀按钮已接上 onItemAction',
    html.count("list.addEventListener('click', onItemAction);") == 1,
    str(html.count("list.addEventListener('click', onItemAction);")))
chk('项目台绑定是幂等的（重复绑定会让「展开明细」执行两次，看着像没反应）',
    'if (S.projBound) return;' in html and 'S.projBound = 1;' in html)
chk('改名弹窗的事件随项目台绑定一起注册', 'bindRenameDialog();' in html)

# 反回归：死代码与重复赋值不许回流
chk('只挂 bindRoll 的那处死代码 bindExtra 赋值不再出现',
    'window.__WB__.bindExtra = function () { bindRoll(); }' not in html)

# ---------- 4j. 项目归并门（整理项目 / 防重复 / 确认弹窗）----------
# 真实事故（用户原话「项目分类你帮我整合一下 我感觉我搞重复了」）：线上 14 张项目卡里 11 张是
# 空壳 —— 「小黄蜂&健医师」和「小黄蜂&健医师项目」各挂一条待办，两张卡谁也看不见谁。
# 根子是「关联项目」这个自由文本框：datalist 只提示、不拦截，手打一个变体照样入库。
chk('项目台有「整理项目」入口', 'id="btnProjMerge"' in html and '整理项目' in html)

for frag, label in [
    ('id="pjMask"', '整理项目：弹窗存在'),
    ('id="pjList"', '整理项目：列表容器'),
    ('id="pjLead"', '整理项目：顶部说明'),
    ('id="pjOk"', '整理项目：合并按钮'),
    ('id="pjCancel"', '整理项目：可取消'),
    ('function projKind(', '归并：名字归一化'),
    ('function bgOf(', '归并：中文 2-gram'),
    ('function projPairReason(', '归并：成对相似判定'),
    ('function pickKeep(', '归并：保留项规则'),
    ('function projSuggest(', '归并：并查集聚类'),
    ('function mergeProj(', '归并：执行单次合并'),
    ('function doProjMerge(', '归并：批量合并入口'),
    ('function bindProjMerge(', '归并：事件已绑定'),
    ('function pjOnChange(', '归并：勾选态同步'),
    ('mergeProj(nm, keep)', '归并：逐个并入保留项'),
    ('renameLinked(fromName, toName, src ? src._id : null)', '归并：复用改名联动，只改「关联项目」'),
    ('判断依据：', '归并：把判断理由讲给用户'),
    ('其他项目（也可勾上一起合并）', '归并：算法抓不到的允许手动勾（业务语义算法不懂）'),
    ('合并所选', '归并：入口文案'),
]:
    chk(label, frag in html)

# 归一化必须真的做四件事，否则「小黄蜂&健医师项目」这种变体抓不出来
chk('归一化会剥掉「项目 / 专项 / 计划」这类通用后缀',
    bool(re.search(r"var tail = /\(项目\|专项\|计划\|方案\|事宜\|工作\|事项\|相关\)\$/", html)))
chk('归一化会做全角转半角', '\\uff01-\\uff5e' in html)
chk('归一化会去掉标点、空格与分隔符', bool(re.search(r"t\.replace\(/\[\\s·・", html)))
chk('归一化可叠加剥离（「XX项目计划」要剥两次）',
    bool(re.search(r"var tail = /\(项目[\s\S]{0,60}for \(var i = 0; i < 3; i\+\+\)", html)))

# 合并只改「关联项目」，且项目本体要分三种情况处理 —— 否则会出现「两条同名项目记录」这种新脏数据
chk('只有被并方有本体时：本体改名搬过来（下一步/卡点不丢）',
    bool(re.search(r"if \(src && !dst\)[\s\S]{0,220}'标题': \{ text: toName \}", html)))
chk('两边都有本体时：先搬字段再删记录（否则同名两条）',
    bool(re.search(r"else if \(src && dst\)[\s\S]{0,700}Store\.remove\(src\._id\)", html)))
chk('两边都没本体时：不新建记录，只改归属', 'head = Promise.resolve(true);' in html)
chk('保留项优先「有项目本体」的（说明真建过、有下一步/卡点）',
    bool(re.search(r"if \(!!b\.hasBody !== !!best\.hasBody\) \{ if \(b\.hasBody\) best = b; continue; \}", html)))

# 防重复：输入时内联提示 + 保存时拦一次
for frag, label in [
    ('function similarProj(', '防重复：相似名判定'),
    ('function renderProjHint(', '防重复：内联提示渲染'),
    ('function bindProjHint(', '防重复：内联提示事件已绑定'),
    ('id="eProjHint"', '防重复：提示容器挂在「关联项目」下'),
    ('data-useproj', '防重复：提供「就用它」一键采用'),
    ('就用它', '防重复：一键采用文案'),
    ('function currentPj(', '防重复：能取到编辑前的旧值（没改就不拦）'),
    ('function saveEditNow(', '保存逻辑已抽出（确认弹窗是回调式的，要能回来接着存）'),
]:
    chk(label, frag in html)

chk('内联提示在草稿还原之后算（否则草稿会覆盖它的输入）',
    bool(re.search(r"restoreDraft\(\);\s*\n\s*/\* 草稿会把「关联项目」也还原[\s\S]{0,120}renderProjHint\(\);", html)))
chk('保存时若与已有项目撞名会拦一次',
    bool(re.search(r"if \(pjSim && pjv !== currentPj\(\)\)", html))
    and bool(re.search(r"title: '项目名可能重复'", html)))
chk('拦截给的是「并入已有 / 仍按我填的」两条明确出路',
    '归到「' in html and '仍按我填的保存' in html)
chk('相似判定刻意收窄：只认归一后相同与包含关系（2-gram 太松，只进建议不拦人）',
    bool(re.search(r"if \(ke === k\) return ex;[\s\S]{0,200}ke\.indexOf\(k\) !== -1", html)))

# 通用确认弹窗：原生 confirm 在 iframe 里可能被 sandbox 静默拦掉（不弹、返回 false），
# 那样「删除」永远删不掉、「顺延」点了没反应，控制台还一片干净。
for frag, label in [
    ('id="cfMask"', '确认弹窗存在'),
    ('id="cfTitle"', '确认弹窗：标题'),
    ('id="cfText"', '确认弹窗：正文'),
    ('id="cfYes"', '确认弹窗：确定'),
    ('id="cfNo"', '确认弹窗：取消'),
    ('function askConfirm(', '确认弹窗：回调式 API'),
    ('function closeConfirm(', '确认弹窗：关闭并回调'),
    ('function bindConfirmDialog(', '确认弹窗：事件已绑定'),
    ('bindConfirmDialog();', '确认弹窗：随项目台一起注册'),
]:
    chk(label, frag in html)

chk('页面里不再有原生 window.confirm 调用（注释里提到不算）',
    html.count('window.confirm(') == 0, str(html.count('window.confirm(')))
chk('四处确认都走自研弹窗（删除 / 整理重复 / 顺延 / 项目名防重复）',
    html.count('askConfirm({') >= 4, str(html.count('askConfirm({')))
chk('删除仍然会回退来源仓库项（换弹窗不能把这条链路弄丢）',
    bool(re.search(r"function deleteRow\(row\)[\s\S]{0,900}releasePool\(pid\)", html)))
chk('弹窗回调前先清空 cfCb（回调里可能又弹一个确认）',
    'cfCb = null;\n    if (cb) cb(!!yes);' in html or bool(re.search(r"cfCb = null;[\s\S]{0,60}if \(cb\) cb\(!!yes\);", html)))

chk('bindExtra 只赋值一次（否则后一处覆盖前一处，改错地方不生效）',
    html.count('window.__WB__.bindExtra = function ()') == 1,
    str(html.count('window.__WB__.bindExtra = function ()')))

# ---------- 4k. 时间点门（排期要精确到小时与分钟）----------
# 用户原话：「当前只能按天选择日期，无法选择具体的时间点。例如预约下午 14:30 时，
# 界面没有提供时间选项。」—— 约人、开会这类事光有日期根本没法用。
# 落地要点（每条都做成可静态验证的不变量）：
#   ①「计划日期 / 截止日期」是 date 列，官方同时接受 'YYYY-MM-DD' 与
#      'YYYY-MM-DDTHH:mm:00Z' 两种形态 ⇒ 不用加字段、不用动表结构。
#      已对线上表做过实测：写 14:30 读回仍是 14:30，无时区漂移。
#   ② 值格式只有两种：'YYYY-MM-DD'（全天）/ 'YYYY-MM-DD HH:mm'（带时间点）。
#      纯日期是新格式的子集 ⇒ 存量记录与既有链路零改动。
#   ③「00:00」一律当「没设时间」：存量数据的值全是 T00:00:00Z，若把它认成有效时间，
#      整页历史记录会突然冒出满屏 00:00。
#   ④ 按天分组的老逻辑必须不受影响：dayKey() 是前缀截取，带时间后缀照样取到那一天。
for _fn, _why in [
        ('timeOf', '从值里取时间点（00:00 与无时间一律返回空）'),
        ('dtText', '输入框与清单里的标准写法'),
        ('dtFriendly', '给人看的中文写法'),
        ('toApiDate', '输入框值 → date 列可写值（唯一的转换口）')]:
    chk('时间解析函数 %s 已定义（%s）' % (_fn, _why),
        bool(re.search(r'function ' + _fn + r'\s*\(', html)))

chk('timeOf / toApiDate 宿主与脑区各有一份（两边同一套口径）',
    len(re.findall(r'function timeOf\s*\(', html)) == 2
    and len(re.findall(r'function toApiDate\s*\(', html)) == 2,
    'timeOf=%d toApiDate=%d' % (len(re.findall(r'function timeOf\s*\(', html)),
                                len(re.findall(r'function toApiDate\s*\(', html))))

chk('timeOf 把 00:00 当作未设时间（否则存量 T00:00:00Z 会集体变成 00:00）',
    bool(re.search(r'function timeOf[\s\S]{0,700}?h === 0 && mi === 0\) return', html)))

chk('dayKey 仍是前缀截取（带时间后缀照样取到那一天，按天分组不受影响）',
    html.count("if (/^\\d{4}-\\d{2}-\\d{2}/.test(s)) return s.slice(0, 10);") >= 2,
    str(html.count("if (/^\\d{4}-\\d{2}-\\d{2}/.test(s)) return s.slice(0, 10);")))

# 弹层里的时间选择行
chk('日历弹层里有「时间」手输框', 'data-a="tin"' in html)
chk('日历弹层里有常用时间点快捷选（点一下即填）',
    bool(re.search(r"QUICK_T = \['\d{2}:\d{2}'", html)))
chk('日历弹层里有「全天」开关（把时间点撤回去）', 'data-a="tall"' in html)
chk('底栏有实时预览（选完能看见「已选 2026-09-21 14:30」）',
    bool(re.search(r"class=\"pv\">' \+ \(v \? \('已选 ", html)))
chk('时间行只在选日模式渲染（年月模式下不抢焦点）',
    bool(re.search(r'h \+= timeRow\(\);', html)))
chk('时间框认得紧凑写法（1430 / 930 / 14:30 / 14.30）',
    bool(re.search(r"function normTime[\s\S]{0,900}?g\.length === 3", html)))

# 时间手输框要能点进去：弹层的全局 preventDefault 必须对它放行
chk('弹层 mousedown 对 INPUT 放行（否则时间框点不动、聚不了焦）',
    bool(re.search(r"pop\.addEventListener\('mousedown'[\s\S]{0,500}?tag === 'INPUT'\) return", html)))

for _cls in ['.calpop .ct{', '.calpop .ct .tin{', '.calpop .ct .clr{',
             '.calpop .tc{', '.calpop .tc b.on{', '.calpop .pv{']:
    chk('时间行样式 %s 已就位' % _cls, _cls in html)

# 写入侧：一律经 toApiDate 转换，绝不把输入框原文直接塞给 SDK
chk('编辑保存走 toApiDate（「2026-09-21 14:30」带空格不能直接当 date 值）',
    bool(re.search(r"props\['计划日期'\] = \{ date: toApiDate\(g\('e-plan'\)\.value\) \}", html)))
chk('编辑保存的截止日期同样走 toApiDate',
    bool(re.search(r"props\['截止日期'\] = \{ date: toApiDate\(g\('e-due'\)\.value\) \}", html)))
chk('领取落库走 toApiDate', bool(re.search(r"'计划日期': \{ date: toApiDate\(planK\) \}", html)))
chk('行内改期走 toApiDate',
    bool(re.search(r"function reschedule[\s\S]{0,1400}?'计划日期': \{ date: toApiDate\(k\) \}", html)))
chk('行内改期要同时比日期与时间点（只比日期会把「仅调时间」当成没改）',
    bool(re.search(r"timeOf\(row\['计划日期'\]\) === kt", html)))
chk('顺延保留原时间点（14:30 的会顺延一天还是 14:30）',
    bool(re.search(r"var _t = timeOf\(r\['计划日期'\]\)", html)))
chk('JSON 导入保留时间点', html.count('{ date: toApiDate(src[') >= 2)

# 展示侧
chk('清单里的计划/截止标签带上时间点',
    bool(re.search(r"截止 ' \+ esc\(dtFriendly\(r\['截止日期'\]\)\)", html)))
chk('任务清单的行内日期框回显时间点',
    bool(re.search(r"var pk = dtText\(r\['计划日期'\] \|\| r\['截止日期'\]\)", html)))
chk('编辑弹窗回填保留时间点',
    bool(re.search(r"g\('e-plan'\)\.value = row \? dtText\(row\['计划日期'\]\)", html)))
chk('落点预览会说明时间点（全天 / 已排到 14:30）',
    bool(re.search(r"'（已排到 ' \+ t \+ '，任务清单里会显示这个时间点）'", html)))

# 对外暴露：冒烟要能直接驱动时间能力
chk('宿主导出时间函数供测试驱动',
    bool(re.search(r"timeOf: timeOf, dtText: dtText, dtFriendly: dtFriendly, toApiDate: toApiDate", html)))
chk('CalPop 对外暴露时间能力（commitTime / normTime / 快捷点）',
    bool(re.search(r"commitTime: commitTime, normTime: normTime, quick: QUICK_T", html)))

# ---- 反回归侧：这几处都是「改回去就出事」的地方 ----
chk('反回归：不得把输入框原文直接当 date 值写入',
    "{ date: g('e-plan').value }" not in html
    and "{ date: g('e-due').value }" not in html
    and "{ date: g('c-plan').value }" not in html)
chk('反回归：脑区落库不得再直接塞 planK',
    "'计划日期': { date: planK }" not in html)
chk('反回归：日期框占位不得再是纯 YYYY-MM-DD（否则看不出还能填时间）',
    html.count('placeholder="YYYY-MM-DD"') == 0, str(html.count('placeholder="YYYY-MM-DD"')))
chk('反回归：normTime 不得用 match 结果长度判定形态（14:30 会被解析成 00:14）',
    'm.length === 2' not in html)
chk('反回归：脑区落点标签不得直接 split("-") 取日（带时间会算出 NaN月NaN日）',
    not bool(re.search(r"function claimDayLabel\(k\) \{ var p = String\(k \|\| ''\)\.split\('-'\)", html)))
chk('反回归：落点标签先经 dayKey 截日期',
    bool(re.search(r"function claimDayLabel\(k\) \{\n\s+var d = dayKey\(k\);", html)))

# ---------- 5. CSS 作用域隔离抽查 ----------
scoped = re.findall(r'#brainZone \.[a-z-]+', html)
chk('脑区 CSS 已前缀化', len(scoped) > 60, '%d 条 #brainZone 规则' % len(scoped))
# 脑区独占类不得被裸定义（.kpi/.dlg/.pcard 等与 v3 同名，允许 v3 保留自身的裸定义）
css_plain = re.sub(r'/\*.*?\*/', '', css[0] if css else '', flags=re.S)
for cls in ['pc-quote', 'pg-head', 'pg-body', 'pg-name', 'pg-toggle', 'rrow', 'rsum',
            'plist', 'rbadge', 'rhead', 'rdate', 'rtodo', 'rule-b', 'flowwrap', 'syncline']:
    bare = re.search(r'^\s*\.' + cls + r'\s*[,{]', css_plain, re.M)
    chk('.%s 未被裸定义' % cls, bare is None)

# ---------- 6. 主题变量隔离 ----------
# 与具体配色解耦：只断言「两块作用域各自持有 --pri」，并额外断言两区主色一致
# （即「风格统一」是一条可验证的不变量）。换肤时无需改动本文件。
_br_pri = re.search(r'#brainZone\{[^}]*--pri:(#[0-9A-Fa-f]{6})', html)
_ro_pri = re.search(r':root\{[^}]*--pri:(#[0-9A-Fa-f]{6})', html)
chk('#brainZone 自带作用域变量块', _br_pri is not None)
chk(':root 主题未被脑区覆盖', _ro_pri is not None)
chk('两区主色一致（风格统一）',
    bool(_br_pri and _ro_pri and _br_pri.group(1).upper() == _ro_pri.group(1).upper()))
if _br_pri and _ro_pri:
    chk('主色为粉调（非旧蓝/青绿）',
        _br_pri.group(1).upper() not in ('#0E8C86', '#2B5CE6'))

print('\n'.join(report))
print('\n__FAILED__ %d' % fail)
io.open(os.path.join(BASE, 'verify_merged_log.txt'), 'w', encoding='utf-8').write('\n'.join(report) + '\n\n__FAILED__ %d\n' % fail)
