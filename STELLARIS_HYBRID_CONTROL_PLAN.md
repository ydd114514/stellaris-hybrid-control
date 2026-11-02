# 大肥鱼群星混合控制实施计划 v1.5

版本：1.5
更新日期：2026年10月31日
起草：Claude，用户确认方向
状态：**本版替代 v1.4 的方向、实施顺序和验证要求。** v1.4 已移到 [stellaris-player/docs/混合控制计划-v1.4-20261031-方向修正前.md](stellaris-player/docs/混合控制计划-v1.4-20261031-方向修正前.md)，仅作历史记录。其他文档与本版冲突时，以本版为准。

---

## 〇、先读这一段：交付优先，停止无休止验证

用户原话：**“别再一直验证验证了，codex拖了我两天了一点进度没有，我人快疯了。”**

这是本版最高优先级的约束，优先于 AGENTS.md / CLAUDE.md / HANDOFF.md 里所有关于证据、验收、报告的要求：

1. **进度 = 游戏里原生 AI 实际能干的事变多了。** 文档、证据文件、测试数、报告、能力协商字段都不算进度。
2. **离线测试只写给新逻辑的必要单测**，跑一次通过就继续写下一项。不为每个小改写证据文件、补充报告、独立回读脚本。
3. **整个 v1.5 只安排一次合并实机验收**，放在第五节全部代码写完之后。中间不请用户读档，不做分领域实机测试。
4. **不再为“证明某个动作确实来自原生 AI”做专项工程。** 门控日志里能看到命令类型和计数就够了。
5. 发现问题直接修，修完继续。不写“失败分析”“补充证据”“范围说明”文档，只在 HANDOFF.md 里用一两句话记录。
6. 每 10 分钟汇报的内容必须是“写完了什么功能 / 卡在哪”，不能是“正在核实 / 正在分析 / 正在补证据”。
7. 安全底线保留（见第八节），但安全底线不等于验证流程。

如果你（Codex）发现自己在写第二份关于同一件事的报告，或者连续 20 分钟没有改动功能代码，停下来，回到第五节的任务清单。

---

## 一、用户真正要的东西

> 程序接管群星原生的电脑玩家 AI，让原生 AI 自己去完成游戏里的各种操作；程序不再一个一个下命令。程序（大肥鱼）的主要精力放在怎么玩好这个游戏，以及怎么让游戏朝用户要求的方向发展。

分工：

| 谁 | 干什么 |
| --- | --- |
| 原生国家 AI | **几乎所有日常操作**：建设、科研、造船、星基、殖民、扩张、舰队调度、岗位、市场等。默认全部放行。 |
| 引导层（新增） | 把大肥鱼的战略方向翻译成原生 AI 会听的东西：政策、法令、星球定位，以及引导 mod 里的 AI 权重。 |
| 大肥鱼（模型） | 低频决定战略方向，只亲手做少数保留决定：宣战、议和、重大外交。 |

“多线程”的收益来自这种分工：原生 AI 每个月替玩家做几百个小决定，大肥鱼只做几个大决定。

---

## 二、v1.4 的方向错误（必须纠正）

### 错误 1：原生 AI 被做成“默认禁止、逐项放行”

`.local/research/stellaris-mcp-native/stellaris_bridge/include/country_ai_routine_policy.hpp` 的 `AllowNativeRoutine` 只认 4 类命令：`ResearchTechnology`、`AddBuildable`（建筑、区划、升级、区域、船、殖民船）、`WorkforceLimit`、`ColonyDesignation`。`country_ai_routine_gate.cpp` 的 `GuardedAddAI` 把其他所有命令直接 `Reject` 销毁。

后果：

- 原生 AI 开着，但星基、舰队移动、殖民、扩张、市场、政策、法令等都被丢掉。帝国实际上只会科研和盖楼。
- 原生 AI 自己的内部维护命令（如 HANDOFF 里提到的 `ai_remove_diplo_action`、`ai_add_strategy`，以及 SDK 里的 `update_strat_war_data_command`）也被拦，AI 的内部计划状态会被搞乱，表现变差。
- 每多一个领域就要逆向一个命令结构、加一个开关、做一轮验收。这本质上还是“程序一个一个操作”，只是从 JS 层挪到了 C++ 层。两天没有进度的根源就在这里。

