# 大肥鱼 · 原生 AI 意图执行闭环审阅快照

2026-11-02 更新，供 Claude 独立审阅。**这是源码与方案快照，尚未实机验收，不是完成品。**

**从这里开始：[给 Claude 的审阅交接](stellaris-player/docs/CLAUDE_NATIVE_INTENT_REVIEW_2026-11-02.md)。**

用户当前重点：把本人要求、已采纳的观众建议和大肥鱼的判断，转换为原生国家 AI 真正会执行的目标，并根据实际结果持续纠偏。本人要求优先；“设置已应用”不能等同于“目标已落实”。凝聚力是当前最高经营优先，但不硬编码 +600/月、年份或帝国规模上限。

## 此次快照

- 统一意图编译、本人/参谋/模型优先级、原生方针和生产约束的回读。
- 实际净产/传统的基线、推进/停滞/受阻状态，以及现有受限纠偏路径。
- DSH 意图状态卡，不再用参谋的完成措辞覆盖实际经营状态。
- 最新控制器、相关离线测试、DSH 源码、0.6.25-owner-intent 原生桥源码。

仍有关键缺口：当前有限方针不能表达任意自然语言目标；生产约束不等于军舰持续探索；探索选择器尚未接自动写入；节点完工、填岗和持续净产改善尚未取得本次修复后的实机结论。审阅稿明确列出这些限制及希望 Claude 优先查的问题。

## 源码入口

| 路径 | 内容 |
| --- | --- |
| `stellaris-player/src/native-intent.mjs` | 目标编译与实际效果计量 |
| `stellaris-player/src/native-game.mjs` | 意图同步、实际原生控制与纠偏挂点 |
| `stellaris-player/src/native-country-ai.mjs` | 国家 AI 委派、回读、生产约束和停止 |
| `stellaris-player/src/advice-execution.mjs` | 已采纳建议的执行与结果账本 |
| `stellaris-player/src/owner-economic-policy.mjs` | 真实资源缺口与普通法令复查 |
| `.local/research/stellaris-mcp-native/stellaris_bridge/` | C++ 原生桥；保留原相对目录布局 |
| `赛博肥鱼-全套-v0.3.7-95dfaa6/` | Electron/Vue/TypeScript DSH |

再读 [v1.5 计划第〇节](STELLARIS_HYBRID_CONTROL_PLAN.md)、[当前交接状态](HANDOFF.md)。历史 `evidence/`、`snapshot-tests.txt` 与旧报告保留原记录，不能当成本次新实现已实机通过。

## 审阅边界

用户当前要求停止测试、集中修复。此次上传只供代码审阅：不要连接游戏或 native pipe，不启动付费模型，不重新 arm、不清 STOP、不自动重启/读档、不操作桌面。默认先静态审阅，不增加长测或新一轮实机验收。

相关定向离线检查及本机构建此前已通过；这里只记录其范围，不重跑游戏，也不把离线通过当经营效果。若审阅确需离线回归，可从 `stellaris-player/test/native-intent.test.mjs`、`strategy-direction.test.mjs`、`strategy-domestic-actions.test.mjs`、`native-monitor-strategy.test.mjs` 及 DSH `tests/operator-standing-sync.test.ts` 定位用例。

## 排除内容与许可

不包含密钥、个人配置、登录状态、数据库、运行会话/原始模型流、依赖、DLL/EXE、构建产物、游戏/存档、鲸鱼贴图、生成语音或 Workshop Mod 文件。`HANDOFF_INVENTORY.json` 用于核对快照文件，不是功能验收证据。

各子项目保留原许可：控制器 MIT、桌面 AGPL-3.0-or-later、原生桥 MIT、部分研究/加载工具 GPL-3.0-only。见对应 LICENSE、SPDX 与 THIRD_PARTY_NOTICES；不对全仓库重新统一授权。
