# -*- coding: utf-8 -*-
"""得到大脑 → 工作台：录音索引 + 待办提取同步脚本

数据流：
  Obsidian 得到大脑/*.md  ──扫描解析──▶  得到大脑·录音库（表2）
                          ──三级提取──▶  得到大脑·待办仓库（表3）

提取规则（四级，逐级兜底，全部可复核）：
  P1 原生待办段 : ### 📋 待办事项 下的 - 行（getnote 原生生成，置信度最高）
  P2 行动小标题 : 摘要内的 #### 小标题 / **加粗小标题** 命中行动词表，取其下 - 行
                  （P2 仅在无 P1 时启用，单篇上限 5 条）
  P3 行动句兜底 : 已停用 —— 实测噪音率 >90%，见 parse_note 内注释
  P4 AI 精读补录: 不在本脚本内。规则提不出来但确有待办的录音标记「待提取」，
                  由 backfill_review.py 读 manual_review.json 写入（逐篇读原文后人工抽取）

提取状态语义：
  已提取     规则命中，已入库
  待提取     9 月及以后 + 规则未命中 → 进入 AI 精读队列（非「没有待办」）
  无待办     转写为空，本来就无内容
  历史不抽取 9 月之前的原始通稿，判定无抽取价值（用户 2026-09-18 决策）

清洗规则：
  - 只从「摘要段」提取（<!-- getnote-audio 之前），原始转写段不参与
  - 剥离说话人前缀「XXX：」→ 存入「指派人」；「相关负责人 / 参会人员 / 对接人」
    这类泛称归空，不算指名（否则归属筛选会被 94 条伪责任人撑爆）
  - 相对时间词（明天 / 本周三 / 下周一 / 月底）按录音日期换算成 MM-DD。
    不换算的后果：82 条「明天交付…」在两个月后仍然是「待领取」，
    过期永远判不出来。换算不出来时保持原样，不猜日期。
  - 归一化（去空白/全角标点/尾部标点）后取 md5 → 内容指纹，同录音内去重
  - 跨录音不做文本级去重（不同会议的同名事项是不同的事）

幂等：
  - 录音库以「来源ID」(getnote_id) 为唯一键
  - 待办仓库以「内容指纹」为唯一键
  - 重复执行只补新增，不产生重复记录

用法：
  python3 sync_getnote.py --dry        # 只解析并打印统计，不写库
  python3 sync_getnote.py --push       # 增量写库
"""
import hashlib
import json
import os
import re
import sys
import time
import calendar
from datetime import datetime, timedelta

VAULT = r"E:\Obsidian\Molly的第二脑\得到大脑"
HERE = os.path.dirname(os.path.abspath(__file__))
DB_LIB = "g0T2Bz3L9LmINPC1YhLPg6"      # 得到大脑·录音库
DB_POOL = "fONLTaaLixhK3YpW5ExBJO"     # 得到大脑·待办仓库
DB_MAIN = "ggytTE4Cvh4Nyi3nBAcdxD"     # 个人工作台·事务与知识
REVIEW_CUT = "2026-09-01"              # 此日期起（含）的无提取录音进入 AI 精读队列；更早的判定无抽取价值

# 行动小标题词表（严格：只认明确的行动段）
ACTION_HEAD = ["后续安排", "后续跟进", "后续动作", "下一步", "行动项", "行动计划",
               "待办", "待办事项", "任务", "落实事项", "工作安排", "后续计划",
               "待落实", "责任分工", "分工安排", "跟进事项"]
# 强行动动词（P2/P3 必须命中其一，否则视为描述句而非待办）
STRONG_VERB = ["安排", "落实", "推进", "对接", "跟进", "提交", "出具", "整理", "同步",
               "完成", "联系", "核实", "拟定", "准备", "组织", "采购", "招聘", "审批",
               "签字", "盖章", "发出", "发送", "收集", "汇总", "更新", "上线", "培训",
               "排期", "复盘", "评估", "排查", "整改", "申报", "备案", "签订", "回收",
               "盘点", "确认", "布置", "拆解", "输出", "起草", "修改", "优化", "安排",
               "建立", "搭建", "梳理", "汇报", "报批", "申请", "打款", "付款", "催"]
