# 当前交接状态 · 2026-10-31

## 实际状态

整帝国经营＋战略接管交还核心**未完成**。P0开关、r2限定科研/建设、真实接管交还和失联收权已有实机证据；经济候选尚未加载。

- 默认桥：`cyberfish-0.6.16-country-ai-p1-r2`，本机固定DLL SHA256 `53356faf2a90c123b3ba39a03498518ebd231b6e093530d4cad8f6241cbb7368`。源码仓库不含DLL。
- 当前C++源码：`cyberfish-0.6.17-country-ai-economy-wip`，未进加载白名单，DSH默认仍r2。
- 固定Windows Stellaris4.5.2 EXE SHA256 `400df27c82ddc845aa9dce79bd468d81f18f060d299cd263e3afa93aef4f7a83`，原本机游戏 `D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe`，工作区 `E:/肥鱼直播`。迁移前核对硬编码本机路径，不能跨游戏版本盲用ABI。
- 历史最后独立状态：PID60288、2248.06.08暂停、country0、humanAI/forceHumanAI关闭。**这不是当前会话状态，接手后必须重新核对进程/世界/暂停。**

## 已有证据（evidence目录）

- `country-ai-p0-acceptance-1793443990878/report.json`：暂停开关、幂等、恢复。
- `country-ai-p1-acceptance-1793451582172/report.json`：r1失败，岗位旁路及Clone生命周期缺失，保留原状。
- `country-ai-p1-acceptance-1793453223229/report.json`：r2原生科研、脚本关键科研干预、交还、后续原生工作、17秒无心跳后暂停/关AI/排空。独立construction-readback-supplement匹配rare crystals建设；脚本干预不是模型干预。
- `country-ai-dsh-acceptance-1793456153567/`：真实DSH模型共10次上游请求，决定tech_shields_4并实际接管/回读/交还，原生随后新建district_city。独立scoped-chain-evidence与队列回读证明局部链路。**严格原report.passed=false、exitCode=1**，因原额度触顶退出异常。收尾修复已离线验证，不改原报告、不为小改再跑收费模型。

## 当前新增实现

1. 原生岗位劳动力上限、殖民地专精候选：完整引用/归属检查，Execute/Clone/释放跟踪，执行前后真实值回读。
2. 普通船/殖民船生产：原生AI自己选设计，工厂/serializer/GetToken交叉核实；限普通静态星基船坞、完整本国队列、owner-type-zero设计。未含联邦/共同体船及移动船坞。执行边界真实新增队列证据只证明排产，不是舰船已完工。
3. `protected_targets`：jobs保护单岗位上限；colonies保护岗位上限/专精；shipyards阻止新增生产。不是保护整个星球所有建设，也不取消既有队列。AddAI和已识别本国Post两处拦截，委派周期内不可变。
4. NativeCountryAI候选能力协商：完整版本/标记；prepare后先持久化取得的代次，再读回范围和保护，一致才enable；不一致收回已取得代次。
5. **最新一轮**接入NativeGame/MCP：显式构造选项 `nativeCountryAIEconomyCandidate`；MCP候选环境变量 `CYBERFISH_COUNTRY_AI_ECONOMY_CANDIDATE=1`。默认关闭，加载器未接纳WIP，DSH未推广；只设环境变量不等于可用交付。
6. `protect` 要求本轮真实收权、同世界、暂停、AI关闭及战略理由；持久化整份替换保护列表，显示pending_native_revalidation；resume重新原生核实后才生效。旧桥拒绝，不静默丢约束。
7. state读回代次/世界不一致保持派单封口，避免外部委派解除本轮约束。

关键代码：

- `stellaris-player/src/native-country-ai.mjs`、`native-country-ai-economic-policy.mjs`、`native-country-ai-tool.mjs`、`native-country-ai-economic-evidence.mjs`
- `stellaris-player/src/native-game.mjs`、`native-mcp.mjs`、`bridge-capabilities.mjs`
- `.local/research/stellaris-mcp-native/stellaris_bridge/src/country_ai_routine_gate.cpp`、`country_ai_observation.cpp`、`country_ai_lease.cpp`
- 原生include的country_ai_ship_layout.hpp和country_ai_routine_policy.hpp。

## 验证范围

- 前一批Release编译通过、原生3项、16项定向、147项现有控制器回归通过。
- 最新NativeGame/MCP/protect修改：18项控制/能力/工具测试、MCP5项、NativeGame关键2项通过。**147项完整回归属于此前批次**，不能称最新所有修改已全量重测。
- 最新JS修改还未重建桌面DSH；此前桌面r2相关构建已通过。
- MCP schema测试须cwd=stellaris-player；曾从父目录运行找不到src/native-mcp.mjs，正确cwd后5项通过，不是产品故障。
- evidence/research-20261031/economy-batch-progress.json是前批次历史清单，未涵盖最新NativeGame/MCP/protect；本页补充，不改写原证据。

## 下一步

1. 审查候选实际入口，继续集中补生产和必要内部计划维护，形成一个固定候选桥，再统一验收，不逐个小改要重启。
2. 内部维护：虚表slot8是IsValid、slot9才Execute。ai_remove_diplo_action经B7E9F0操作AI集合；ai_add_strategy经1AFF0B0操作计划容器；战况刷新仍有下游调用。目前均未因此放行。要放行须完整副作用边界、类型化Execute/Clone/析构与排空证据，不能制造未跟踪命令的假未释放。分段unwind可能只覆盖首片，不能误判全函数无副作用。
3. 星基建筑/模块/升级、扩张/舰队执行仍缺完整托管覆盖；普通造船不等于完整电脑玩家运营。
4. 检查AddAI/own-pending-Post之外的来源覆盖及真实预算约束；当前无原生花费硬预算，不把轮询告警称硬限制。
5. 验证真实战略干预后保护保留，准备一次短合并验收，由用户手动重启/读档。当前长期目标已暂停、转为交接，未经后续指令不恢复实机或付费模型测试。

## 快照边界

不带API/加密密钥、登录状态、配置、最新会话、模型原始流、游戏文件/存档、DLL/EXE、依赖、安装包、鲸鱼贴图和生成语音。选取报告含游戏测试数据，仅用于私有交接。新建干净仓库，不上传旧git历史；各来源许可证保留。
