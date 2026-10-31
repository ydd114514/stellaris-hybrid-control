# 格式塔实施记录 · 2026-10-29

> 后续已补充主动宣战、登陆、议和、招募登舰及可执行首战流程，并重新打包。最新交付与验证以 `GESTALT_M2_DELIVERY.md` 为准；下文保留第一轮审计和当时的边界记录。

## 当前交付范围

项目书已从桌面完整读取并原样复制到工作区根目录 `STELLARIS_GESTALT_PLAN.md`。本次实现持久任务工具、共享承诺、动作发送前落盘、防重放及最小状态展示；加入首战目标记录、备战期限、三类策略卡、实际战争绑定和战后核验状态。**M2 完整首战没有完成**：现有桥缺少主动宣战、登陆占领和议和接口，不能把战争列表消失当作首战获胜。M1 也仍有下述范围限制，不标记计划所有验收项完成。

## M0 实际调用链及基线

- 已读取工作区 AGENTS、桌面项目 AGENTS、两个项目 README、package.json、原生主循环和订单/连续性代码。stellaris-player 没有自己的 AGENTS，也不是独立 Git 仓库。
- 桌面入口：`赛博肥鱼-全套-v0.3.7-95dfaa6/apps/desktop/electron/stellaris-controller.ts` 的 start → `stellaris-player/scripts/autoplay-native.mjs` → `scripts/play-native-dsh.mjs` → 官方已安装 DSH → `src/native-mcp.mjs`。
- 观察：`NativeGame.observe` → 原生管道 get_status/get_government/get_*fleets/get_wars 等；状态带 snapshotId、游戏日期、现实观测时点。inspect 提供合法候选和路线。不是存档实时读取；不能用旧文件证明当前版本或帝国。
- 调度：`SerialWork` 串行处理 MCP 工具与空闲监测；原生管道一次一个请求。watch 本地等待并提前响应中央事件/科研/舰队变化。现有等待本来就不需要新线程，但没有通用持久目标。
- 执行：apply 校验 snapshotId、候选、资源和容量 → presentOrder → 原生 rpc → verifyOrder → OrderTracker.register → observe/checkpoint。审计确认 register 原来位于 rpc 之后，崩溃窗口内没有持久动作记录。
- 确认：OrderTracker 分离排队、执行和完成。旧 ControllerContinuity 恢复订单和经营诊断，限定进程身份、日期、帝国；不授权重放。
- 停止：桌面 STOP 文件 → supervisor/guard/展示取消 → 清理暂停。语音由独立解说/桌面服务消费状态，不在本次引入额外模型、密钥存储或语音框架。
- 已记录桌面仓库存在大量用户修改；本次没有 reset、clean、checkout、远端操作或提交。仅对列出的文件做增量修改。native-game/native-mcp 修改前副本位于 `.local/gestalt-backup/`。
- 基线证据：原始代码的动作注册晚于 rpc；新增集成测试 `write-ahead intent is durable before the native mutation` 在原生 mutation stub 内读取已保存 issued 记录，验证修复。此次没有启动真实游戏记录建设/探索/军备运行，因此计划要求的真实运行基线仍未完成。

## 实际文件修改清单

| 文件 | 行为 |
|---|---|
| STELLARIS_GESTALT_PLAN.md | 复制用户原文件，保留计划原始状态 |
| stellaris-player/src/gestalt-tasks.mjs | 持久任务、依赖、日期/依赖唤醒、老化优先级、共享承诺、动作 outbox、未知防重、独立身份文件 |
| stellaris-player/src/gestalt-campaign.mjs | 三类策略卡、目标与收益、准备期限、真实战争持续跟踪、战后核验阻塞 |
| stellaris-player/src/native-game.mjs | 在原 observe/apply/stop 接入上述状态与写前日志；tasks/campaign 方法复用原执行和确认 |
| stellaris-player/src/native-mcp.mjs | 发布 tasks/campaign 两个工具，继续共用 SerialWork |
| stellaris-player/scripts/play-native-dsh.mjs | 原有模型任务追加持久目标使用规则，没有切换模型 |
| 赛博肥鱼-全套-v0.3.7-95dfaa6/apps/desktop/electron/stellaris-controller.ts | 原状态消息附加任务数量、等待/阻塞数量、战役阶段、待对账数 |
| stellaris-player/test/gestalt-tasks.test.mjs | 预算冲突、取消释放、等待、暂停、重启、防重与跨身份隔离 |
| stellaris-player/test/gestalt-campaign.test.mjs | 目标约束、准备超期、战争跟踪、不能虚构胜利 |
| stellaris-player/test/native-game.test.mjs | 在原 fixture 增加真实入口分派及发送前落盘验证 |