# 描述句开头（命中即判为纪要描述而非待办）
DESC_OPEN = ["主动询问", "主动发起", "双方", "一致", "目前", "此前", "提到", "表示",
             "强调", "围绕", "建议", "认为", "指出", "属于", "明确标注", "同步了",
             "已", "将", "会", "希望", "相关", "后续将", "确认属于", "该", "对方"]
# 优先级判定关键词（顺序敏感：P0 先判）
P0_KW = ["紧急", "立刻", "马上", "即刻", "今天", "今日", "明天", "次日", "尽快",
         "务必", "必须", "一定要", "截止", "限期", "限时", "最晚", "当天"]
P1_KW = ["合同", "协议", "款项", "付款", "账目", "账", "公章", "资质", "合规", "法务",
         "律师", "审计", "商标", "股权", "仲裁", "诉讼", "备案", "申报",
         "招聘", "面试", "录用", "采购", "成本", "报价", "分润", "提成", "招商",
         "落地", "培训", "发布会", "上线", "课程", "客户", "签约", "整改", "风控"]

THEME_NAME = {
    "T01": "精武陈真退股纠纷", "T02": "美博会与展会作战", "T03": "三大商学院与课程发行",
    "T04": "新媒体矩阵与投流", "T05": "AI与数字化转型", "T06": "组织架构与人力管理",
    "T07": "财务体系与数据系统", "T08": "法务风控与合规", "T09": "会务统筹与商务接待",
    "T10": "产品供应链与工厂", "T11": "渠道运营与招商体系", "T12": "手机系统与客户管理",
}


def parse_fm(txt):
    """极简 YAML frontmatter 解析（仅支持本项目用到的标量 + 列表）。"""
    m = re.match(r"---\s*\n(.*?)\n---", txt, re.S)
    d = {}
    if not m:
        return d
    key = None
    for line in m.group(1).split("\n"):
        if re.match(r"^\s*-\s+", line) and key:
            val = line.strip()[2:].strip().strip('"')
            if not isinstance(d.get(key), list):
                d[key] = [] if not d.get(key) else [d[key]]
            d[key].append(val)
            continue
        if ":" in line and not line.startswith(" "):
            k, v = line.split(":", 1)
            key = k.strip()
            d[key] = v.strip().strip('"')
    return d


def normalize(s):
    """归一化用于指纹：去空白、统一全角标点、去尾部标点、小写化。"""
    s = re.sub(r"\s+", "", s)
    s = s.replace("：", ":").replace("，", ",").replace("。", ".").replace("；", ";")
    s = s.replace("（", "(").replace("）", ")").replace("、", ",").replace("！", "!")
    s = s.strip(".,;:。，；：、.!！?？-—～~")
    return s.lower()


def fingerprint(nid, text):
    return hashlib.md5((nid + "|" + normalize(text)).encode("utf-8")).hexdigest()[:16]


def clean_item(raw, base_date=None):
    """剥离 markdown 装饰与说话人前缀，返回 (指派人, 事项)。

    2026-11-04 两处改动（存量清理时发现的问题）：
    ① 泛称不算责任人。历史数据里「相关负责人 / 参会人员 / 对接人」这类占了 94 条，
       实质上等于没指名，留在「指派人」里只会让归属筛选失真 —— 一律归空。
    ② 相对时间词按录音日期换算成具体日期。历史上有 82 条「明天交付…」在一个月后
       仍然是「待领取」，因为入库时把「明天」原样存了下来，之后永远无法判断是否过期。
    """
    s = raw.strip()
    s = re.sub(r"^[-*+]\s+", "", s)
    s = re.sub(r"^\d+[.、)]\s*", "", s)
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)          # 去加粗
    s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s)   # 去链接只留文字
    s = re.sub(r"\[\[\s*|\s*\]\]", "", s)            # 去 wikilink 括号
    s = s.replace("`", "").strip()

    who = ""
    m = re.match(r"^([^：:]{2,14})[：:]\s*(.+)$", s)
    if m:
        who, s = m.group(1).strip(), m.group(2).strip()
    who = re.sub(r"^(主动发起交流的一方|说话人\s*\d*|我|我们)$", "", who).strip()
    if VAGUE_WHO.match(who):
        who = ""
    return who, resolve_relative(s.strip(" 　"), base_date)


