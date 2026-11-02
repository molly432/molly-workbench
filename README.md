# Molly 工作台

个人工作台：把「录音 → 待办 → 项目 → 沉淀 → 复盘」串成一条线。单文件 HTML 应用，数据存放在 WorkBuddy 资料库的三张表里，靠页面 SDK 直连，无自建后端。

- 线上版本：https://www.workbuddy.cn/space/d/II2IiPAcAYwDZ6sr36hzFU
- 当前版本：v23
- 产物：`workbench.html`（约 440KB，可直接托管）

> 接手改造请先读 **[HANDOVER.md](HANDOVER.md)** —— 里面有架构、数据模型、已知问题和「动了会出事」的清单。

## 结构：两个源页合并成一个产物

`workbench.html` **不是手写的**，由 `merge_workbench.py` 从两个源页生成：

| 源页 | 内容 |
|---|---|
| `workbench_v3.html` | 宿主：外壳、导航、今日推进、任务清单、项目推进、知识沉淀、复盘 |
| `workbench_brain.html` | 脑区：待办仓库、录音库、领取与蒸馏入口 |

**改逻辑改源页，再重跑合并，不要手改 `workbench.html`。**

## 构建顺序（固定，不可调换）

```bash
python add_rose_deco.py     # 装饰层：玫瑰纹样，注入宿主源页
python add_splash.py        # 启动页：每日一句，注入宿主源页
python _run_merge.py        # 合并两个源页 → workbench.html
```

前两个脚本带幂等保护（检测到注入标记就跳过），重复跑不会叠加。`_run_merge.py` 是 `merge_workbench.py` 的包装，把异常写进 `merge_log.txt` 而不是直接抛出。

## 校验链

```bash
python verify_merged.py      # 结构完整性、JS 语法、关键锚点
node smoke_merged.js         # 无浏览器 DOM 桩，跑主流程
node smoke_review.js         # 复盘模块
```

再加两条 lint（脚本在 WorkBuddy library 技能目录下）：

```bash
python lint_database_sdk_usage.py --html workbench.html --schema-file merged-schema.json
python lint_schema.py --html workbench.html --schema "$(cat merged-schema.json)"
```

冒烟脚本自带夹具，不依赖线上数据；`_chk_time.js` 是时间逻辑回归工具，从两个源页原样提取函数再跑。

## 数据表

| 用途 | 表 ID |
|---|---|
| 主台账（待办 / 项目 / 沉淀） | `ggytTE4Cvh4Nyi3nBAcdxD` |
| 得到大脑 · 每日录音库 | `g0T2Bz3L9LmINPC1YhLPg6` |
| 得到大脑 · 待办仓库 | `fONLTaaLixhK3YpW5ExBJO` |

主台账的「计划日期」是排期唯一权威：月历、当日清单、任务清单三处都从它推导，不存在第二份日历数据。

## 几个必须遵守的约束

这些都是踩过的坑，改动前先看：

- **`#brainZone` 是脑区作用域根**。脑区 CSS 一律加 `#brainZone` 前缀，变量定义在 `#brainZone{}` 里。漏了前缀会污染宿主同名类（`.card` `.kpi` `.dlg` `.btn` `.pill` `.filters`）。
- **`databaseId` 必须写字面量**。用常量会触发 lint `DSDK002`。
- **同一 IIFE 内禁止函数重名**。`overdueDays` 曾被复盘模块占用，新写的同名函数静默覆盖它，页面算出 `NaN`，控制台干净、静态检查全绿。泛名（`label` `format` `key` `idx`）都要警惕。
- **整页只注册一个 `db.onUpdated`**，统一在宿主的 `bindDbUpdates` 里（lint `DSDK013`）。
- **改「选中日」只有一个入口 `setSelDate(k)`**，它同时写 `S.selDate` 与月历的 `S.calY/calM` 再 `refreshAll()`。
- **不用原生 `<input type="date">`**。弹层会被 iframe 边界和 `.dlg{overflow:auto}` 裁掉，统一 `type="text" + inputmode="numeric" + data-cal="1"` 配自研 `CalPop`。
- **全页禁用 `window.confirm`**。页面在 iframe 里，原生模态可能被 sandbox 静默拦掉 —— 不显示、直接返回 false，删除和顺延会永远失效。统一用自研 `#cfMask` + `askConfirm(o, cb)`。
- **装饰层的跨区样式只能写进 `MERGED_EXTRA`**（排在合并 CSS 最末），否则盖不过 `#brainZone .card`。
- **空态与故障必须分开**。`S.empty`（真没数据）和 `S.loadFailed`（加载失败）不能混用 —— catch 分支里 `rows=[]` 恰好也满足 `length===0`，最容易把故障误报成空态。
- **交付物里不放演示数据**。

## 时间口径

输入框只有两种形态：`YYYY-MM-DD`（全天）和 `YYYY-MM-DD HH:mm`（精确到点）。落库走 date 列。**`00:00` 一律当「没设时间」** —— 存量值全是 `T00:00:00Z`，当成真时间会让整页历史记录冒出满屏 00:00。

转换只发生在 `toApiDate()` 一处；`dayKey()` 是前缀截取，所以按天分组的老逻辑不用改。

## 仓库里没有什么

本仓库只放页面源码、构建链和校验脚本。线上数据快照、诊断输出、含访问令牌的临时脚本都不在这里（`.gitignore` 是白名单式，新增文件需显式放行）。