## 运行与验证

继续使用原桌面启动入口，或在 stellaris-player 运行 `node scripts/autoplay-native.mjs`。该入口会调用真实模型与游戏，**本次没有执行**。现有安装包未重新打包，旧安装包不会自动包含源码改动。

开发命令使用 `C:\Program Files\Git\bin\bash.exe`。无需新依赖。在 stellaris-player：

```bash
node --test test/gestalt-tasks.test.mjs test/gestalt-campaign.test.mjs test/native-game.test.mjs test/native-mcp-schema.test.mjs
npm test
```

在桌面项目：

```bash
node node_modules/vitest/vitest.mjs run tests/stellaris-controller.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.electron.json --noEmit
```

最终针对性回归：84/84 通过；桌面控制器 11/11 通过；Electron TypeScript 检查通过。全量测试第一次运行 456/457 通过，唯一失败为隔离账户 DPAPI round trip，未修改安全存储绕过该失败。日志在 `.local/gestalt-final-tests.txt`、`gestalt-desktop-tests.txt`、`gestalt-typecheck.txt`、`gestalt-all-tests.txt`。全程离线测试，未读取真实密钥或请求模型。

tasks add 示例参数：`{operation:"add",task:{goal:"探索通道",orders:[{command:"survey",arguments:{fleet_id:实际ID,system_id:实际ID}}],budget:{},dependencies:[],priority:10}}`。每项任务一个动作，多步用依赖连接；run 选择一个就绪任务，watch/observe 更新等待与订单完成；预算用最新库存与所有预留核对。已有预留时直接 apply 被阻止，避免绕开账本。动作日志限制2048项、任务128项，达到上限会停止新增，需停机归档。

## 已知边界与后续工程

- 不以当前 README 的 4.5.2 标注冒充当前运行版本。格式塔类型、DLC、模组尚未实机确认。策略卡不含未经验证的固定数值与视频结论。
- 首战尚未实现自动集结开战、登陆、议和和最终恢复完成。须补充匹配本机游戏构建的正常原生命令、合法候选及确认能力，再进入实机首战验收；不能用未经核实的内存地址或界面模拟填补。本次新增战役工具不会主动宣战。
- 当前战役记录提供阶段及缺口，但尚未自动从侦察结果比较敌国、生成全部备战任务、自动收缩或更换目标。普通模型返回不清空战役；终止必须给原因。
- 共享账本管理任务提交的预算，**尚未覆盖所有动作的引擎精确报价和新增维护费**。现有原生合法性、市场报价、舰容及军费校验继续有效。真实报价与预算一致性仍需补齐，不能宣称所有资源管理验收完成。
- 原进程身份不同或游戏日期回退时不会导入旧计划。哈希文件分别保存；同一进程内切到同帝国、同首府且日期更晚的另一存档，目前没有可靠存档 GUID，仍需补充存档身份信号。
- 发送前崩溃后，未知动作禁止重发。可恢复的订单通过原 OrderTracker 回读推进；若连 tracker 都未注册即崩溃，则保留未知并阻塞，尚无通用自动对账/人工证据消歧工具。宁可明确受阻，也不重复购买或建设。
- 任务调度由当前模型调用 tasks run，不是独立自动后台执行器；等待任务不占原生锁，其他就绪任务仍可执行。重试沿用原指令缓存/冷却；尚无通用任务级重试修复卡。
- 状态展示当前只有概要及模型快照中的完整任务/承诺/等待原因，尚未增加完整桌面任务详情面板。
- 真实游戏的长时间暂停、在途命令跨程序重启、路线中断、新参战者、占领、战果与战后经济均待服务接口实机验证。保持用户禁止桌面控制的要求，不自动开启窗口或抢占焦点。

剩余工作量主要取决于本机原生桥的战争命令与存档身份能力；在它们完成合法性和回执验证前，不给出完整首战交付日期，也不勾选 M2 完成。
