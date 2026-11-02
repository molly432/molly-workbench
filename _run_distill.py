# -*- coding: utf-8 -*-
"""stdin 读 WB_TOKEN → 跑 distill_notes.py（参数透传）。避免 token 出现在命令行。"""
import os
import sys

t = sys.stdin.read().strip()
if not t:
    sys.exit("缺少 token（stdin）")
os.environ["WB_TOKEN"] = t
sys.argv = ["distill_notes.py"] + [a for a in sys.argv[1:]]
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import runpy
runpy.run_path(os.path.join(HERE, "distill_notes.py"), run_name="__main__")
