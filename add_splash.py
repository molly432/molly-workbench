# -*- coding: utf-8 -*-
"""为工作台宿主页注入「玫瑰开场层」——打开页面先呈现一屏玫瑰，每日一句名著箴言。

设计约束（与合并页一致）
- 只改宿主页 workbench_v3.html；脑区页不动（脑区 DOM 在合并时被搬进宿主）。
- 必须保持「1 个 <style> + 1 个 <script>」，否则 verify_merged.py 的门会红。
- 幂等：重复执行会先移除旧开场块再写回，不会叠加。
- JS 插在 ROSE_DECO_JS 之前（deco 脚本重跑时只会把自己挪到末尾，相对顺序稳定）。
- 开场层「宁可不生效也不能报错」：整段 IIFE 内部逐项能力探测；
  且覆盖层默认 display:none，由 JS 打开 —— JS 万一失败则直接看不到开场，不会白屏。
- 每日一句用日期哈希（murmur3 终混）确定性选取，同一天永远是同一句；
  「再换一句」只改当天记录，不动全局。

用法
  python add_splash.py          # 注入/更新
  python add_splash.py --check  # 只体检，不写
  python add_splash.py --dist   # 检查每日选句分布（3 年）
"""
import datetime
import io
import json
import math
import os
import re
import sys
from urllib.parse import quote

BASE = os.path.dirname(os.path.abspath(__file__))
HOST = os.path.join(BASE, 'workbench_v3.html')
DATA = os.path.join(BASE, 'rose_quotes.json')

M = '<!-- ROSE_SPLASH BEGIN -->'
ME = '<!-- ROSE_SPLASH END -->'
CM = '/* ===== ROSE_SPLASH BEGIN ===== */'
CME = '/* ===== ROSE_SPLASH END ===== */'
JM = '/* ROSE_SPLASH_JS BEGIN */'
JME = '/* ROSE_SPLASH_JS END */'

DECO_HTML_END = '<!-- ROSE_DECO END -->'
DECO_JS_BEGIN = '/* ROSE_DECO_JS BEGIN */'


# ------------------------------------------------------------------ 几何
def petal(cx, cy, ang_deg, r0, r1, hw, n=12, exp=0.70):
    """一片花瓣：从 (r0, ang) 指向 (r1, ang) 的对称纺锤形（尖基、尖梢）。"""
    a = math.radians(ang_deg)
    dx, dy = math.sin(a), -math.cos(a)
    px, py = math.cos(a), math.sin(a)
    left, right = [], []
    for k in range(n + 1):
        t = k / n
        rr = r0 + (r1 - r0) * t
        w = hw * math.pow(math.sin(math.pi * t), exp)
        bx, by = cx + dx * rr, cy + dy * rr
        left.append((bx - px * w, by - py * w))
        right.append((bx + px * w, by + py * w))
    pts = left + right[::-1]
    return 'M%.1f %.1f' % pts[0] + ''.join('L%.1f %.1f' % p for p in pts[1:]) + 'Z'


PHI = 137.508


