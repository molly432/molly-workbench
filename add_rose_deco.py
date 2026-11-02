# -*- coding: utf-8 -*-
"""为工作台宿主页注入「玫瑰」装饰层：纹理（颗粒 + 小花格）+ 玫瑰纹样 + 动效。

设计约束（与合并页一致）
- 只改宿主页 workbench_v3.html；脑区页不动（脑区 DOM 在合并时被搬进宿主）。
- 必须保持「1 个 <style> + 1 个 <script>」，否则 verify_merged.py 的门会红。
- 幂等：重复执行会先移除旧装饰块再写回，不会叠加。
- 动效可关：默认开，写入 localStorage；同时尊重 prefers-reduced-motion。

用法
  python add_rose_deco.py          # 注入/更新
  python add_rose_deco.py --check  # 只体检，不写
"""
import io
import math
import os
import re
import sys
from urllib.parse import quote

BASE = os.path.dirname(os.path.abspath(__file__))
HOST = os.path.join(BASE, 'workbench_v3.html')

M = '<!-- ROSE_DECO BEGIN -->'
ME = '<!-- ROSE_DECO END -->'
CM = '/* ===== ROSE_DECO BEGIN ===== */'
CME = '/* ===== ROSE_DECO END ===== */'
JM = '/* ROSE_DECO_JS BEGIN */'
JME = '/* ROSE_DECO_JS END */'


# ------------------------------------------------------------------ 花瓣几何
def petal(cx, cy, ang_deg, r0, r1, hw, n=12, exp=0.70):
    """一片叶/花瓣：从 (r0, ang) 指向 (r1, ang) 的对称纺锤形（尖基、尖梢）。"""
    a = math.radians(ang_deg)
    dx, dy = math.sin(a), -math.cos(a)          # 径向（ang=0 指向正上）
    px, py = math.cos(a), math.sin(a)           # 切向
    left, right = [], []
    for k in range(n + 1):
        t = k / n
        rr = r0 + (r1 - r0) * t
        w = hw * math.pow(math.sin(math.pi * t), exp)
        bx, by = cx + dx * rr, cy + dy * rr
        left.append((bx - px * w, by - py * w))
        right.append((bx + px * w, by + py * w))
    pts = left + right[::-1]
    d = 'M%.1f %.1f' % pts[0] + ''.join('L%.1f %.1f' % p for p in pts[1:]) + 'Z'
    return d


def brand_rose_svg():
    """品牌标：5 外瓣 + 3 内瓣的玫瑰正面观，19px 下仍可辨。"""
    c = 12.0
    parts = []
    for i in range(5):
        parts.append(petal(c, c, i * 72, 5.4, 10.4, 3.2, 12, 0.72))
    for i in range(3):
        parts.append(petal(c, c, 36 + i * 120, 1.2, 4.8, 1.7, 12, 0.70))
    body = ''.join('<path d="%s"/>' % d for d in parts)
    return ('<svg class="ico lg" viewBox="0 0 24 24" fill="none" stroke="#fff" '
            'stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" '
            'data-dx="rose">' + body + '</svg>')


# ------------------------------------------------------------------ 纹理 data-URI
def _uri(svg):
    return 'data:image/svg+xml,' + quote(svg, safe="/:=(),*!'.-")


def floret_tile():
    """32×32 无缝小花格：4 瓣玫瑰花蕾节点，按 16px 网格铺开。"""
    R, S, step = 2.2, 5.4, 16.0
    pts = set()
    for gx in (0.0, step, 2 * step):
        for gy in (0.0, step, 2 * step):
            for ox, oy in ((0, 0), (S, 0), (-S, 0), (0, S), (0, -S)):
                x = round((gx + ox) % 32.0, 1)
                y = round((gy + oy) % 32.0, 1)
                if x > 32.0:
                    x -= 32.0
                if y > 32.0:
                    y -= 32.0
                pts.add((x, y))
    cir = ''.join("<circle cx='%s' cy='%s' r='%s'/>" % (x, y, R) for x, y in sorted(pts))
    return ("<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>"
            "<g fill='none' stroke='#B0577B' stroke-width='.5' stroke-opacity='.5'>"
            + cir + "</g></svg>")


