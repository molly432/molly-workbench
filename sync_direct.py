# -*- coding: utf-8 -*-
"""得到大脑 → 工作台：直连云端 API 的提取通道（不经 Obsidian）

与 sync_getnote.py 的分工
  sync_getnote.py   读 Obsidian 里的 .md 文件 → 解析
  本脚本            直接调得到开放 API 取「智能总结正文 + 官方全文转写 + 音频直链」，
                    在内存里拼出与 Obsidian .md 同构的文本，复用同一套解析器与指纹，
                    产出格式完全相同的 getnote-lib-parsed.json / getnote-pool-parsed.json，
                    之后同样交给 push_getnote.py 入库。

为什么需要这条通道
  - 不依赖 Obsidian 是否开着、上游 Codex 同步任务是否成功
  - 转写一旦在云端就绪即可入库，不必等落盘
  - 与 Obsidian 通道共用幂等键（来源ID / 内容指纹），双轨并行不会写重

主题码说明
  themes（T01–T12）属知识库侧标注，API 不提供，故仍从 Obsidian 同 getnote_id 的
  frontmatter 读取；读不到就留空，不影响其余字段。

落盘产物（--fetch）
  getnote-lib-parsed.json    录音库候选（交给 push_getnote.py 入库）
  getnote-pool-parsed.json   待办候选
  direct_text.json           {来源ID: {元数据 + 智能总结 + 官方全文}}
      ↑ 这是「本地全文留档」的直连版本。AI 精读直接读它的「官方全文」，
        backfill_review.py 也从它取标题/日期/主题 —— 因此整条下游链路
        不再依赖 Obsidian 目录是否存在。

用法
  python3 sync_direct.py --dry                # 只统计，不写文件
  python3 sync_direct.py --fetch              # 拉全量并生成 parsed json + direct_text.json
  python3 sync_direct.py --fetch --limit 5    # 只拉最近 5 条（联调用）
  python3 sync_direct.py --fetch --audio-dir <dir>   # 顺带下载音频
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from sync_getnote import parse_text, parse_fm  # noqa: E402

CREDS = r"C:\Users\Administrator\Documents\Codex\2026-09-15\realtime-voice-chat\work\getnote-private\config.json"
BASE = "https://openapi.biji.com/open/api/v1/resource"
VAULT = r"E:\Obsidian\Molly的第二脑\得到大脑"
AUDIO_EXT = (".mp3", ".m4a", ".wav", ".aac", ".ogg", ".opus", ".mp4", ".flac")


def creds():
    if not os.path.isfile(CREDS):
        raise SystemExit("凭证文件缺失：%s" % CREDS)
    c = json.load(open(CREDS, encoding="utf-8-sig"))
    if not c.get("api_key") or not c.get("client_id"):
        raise SystemExit("凭证文件字段不全（需 api_key / client_id）")
    return c["api_key"], c["client_id"]


def api(path):
    """带退避重试的 GET；返回 data 段。不打印任何凭据。"""
    key, cid = creds()
    for attempt in range(5):
        try:
            req = urllib.request.Request(BASE + path, headers={
                "Authorization": "Bearer " + key, "X-Client-Id": cid})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.load(r)
            if data.get("success") is not True:
                raise RuntimeError("API 返回 success!=true")
            time.sleep(0.3)
            return data["data"]
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == 4:
                raise RuntimeError("API HTTP %d" % e.code) from None
            time.sleep(min(60, 2 ** attempt * 3))
        except urllib.error.URLError as e:
            if attempt == 4:
                raise RuntimeError("网络不可达：%s" % e.reason) from None
            time.sleep(min(30, 2 ** attempt * 2))
    raise RuntimeError("API 重试耗尽")


def all_notes():
    """游标翻页拉全量会话；返回 {note_id: note}"""
    out, cursor, seen = {}, None, set()
    while True:
        q = "/note/list" + (("?cursor=" + urllib.parse.quote(str(cursor)))
                            if cursor is not None else "")
        d = api(q)
        for n in d.get("notes", []):
            out[str(n.get("note_id") or n.get("id"))] = n
        if not d.get("has_more"):
            break
        cursor = d.get("next_cursor")
        if cursor is None or str(cursor) in seen:
            raise RuntimeError("分页游标异常")
        seen.add(str(cursor))
    return out


def theme_index():
    """{getnote_id: [themes]} —— 从 Obsidian frontmatter 读，补 API 缺失的主题码。"""
    idx = {}
    if not os.path.isdir(VAULT):
        return idx
    for f in os.listdir(VAULT):
        if not f.endswith(".md"):
            continue
        try:
            head = open(os.path.join(VAULT, f), encoding="utf-8", errors="ignore").read(2000)
        except OSError:
            continue
        fm = parse_fm(head)
        nid = fm.get("getnote_id")
        if not nid:
            continue
        th = fm.get("themes")
        if isinstance(th, str):
            th = [th]
        idx[str(nid)] = th or []
    return idx


def build_md(nid, title, created, content, original, themes):
    """拼出与上游落盘的 .md 同构的文本（仅供内存解析，不落盘）。

    关键：必须保留 <!-- getnote-transcript:ID --> 标记 —— parse_text 以它为
    「摘要段 / 转写段」的分界。
    """
    L = ["---", 'source_type: "getnote"', "getnote_id: " + json.dumps(str(nid)),
         "title: " + json.dumps(title or "", ensure_ascii=False),
         "created: " + json.dumps(created or "")]
    if themes:
        L.append("themes:")
        L += ["  - " + t for t in themes]
    L += ["---", "", "# " + (title or "未命名录音"), "", content or ""]
    if (original or "").strip():
        L += ["", "<!-- getnote-transcript:" + str(nid) + " -->",
              "## 官方录音原文", "", original.strip()]
    return "\n".join(L) + "\n"


def download(url, dest):
    """下载音频直链（签名 URL，不带 API 凭据）。返回是否新下载。"""
    if os.path.isfile(dest) and os.path.getsize(dest) > 0:
        return False
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise RuntimeError("非 HTTPS 音频直链")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    try:
        with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
            expect = r.headers.get("Content-Length")
            size = 0
            while True:
                buf = r.read(1024 * 1024)
                if not buf:
                    break
                f.write(buf)
                size += len(buf)
        if size == 0 or (expect and size != int(expect)):
            raise RuntimeError("音频下载不完整")
        os.replace(tmp, dest)
        return True
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="只处理最近 N 条（0=全量）")
    ap.add_argument("--audio-dir", dest="audio_dir", default="",
                    help="指定则把音频下载到该目录（文件名 getnote_id_1.ext）")
    a = ap.parse_args()
    if not a.fetch:
        a.dry = True

    notes = all_notes()
    cands = [n for n in notes.values()
             if n.get("note_type") in ("audio", "meeting", "recorder_audio")]
    cands.sort(key=lambda n: (n.get("created_at") or ""))
    total_cands = len(cands)
    if a.limit:
        cands = cands[-a.limit:]

    tidx = theme_index()
    print("=== 直连取数 ===")
    print("会话总数:", len(notes), "｜录音/会议:", total_cands,
          "｜本次处理:", len(cands), "｜Obsidian 主题索引命中:", len(tidx))

    libs, pools = [], []
    texts = {}      # 来源ID -> 元数据 + 原文（落盘为 direct_text.json）
    st = {"ok": 0, "no_transcript": 0, "audio_new": 0, "err": 0}
    for n in cands:
        nid = str(n.get("note_id") or n.get("id"))
        try:
            d = (api("/note/detail?id=" + urllib.parse.quote(nid)) or {}).get("note") or {}
            content = d.get("content") or ""
            audio = d.get("audio") or {}
            original = audio.get("original") or ""
            if not isinstance(original, str):
                original = ""
            title = d.get("title") or ""
            created = d.get("created_at") or ""
            themes = tidx.get(nid, [])

            if a.audio_dir:
                atts = [x for x in (d.get("attachments") or [])
                        if x.get("type") == "audio" and x.get("url")]
                for i, att in enumerate(atts):
                    ext = os.path.splitext(urllib.parse.urlparse(att["url"]).path)[1].lower()
                    if ext not in AUDIO_EXT:
                        ext = ".mp3"
                    dest = os.path.join(a.audio_dir, "%s_%d%s" % (nid, i + 1, ext))
                    if download(att["url"], dest):
                        st["audio_new"] += 1

            raw = build_md(nid, title, created, content, original, themes)
            fname = "%s__%s__%s.md" % ((created or "")[:10], title or "未命名", nid)
            lib, pool, _ = parse_text(raw, fname)
            if not lib.get("来源ID"):
                st["err"] += 1
                continue
            libs.append(lib)
            pools.extend(pool)
            texts[nid] = {
                "来源ID": nid,
                "录音日期": (created or "")[:10],
                "标题": title or "",
                "创建时间": created or "",
                "themes": themes or [],
                "智能总结": content or "",
                "官方全文": original or "",
                "转写就绪": bool((original or "").strip()),
                "提取状态": lib.get("提取状态") or "",
                "待办数": int(lib.get("待办数") or 0),
            }
            st["ok"] += 1
            if not original.strip():
                st["no_transcript"] += 1
        except Exception as e:
            st["err"] += 1
            print("  ! 失败", nid, type(e).__name__, str(e)[:80])

    print("成功解析:", st["ok"], "｜转写未就绪:", st["no_transcript"],
          "｜失败:", st["err"], "｜本次新下载音频:", st["audio_new"])
    print("待办候选合计:", len(pools))
    print("主题分布:", json.dumps(
        {k: sum(1 for p in pools if str(p.get("主题", "")).startswith(k))
         for k in ["T%02d" % i for i in range(1, 13)]}, ensure_ascii=False))
    print("优先级分布:", json.dumps(
        {k: sum(1 for p in pools if p.get("优先级建议") == k)
         for k in ("P0 紧急", "P1 重要", "P2 常规")}, ensure_ascii=False))

    # 待精读清单：规则未命中但有转写内容的录音，必须逐篇 AI 精读后进待办仓库
    pending = [x for x in libs if x.get("提取状态") == "待提取"]
    print("待精读（规则未命中，需 AI 逐篇精读）:", len(pending), "篇")
    for x in pending:
        print("   ·", x.get("录音日期"), "|", "待提取", "|",
              str(x.get("_title") or "")[:38], "|", x.get("来源ID"))
    no_tr = [x for x in libs if x.get("提取状态") == "无待办"]
    if no_tr:
        print("转写未就绪（本次标「无待办」，下次跑会自动补更新）:", len(no_tr), "篇")
        for x in no_tr:
            print("   ·", x.get("录音日期"), "|", str(x.get("_title") or "")[:38], "|",
                  x.get("来源ID"))

    if a.dry:
        print("\n[dry] 未写文件。加 --fetch 才产出 parsed json。")
        print("=== 样例（最近 3 条）===")
        for p in pools[-3:]:
            print(" ·", p["录音日期"], "|", p["优先级建议"], "|",
                  p["事项"][:56], "|", p["主题"] or "-")
        return

    with open(os.path.join(HERE, "getnote-lib-parsed.json"), "w", encoding="utf-8") as f:
        json.dump(libs, f, ensure_ascii=False, indent=1)
    with open(os.path.join(HERE, "getnote-pool-parsed.json"), "w", encoding="utf-8") as f:
        json.dump(pools, f, ensure_ascii=False, indent=1)
    # 原文留档（AI 精读 + 补录元数据都靠它，不再依赖 Obsidian）
    tp = os.path.join(HERE, "direct_text.json")
    with open(tp, "w", encoding="utf-8") as f:
        json.dump(texts, f, ensure_ascii=False)
    print("\n已写出 getnote-lib-parsed.json / getnote-pool-parsed.json"
          "（可直接跑 push_getnote.py 入库）")
    print("已写出 direct_text.json：%d 篇 | %.1f MB（含智能总结 + 官方全文）"
          % (len(texts), os.path.getsize(tp) / 1048576.0))


if __name__ == "__main__":
    main()