def splash_rose_svg(size=320, n_outer=34):
    """开场页主视觉：斐波那契螺旋排布的玫瑰线描 + 中心花心 + 点状光环。

    每条 path 带 pathLength="1"，配合 CSS 的 stroke-dasharray:1 1 / dashoffset
    即可做出「描线绽放」动画，无需在 Python 里算真实路径长度。
    越靠外的花瓣 stroke-opacity 越高，形成浅深层次。
    """
    c = size / 2
    parts, ds = [], []
    r_max = 0.0
    for i in range(n_outer):
        u = i / (n_outer - 1)
        br = c * 0.045 + c * 0.44 * math.sqrt(u)
        tr = br + c * (0.115 + 0.135 * u)
        hw = c * (0.022 + 0.055 * u)
        op = 0.40 + 0.52 * u
        r_max = max(r_max, tr + hw)
        d = petal(c, c, i * PHI, br, tr, hw, 12, 0.80)
        ds.append(d)
        parts.append('<path d="%s" pathLength="1" style="--i:%d" stroke-opacity="%.2f"/>'
                     % (d, i, op))
    # 花心：三片小瓣，收紧成一个苞
    for k in range(3):
        d = petal(c, c, 60 + k * 120, 1.0, 4.6, 1.9, 12, 0.72)
        ds.append(d)
        parts.append('<path d="%s" pathLength="1" style="--i:%d" stroke-opacity=".85"/>'
                     % (d, n_outer + k))
    # 斐波那契排布本身略偏心：按包围盒实测中心整体平移，保证绝对居中
    xs, ys = [], []
    for d in ds:
        for mx, my in re.findall(r'[ML](-?[\d.]+) (-?[\d.]+)', d):
            xs.append(float(mx))
            ys.append(float(my))
    ox = c - (min(xs) + max(xs)) / 2.0
    oy = c - (min(ys) + max(ys)) / 2.0
    r_max += math.hypot(ox, oy)
    body = ('<g transform="translate(%.2f %.2f)">' % (ox, oy)) + ''.join(parts) + '</g>'
    # 点状光环（不动画，只做底纹），半径取在花瓣之外
    ring = c - 6.0
    assert ring > r_max - 2, '光环半径(%.1f) 必须大于花瓣外沿(%.1f)' % (ring, r_max)
    body = ('<circle cx="%.1f" cy="%.1f" r="%.1f" pathLength="1" '
            'stroke-dasharray="0.028 0.058" stroke-opacity=".12"/>'
            '<circle cx="%.1f" cy="%.1f" r="%.1f" pathLength="1" '
            'stroke-dasharray="0.005 0.011" stroke-opacity=".3"/>'
            % (c, c, ring - 13.0, c, c, ring)) + body
    return ('<svg class="dx-sp-rose" viewBox="0 0 %d %d" fill="none" stroke="currentColor" '
            'stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" '
            'aria-hidden="true">%s</svg>' % (size, size, body))


def bud_svg():
    """分隔线上的小花蕾（3 瓣），20px 下可辨。"""
    ds = [petal(12, 13, 0, 2.4, 8.6, 2.6, 12, 0.74),
          petal(12, 13, 120, 2.4, 8.6, 2.6, 12, 0.74),
          petal(12, 13, 240, 2.4, 8.6, 2.6, 12, 0.74)]
    return ('<svg class="dx-sp-bud" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            'stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + ''.join('<path d="%s"/>' % d for d in ds) + '</svg>')


def small_rose_svg():
    """侧栏入口用的小玫瑰（5 外瓣 + 3 内瓣，14px 下可辨）。"""
    parts = [petal(12, 12, i * 72, 5.4, 10.4, 3.2, 12, 0.72) for i in range(5)]
    parts += [petal(12, 12, 36 + i * 120, 1.2, 4.8, 1.7, 12, 0.70) for i in range(3)]
    return ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.35" '
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + ''.join('<path d="%s"/>' % d for d in parts) + '</svg>')


def arrow_svg():
    return ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            '<path d="M5 12h13M12.5 6l6 6-6 6"/></svg>')


# ------------------------------------------------------------------ 数据
def load_quotes():
    d = json.load(io.open(DATA, encoding='utf-8'))
    qs = d['quotes']
    for i, q in enumerate(qs):
        for k in ('t', 'a', 'w', 'k'):
            assert isinstance(q.get(k), str) and q[k].strip(), '第 %d 条缺字段 %s' % (i + 1, k)
    texts = [q['t'] for q in qs]
    dup = sorted({t for t in texts if texts.count(t) > 1})
    assert not dup, '正文重复：%s' % dup
    assert len(qs) >= 30, '句子太少（%d），先补到 30 条以上' % len(qs)
    return qs