def grain_tile():
    """纸感颗粒：分形噪声去彩后做极低透明度 multiply 叠底。"""
    return ("<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>"
            "<filter id='n'>"
            "<feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/>"
            "<feColorMatrix type='saturate' values='0'/>"
            "</filter>"
            "<rect width='200' height='200' filter='url(#n)'/></svg>")


# ------------------------------------------------------------------ CSS
def build_css():
    return """
/* ===== ROSE_DECO BEGIN ===== */
/* 玫瑰装饰层：纹理 / 纹样 / 动效。由 add_rose_deco.py 生成，勿手改。 */
:root{
  --dx-rose:#C9769A;          /* 装饰玫瑰（比主色浅一档，不抢正文） */
  --dx-rose-soft:#E9B9CE;
  --dx-floret:url("{{FLORET}}");
  --dx-grain:url("{{GRAIN}}");
}

/* —— 1. 氛围底：纸感颗粒 + 小花格 + 玫瑰雾光（固定层，永不吃点击） —— */
.dx-layer{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.dx-layer .dx-grain{position:absolute;inset:0;background-image:var(--dx-grain);
  background-size:200px 200px;opacity:.05;mix-blend-mode:multiply}
.dx-layer .dx-floret{position:absolute;inset:0;background-image:var(--dx-floret);background-size:34px 34px;opacity:.5;
  -webkit-mask-image:radial-gradient(880px 560px at 80% 0%,#000 0%,rgba(0,0,0,.22) 58%,transparent 82%),
                     linear-gradient(200deg,transparent 55%,rgba(0,0,0,.5) 100%);
          mask-image:radial-gradient(880px 560px at 80% 0%,#000 0%,rgba(0,0,0,.22) 58%,transparent 82%),
                     linear-gradient(200deg,transparent 55%,rgba(0,0,0,.5) 100%)}
.dx-layer .dx-glow{position:absolute;inset:0;
  background:radial-gradient(700px 360px at 92% 4%,rgba(216,154,186,.22),transparent 64%),
             radial-gradient(560px 320px at 4% 98%,rgba(186,166,222,.16),transparent 68%)}
.app{position:relative;z-index:1}

/* —— 2. 侧栏：玫瑰线描水印（13s 呼吸 + 微旋） —— */
.nav button{position:relative}
.side>.brand,.side>.nav,.side>.side-foot{position:relative;z-index:1}
.dx-side-rose-wrap{position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:0}
.dx-side-rose{position:absolute;left:-54px;bottom:-46px;width:240px;height:240px;
  color:var(--dx-rose);opacity:.12;animation:dxRose 13s ease-in-out infinite}
.dx-side-rose svg{display:block;width:100%;height:100%}
@keyframes dxRose{
  0%,100%{opacity:.09;transform:scale(1) rotate(-2deg)}
  50%{opacity:.17;transform:scale(1.045) rotate(3deg)}
}

/* —— 3. 卡面：顶部一抹极浅玫瑰雾（保持卡面干净，不铺网格） —— */
.card,.kpi{background-image:linear-gradient(180deg,rgba(233,185,206,.13),rgba(233,185,206,0) 88px)}
.card,.kpi{transition:box-shadow .22s ease,border-color .22s ease}
.card:hover{box-shadow:0 1px 2px rgba(92,42,68,.05),0 12px 30px rgba(92,42,68,.11);border-color:#F0D8E4}

/* —— 4. 飘落花瓣（z-index 6：卡片之上、弹窗 50/60/80 之下） —— */
.dx-petals{position:fixed;inset:0;z-index:6;pointer-events:none;overflow:hidden}
.dx-petal{position:absolute;top:0;display:block;opacity:0;will-change:transform,opacity;
  animation-name:dxFall;animation-timing-function:linear;animation-iteration-count:infinite}
.dx-petal svg{display:block;width:100%;height:auto;filter:drop-shadow(0 3px 6px rgba(176,87,123,.14))}
@keyframes dxFall{
  0%{transform:translate3d(0,-14vh,0) rotate(0deg) scale(.9);opacity:0}
  10%{opacity:var(--o,.4)}
  50%{transform:translate3d(var(--sw,20px),46vh,0) rotate(150deg) scale(1)}
  88%{opacity:var(--o,.4)}
  100%{transform:translate3d(calc(var(--sw,20px) * -1),112vh,0) rotate(300deg) scale(1.02);opacity:0}
}

/* —— 5. 微动效：页签入场 / 导航玫瑰指示条 / 呼吸光晕 / 同步点心跳 —— */
.pane:not(.hide){animation:dxPane .32s cubic-bezier(.22,.7,.28,1)}
@keyframes dxPane{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
.nav button::before{content:"";position:absolute;left:0;top:50%;width:3px;height:0;
  border-radius:0 3px 3px 0;background:linear-gradient(180deg,var(--dx-rose-soft),var(--pri));
  transform:translateY(-50%);transition:height .22s ease}
.nav button.on::before{height:19px}
.brand-mark{animation:dxBrand 6.5s ease-in-out infinite}
@keyframes dxBrand{
  0%,100%{box-shadow:0 4px 12px rgba(176,87,123,.24)}
  50%{box-shadow:0 6px 20px rgba(176,87,123,.42)}
}
.dot.ok,.dot.wait{animation:dxPulse 2.6s ease-out infinite}
@keyframes dxPulse{
  0%{box-shadow:0 0 0 0 rgba(176,87,123,.22)}
  70%,100%{box-shadow:0 0 0 6px rgba(176,87,123,0)}
}

/* —— 6. 动效开关 —— */
.dx-toggle{display:flex;align-items:center;gap:7px;width:100%;margin-top:10px;padding:6px 9px;
  border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink3);
  font-size:11px;text-align:left;transition:.18s}
.dx-toggle:hover{border-color:#EDD6E1;color:var(--ink2)}
.dx-toggle .dx-tg-dot{width:6px;height:6px;border-radius:50%;background:var(--pri);flex:0 0 6px;transition:.18s}
html[data-fx="off"] .dx-toggle .dx-tg-dot{background:var(--ink3);opacity:.6}
html[data-fx="off"] .dx-petal{display:none}
html[data-fx="off"] .dx-side-rose,html[data-fx="off"] .brand-mark{animation:none}

/* —— 7. 降级：窄屏减量 / 系统减弱动效 —— */
@media (max-width:700px){
  .dx-petal:nth-child(n+5){display:none}
  .dx-layer .dx-floret{background-size:28px 28px;opacity:.36}
  .dx-side-rose{display:none}
}
@media (prefers-reduced-motion:reduce){
  .dx-petal{display:none}
  .dx-side-rose,.brand-mark,.dot.ok,.dot.wait{animation:none}
  .pane:not(.hide){animation:none}
  .nav button::before{transition:none}
  .card,.kpi{transition:none}
}
/* ===== ROSE_DECO END ===== */
""".replace('{{FLORET}}', _uri(floret_tile())).replace('{{GRAIN}}', _uri(grain_tile()))