# 泛称：指了等于没指，不进「指派人」，页面按「未指派」归类
VAGUE_WHO = re.compile(r"^(相关负责人|相关人员|参会人员|对接人|负责人|各部门|全员|大家|全体|团队|有关人员)$")

_CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7}
_REL_DAY = [(r"明天", 1), (r"后天", 2), (r"今天|今日|当天|当晚", 0), (r"次日", 1)]


def resolve_relative(text, base):
    """把「明天 / 本周三 / 下周一 / 月底」按录音日期换算成 MM-DD。

    换算不出来就原样保留 —— 宁可留一点歧义，也不能猜一个错日期：
    猜错了会让一条本来有效的待办被误判成过期而归档，代价比留歧义大得多。
    """
    if not base or not text:
        return text
    try:
        d0 = datetime.strptime(str(base)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return text
    out = text
    for pat, delta in _REL_DAY:
        if re.search(pat, out):
            out = re.sub(pat, (d0 + timedelta(days=delta)).strftime("%m-%d"), out, count=1)
    for prefix, woff in (("本周", 0), ("这周", 0), ("下周", 1)):
        # 「本周星期一」和「本周一」两种写法都要吃；漏了前者会留下无法判过期的时间词
        m = re.search(prefix + r"(?:周|星期)?([一二三四五六日天])", out)
        if m:
            monday = d0 - timedelta(days=d0.weekday())
            d = monday + timedelta(days=_CN_NUM[m.group(1)] - 1 + 7 * woff)
            out = out[:m.start()] + d.strftime("%m-%d") + out[m.end():]
    # 裸的「本周 / 下周」（不跟星期几，如「本周内完成」）→ 取该周周日，
    # 这是唯一能保留「期限内」语义又不丢过期判据的写法
    for prefix, woff in (("本周", 0), ("这周", 0), ("下周", 1)):
        if prefix in out:
            monday = d0 - timedelta(days=d0.weekday())
            d = monday + timedelta(days=6 + 7 * woff)
            out = out.replace(prefix, d.strftime("%m-%d"), 1)
    m = re.search(r"(\d{1,2})\s*月\s*月底", out)
    if m:
        y, mo = d0.year, int(m.group(1))
        if mo < d0.month:
            y += 1
        out = out[:m.start()] + "%02d-%02d" % (mo, calendar.monthrange(y, mo)[1]) + out[m.end():]
    elif "月底" in out:
        first_next = (d0.replace(day=28) + timedelta(days=4)).replace(day=1)
        out = out.replace("月底", (first_next - timedelta(days=1)).strftime("%m-%d"), 1)
    return out


def suggest_prio(text):
    for k in P0_KW:
        if k in text:
            return "P0 紧急", "紧急词:" + k
    for k in P1_KW:
        if k in text:
            return "P1 重要", "要务词:" + k
    return "P2 常规", "常规"


def is_valid_item(text, strict=False):
    if len(text) < 6 or len(text) > 120:
        return False
    if text.count("?") + text.count("？") > 0:      # 疑问句多半是讨论而非待办
        return False
    if re.match(r"^(综上|总之|因此|所以|谢谢|好的|嗯|对|是|没有|无)$", text):
        return False
    if text.count("：") + text.count(":") >= 2:      # 多个冒号 = 表格/多层描述
        return False
    if strict:
        # 必须命中强行动动词，否则判为纪要描述句
        if not any(v in text for v in STRONG_VERB):
            return False
        # 描述性开头一律否决
        for d in DESC_OPEN:
            if text.startswith(d):
                return False
    return True


def parse_note(path):
    """解析单篇录音文件 → (录音库记录 dict, 待办列表 list[dict])"""
    raw = open(path, encoding="utf-8", errors="ignore").read()
    return parse_text(raw, os.path.basename(path))


def parse_text(raw, fname):
    """解析录音正文 → (录音库记录 dict, 待办列表 list[dict])

    与 parse_note 完全等价，区别只在入参是「文本 + 文件名」而非文件路径，
    供直连通道（sync_direct.py，不落盘）复用同一套解析与指纹逻辑。
    """
    fm = parse_fm(raw)
    b = re.match(r"(\d{4}-\d{2}-\d{2})__(.+?)__(\d+)\.md$", fname)
    date = b.group(1) if b else (fm.get("created", "")[:10] or "")
    title = fm.get("title") or (b.group(2) if b else fname[:-3])
    nid = fm.get("getnote_id") or (b.group(3) if b else "")
    themes = fm.get("themes")
    if isinstance(themes, str):
        themes = [themes]
    theme = (themes or [""])[0]
    tcode = theme.split()[0] if theme else ""

    # 摘要段 = 转写标记之前
    cut = raw.find("<!-- getnote-audio")
    if cut == -1:
        cut = raw.find("<!-- getnote-transcript")
    summ = raw[cut:] if cut == -1 else raw[:cut]
    # 剥掉 YAML frontmatter 与 H1 标题行（否则摘要/摘录字段会带上 source_type 等元数据）
    summ = re.sub(r"^\s*---\s*\n.*?\n---\s*\n", "", summ, count=1, flags=re.S)
    summ = re.sub(r"^#\s+.*$", "", summ, count=1, flags=re.M).strip()

    todos = []
    seen = set()

    def add(text, rule, strict=False):
        who, item = clean_item(text, date)
        if not is_valid_item(item, strict):
            return False
        fp = fingerprint(nid, item)
        if fp in seen:
            return False
        seen.add(fp)
        prio, hit = suggest_prio(item)
        todos.append({
            "事项": item, "指派人": who, "命中规则": rule + "|" + hit,
            "优先级建议": prio, "原文摘录": text.strip()[:180],
            "内容指纹": fp,
        })
        return True

    # ---- P1：原生「📋 待办事项」段（getnote 原生生成，置信度最高）----
    p1 = 0
    m = re.search(r"^#{2,4}\s*📋?\s*待办事项\s*$(.*?)(?=^#{2,4}\s|\Z)", summ, re.M | re.S)
    if m:
        for line in m.group(1).split("\n"):
            if re.match(r"^\s*[-*+\d]", line.strip()):
                if add(line, "P1原生待办", False):
                    p1 += 1

    # ---- P2：行动小标题段（仅当本录音无 P1 段时启用，最多 5 条）----
    # 小标题三种真实形态：#### 标题 / **加粗** / 以「：」结尾的独立文本行
    p2 = 0
    if p1 == 0:
        cur_head = ""
        for ln in summ.split("\n"):
            ln = ln.strip()
            hm = (re.match(r"^#{2,4}\s*(.+)$", ln)
                  or re.match(r"^\*\*(.+?)\*\*$", ln)
                  or re.match(r"^([^\n]{2,24})[：:]\s*$", ln))
            if hm:
                cur_head = hm.group(1).strip()
                continue
            if p2 >= 5:
                continue
            if cur_head and any(k in cur_head for k in ACTION_HEAD) and re.match(r"^[-*+]\s+", ln):
                if add(ln, "P2行动小标题", True):
                    p2 += 1

    # ---- P3 已停用 ----
    # 实测：在「摘要段」上做行动句兜底，会捞入大量对话碎片与描述句（噪音率 >90%），
    # 严重损害待办仓库的可用性。故停用 P3，未命中 P1/P2 的录音标记为「无待办」，
    # 仍可在「录音流」中完整回看，需要时可人工补录。此决策可回溯于本次交付说明。
    p3 = 0

    head = re.sub(r"[*#>\s]+", "", summ)[:200]
    plain = len(re.sub(r"\s", "", summ))
    status = "无待办"
    if todos:
        status = "已提取"
    elif plain < 10:
        status = "无待办"          # 转写为空，本来就无内容可提
    elif date and date >= REVIEW_CUT:
        status = "待提取"          # 9 月及以后：规则提不出来 ≠ 没有待办，待 AI 逐篇精读
    else:
        status = "历史不抽取"       # 9 月之前的原始通稿，已判定无抽取价值

    lib_rec = {
        "_title": title, "录音日期": date, "来源ID": nid,
        "主题": theme, "摘要": (summ[:900].strip() or ""),
        "待办事项": "\n".join("• " + t["事项"] for t in todos),
        "待办数": len(todos), "关键摘录": head,
        "文件名": fname[:-3], "提取状态": status, "同步时间": int(time.time() * 1000),
    }
    pool_recs = []
    for t in todos:
        pool_recs.append({
            "事项": t["事项"], "状态": "待领取",
            "优先级建议": t["优先级建议"],
            "来源录音": (date + "｜" + title) if date else title,
            "录音日期": date, "来源ID": nid,
            "主题": (tcode + " " + THEME_NAME.get(tcode, "")) if tcode else "",
            "指派人": t["指派人"], "命中规则": t["命中规则"],
            "原文摘录": t["原文摘录"], "内容指纹": t["内容指纹"],
            "领取时间": None, "工作台记录ID": "",
            "创建时间": int(time.time() * 1000),
        })
    return lib_rec, pool_recs, {"p1": p1, "p2": p2, "p3": p3}


def scan():
    files = sorted(f for f in os.listdir(VAULT) if f.endswith(".md"))
    libs, pools, stat = [], [], {"p1": 0, "p2": 0, "p3": 0, "skip": 0, "none": 0}
    for f in files:
        lib, pool, s = parse_note(os.path.join(VAULT, f))
        if not s["p1"] and not s["p2"] and not s["p3"]:
            stat["none"] += 1
        for k in ("p1", "p2", "p3"):
            stat[k] += s[k]
        if not lib["来源ID"]:
            stat["skip"] += 1
            continue
        libs.append(lib)
        pools.extend(pool)
    return libs, pools, stat


def to_prop(rec):
    """把扁平 dict 转为 PropertyValue map；date/number/select 走对应 oneof。"""
    DATE_F = {"录音日期"}
    NUM_F = {"待办数", "同步时间", "领取时间", "创建时间"}
    props = {}
    for k, v in rec.items():
        if v is None or v == "":
            continue
        if k == "_title":
            props["标题"] = {"text": str(v)}
        elif k in DATE_F:
            props["录音日期"] = {"date": str(v)}
        elif k in NUM_F:
            props[k] = {"number": int(v)}
        else:
            props[k] = {"text": str(v)}
    return props


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--dry"
    libs, pools, stat = scan()
    print("=== 解析统计 ===")
    print("录音总数:", len(libs))
    print("P1 原生待办提取:", stat["p1"])
    print("P2 行动小标题提取:", stat["p2"])
    print("P3 行动句兜底提取:", stat["p3"])
    print("无待办的录音:", stat["none"])
    print("待办仓库候选合计:", len(pools))
    print("主题分布:", json.dumps(
        {k: sum(1 for p in pools if p["主题"].startswith(k)) for k in sorted(THEME_NAME)},
        ensure_ascii=False))
    print("优先级分布:", json.dumps(
        {k: sum(1 for p in pools if p["优先级建议"] == k)
         for k in ("P0 紧急", "P1 重要", "P2 常规")}, ensure_ascii=False))

    with open(os.path.join(HERE, "getnote-lib-parsed.json"), "w", encoding="utf-8") as f:
        json.dump(libs, f, ensure_ascii=False, indent=1)
    with open(os.path.join(HERE, "getnote-pool-parsed.json"), "w", encoding="utf-8") as f:
        json.dump(pools, f, ensure_ascii=False, indent=1)
    print("\n已写出 getnote-lib-parsed.json / getnote-pool-parsed.json")
    print("\n=== 样例（最近 5 条待办）===")
    for p in pools[-5:]:
        print(" ·", p["录音日期"], "|", p["优先级建议"], "|", p["事项"][:60],
              "| 指派人:", p["指派人"] or "-", "|", p["命中规则"])


if __name__ == "__main__":
    main()