### 错误 2：大肥鱼只能“整个接管”，没有“引导”

v1.4 的干预方式是：暂停 → 关 AI → 模型亲自下命令 → 回读 → 交还。这只适合单次决定。“往消费品经济发展”“先巩固再扩张”这类方向性指挥根本传不给原生 AI。结果大肥鱼要么不管，要么亲手干。

### 错误 3：验证成本压过了交付

每个小领域都要实机证据、独立回读、严格报告、范围说明。时间花在证明上，而不是让 AI 把帝国跑起来。见第〇节。

---

## 三、新架构

```
                 ┌──────────────────────────────────────┐
  游戏摘要/事件 →│ 大肥鱼（模型，低频、事件驱动）          │
                 │ 输出 StrategyContract                  │
                 └───────────────┬──────────────────────┘
                                 │
              ┌──────────────────┴───────────────────┐
              ▼                                      ▼
   ┌─────────────────────┐              ┌────────────────────────┐
   │ 引导层 steering      │              │ 保留决定执行             │
   │ 方针 → 政策/法令/定位 │              │ 宣战、议和、外交提议/回应 │
   │ → 引导 mod 的 AI 权重 │              │ 用现有普通命令直接下      │
   └──────────┬──────────┘              └───────────┬────────────┘
              ▼                                     ▼
   ┌──────────────────────────────────────────────────────────┐
   │ 原生国家 AI（human_ai），门控 = 默认放行 + 保留清单拦截     │
   │ 日常运营全部由它完成                                        │
   └──────────────────────────────────────────────────────────┘
```

### 3.1 门控：默认放行 + 保留清单

- 本国 AI 的命令**默认全部放行**，包括未识别的命令类型。
- 只拦**保留清单**里的命令（第四节），以及命中 `protected_targets` 的命令。
- 每个命令按 vtable 映射到 SDK 里的命令名（`include/sdk/stellaris_sdk.hpp` 里每个 `CmdSpec` 都有名字和 `kVtableRva`），按名字统计放行和拦截次数，`status` 返回这张表。这就是全部的“来源观测”，不另做证据工程。
- 保留现有的安全检查：本国身份检查、世界代次检查（旧世界的委派不能操作新世界）、心跳失联收权、停止时关闭 AI。

### 3.2 引导层：让原生 AI 自己朝大肥鱼的方向走

按顺序使用：

1. **游戏本来就给玩家用的设置**，通过现有普通命令修改：政策（`add_policy_command`）、法令（`add_edict_command` / `remove_edict_command`）、星球定位（`set_colony_type_command`）。这些原生 AI 本来就会参考。
2. **引导 mod `cyberfish_steering_v1`**：
   - 定义少量“大肥鱼方针”作为切换开关。首选做成**自定义政策**（玩家通过普通 `add_policy_command` 切换，脚本里用 `has_policy_flag` 判断）。如果 4.5.2 的政策有冷却期或其他限制不合适，改用**零成本法令**（`has_edict`）。由 Codex 读 4.5.2 游戏文件后二选一，**不要两个都做**。
   - 在原生 AI 用到的权重里加上“方针开启时乘以系数”：`common/ai_budget`、`common/economic_plans`、建筑/区划的 `ai_weight`、科技的 `ai_weight` 等。**优先用追加文件，不整份覆盖原版文件**；必须覆盖时只覆盖用到的条目。
   - 方针政策/法令自身 `ai_weight = 0`，并且门控拦截本国 AI 对这些方针的 `add_policy` / `add_edict` / `remove_edict`，防止 AI 自己改回去。
   - 复用现有 `src/mod-install.mjs` 的安装方式（只写本 mod 目录，不改 `enabled_mods` 和启动器数据库）。启用由用户在启动器里手动完成。
3. **初版方针只做 3 个维度**，不要扩：

| 维度 | 取值 |
| --- | --- |
| 经济重点 | 均衡 / 凝聚力与传统 / 消费品与稳定 / 合金与军工 / 科研 |
| 扩张姿态 | 积极扩张 / 巩固消化 |
| 军备姿态 | 和平建设 / 备战 |

### 3.3 保留决定：直接下命令，不关 AI