# ------------------------------------------------------------------ HTML
DECO_HTML = M + """
<div class="dx-layer" aria-hidden="true"><div class="dx-grain"></div><div class="dx-floret"></div><div class="dx-glow"></div></div>
<div class="dx-petals" id="dxPetals" aria-hidden="true"></div>
""" + ME

ROSE_HOST = ('      <div class="dx-side-rose-wrap" aria-hidden="true">'
             '<div class="dx-side-rose" id="dxSideRose"></div></div>\n')

TOGGLE = ('      <button class="dx-toggle" id="dxToggle" type="button" aria-pressed="true">'
          '<span class="dx-tg-dot"></span><span id="dxTgTxt">玫瑰动效 · 开</span></button>\n')


# ------------------------------------------------------------------ JS
DECO_JS = r"""
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
"""


# ------------------------------------------------------------------ 注入
def strip_old(s):
    s = re.sub(r'\n/\* ===== ROSE_DECO BEGIN ===== \*/.*?/\* ===== ROSE_DECO END ===== \*/\n', '\n', s, flags=re.S)
    s = re.sub(r'\n?<!-- ROSE_DECO BEGIN -->.*?<!-- ROSE_DECO END -->\n?', '', s, flags=re.S)
    s = re.sub(r'\n?/\* ROSE_DECO_JS BEGIN \*/.*?/\* ROSE_DECO_JS END \*/\n?', '', s, flags=re.S)
    s = s.replace(ROSE_HOST, '')
    s = s.replace(TOGGLE, '')
    return s