# ------------------------------------------------------------------ CSS
def build_css():
    return r"""
/* ===== ROSE_SPLASH BEGIN ===== */
/* 玫瑰开场层：一屏一花一句。不参与工作台布局，JS 未跑则不显示（无白屏风险）。 */
.dx-splash{
  position:fixed; inset:0; z-index:9000;
  display:none; opacity:0; transform:scale(1.018);
  transition:opacity .52s ease, transform .6s cubic-bezier(.22,.7,.25,1);
  align-items:center; justify-content:center; padding:30px 22px; overflow:auto;
  color:#3B2B3F; font-size:15px; line-height:1.6;
  background:
    radial-gradient(1200px 720px at 50% 116%, rgba(201,127,163,.22) 0%, rgba(201,127,163,0) 64%),
    radial-gradient(820px 560px at 50% 26%, rgba(255,255,255,.94) 0%, rgba(255,255,255,0) 70%),
    linear-gradient(166deg,#FFF8FB 0%,#FDF1F7 40%,#F9ECF7 72%,#F7EAF6 100%);
  -webkit-backdrop-filter:blur(16px) saturate(1.04); backdrop-filter:blur(16px) saturate(1.04);
}
.dx-splash.on{display:flex}
.dx-splash.in{opacity:1;transform:none}
.dx-splash.out{opacity:0;transform:scale(1.012);pointer-events:none}
body.dx-splash-lock{overflow:hidden}

/* 质地：颗粒 + 小花格，只在玫瑰周围露出来 */
.dx-splash-veil{position:absolute;inset:0;pointer-events:none;
  background-image:var(--dx-grain,none);opacity:.05;mix-blend-mode:multiply}
.dx-splash-veil::after{content:"";position:absolute;inset:0;
  background-image:var(--dx-floret,none);background-size:32px 32px;opacity:.5;
  -webkit-mask-image:radial-gradient(620px 500px at 50% 30%,#000 0%,rgba(0,0,0,.32) 46%,transparent 78%);
  mask-image:radial-gradient(620px 500px at 50% 30%,#000 0%,rgba(0,0,0,.32) 46%,transparent 78%)}

/* 飘落花瓣（复用装饰层的下落节奏，但容器独立，装饰层被移除也不受影响） */
.dx-splash-petals{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.dx-sp-petal{position:absolute;top:-6vh;color:#D98BAE;opacity:0;
  animation:dxSpFall linear infinite;will-change:transform,opacity}
@keyframes dxSpFall{
  0%{transform:translate3d(0,-8vh,0) rotate(0deg);opacity:0}
  9%{opacity:var(--o,.32)}
  86%{opacity:var(--o,.32)}
  100%{transform:translate3d(var(--sw,0px),112vh,0) rotate(330deg);opacity:0}
}

.dx-splash-inner{position:relative;z-index:2;width:100%;max-width:720px;margin:auto;
  display:flex;flex-direction:column;align-items:center;text-align:center}

/* 主视觉：玫瑰线描（描线绽放） */
.dx-sp-rose-wrap{width:320px;max-width:62vw;color:#C97FA3;
  filter:drop-shadow(0 12px 28px rgba(176,87,123,.16))}
.dx-sp-rose{display:block;width:100%;height:auto}
.dx-sp-rose path{stroke-dasharray:1 1;stroke-dashoffset:0}
.dx-splash.in .dx-sp-rose path{
  animation:dxSpDraw 1.5s cubic-bezier(.22,.7,.25,1) both;
  animation-delay:calc(.10s + var(--i,0) * .017s)}
@keyframes dxSpDraw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}

/* 问候 + 日期 */
.dx-sp-greet{margin:24px 0 0;display:flex;align-items:center;gap:9px;
  font-size:13.5px;letter-spacing:.14em;color:#6D5A73}
.dx-sp-greet .dx-sp-dot{color:#D9AEC2}
.dx-sp-rule{display:flex;align-items:center;gap:10px;width:min(380px,74%);margin:15px 0 2px;color:#C08FA8}
.dx-sp-rule i{flex:1;height:1px;background:linear-gradient(90deg,transparent,#E7C4D4,transparent)}
.dx-sp-bud{width:20px;height:20px;opacity:.85;flex:0 0 20px}

/* 名言 */
.dx-sp-quote{position:relative;margin:10px 0 0;padding:0 46px;max-width:640px;
  font-family:"Songti SC","STSong","Noto Serif SC","Source Han Serif SC",Georgia,"Times New Roman",serif}
.dx-sp-quote p{margin:0;font-size:26px;line-height:1.86;letter-spacing:.035em;
  color:#3B2B3F;font-weight:500}
.dx-sp-mark{position:absolute;font-family:Georgia,serif;font-size:62px;line-height:1;
  color:#EFD3E0;pointer-events:none;user-select:none}
.dx-sp-mark-l{left:0;top:-10px}
.dx-sp-mark-r{right:0;bottom:-10px}
.dx-sp-by{margin:20px 0 0;display:flex;align-items:center;justify-content:center;gap:10px;
  font-size:13px;letter-spacing:.06em;color:#8A7C93;font-style:normal}
.dx-sp-by cite{font-style:normal}
.dx-sp-tag{padding:2px 9px;border-radius:999px;background:#FBEDF3;color:#8F4363;
  font-size:11.5px;letter-spacing:.08em;border:1px solid #F4DEE8;white-space:nowrap}
.dx-sp-swap p{animation:dxSpSwap .5s ease both}
@keyframes dxSpSwap{from{opacity:.12;transform:translateY(5px)}to{opacity:1;transform:none}}

/* 入口 */
.dx-sp-act{margin:32px 0 0;display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:center}
.dx-sp-go{display:inline-flex;align-items:center;gap:9px;padding:13px 30px;border:0;cursor:pointer;
  border-radius:999px;font-size:15px;letter-spacing:.08em;color:#fff;font-family:inherit;
  background:linear-gradient(135deg,#B0577B 0%,#8F4363 100%);
  box-shadow:0 8px 22px rgba(143,67,99,.26),0 2px 6px rgba(143,67,99,.18);
  transition:transform .28s cubic-bezier(.22,.7,.25,1),box-shadow .28s ease,filter .28s ease}
.dx-sp-go:hover{transform:translateY(-2px);box-shadow:0 12px 30px rgba(143,67,99,.32);filter:saturate(1.06)}
.dx-sp-go:active{transform:translateY(0)}
.dx-sp-go svg{width:16px;height:16px}
.dx-sp-next{padding:11px 20px;border:1px solid #ECD5E1;background:rgba(255,255,255,.72);cursor:pointer;
  border-radius:999px;font-size:13.5px;color:#8F4363;letter-spacing:.06em;font-family:inherit;
  transition:background .25s ease,border-color .25s ease,transform .25s ease}
.dx-sp-next:hover{background:#fff;border-color:#DFBCCE;transform:translateY(-1px)}
.dx-sp-foot{margin:18px 0 0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  justify-content:center;font-size:12px;color:#A99CB1}
.dx-sp-skip{border:0;background:none;cursor:pointer;font-family:inherit;font-size:12px;color:#A99CB1;
  padding:4px 2px;border-bottom:1px dashed #DCCFD9;letter-spacing:.04em}
.dx-sp-skip:hover{color:#8F4363;border-color:#DFBCCE}
.dx-sp-sep{color:#DCCFD9}

/* 入场：一层层浮上来，总时长约 1.7s */
.dx-splash.in .dx-sp-rose-wrap{animation:dxSpUp .8s cubic-bezier(.22,.7,.25,1) both}
.dx-splash.in .dx-sp-greet{animation:dxSpUp .7s cubic-bezier(.22,.7,.25,1) .30s both}
.dx-splash.in .dx-sp-rule{animation:dxSpUp .6s ease .42s both}
.dx-splash.in .dx-sp-quote{animation:dxSpUp .85s cubic-bezier(.22,.7,.25,1) .50s both}
.dx-splash.in .dx-sp-act{animation:dxSpUp .75s cubic-bezier(.22,.7,.25,1) .86s both}
.dx-splash.in .dx-sp-foot{animation:dxSpUp .6s ease 1.02s both}
@keyframes dxSpUp{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}

/* 侧栏入口：沿用 .dx-toggle 的外形，只换图标 */
.dx-splash-entry svg{width:12px;height:12px;flex:0 0 12px;color:var(--pri);transition:.18s}
.dx-splash-entry:hover svg{transform:rotate(-12deg)}

/* —— 降级：窄屏 / 矮屏 / 系统减弱动效 / 关闭玫瑰动效 —— */
@media (max-width:760px){
  .dx-splash{padding:22px 16px}
  .dx-sp-rose-wrap{width:216px}
  .dx-sp-greet{margin-top:18px;font-size:12.5px}
  .dx-sp-quote{padding:0 24px}
  .dx-sp-quote p{font-size:19.5px;line-height:1.8}
  .dx-sp-mark{font-size:52px}
  .dx-sp-mark-r{bottom:-26px}
  .dx-sp-act{margin-top:26px}
  .dx-sp-go{padding:12px 24px;font-size:14.5px}
}
@media (max-width:420px){
  .dx-sp-rose-wrap{width:168px}
  .dx-sp-quote p{font-size:17.5px}
  .dx-sp-act{gap:10px}
  .dx-sp-next{width:100%}
}
@media (max-height:680px){
  .dx-sp-rose-wrap{width:166px}
  .dx-sp-greet{margin-top:14px}
  .dx-sp-quote p{font-size:18px;line-height:1.72}
  .dx-sp-act{margin-top:20px}
  .dx-sp-foot{margin-top:12px}
}
@media (prefers-reduced-motion:reduce){
  .dx-splash{transition:opacity .12s linear}
  .dx-sp-petal{display:none}
}
@media (prefers-reduced-motion:reduce){
  .dx-splash.in .dx-sp-rose-wrap,.dx-splash.in .dx-sp-greet,.dx-splash.in .dx-sp-rule,
  .dx-splash.in .dx-sp-quote,.dx-splash.in .dx-sp-act,.dx-splash.in .dx-sp-foot,
  .dx-splash.in .dx-sp-rose path,.dx-sp-swap p{animation:none !important}
}
html[data-fx="off"] .dx-splash *{animation:none !important}
html[data-fx="off"] .dx-splash-petals{display:none}
/* ===== ROSE_SPLASH END ===== */
""".strip()