- 大肥鱼决定宣战、议和、外交时，**用现有 `native-game.mjs` 里的普通命令**（如 `declare_war`、`offer_peace`）直接下，原生 AI **保持开启**，继续负责战争中的造船、调兵等执行。
- 原来的“暂停 → 关 AI → 操作 → 交还”只保留作**紧急手段**（比如 AI 行为异常时整体收权），不再是常规干预路径。

### 3.4 大肥鱼主循环

1. 低频读取帝国摘要。复用 `strategic-review.mjs`、`native-country-ai-summary.mjs`。
2. 触发条件：定期（建议每 6 个游戏月一次），或者出现关键事件（战争、危机、核心资源告急、用户/弹幕给出新方向）。**原生 AI 持权时，模型没有新请求是正常状态，不能让游戏停下来等模型。**
3. 模型输出 `StrategyContract`：

```json
{
  "economyFocus": "balanced | unity_traditions | consumer_stability | alloys_military | research",
  "expansionStance": "aggressive | consolidate",
  "militaryStance": "peaceful | prepare_war",
  "oneOffActions": [{ "type": "declare_war | offer_peace | diplo_propose | diplo_respond", "...": "现有命令参数" }],
  "reason": "公开解说用的一句话"
}
```

4. 翻译层把 contract 变成：方针切换（政策/法令）+ 原生设置修改 + 保留决定命令。
5. 下次复查时看方向是否偏离，偏离就调整方针，不亲自接管日常。

---

### 3.5 直播导播补充要求（2026-11-01 用户最新要求）

- 自动导播必须每 120 秒至少展示一次**完整银河星图**，作为强制回顾场景，优先于普通科研、建设、探索和经济展示；首次开启也应尽早展示一次。
- 星图场景应切到真正的银河视图并拉到能看清整体版图的尺度，停留约 10–15 秒。仅关闭面板、局部星系图、跟随科研船或读取 get_galaxy_map 数据，都不算完成该要求。
- 间隔从上次成功展示完整星图计算，不用其他场景刷新计时。中央事件或必须处理的交互窗口阻挡时不强关窗口，解除阻挡后优先补展示。
- 与“固定当前画面”的交互需保持明确：固定模式暂停自动切换，恢复自动导播后若星图已逾期则优先展示。
- 0.6.22已新增 `show_galaxy_map` 和 `get_camera_state`：解除跟随、切换原生银河视图、按星图半径居中缩放；回读模式、中心与缩放范围，成功后才重置120秒计时。代码及定向测试已完成，尚待用户重启后的组合实测；不能以 show_panel(game) 冒充。

---

## 四、保留清单（初版）

门控只拦下列来自本国原生 AI 的命令：

| 命令（SDK 名） | 原因 |
| --- | --- |
| `diplo_action_propose_command` | 宣战、结盟、联邦、附庸等外交提议，留给大肥鱼 |
| `diplo_action_respond_command` | 接受或拒绝他国提议（包括议和），留给大肥鱼 |
| `diplo_action_vote_command` | 银河议会投票，留给大肥鱼 |
| `cast_vote_command`、`support_proposed_resolution_command`、`oppose_proposed_resolution_command`、`remove_support_for_proposed_resolution_command`、`propose_resolution_command`、`withdraw_proposed_resolution_command`、`veto_resolution_command`、`borrow_diplo_weight_for_resolution_command` | T6发现的独立议会决定路径，同属保留决定 |
| `join_community_command`、`leave_community_command` | T6发现的独立共同体外交决定 |
| `propose_emergency_measure_command`、`freeze_proposed_resolution_command`、`end_senate_session_command` | 议会紧急议案、冻结议案、提前结束会期，同属保留决定 |
| `diplo_action_start_proxy_war_command` | 代理战争 |
| 针对引导 mod 方针的 `add_policy_command` / `add_edict_command` / `remove_edict_command` | 防止 AI 改掉大肥鱼的方针 |
| 命中 `protected_targets` 的命令 | 沿用现有保护 |

注意：