def inject(s):
    s = strip_old(s)

    # 1) CSS：插在 </style> 前
    assert s.count('</style>') == 1, '期望 1 个 </style>'
    s = s.replace('</style>', build_css().rstrip() + '\n</style>', 1)

    # 2) 品牌标换成玫瑰
    if 'data-dx="rose"' not in s:
        new_svg = brand_rose_svg()
        s2, k = re.subn(r'(<div class="brand-mark">\s*)<svg class="ico lg".*?</svg>',
                        lambda m: m.group(1) + new_svg, s, count=1, flags=re.S)
        assert k == 1, '品牌标锚点未命中'
        s = s2

    # 3) 装饰层：紧跟 <body>
    assert s.count('<body>') == 1
    s = s.replace('<body>', '<body>\n' + DECO_HTML, 1)

    # 4) 侧栏玫瑰水印：插在 </aside> 前
    assert s.count('</aside>') == 1
    s = s.replace('  </aside>', ROSE_HOST + '  </aside>', 1)

    # 5) 动效开关：插在侧栏页脚说明之后
    foot_anchor = '<div class="brandnote" style="margin-top:8px">设计蓝本 · Logseq（日记流／块级任务／双向链接）</div>\n'
    assert foot_anchor in s, '侧栏页脚锚点未命中'
    s = s.replace(foot_anchor, foot_anchor + TOGGLE, 1)

    # 6) JS：追加到唯一 script 块末尾
    assert s.count('</script>') == 1, '期望 1 个 </script>'
    s = s.replace('</script>', DECO_JS.strip() + '\n</script>', 1)
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
    c('玫瑰 CSS 已注入', CM in s and CME in s)
    c('装饰层已注入', M in s and ME in s)
    c('玫瑰 JS 已注入', JM in s and JME in s)
    c('品牌标为玫瑰', s.count('data-dx="rose"') == 1)
    for i in ('dxPetals', 'dxSideRose', 'dxToggle', 'dxTgTxt'):
        c('id=%s 唯一' % i, s.count('id="%s"' % i) == 1, str(s.count('id="%s"' % i)))
    c('无重复装饰块', s.count(M) == 1 and s.count(CM) == 1 and s.count(JM) == 1)
    # 括号平衡
    body = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
    c('CSS 花括号平衡', body.count('{') == body.count('}'),
      'open=%d close=%d' % (body.count('{'), body.count('}')))
    print('\n'.join(tips))
    return ok


if __name__ == '__main__':
    src = io.open(HOST, encoding='utf-8').read()
    if '--check' in sys.argv:
        sys.exit(0 if check(src) else 1)
    out = inject(src)
    assert check(out), '注入后自检未通过'
    io.open(HOST, 'w', encoding='utf-8').write(out)
    print('\nOK  ->  workbench_v3.html  (%d -> %d bytes)' % (len(src), len(out)))