# ------------------------------------------------------------------ HTML
def build_html(rose_svg, bud, greet, date_txt, count):
    return (M + '\n'
            '<div class="dx-splash" id="dxSplash" role="dialog" aria-modal="true" '
            'aria-label="玫瑰开场" aria-hidden="true">\n'
            '  <div class="dx-splash-veil" aria-hidden="true"></div>\n'
            '  <div class="dx-splash-petals" id="dxSplashPetals" aria-hidden="true"></div>\n'
            '  <div class="dx-splash-inner">\n'
            '    <div class="dx-sp-rose-wrap" aria-hidden="true">' + rose_svg + '</div>\n'
            '    <p class="dx-sp-greet"><span id="dxSpGreet">' + greet + '</span>'
            '<span class="dx-sp-dot">·</span><span id="dxSpDate">' + date_txt + '</span></p>\n'
            '    <div class="dx-sp-rule" aria-hidden="true"><i></i>' + bud + '<i></i></div>\n'
            '    <blockquote class="dx-sp-quote" id="dxSpQuote">\n'
            '      <span class="dx-sp-mark dx-sp-mark-l" aria-hidden="true">\u201c</span>\n'
            '      <p id="dxSpText"></p>\n'
            '      <span class="dx-sp-mark dx-sp-mark-r" aria-hidden="true">\u201d</span>\n'
            '      <footer class="dx-sp-by"><cite id="dxSpBy"></cite>'
            '<span class="dx-sp-tag" id="dxSpTag"></span></footer>\n'
            '    </blockquote>\n'
            '    <div class="dx-sp-act">\n'
            '      <button class="dx-sp-go" id="dxSpGo" type="button"><span>进入工作台</span>'
            + arrow_svg() + '</button>\n'
            '      <button class="dx-sp-next" id="dxSpNext" type="button">再换一句</button>\n'
            '    </div>\n'
            '    <p class="dx-sp-foot">\n'
            '      <button class="dx-sp-skip" id="dxSpSkip" type="button">今日不再自动显示</button>\n'
            '      <span class="dx-sp-sep" aria-hidden="true">·</span>\n'
            '      <span>共 ' + str(count) + ' 句，每天一句</span>\n'
            '    </p>\n'
            '  </div>\n'
            '</div>\n' + ME + '\n')