- `prepare_war_command`、`update_strat_war_data_command`、`ai_remove_diplo_action_command`、`ai_add_strategy` 一类是 **AI 内部计划命令，放行**。它们只是 AI 自己的战略规划，不是对外决定。
- 宣战等如果不经过 `AddAI` 入口（比如走了另一条提交路径），在 `GuardedAddAI` 旁边的已有 own-pending-Post 钩子里同样按名字拦。两处都没有经过的，在 HANDOFF 里记一句，交给引导 mod 用权重把本国 AI 的宣战意愿压到 0 作为兜底。不要为此另开一轮逆向。
- 别的命令类型以后如果发现确实需要拦，往这张表里加一行就行，不需要改架构。

---

## 五、给 Codex 的任务清单（按顺序做，全部做完再统一实测）

每项写完、单测通过就做下一项。不写额外的报告文件。

**T1 门控改成默认放行**（C++，`country_ai_routine_policy.hpp`、`country_ai_routine_gate.cpp`）
- 新增 vtable → 命令名映射，用 SDK 里已有的 `CmdSpec`。
- `AllowNativeRoutine` 改成：非本国 → 原路放行（不变）；本国 → 命中保留清单或 `protected_targets` 才拒绝，其余放行。
- 原来的 research / construction / administration / shipProduction 四个开关删掉，换成一个 `reservedPolicy`。
- 按命令名统计 admitted / blocked，放进 `status`。
- 写一个纯函数单测，覆盖“保留命令被拦、普通命令放行、未知命令放行、保护目标被拦、他国不受影响”。
- 桥版本号改为新版本（如 `cyberfish-0.6.18-country-ai-full`），加入加载白名单，成为默认桥。r2 和 0.6.17 economy-wip 保留作回退，不再继续开发 economy-wip。

**T2 JS 控制器接上新门控**（`native-country-ai.mjs`、`native-country-ai-economic-policy.mjs`、`native-game.mjs`、`bridge-capabilities.mjs`）
- `COUNTRY_AI_POLICIES` 新增并默认使用 `full_with_reserved`。旧的 `research_and_planet_construction` 和 `economy*` 策略保留作回退。
- `nativeCountryAIEconomyCandidate` 和 `CYBERFISH_COUNTRY_AI_ECONOMY_CANDIDATE` 不再需要，移除或固定为不使用。
- 原生 AI 持权时，**关闭会重复派单的本地调度**：`colony-routine`、`colony-upgrade-routine`、本地建筑派单，以及模型逐条经营的提示路径。
- 删除“模型没有新指令就暂停游戏”这类会让原生运营停住的等待规则；保留用户暂停、心跳失联、停止收权。
- 并入控制器 issue #1：读取 `../commentary/operator-standing.json`，字段严格沿用 `cyber-fish-shop#3`；32KB上限、同局、来源/版本/kind校验和3分钟心跳，原话进入operatorMessages，文件删除或超时撤销。参谋目标改为10分钟未刷新才失效。

**T3 读 4.5.2 游戏文件，定引导 mod 方案**（只读）
- 看 `common/policies`、`common/edicts`、`common/ai_budget`、`common/economic_plans`，以及建筑和科技里 `ai_weight` 的写法。
- 决定方针用政策还是法令，列出每个方针要改哪些权重。写进 HANDOFF.md，**不超过一屏**。
- 同时确定凝聚力与传统的行政/凝聚力建设、岗位、相关科技、经济计划和传统预算权重，结论仍在同一屏内。

**T4 写引导 mod `cyberfish_steering_v1`**
- 3 个维度的方针 + 对应权重修改，按 T3 的方案。
- 复用 `mod-install.mjs`，安装逻辑支持多个 mod。
- 门控保留清单加上方针相关命令。
- 经济维度加入unity_traditions，仍复用相同法令开关和cfsteer_门控保护，不增加维度。

**T5 大肥鱼主循环改造**（`strategic-review.mjs`、`strategy-planner.mjs`、`strategy-advice.mjs`、DSH 提示词）
- 模型输出改为第 3.4 节的 `StrategyContract`。
- 新增翻译层：contract → 方针切换 + 保留决定命令。
- 去掉托管范围内的日常微操提示。模型调用改为定期加事件驱动。
- DSH 状态面板显示：“原生 AI 运营中”、当前方针、最近一次战略决定及原因、门控拦截计数。
- 主播常驻档位优先于参谋targetResource映射，后者优先于模型判断；只在战争或核心资源半年内耗尽时临时覆盖，脱险恢复，在controller-receipt.json写读取/切换结果和原因。退出条件达到后待本人确认，不自动切走；传统与飞升合法候选保留凝聚力收益优先的过渡提示。确认planStrategy调用路径，清除默认征服与主播要求冲突的提示。

