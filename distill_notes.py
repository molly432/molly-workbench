# -*- coding: utf-8 -*-
"""从「已完成」记录与录音摘要自动蒸馏沉淀草稿（AI 只提议，人来确认）。

设计闸门（对齐 cacaprog/second-brain-mvp 的 human-gate 思想）：
  生成的沉淀只带「蒸馏草稿」标签写入主台账，页面沉淀页有「待确认」专区，
  必须人工点「确认转正」摘掉标签后才进入正式知识库。

幂等双保险：
  指纹 fp = 'distill:v1:' + sha1(sorted(来源record_id)).hexdigest()[:16]
  ① 写入前查线上主台账「来源ID」字段是否已含该指纹（跨机/丢本地 state 也不重复）
  ② 本地 distill_state.json 记录 {fp: {ts, ids}} 供审计

用法：
  python distill_notes.py                # 等价 --dry：只打印将生成的草稿，零写库
  python distill_notes.py --days 7       # 取近 7 天已完成（默认 7）
  python distill_notes.py --apply        # 真的写库
凭证：WB_TOKEN 环境变量（或 argv[1]）。
LLM ：优先读 ../skills/gpt-image-2/.env 的 APIYI_API_KEY（与出图技能同一份 key），
      或环境变量 APIYI_API_KEY；模型可用 --model 覆盖（默认 gpt-4o-mini）。
失败即上报：任何一步异常打印明细并非零退出，绝不静默、绝不造假数据。
"""
import hashlib
import json
import os
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from push_getnote import query_all, batch_add, rec_id  # noqa: E402

MAIN = 'ggytTE4Cvh4Nyi3nBAcdxD'
LIB = 'g0T2Bz3L9LmINPC1YhLPg6'
DRAFT_TAG = '蒸馏草稿'
STATE_FILE = os.path.join(HERE, 'distill_state.json')
APIYI_ENV = r'C:\Users\Administrator\.workbuddy\skills\gpt-image-2\.env'
API_BASE = 'https://api.apiyi.com/v1'


def log(msg):
    print(msg, flush=True)


def die(msg):
    log('!! ' + msg)
    sys.exit(1)


def token_from(argv):
    t = os.environ.get('WB_TOKEN', '').strip()
    if not t and len(argv) > 1 and not argv[1].startswith('--'):
        t = argv[1].strip()
    if not t:
        die('缺少 WB_TOKEN：export WB_TOKEN=op_xxx 或 python distill_notes.py <token>')
    return t


