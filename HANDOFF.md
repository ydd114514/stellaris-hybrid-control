## 最新：科研引导真实排产通过（2026-11-01）
用户新载入2216.04.19，PID31608；仅两项短复测至2216.11.29。科研方针下原生AI自行在温州排入cfsteer_zone_research，实际施工74.4%、剩93天，未由脚本派建设订单；证明科研建设选择受引导，尚未完工。议会命令未触发，仍待验；最终确认暂停、AI关闭、人类持权，无付费模型/桌面操作，不再追加整轮。

## 最新两项短复测结果（2026-11-01）
2252.01.01→2253.07.27后确认暂停/AI关闭；科研候选已加载，但现有合法槽被占用、两颗空槽需都城升级，未见新科研施工；议会命令未触发。两项均仍待验，不再同档空等或追加重启；未强制建造/升级/触发议会。

## 最新：区域解析错误已修（2026-11-01）
再次短复测发现additional_ai_weight条件块实际不能解析，已提前停在2252.03.22并确认AI关闭/暂停；科研结果无效、议会未触发，均未通过。已改为科研方针限定的独立研究区候选及数值权重（不覆盖原区、不改费用岗位），本机mod已更新，需正常重启加载后只继续这两项。

## 0.6.19两项复测后（2026-11-01）
2250.01.01→2252.01.04未看到新科研施工，议会命令未触发，均不计通过；最终确认暂停、AI关闭、人类持权。科研引导已补4.5.2区域additional_ai_weight的本机生成器并安装，旧经济计划单独不足；新权重待下次正常重启加载，本轮不再追加重启/延时。安装命令install-steering-mod可指定--game-dir；不提交本机生成的原版派生区域条目。

## v1.5 T6（2026-11-01）
原生多类日常运营、三维方针切换、不关AI提出保留外交请求及修复后的正常停止已实机通过；科研方向偏贸易、独立议会命令漏拦两项已修，默认补丁桥0.6.19和更新mod待下次用户正常重启后仅复测这两项，不再整轮重跑。详见stellaris-player/docs/T6-v1.5-20261101.md；当前游戏已暂停、AI关闭，无付费模型调用。

# v1.5 当前交接（2026-11-01）
T1–T5已实现：默认放行保留清单门控、full_with_reserved控制器、零成本方针法令与追加经济计划/预算、StrategyContract和不关AI的保留决定、180游戏日/事件复查、DSH方针与统计面板。新桥0.6.18已编译并固定为默认，引导mod文件已安装但未启用；未实机、未调用付费模型，等待一次T6（手动启用mod、重启、读档）。
已知覆盖边界：门控为AddAI和已有own-pending-Post；其他路径用玩家方针人格aggressiveness=0兜底，T6看实际行为，不另做逆向或证据工程。以下v1.4记录仅历史，不再决定待办。

# 当前交接状态 · 2026-10-31

> **方向修正（v1.5）：** 本页“下一步”已作废，改按 [STELLARIS_HYBRID_CONTROL_PLAN.md](STELLARIS_HYBRID_CONTROL_PLAN.md) v1.5 第五节执行。门控从“白名单逐项放行”改为“默认放行＋保留清单”，新增引导 mod 和战略契约；交付优先，全部写完后只做一次合并实测。下文“实际状态”“已有证据”“关键代码”仍有效。

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

## 下一步（已作废，见 v1.5 第五节）

1. 审查候选实际入口，继续集中补生产和必要内部计划维护，形成一个固定候选桥，再统一验收，不逐个小改要重启。
2. 内部维护：虚表slot8是IsValid、slot9才Execute。ai_remove_diplo_action经B7E9F0操作AI集合；ai_add_strategy经1AFF0B0操作计划容器；战况刷新仍有下游调用。目前均未因此放行。要放行须完整副作用边界、类型化Execute/Clone/析构与排空证据，不能制造未跟踪命令的假未释放。分段unwind可能只覆盖首片，不能误判全函数无副作用。
3. 星基建筑/模块/升级、扩张/舰队执行仍缺完整托管覆盖；普通造船不等于完整电脑玩家运营。
4. 检查AddAI/own-pending-Post之外的来源覆盖及真实预算约束；当前无原生花费硬预算，不把轮询告警称硬限制。
5. 验证真实战略干预后保护保留，准备一次短合并验收，由用户手动重启/读档。当前长期目标已暂停、转为交接，未经后续指令不恢复实机或付费模型测试。

## 快照边界

不带API/加密密钥、登录状态、配置、最新会话、模型原始流、游戏文件/存档、DLL/EXE、依赖、安装包、鲸鱼贴图和生成语音。选取报告含游戏测试数据，仅用于私有交接。新建干净仓库，不上传旧git历史；各来源许可证保留。


## v1.5 当前执行（替代以上v1.4待办）
T3：选零成本永久法令，避免政策切换冷却；三个维度8个值，ai_weight=0，由本国门控保护cfsteer_前缀。4.5.2经济计划支持追加同名plan的命名subplan：消费稳定提高消费品/凝聚力focus（格式塔改能量/凝聚力），军工提高合金focus，科研提高三科focus；追加ai_budget相对份额引导星球、殖民/前哨、造船/升级，不改原版或资源。建筑与科技权重语法已读，本版通过经济计划引导建设，暂不覆盖科技条目。玩家方针限定的aggressiveness=0人格作为门控外宣战兜底，不修改他国。安装仅写本mod目录，启用由用户手动。