**T6 一次合并实机验收**（全部写完之后，向用户申请一次）
- 申请时一次说清：目的、需要用户做什么（启用 mod、重启游戏、读档一次）、预计时长（目标 30 分钟以内）、停止条件。
- 只看这几件事，看到了就算通过：
  1. 开启后，原生 AI 在几个游戏月里实际做了多种工作（门控统计里出现建设、科研、造船、星基、殖民或舰队等多类命令），保留命令被拦。
  2. 切换一次经济重点方针，之后 AI 的建设选择明显往该方向偏。只要求方向对，不做精确对照实验。
  3. 大肥鱼下一个保留决定（比如一次外交提议或宣战），原生 AI 继续运营不受影响。
  4. 停止后 AI 被关闭。
  5. DSH设置“前期主拉凝聚力”后，几个游戏月内凝聚力月产明显上升，原生建设偏向行政/凝聚力，回执steeringApplied=true；只看方向，不做精确对照。
- 实测发现的问题直接修。修完只复测出问题的那一项，不重跑整轮。

---

## 六、复用的现有成果

不推倒重来，下面这些直接用：

- `AddAI` 钩子和 own-pending-Post 钩子、世界代次检查、本国身份检查。
- 委派租约、心跳失联收权、停止和清理（`supervisor-cleanup.mjs`、`native-country-ai-cleanup.mjs`）。
- `protected_targets`。
- `native-game.mjs` 里已有的普通命令（宣战、议和、政策、法令等）。
- `mod-install.mjs` 和观测 mod `cyberfish_observer_v1`。
- `strategic-review.mjs`、DSH 入口、AI 中枢、场控/参谋分工、公开解说边界。

## 七、停止的工作

- 0.6.17 economy-wip 的逐领域候选扩展：星基建筑/模块/升级逆向、联邦船、移动船坞等。默认放行后不再需要。
- HANDOFF“下一步”第 2 条：内部维护命令的副作用边界逆向（虚表 slot、B7E9F0、1AFF0B0 等）。默认放行后这些命令照常执行，不再需要证明。
- 原生花费的硬预算工程。改为用方针和 `ai_budget` 权重引导花费方向，不承诺硬上限。
- 为局部功能单独做的实机验收、独立回读脚本、补充证据文件。
- 旧战役长测、效率对照、贸易/住房/报价等外围功能。

---

## 八、保留的底线（只有这些，不要扩展）

1. 不用桌面控制，不模拟键鼠，不抢焦点；重启和读档由用户手动完成。
2. 不热替换 DLL；新桥需要用户重启游戏后加载。
3. 他国电脑玩家不受影响：门控只作用于本国。
4. 停止或心跳失联时，必须关闭本国 AI。
5. 不提交密钥、游戏文件、存档、DLL/EXE、鲸鱼贴图。
6. 不发起付费模型请求，除非用户明确同意。T6 需要模型时，申请里写明预计请求次数。
7. 已有的原始证据不改写；但**不再新增**证据文件，除了 T6 的一份简短结果。

## 九、需要 Codex 自己确认、但不许因此停工的未知项

| 未知项 | 处理方式 |
| --- | --- |
| 宣战/外交是否都经过 `AddAI` 或 own-pending-Post | T1 按名字拦；T6 看计数。漏掉的用引导 mod 压低意愿兜底 |
| 政策是否有冷却期 | T3 读文件决定政策还是法令 |
| `human_ai` 下本国是否使用 `ai_budget`/`economic_plans`/`ai_weight` | 按会使用来做；T6 的方针切换结果会直接说明 |
| 默认放行后 AI 做出和方针冲突的事（如拆建筑、乱花战略资源） | 先用方针权重和 `protected_targets` 处理；T6 后再看要不要加保留项 |
| mod 影响铁人模式/成就/校验和 | 告诉用户即可，不影响开发 |

以上未知项都不能成为停工、先做专项验证或写分析报告的理由。