def api_key_from():
    k = os.environ.get('APIYI_API_KEY', '').strip()
    if k:
        return k
    try:
        with open(APIYI_ENV, encoding='utf-8') as f:
            for line in f:
                if line.startswith('APIYI_API_KEY') and '=' in line:
                    return line.split('=', 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ''


def sval(v):
    """select/text 字段读值双兼容：query 返回可能是纯文本或 {text:...} 对象。"""
    if isinstance(v, dict):
        return str(v.get('text') or v.get('name') or '')
    return str(v or '')


def load_state():
    try:
        with open(STATE_FILE, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(st):
    try:
        with open(STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(st, f, ensure_ascii=False, indent=1)
    except OSError as e:
        log('! 无法写 state 文件（不影响本次写入，只影响审计）：' + str(e))


def llm_chat(api_key, model, messages, timeout=90):
    body = json.dumps({'model': model, 'messages': messages, 'temperature': 0.3},
                      ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        API_BASE + '/chat/completions', data=body, method='POST',
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api_key})
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode('utf-8'))
            return data['choices'][0]['message']['content']
        except Exception as e:  # 429/5xx/网络抖动：指数退避重试
            last = e
            wait = 3 * (attempt + 1)
            log('  ! LLM 第 %d 次调用失败（%s），%ds 后重试' % (attempt + 1, str(e)[:120], wait))
            time.sleep(wait)
    die('LLM 调用三次均失败：' + str(last)[:200])


def parse_json_loose(text):
    """从模型输出里抠出第一个 {...} JSON 块并解析；失败返回 None。"""
    t = (text or '').strip()
    if t.startswith('```'):
        t = t.strip('`')
        if t.startswith('json'):
            t = t[4:]
    try:
        return json.loads(t)
    except Exception:
        pass
    a, b = t.find('{'), t.rfind('}')
    if a != -1 and b > a:
        try:
            return json.loads(t[a:b + 1])
        except Exception:
            return None
    return None


PROMPT = """你是个人工作台的沉淀助手。下面是茉莉近 {days} 天「已完成」的工作记录（标题/完成结果/内容/主题/关联项目）和得到大脑录音摘要。

任务：按主题把值得沉淀的内容蒸馏成知识条目。只蒸馏输入里真实存在的结论、口径、话术、数据，禁止编造输入里没有的事实；输入太薄的（一句话日常杂事）不要硬蒸馏。

每条沉淀输出：
- 主题：从输入记录的「主题」里选（原样带 T 码，如「T08 法务风控与合规」）
- 标题：≤30 字，沉淀的是可复用的结论/口径/话术，不是事项复述
- 内容：3-8 行，先给结论，再给依据/背景；可写 [[项目名]] / [[人名]] 形成双链
- 关联项目：取来源记录的项目名（可留空）

严格只输出 JSON（不要任何其他文字）：
{{"drafts":[{{"主题":"T08 法务风控与合规","标题":"...","内容":"...","关联项目":"..."}}]}}

【已完成记录】
{done_text}

【录音摘要】
{lib_text}"""


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    apply = '--apply' in sys.argv
    days = 7
    for i, a in enumerate(sys.argv):
        if a == '--days' and i + 1 < len(sys.argv):
            days = int(sys.argv[i + 1])
    model = os.environ.get('DISTILL_MODEL', 'gpt-4o-mini')
    for i, a in enumerate(sys.argv):
        if a == '--model' and i + 1 < len(sys.argv):
            model = sys.argv[i + 1]

    token = token_from(sys.argv)
    api_key = api_key_from()
    if not api_key:
        die('缺少 APIYI_API_KEY：检查 %s 或 export APIYI_API_KEY=sk-xxx' % APIYI_ENV)

    log('== 拉取主台账近 %d 天已完成记录…' % days)
    rows = query_all(token, MAIN, ['标题', '类型', '状态', '完成结果', '内容', '主题', '关联项目', '完成时间', '来源ID'])
    if not isinstance(rows, list):
        die('主台账 query 失败（返回非列表）：%s' % str(rows)[:200])
    cutoff = int(time.time() * 1000) - days * 86400000
    done = [r for r in rows
            if sval(r.get('状态')) == '已完成'
            and (r.get('完成时间') or 0) >= cutoff
            and (sval(r.get('完成结果')) or sval(r.get('内容')))]
    log('   已完成且有实质内容：%d 条' % len(done))
    if not done:
        log('== 没有可蒸馏的素材，收工。')
        return

    log('== 拉取录音库摘要…')
    lib_rows = query_all(token, LIB, ['标题', '摘要', '主题', '录音日期', '来源ID'])
    lib_rows = lib_rows if isinstance(lib_rows, list) else []

    src_ids = sorted(str(rec_id(r)) for r in done)
    fp = 'distill:v1:' + hashlib.sha1('|'.join(src_ids).encode('utf-8')).hexdigest()[:16]
    log('== 本批指纹 %s（来源 %d 条）' % (fp, len(src_ids)))

    state = load_state()
    if fp in state:
        log('== 本地 state 已有该指纹，跳过（上次 %s）。如需重跑请删 distill_state.json 里对应行。'
            % state[fp].get('ts', ''))
        return
    if any(sval(r.get('来源ID')) == fp for r in rows):
        log('== 线上已存在该指纹的草稿，跳过。')
        state[fp] = {'ts': time.strftime('%Y-%m-%d %H:%M:%S'), 'ids': src_ids, 'where': 'online'}
        save_state(state)
        return

    done_text = '\n'.join(
        '- [主题:%s][项目:%s] %s｜完成结果:%s｜内容:%s' % (
            sval(r.get('主题')) or '未分类', sval(r.get('关联项目')),
            sval(r.get('标题')), sval(r.get('完成结果')), sval(r.get('内容'))[:300])
        for r in done)
    lib_text = '\n'.join(
        '- [%s] %s：%s' % (sval(r.get('录音日期')), sval(r.get('标题')), sval(r.get('摘要'))[:200])
        for r in lib_rows if sval(r.get('摘要'))) or '（无）'

    log('== 调用 LLM（%s）蒸馏…' % model)
    prompt = PROMPT.format(days=days, done_text=done_text[:12000], lib_text=lib_text[:6000])
    content = llm_chat(api_key, model, [
        {'role': 'system', 'content': '你是严谨的个人知识沉淀助手，只基于给定输入蒸馏，绝不编造。'},
        {'role': 'user', 'content': prompt}])
    data = parse_json_loose(content)
    if not data or not isinstance(data.get('drafts'), list):
        log('  ! 首次输出非合法 JSON，重试一次…')
        content = llm_chat(api_key, model, [
            {'role': 'system', 'content': '你是严谨的个人知识沉淀助手。'},
            {'role': 'user', 'content': prompt},
            {'role': 'assistant', 'content': content[:2000]},
            {'role': 'user', 'content': '你的输出不是合法 JSON。请重新输出，只输出 JSON 本体，不要任何其他文字。'}])
        data = parse_json_loose(content)
    if not data or not isinstance(data.get('drafts'), list):
        die('LLM 两次输出均无法解析为合法 JSON，中止（不写库）。')

    drafts = [d for d in data['drafts']
              if isinstance(d, dict) and sval(d.get('标题')).strip() and sval(d.get('内容')).strip()]
    log('== 蒸馏出草稿 %d 条' % len(drafts))
    for i, d in enumerate(drafts, 1):
        log('--- 草稿 %d ---' % i)
        log('主题: %s' % sval(d.get('主题')))
        log('标题: %s' % sval(d.get('标题')))
        log('内容:\n%s' % sval(d.get('内容')))
        log('项目: %s' % sval(d.get('关联项目')))

    if not apply:
        log('\n== DRY-RUN：以上草稿未写入。确认质量后加 --apply 写入。')
        return

    now_ms = int(time.time() * 1000)
    footer = '\n\n---\n来源记录：' + ','.join(src_ids) + '\n批次指纹：' + fp
    props_list = []
    for d in drafts:
        p = {
            '标题': {'text': sval(d.get('标题')).strip()[:120]},
            '类型': {'select': '沉淀'},
            '状态': {'select': '已完成'},
            '标签': {'text': DRAFT_TAG},
            '内容': {'text': sval(d.get('内容')).strip() + footer},
            '来源ID': {'text': fp},
            '创建时间': {'number': now_ms},
            '更新时间': {'number': now_ms},
        }
        if sval(d.get('主题')).strip():
            p['主题'] = {'text': sval(d.get('主题')).strip()[:60]}
        if sval(d.get('关联项目')).strip():
            p['关联项目'] = {'text': sval(d.get('关联项目')).strip()[:120]}
        props_list.append(p)

    ok, fail = batch_add(token, MAIN, props_list)
    log('== 写入完成：成功 %d，失败 %d' % (ok, fail))
    if fail:
        die('有 %d 条写入失败，请检查上方错误。' % fail)
    state[fp] = {'ts': time.strftime('%Y-%m-%d %H:%M:%S'), 'ids': src_ids, 'drafts': len(drafts)}
    save_state(state)
    log('== 完成。到工作台「沉淀」页待确认区人工转正。')


if __name__ == '__main__':
    main()
