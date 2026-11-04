# -*- coding: utf-8 -*-
"""把 sync_getnote.py 解析出的结果增量推送进资料库数据表（幂等）。

幂等键：
  录音库   -> 来源ID (getnote_id)
  待办仓库 -> 内容指纹

用法：
  python3 push_getnote.py <token>
"""
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = r"D:\Program Files\wb\WorkBuddy\resources\app.asar.unpacked\resources\plugins\workbuddy-builtin\skills\library"
PY = sys.executable or "python3"
DB_LIB = "g0T2Bz3L9LmINPC1YhLPg6"
DB_POOL = "fONLTaaLixhK3YpW5ExBJO"
CHUNK = 20
CHUNK_BYTES = 11000   # Windows 命令行上限约 32KB，留足余量按字节自适应分批


def run(script, token, extra):
    """script 传相对 library 的路径，如 database/query_database_record.py"""
    cmd = [PY, os.path.join(LIB, script), "--token-stdin"] + extra
    p = subprocess.run(cmd, input=token.encode("utf-8"),
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out = p.stdout.decode("utf-8", "ignore").strip()
    try:
        return json.loads(out)
    except Exception:
        err = p.stderr.decode("utf-8", "ignore").strip()
        return {"error": "NON_JSON", "raw": (out[:200] + " || " + err[:300])}


def query_all(token, db_id, fields):
    """分页拉全量，返回扁平记录列表。"""
    out, cursor, guard = [], None, 0
    while guard < 60:
        guard += 1
        extra = ["--database-id", db_id, "--fields", json.dumps(fields, ensure_ascii=False),
                 "--page-size", "200"]
        if cursor:
            extra += ["--start-cursor", cursor]
        r = run("database/query_database_record.py", token, extra)
        if isinstance(r, dict) and r.get("error"):
            print("  ! query 失败:", r.get("error"))
            break
        res = r.get("results") or r.get("data", {}).get("results") or []
        out.extend(res)
        nxt = r.get("next_cursor") or r.get("data", {}).get("next_cursor")
        more = r.get("has_more") or r.get("data", {}).get("has_more")
        if more and nxt and nxt != cursor and res:
            cursor = nxt
        else:
            break
    return out


def batch_add(token, db_id, props_list):
    """按「条数 + 累计字节」双阈值分批，避免 Windows 命令行超长。

    注意：服务端返回 {"results": [{"index":N, "success":bool, "error":...}]}
    顶层没有 error 不代表成功 —— v20 踩过：非法字段时逐条 success=false，
    旧判定只看顶层 error，把 5 条全失败的批次报成「成功 5」。必须逐条查。"""
    ok, fail = 0, 0
    batch, size = [], 0

    def flush():
        nonlocal ok, fail, batch, size
        if not batch:
            return
        r = run("database/batch_add_database_records.py", token,
                ["--database-id", db_id, "--records", json.dumps(batch, ensure_ascii=False)])
        results = r.get("results") if isinstance(r, dict) else None
        if isinstance(results, list):
            for item in results:
                if item.get("success"):
                    ok += 1
                else:
                    fail += 1
                    print("  ! 单条写入失败:", str(item.get("error"))[:160])
        elif isinstance(r, dict) and r.get("error"):
            fail += len(batch)
            print("  ! batch_add 失败:", str(r.get("error"))[:160])
        else:
            # 返回结构不认识时保守计失败，绝不谎报成功
            fail += len(batch)
            print("  ! batch_add 返回结构异常:", str(r)[:160])
        batch, size = [], 0

    for p in props_list:
        b = len(json.dumps(p, ensure_ascii=False).encode("utf-8"))
        if batch and (len(batch) >= CHUNK or size + b > CHUNK_BYTES):
            flush()
        batch.append(p)
        size += b
    flush()
    return ok, fail


def rec_id(r):
    """query_database_record.py 返回的记录主键键名是 record_id（不是 _id/id）。"""
    return r.get("record_id") or r.get("_id") or r.get("id")


def batch_update(token, db_id, items):
    """items: [{"record_id": rid, "properties": {...}}]，同样按字节自适应分批。"""
    ok, fail = 0, 0
    batch, size = [], 0

    def flush():
        nonlocal ok, fail, batch, size
        if not batch:
            return
        r = run("database/batch_update_database_records.py", token,
                ["--database-id", db_id, "--records", json.dumps(batch, ensure_ascii=False)])
        results = r.get("results") if isinstance(r, dict) else None
        if isinstance(results, list):
            for item in results:
                if item.get("success"):
                    ok += 1
                else:
                    fail += 1
                    print("  ! 单条更新失败:", str(item.get("error"))[:180])
        elif isinstance(r, dict) and r.get("error"):
            fail += len(batch)
            print("  ! batch_update 失败:", str(r.get("error"))[:180])
        else:
            fail += len(batch)
            print("  ! batch_update 返回结构异常:", str(r)[:180])
        batch, size = [], 0

    for it in items:
        b = len(json.dumps(it, ensure_ascii=False).encode("utf-8"))
        if batch and (len(batch) >= CHUNK or size + b > CHUNK_BYTES):
            flush()
        batch.append(it)
        size += b
    flush()
    return ok, fail


def lib_props(x):
    p = {"标题": {"text": x["_title"]}, "来源ID": {"text": str(x["来源ID"])},
         "提取状态": {"select": x["提取状态"]}, "待办数": {"number": int(x["待办数"])},
         "同步时间": {"number": int(x["同步时间"])}}
    if x["录音日期"]:
        p["录音日期"] = {"date": x["录音日期"]}
    for k in ("主题", "摘要", "待办事项", "关键摘录", "文件名"):
        if x.get(k):
            p[k] = {"text": x[k]}
    return p


def pool_props(x):
    p = {"事项": {"text": x["事项"]}, "状态": {"select": x["状态"]},
         "优先级建议": {"select": x["优先级建议"]},
         "内容指纹": {"text": str(x["内容指纹"])},
         "创建时间": {"number": int(x["创建时间"])}}
    if x["录音日期"]:
        p["录音日期"] = {"date": x["录音日期"]}
    for k in ("来源录音", "来源ID", "主题", "指派人", "命中规则", "原文摘录"):
        if x.get(k):
            p[k] = {"text": x[k]}
    return p


def compute_repairs(libs, state):
    """算出需要「补更新」的记录（转写迟到场景）。

    state: {来源ID: {"id": 记录id, "st": 线上提取状态}}

    规则（只有第 2 条会写库）：
      1) 线上是「无待办」且本地仍是「无待办」→ 转写仍未就绪，保持原样；
      2) 线上是「无待办」但本地已有实质内容 → 补更新（这正是要救的场景）；
      3) 线上是其它状态（已提取 / 待提取 / 已精读 / 历史不抽取）→ 一律不碰，
         避免冲掉人工领取结果或 AI 精读成果。
    """
    fixes = []
    for x in libs:
        c = state.get(str(x.get("来源ID")))
        if not c or c.get("st") != "无待办":
            continue
        if x.get("提取状态") == "无待办":
            continue
        fixes.append({"record_id": c["id"], "properties": lib_props(x)})
    return fixes


def main():
    token = sys.argv[1] if len(sys.argv) > 1 else ""
    if not token:
        print("缺 token"); return

    libs = json.load(open(os.path.join(HERE, "getnote-lib-parsed.json"), encoding="utf-8"))
    pools = json.load(open(os.path.join(HERE, "getnote-pool-parsed.json"), encoding="utf-8"))

    print("=== 1/2 同步录音库 (%d 条候选) ===" % len(libs))
    have_ids = set()
    for r in query_all(token, DB_LIB, ["来源ID"]):
        v = r.get("来源ID")
        if v:
            have_ids.add(str(v))
    print("  已存在:", len(have_ids), "条")
    new_libs = [x for x in libs if str(x["来源ID"]) not in have_ids]
    print("  待新增:", len(new_libs), "条")

    if new_libs:
        ok, fail = batch_add(token, DB_LIB, [lib_props(x) for x in new_libs])
        print("  写入成功:", ok, "失败:", fail)

    # ---- 1.5 补更新「转写迟到」记录 ----
    # 背景：一天跑多次时，前一次拉取时官方转写可能尚未就绪，该录音会以
    #       「无待办」入库；后一次转写就绪，却因来源ID 已存在而被跳过 ——
    #       待办就永远进不了仓库。故对这类空壳记录做字段级补更新。
    # 判定规则见 compute_repairs（只碰线上「无待办」的记录）。
    state = {}
    for r in query_all(token, DB_LIB, ["来源ID", "提取状态"]):
        v = r.get("来源ID")
        if v:
            state[str(v)] = {"id": rec_id(r), "st": r.get("提取状态")}
    fixes = compute_repairs(libs, state)
    print("  转写迟到需补更新:", len(fixes), "条")
    if fixes:
        ok, fail = batch_update(token, DB_LIB, fixes)
        print("  补更新成功:", ok, "失败:", fail)

    print("=== 2/2 同步待办仓库 (%d 条候选) ===" % len(pools))
    have_fp = set()
    for r in query_all(token, DB_POOL, ["内容指纹"]):
        v = r.get("内容指纹")
        if v:
            have_fp.add(str(v))
    print("  已存在:", len(have_fp), "条")
    new_pools = [x for x in pools if str(x["内容指纹"]) not in have_fp]
    print("  待新增:", len(new_pools), "条")

    if new_pools:
        ok, fail = batch_add(token, DB_POOL, [pool_props(x) for x in new_pools])
        print("  写入成功:", ok, "失败:", fail)

    # 复核
    print("=== 复核 ===")
    n_lib = len(query_all(token, DB_LIB, ["来源ID"]))
    n_pool = len(query_all(token, DB_POOL, ["内容指纹"]))
    print("  录音库现有:", n_lib, "条")
    print("  待办仓库现有:", n_pool, "条")


if __name__ == "__main__":
    main()