def build_entry(rose_small):
    return ('      <button class="dx-toggle dx-splash-entry" id="dxSplashBtn" type="button">'
            + rose_small + '<span>玫瑰开场</span></button>\n')


# ------------------------------------------------------------------ JS
SPLASH_JS = r"""
/* ROSE_SPLASH_JS BEGIN */
/* 玫瑰开场层：每日一句 + 进入工作台。整段防御式，任何一步失败都不影响工作台。 */
(function(){
  var QUOTES = {{QUOTES}};
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
  var PETAL_D = '{{PETAL_D}}';
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
"""


def build_js(quotes, petal_d):
    packed = json.dumps([{'t': q['t'], 'a': q['a'], 'w': q['w'], 'k': q['k']} for q in quotes],
                        ensure_ascii=False, separators=(',', ':'))
    return (SPLASH_JS
            .replace('{{QUOTES}}', packed)
            .replace('{{PETAL_D}}', petal_d)
            ).strip()


# ------------------------------------------------------------------ 注入
def strip_old(s):
    s = re.sub(r'\n/\* ===== ROSE_SPLASH BEGIN ===== \*/.*?/\* ===== ROSE_SPLASH END ===== \*/\n',
               '\n', s, flags=re.S)
    s = re.sub(r'\n?<!-- ROSE_SPLASH BEGIN -->.*?<!-- ROSE_SPLASH END -->\n?', '', s, flags=re.S)
    s = re.sub(r'\n?/\* ROSE_SPLASH_JS BEGIN \*/.*?/\* ROSE_SPLASH_JS END \*/\n?', '', s, flags=re.S)
    s = re.sub(r'\n?[ \t]*<button class="dx-toggle dx-splash-entry".*?</button>\n?', '\n', s, flags=re.S)
    return s


