# 凝聚力优先与原生门控审阅

本轮沿用 v1.5 分工。原生国家 AI 负责日常经营，大肥鱼只提交方针和经审核的保留决定。S6 审阅提交为 `ab88667`。分支同步了实际构建使用的桥和控制器源文件，以及它们依赖的本机模块。

## 实现

| 事项 | 实现与边界 |
| --- | --- |
| 普通法令 | 本国原生 AI 的 `add_edict_command` 在队列入口及原生来源确认后的提交入口被拦截。普通法令停用仍可走正常路径，方针法令保护和其他帝国逻辑保留。入口要求 `0.6.29` 法令门控能力，旧桥不能静默继续。 |
| 审核与预算 | 2300.01.01 前及日期未知时，控制器拒绝新增普通法令。中后期每份战略合同最多批准一条，须通过引擎合法性、真实用途和凝聚力预算检查。桥使用原生 `IsValid` 区分可启停、引擎拒绝和核验失败。当前桥无法读取可信的单条维护费与法令基金，费用未知时继续拒绝开启。2300 是当前策略默认线，桥尚未读取存档自定义中期年份。 |
| 审批后下单 | 原先已授权的法令参数加入会话绑定字段后变成新对象，原生管道写前检查误拒绝。授权现在绑定原始参数和生成的唯一传输对象。停用后必须回读实际列表，结果未知不得重发。 |
| 前期扩张 | 控制器优先凝聚力，支持传统与飞升。规模到 100 时锁定巩固方针。桥针对早期、已确认达到 100 的本国原生 AI 拦截无主星系的新前哨订单。已有领土建设、矿站、科研站和防守继续。 |
| 突触节点 | 战略提示要求比较真实槽位、协调岗位和凝聚力净收益。早期和平时，桥拒绝本国原生 AI 在同一特区重复新建已有或已排队的护卫哨所，保留第一座。现有建筑不会由门控移除。 |

## 当前档回读

- 在已运行且此前未加载桥的进程中首次加载 `cyberfish-0.6.29-edict-approval`。读回该版本和法令门控能力。自动重启、读档、桌面操作和付费模型请求均为零。
- 2225.07.01，帝国规模 126，凝聚力净产 +27.59/月。确认和平、人类持权且暂停后，只停用「舰队至上」，回读确认已移除。采矿、农业和能源补贴仍启用。停用这些补贴后的资源净收支尚无可信数据。
- 地球已解锁突触建筑。政府区 6/6，包含三座护卫哨所，档案馆 3/3。引擎拒绝向这两个满槽特区新增节点，也拒绝矿、能源和农业特区的候选。当前桥没有经验证的建筑替换入口，本轮未拆除或下单。建筑须用游戏中的替换释放槽位，再以实际排队和完工回读为准。
- 本轮直接核实了桥加载、停用回读和建设阻碍。新门控在原生托管下的实际拦截次数，以及突触节点完工后的净产，留待后续正常运行观察。

## 离线验证

- 审阅工作树 99 项 JS 定向测试通过。主要覆盖日期边界、凝聚力预算、合法性、原生管道授权、前期巩固和 S6 回归。
- 审阅工作树的 C++ `country_ai_routine_admission` 通过。覆盖开启与停用法令、帝国范围、前哨目标和重复护卫哨所的门控条件。
- 本机 MSVC x64 Release 桥已编译。该构建的 SHA-256 为 `ce595b7f5cbb2e24d2da3ef6478093f009ef66ae10d8f75f14f24d384293927e`。分支仅提交对应源码、测试和本说明。

```bash
cd stellaris-player
node --test test/{native-strategy-domestic-transport,native-bootstrap,native-director-bridge,native-country-ai-brief,strategy-direction,strategy-direction-locks,native-intent,strategy-review-regressions,strategy-decision-options,edict-inspection,strategy-domestic-actions,owner-economic-policy,behemoth-guide,native-model-budget,strategy-turn-recovery,runtime-continuation,game-checkpoint,game-compaction-pressure,model-view}.test.mjs
cmake -S test/native-country-ai-receipts -B ../build-edict-tests
cmake --build ../build-edict-tests --config Release --target native_country_ai_routine_policy
ctest --test-dir ../build-edict-tests -C Release -R country_ai_routine_admission --output-on-failure
```
