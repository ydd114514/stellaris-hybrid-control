# 大肥鱼战略质量 S1–S5 · Claude 审阅入口

2026-11-03。本分支供独立代码审阅。主线保留 v1.5 分工，原生国家 AI 负责日常经营，大肥鱼负责方针和少数保留决定。

- [任务书与验收定义](https://github.com/ydd114514/stellaris-hybrid-control/blob/92ccc64/CODEX_TASK_STRATEGY_QUALITY.md)
- [主线五个提交的完整差异](https://github.com/ydd114514/stellaris-hybrid-control/compare/92ccc64...7454fa3)
- [主线下次正常开局观察项](https://github.com/ydd114514/stellaris-hybrid-control/blob/7454fa3/HANDOFF.md)
- [本机接线差异](https://github.com/ydd114514/stellaris-hybrid-control/compare/04f7217...review/strategy-quality-20261103)

审阅以主线 `7454fa3` 为完整基线。这里在上次公开的原生意图快照 `04f7217` 上补入本机这次涉及的源码和定向测试。部分文件带有早于 S1 的本机接线上下文，本分支用于对照这些实现。

## 优先检查

1. **S1 模型与费用**。检查 `dsh-mcp-environment.mjs` 和 `play-native-dsh.mjs` 的模型选择、Cordis 整段覆盖、回退提示与请求预算。对照 180 游戏日复查和 watch 的实际调用链，区分战略复查次数与模型请求次数。
2. **S2 简报与情报边界**。检查 `strategy-brief.mjs` 与 `native-game.mjs` 的读接口、快照新鲜度、未知值与真零的区分、已知邻国可见范围、读取期间的租约心跳。当前桥无法提供已知帝国的相对实力与态度，简报显示「未知」。
3. **S3 目标与停滞**。检查 `strategy-contract.mjs`、`native-strategy-review.mjs` 和 `native-game.mjs` 的期限、80% 阈值、连续两次复查、重复 observe/watch、continue 与请求防重。重点对照目标到期后才达到、同日连续事件、有效方针与本机本人优先级冲突这几种情况。面板与解说的进度应来自已观察值。
4. **S4 引导 Mod**。检查 `cfsteer_budget.txt` 的殖民、前哨类别和归一化占比，及 `mod-install.mjs` 的旧文件迁移。本机另有 `stellar-steering-compat.mjs`，重点核对旧固定人格退出、和平凝聚力规则保留及备份范围。

请按严重度列出问题，附路径、触发条件、对实际运营的影响和最小修法。定向离线测试与本机 DSH 构建已通过。游戏内的实际战略表现留到下次正常开局观察，本轮付费模型请求 0 次。