def inject(s):
    quotes = load_quotes()
    rose_svg = splash_rose_svg()
    bud = bud_svg()
    small = small_rose_svg()
    petal_d = petal(10, 25, 0, 1.5, 24, 8, 12, 0.68)
    # 问候与日期在 HTML 里放静态兜底（JS 会覆盖），保证首屏不出现空行
    html = build_html(rose_svg, bud, '你好，茉莉', '今天', len(quotes))
    entry = build_entry(small)
    js = build_js(quotes, petal_d)

    s = strip_old(s)

    # 1) CSS：插在 </style> 前
    assert s.count('</style>') == 1, '期望 1 个 </style>'
    s = s.replace('</style>', build_css() + '\n</style>', 1)

    # 2) 开场层 HTML：紧跟装饰层之后（装饰层不在则紧跟 <body>）
    if DECO_HTML_END in s:
        s = s.replace(DECO_HTML_END, DECO_HTML_END + '\n' + html, 1)
    else:
        assert s.count('<body>') == 1
        s = s.replace('<body>', '<body>\n' + html, 1)

    # 3) 侧栏入口：跟在玫瑰动效开关之后
    m = re.search(r'[ \t]*<button class="dx-toggle" id="dxToggle".*?</button>\n', s, re.S)
    assert m, '侧栏动效开关锚点未命中（先跑 add_rose_deco.py）'
    s = s[:m.end()] + entry + s[m.end():]

    # 4) JS：插在 ROSE_DECO_JS 之前（deco 重跑时只会把自己挪到末尾，相对顺序稳定）
    if DECO_JS_BEGIN in s:
        s = s.replace(DECO_JS_BEGIN, js + '\n' + DECO_JS_BEGIN, 1)
    else:
        assert s.count('</script>') == 1, '期望 1 个 </script>'
        s = s.replace('</script>', js + '\n</script>', 1)
    return s


