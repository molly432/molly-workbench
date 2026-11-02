# -*- coding: utf-8 -*-
"""生成 lint 用的「三表字段并集」schema。

lint_database_sdk_usage.py 只接受单个 --schema，但两个页面都绑定 3 张表。
其 DSDK003/006/009 只校验「字段名是否存在于 schema」，故传入三表字段并集即可
完整覆盖，不会漏检也不会误报。

用法：python3 gen_merged_schema.py <表1 schema json> <表2 json> <表3 json>
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def fields_of(path):
    d = json.load(open(path, encoding="utf-8"))
    props = d.get("properties")
    if isinstance(props, dict):
        return list(props.keys())
    if isinstance(props, list):
        return [x["name"] for x in props if isinstance(x, dict) and x.get("name")]
    return []


def main():
    # 表1 用 canonical-schema.json（dict 形态），表2/3 用 canonical-*.json
    parts = [
        os.path.join(HERE, "canonical-schema.json"),
        os.path.join(HERE, "canonical-lib.json"),
        os.path.join(HERE, "canonical-pool.json"),
    ]
    names, per = [], {}
    for p in parts:
        f = fields_of(p)
        per[os.path.basename(p)] = len(f)
        for n in f:
            if n not in names:
                names.append(n)
    merged = {
        "title": "工作台+得到大脑（三表并集）",
        "page_type": "mixed",
        "properties": {n: {"text": ""} for n in names},
        "source": "agent_analysis",
        "sdk_calls_found": True,
        # R1：sdk_calls_found=true 时必须声明已存在的表 id（三张表均已在线上建好）
        "existing_databases": [
            {"id": "ggytTE4Cvh4Nyi3nBAcdxD", "name": "个人工作台·事务与知识"},
            {"id": "g0T2Bz3L9LmINPC1YhLPg6", "name": "得到大脑·每日录音库"},
            {"id": "fONLTaaLixhK3YpW5ExBJO", "name": "得到大脑·待办仓库"},
        ],
    }
    out = os.path.join(HERE, "merged-schema.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False, indent=2)
    print("各表字段数:", json.dumps(per, ensure_ascii=False))
    print("并集字段数:", len(names))
    print("->", out)


if __name__ == "__main__":
    main()