def check(s):
    ok = True
    tips = []

    def c(name, cond, extra=''):
        nonlocal ok
        tips.append(('PASS' if cond else 'FAIL') + '  ' + name + (('  ' + extra) if extra else ''))
        if not cond:
            ok = False

    c('样式块 = 1', s.count('<style>') == 1 and s.count('</style>') == 1)
    c('脚本块 = 1', s.count('<script>') == 1 and s.count('</script>') == 1)
    c('开场 CSS 已注入', CM in s and CME in s)
    c('开场 HTML 已注入', M in s and ME in s)
    c('开场 JS 已注入', JM in s and JME in s)
    c('无重复开场块', s.count(M) == 1 and s.count(CM) == 1 and s.count(JM) == 1)
    for i in ('dxSplash', 'dxSpGo', 'dxSpNext', 'dxSpSkip', 'dxSpText', 'dxSpBy',
              'dxSpTag', 'dxSpGreet', 'dxSpDate', 'dxSplashPetals', 'dxSplashBtn'):
        c('id=%s 唯一' % i, s.count('id="%s"' % i) == 1, str(s.count('id="%s"' % i)))
    c('JS 在装饰层之前（顺序稳定）',
      JM in s and DECO_JS_BEGIN in s and s.index(JM) < s.index(DECO_JS_BEGIN))
    c('开场层在 .app 之前', s.index(M) < s.index('<div class="app">'))
    c('开场层 z-index 高于脑区', int(re.search(r'\.dx-splash\{[^}]*z-index:(\d+)', s).group(1)) > 1000)
    c('默认 display:none（无白屏风险）', re.search(r'\.dx-splash\{[^}]*display:none', s) is not None)

    # 名言库
    m = re.search(r'var QUOTES = (\[.*?\]);\n  var N =', s, re.S)
    c('名言库已内嵌', m is not None)
    if m:
        try:
            qs = json.loads(m.group(1))
            c('名言条数 ≥ 30', len(qs) >= 30, '%d 条' % len(qs))
            c('名言字段完整', all(q.get('t') and q.get('a') and q.get('w') and q.get('k') for q in qs))
            c('正文无重复', len({q['t'] for q in qs}) == len(qs))
            c('含苏世民那条', any('锲而不舍' in q['t'] for q in qs))
        except Exception as e:
            c('名言库 JSON 可解析', False, str(e)[:80])

    # 括号平衡（CSS / JS 各自）
    css = re.search(r'<style>(.*?)</style>', s, re.S)
    if css:
        body = re.sub(r'/\*.*?\*/', '', css.group(1), flags=re.S)
        c('CSS 花括号平衡', body.count('{') == body.count('}'),
          'open=%d close=%d' % (body.count('{'), body.count('}')))
    print('\n'.join(tips))
    return ok


def dist(years=3):
    """检查每日选句分布：覆盖度 / 相邻重复 / 频次极差。"""
    quotes = load_quotes()
    n = len(quotes)

    def mul32(a, b):
        return (a * b) & 0xFFFFFFFF

    def hash32(x):
        x &= 0xFFFFFFFF
        x = mul32(x ^ (x >> 16), 0x7feb352d)
        x = mul32(x ^ (x >> 15), 0x846ca68b)
        return (x ^ (x >> 16)) & 0xFFFFFFFF

    def pick(d):
        k = (d - datetime.date(1970, 1, 1)).days
        i = hash32(k) % n
        if i == hash32(k - 1) % n:
            i = (i + 1) % n
        return i

    seq = []
    d = datetime.date(2026, 1, 1)
    for _ in range(int(years * 365)):
        seq.append(pick(d))
        d += datetime.timedelta(days=1)
    used = {}
    for v in seq:
        used[v] = used.get(v, 0) + 1
    adj = sum(1 for i in range(1, len(seq)) if seq[i] == seq[i - 1])
    ideal = len(seq) / n
    print('名言 %d 条 · 模拟 %d 天' % (n, len(seq)))
    print('  覆盖 = %d/%d' % (len(used), n))
    print('  频次 min/max = %d/%d（理想 %.1f）' % (min(used.values()), max(used.values()), ideal))
    print('  相邻两天重复 = %d 次' % adj)
    print('  2026-09-18 -> 第 %d 句：%s' % (pick(datetime.date(2026, 9, 18)) + 1,
                                      quotes[pick(datetime.date(2026, 9, 18))]['t'][:26]))
    assert len(used) == n, '有句子从未被选中'
    assert adj == 0, '存在相邻两天重复'
    return True


if __name__ == '__main__':
    if '--dist' in sys.argv:
        sys.exit(0 if dist() else 1)
    src = io.open(HOST, encoding='utf-8').read()
    if '--check' in sys.argv:
        sys.exit(0 if check(src) else 1)
    out = inject(src)
    assert check(out), '注入后自检未通过'
    io.open(HOST, 'w', encoding='utf-8').write(out)
    print('\nOK  ->  workbench_v3.html  (%d -> %d bytes)' % (len(src), len(out)))
