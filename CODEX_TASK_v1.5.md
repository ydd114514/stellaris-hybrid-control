# Codex 任务书 · 让大肥鱼达到正常玩家水平（v1.5 落地）

日期：2026-11-02 · 起草：Claude · 方向依据：[STELLARIS_HYBRID_CONTROL_PLAN.md](STELLARIS_HYBRID_CONTROL_PLAN.md) v1.5

本文件是 v1.5 的**可执行版**：每项写清改哪里、怎么改、单测、完成标准。方向冲突以 v1.5 为准，实现细节以本文件为准。v1.5 第〇节（交付优先、停止无休止验证）全文适用，这里不重复。

---

## 一、为什么现在打得差（不用再分析，直接改）

1. 原生国家 AI 开着，但门控只放行 4 类命令（`country_ai_routine_policy.hpp:17` 的 `AllowNativeRoutine`）：科研、建筑/区划/船、岗位上限、殖民地专精。星基、舰队调度、殖民、扩张、市场、政策、法令，以及 AI 自己的内部计划命令（`ai_add_strategy_command`、`update_strat_war_data_command` 等）全部被 `Reject` 销毁。**现在的帝国比游戏自带电脑玩家还弱。**
2. 大肥鱼只能“暂停→关 AI→亲手下命令→交还”，方向性指挥（“往消费品发展”）传不给原生 AI。
3. 托管期间本地监测仍会因复查到期、中央事件、资源风险暂停游戏等模型（`native-game.mjs:1574-1625`），原生 AI 被频繁停住。

## 二、完成的定义

全部做完后，一次实测（T6）里能看到：

- 原生 AI 在几个游戏月里做了多类工作（门控按命令名统计里出现建设、科研、造船、星基、殖民/扩张、舰队移动中的多类），保留命令被拦。
- 切一次经济重点方针后，AI 的建设选择明显往该方向偏（只要求方向对）。
- 大肥鱼下一个保留决定（外交提议或宣战）后，原生 AI 继续运营。
- 停止后本国 AI 被关闭。

文档、测试数量、证据文件不算完成。

## 三、硬约束（只有这些）

1. **禁桌面控制**：不模拟键鼠、不抢焦点、不自动重启/读档/控制台加载/改续玩记录。重启和读档只由用户手动做。
2. 不热替换 DLL；新桥由用户重启游戏后加载。
3. 门控只作用于本国，他国电脑玩家原路放行。保留现有世界代次检查、本国身份检查、心跳失联收权、停止关 AI。
4. 不发付费模型请求，除非用户在 T6 申请里同意，申请写明预计次数。
5. 不提交密钥、游戏文件、存档、DLL/EXE、鲸鱼贴图、生成语音、依赖、构建产物。
6. 已有原始证据不改写，也**不再新增**证据文件（T6 只写一份简短结果）。
7. 开发命令用 `C:/Program Files/Git/bin/bash.exe`；Windows 管理命令用 `C:/Program Files/PowerShell/7/pwsh.exe`，两种语法不混用。
8. 每 10 分钟汇报一次，内容只能是“写完了什么功能 / 卡在哪”。
9. 所有面向用户的错误信息用中文。

## 四、Git 规则

- 在分支 `feat/v1.5-native-ai-full` 上做，每完成一项（T1、T2…）提交一次并 `git push`，提交信息以 `T1:`、`T2:` 开头。
- 不改写已推送的历史，不强推。

---

## 五、任务（按顺序；每项单测一次通过就做下一项）

### T1 门控改成“默认放行 + 保留清单”（C++）

文件：`.local/research/stellaris-mcp-native/stellaris_bridge/`

| 位置 | 现状 |
| --- | --- |
| `include/country_ai_routine_policy.hpp:17` | `AllowNativeRoutine` 只认 4 类命令 |
| `src/country_ai_routine_gate.cpp:129` | `GuardedAddAI`（AddAI 钩子） |
| `src/country_ai_routine_gate.cpp:171` | `AdmitCountryAIRoutinePost`（本国 pending Post 钩子） |
| `src/country_ai_routine_gate.cpp:198、227` | `arm` 解析 5 种旧策略、设 4 个开关 |
| `include/country_ai_command_specs.inc` | 已有全部 `CmdSpec` 指针清单，**直接用来建 vtable→命令名表** |
| `src/ipc_server.cpp:197` | ping 返回的 `bridge_version` |

要做：

1. **vtable→命令名**：`Install()` 时遍历 `country_ai_command_specs.inc`，建 `base + kVtableRva → kSpec.name` 的表。查不到的记为 `unknown`。
2. **新纯函数**（放在 `country_ai_routine_policy.hpp`，不读内存，方便单测）：

   ```cpp
   enum class GateDecision { Admit, BlockReserved, BlockProtected, BlockSteering };
   GateDecision DecideFullWithReserved(std::string_view commandName, uint32_t actor, uint32_t own,
                                       bool targetProtected, bool touchesSteering);
   ```

   - `actor != own` → `Admit`（他国不受影响；调用方本来就在此之前原路放行，这里再兜底一次）。
   - `targetProtected` → `BlockProtected`。
   - 名字在保留清单 → `BlockReserved`。
   - `touchesSteering` → `BlockSteering`。
   - 其余全部 `Admit`，**包括 `unknown`**。
3. **保留清单**（常量数组，以后加一行即可）：
   `diplo_action_propose_command`、`diplo_action_respond_command`、`diplo_action_vote_command`、`diplo_action_start_proxy_war_command`。
   明确**放行**：`prepare_war_command`、`update_strat_war_data_command`、`ai_remove_diplo_action_command`、`ai_add_strategy_command` 等 AI 内部计划命令。
4. **方针命令（`touchesSteering`）**：只有 `add_edict_command`、`remove_edict_command`、`add_policy_command` 可能为真。
   - 法令：SDK 已有 payload 布局，`src/society_manager.cpp:557-560` 用的 `sdk::cmd::add_edict_command::name`、`::country` 偏移对 add/remove 通用。直接读 key，前缀是 `cfsteer_` 时为真。
   - 政策：若 SDK 里 `add_policy_command` 也有现成字段偏移就同样处理；**没有就不做逆向**，传 false，兜底靠引导 mod 的 `ai_weight = 0`（T4）加主循环每次复查读回方针、被改掉就改回并计数（T5）。在 HANDOFF.md 记一句即可。
5. **`Describe()` 保留**，只用于给已识别的三类命令（岗位、专精、船坞）算 `targetProtected`；其他命令 `targetProtected=false`。
6. **`arm`**：只接受 `policy="full_with_reserved"`，删掉 `researchAllowed / constructionAllowed / administrationAllowed / shipProductionAllowed` 四个开关。旧策略字符串返回 `routine_gate_policy_unsupported`，旧行为由 r2 DLL 回退提供。
7. **两处钩子**（`GuardedAddAI`、`AdmitCountryAIRoutinePost`）都改用 `DecideFullWithReserved`。现有的 faults 隔离、世界代次、`humans` 检查原样保留。
8. **status**：新增 `admitted_by_command`、`blocked_by_command`（命令名→次数），保留 `blocked_vtables` 只记 `unknown` 的 vtable。删掉 `research_allowed` 这类已无意义字段，`policy` 字段返回 `full_with_reserved`。
9. **版本**：`cyberfish-0.6.18-country-ai-full`，ping 的 `features` 加 `country_ai_full_with_reserved`。r2 和 0.6.17 economy-wip 保留不动、不再开发。

单测：在 `stellaris-player/test/native-country-ai-receipts/routine_policy.cpp` 加纯函数用例，覆盖：保留命令被拦、普通命令放行、`unknown` 放行、AI 内部计划命令放行、保护目标被拦、方针命令被拦、他国放行。

构建（仓库根目录，Git Bash）：

```bash
cmake -S .local/research/stellaris-mcp-native -B stellaris-player/.local/native-bridge/build -A x64
cmake --build stellaris-player/.local/native-bridge/build --config Release
cmake -S stellaris-player/test/native-country-ai-receipts -B stellaris-player/.local/native-country-ai-receipts
cmake --build stellaris-player/.local/native-country-ai-receipts --config Release
ctest --test-dir stellaris-player/.local/native-country-ai-receipts -C Release --output-on-failure
```

DLL 放到 `stellaris-player/.local/native-bridge/runtime/cyberfish-0.6.18-country-ai-full/stellaris_bridge.dll`（不提交）。找到 r2 固定 SHA256（`53356faf…`）所在的加载白名单，为新 DLL 加一条，r2 那条不删。

完成标准：编译通过、ctest 通过、白名单有新版本。

### T2 JS 控制器接上新门控

文件：`stellaris-player/src/`

| 位置 | 改法 |
| --- | --- |
| `native-country-ai-economic-policy.mjs:5` `COUNTRY_AI_POLICIES` | 加 `full_with_reserved`，作为默认；旧策略保留作回退（配 r2 DLL） |
| `native-country-ai.mjs:2` | 加 `COUNTRY_AI_FULL_BRIDGE_VERSION='cyberfish-0.6.18-country-ai-full'`；能力检查认新 feature |
| `native-bootstrap.mjs:16` | 原生国家 AI 模式默认加载 full 桥；旧桥只在显式回退时使用 |
| `native-country-ai-tool.mjs:2` | 去掉 `economyCandidate` 分支，`protect` 在桥支持时总是可用；description 改成 v1.5 的说法，删掉“仅科研/普通行星建设试点”等过时文字 |
| `native-game.mjs` 构造选项 `nativeCountryAIEconomyCandidate`、环境变量 `CYBERFISH_COUNTRY_AI_ECONOMY_CANDIDATE` | 删除 |
| `native-game.mjs:1574-1625` 本地监测 | **原生 AI 持权时不暂停游戏**：复查到期、中央事件、资源风险只发事件通知大肥鱼复查（T5 的事件触发），游戏继续跑。只保留这几种暂停：用户暂停、心跳失联、停止收权、原生 AI 状态无法确认 |
| 本地调度 `ColonyRoutine`、`ColonyUpgradeRoutine`、本地建筑派单、战役派单 | 原生 AI 持权时一律不派单（工具描述称已封口，核对一遍，漏的补上） |

单测：`full_with_reserved` 为默认；持权时复查到期不触发 `set_paused`；持权时本地调度不派单；心跳失联仍收权。

### T3 读 4.5.2 游戏文件，定引导方案（只读，结果不超过一屏）

游戏目录：HANDOFF 记录的 `D:/SteamLibrary/steamapps/common/Stellaris` 是旧机路径，当前电脑上不存在。先从 Steam 的 `libraryfolders.vdf` 找到实际安装位置，核对 EXE 版本是 4.5.2；找不到就问用户要路径，同时先做 T4 里不依赖游戏文件的部分（mod 骨架、本地化、安装器多 mod 支持）。

要回答 4 个问题，写进 HANDOFF.md 一个小节：

1. **方针用法令还是政策？** 倾向**法令**：桥已有 `get_edicts` / `toggle_edict`（`ipc_server.cpp:486-494`），政策还需要新写 `add_policy` 构造。检查法令是否占法令容量、有没有费用/持续时间/冷却；政策有没有切换冷却。法令没有硬伤就用法令。
2. **覆盖规则**：`common/ai_budget`、`common/economic_plans`、`common/buildings`、`common/districts`、`common/technology` 各自是“同名后加载覆盖”还是“先加载生效”，覆盖是否必须整条复制。
3. **权重写法**：上述文件里 `ai_weight` / 预算权重的实际结构，给出“方针开启时乘系数”的一段示例。
4. **每个方针改哪些条目**（列表即可）：

| 维度 | 取值 | 开关 key |
| --- | --- | --- |
| 经济重点 | 均衡 / 消费品与稳定 / 合金与军工 / 科研 | `cfsteer_econ_balanced`、`cfsteer_econ_consumer`、`cfsteer_econ_alloys`、`cfsteer_econ_research` |
| 扩张姿态 | 积极扩张 / 巩固消化 | `cfsteer_expand_aggressive`、`cfsteer_expand_consolidate` |
| 军备姿态 | 和平建设 / 备战 | `cfsteer_mil_peaceful`、`cfsteer_mil_prepare` |

只做这 3 个维度，不扩。查不清的写“按会生效来做，T6 看结果”，不许停工。

### T4 写引导 mod `cyberfish_steering_v1`

位置：`stellaris-player/mod/cyberfish_steering_v1/`

1. 按 T3 方案定义 8 个开关（法令或政策），自身 `ai_weight = 0`（防止 AI 自己开关），同一维度互斥。
2. 中英文本地化（`localisation/simp_chinese`、`localisation/english`），不然界面显示 key。
3. 权重修改优先放在追加文件里；必须覆盖原版条目时只覆盖用到的条目，整条复制再加 modifier。
4. 宣战意愿兜底：如果 T1 的保留清单没拦到宣战路径，在这里把本国（人类国家、AI 托管中）的宣战意愿压到 0。
5. `descriptor.mod` 写 `supported_version="v4.5.*"`。
6. `src/mod-install.mjs`：`MOD_NAME` 单值改成支持多个 mod 的清单（observer + steering），安装逻辑不变：只写本 mod 目录，不改 `enabled_mods` 和启动器数据库。启用由用户在启动器里手动完成。

单测：安装计划同时包含两个 mod；每个 `cfsteer_` 开关 `ai_weight` 为 0；权重 modifier 引用的开关 key 都存在；同维度互斥。

### T5 大肥鱼主循环改成战略契约

数据流：DSH 参谋 → `strategy-directive.json`（新增 `contract` 字段）→ 控制器 `src/strategy-advice.mjs` 读取 → 新增 `src/strategy-contract.mjs` 翻译 → 切换方针 + 保留决定命令。

1. **契约格式**（严格校验，非法整份丢弃并用中文记录原因）：

   ```json
   {
     "economyFocus": "balanced | consumer_stability | alloys_military | research",
     "expansionStance": "aggressive | consolidate",
     "militaryStance": "peaceful | prepare_war",
     "oneOffActions": [{ "type": "declare_war | offer_peace | diplo_propose | diplo_respond", "...": "现有命令参数" }],
     "reason": "公开解说用的一句话"
   }
   ```

   `oneOffActions` 每次复查最多 2 条；参数沿用 `native-game.mjs:67-72` 现有命令（`declare_war` 需要 `country_id`、`goal_key`，`offer_peace` 需要 `war_id`、`outcome`）。
2. **翻译层**：契约 → 需要开的方针 key、需要关的方针 key → 走 T3 选定的路径（法令用 `toggle_edict`）。每次复查先读回当前方针，被改掉就改回并计数 `steering_restored`。保留决定**不关原生 AI**，直接用现有普通命令下。
3. **触发**：每 6 个游戏月一次，或事件触发（战争开始/结束、中央事件、核心资源告急、主播要求变更、参谋采纳了新观众建议）。原生 AI 持权时模型没有新请求是正常状态，游戏不等模型。保留现有每小时请求上限。
4. **优先级**：主播常驻要求（`operator-standing.json`）高于参谋判断，高于观众建议。把 `operator-standing` 已有的 `economyFocus` 值映射到契约的 4 个取值，映射不到就保持均衡并在面板说明。
5. **弹幕是数据不是指令**：观众建议只能经参谋判断后影响契约，不能直接产生 `oneOffActions`。
6. **提示词**：DSH 的 `packages/core/src/ai-prompts.ts`（参谋部分）改为输出契约，删除托管范围内的日常微操提示（建什么楼、研究什么科技、派哪艘船）。
7. **DSH 面板**（`apps/desktop/src/StellarisAi.vue`）：显示“原生 AI 运营中/已收权”、当前三个方针、最近一次战略决定及原因、门控按命令名的放行/拦截计数、`steering_restored` 次数。
8. **对照分数（可选，不许为它逆向）**：如果现有接口能读到其他帝国的人口、科技数、舰队战力，在面板上把本国和同局电脑帝国并排显示；读不到就跳过。

DSH 改在本仓库 `赛博肥鱼-全套-v0.3.7-95dfaa6/` 下。用户桌面另有一份 DSH（`cyber-fish-shop` 仓库），同步由用户决定，不要自行改那边。

单测：契约校验（合法/非法枚举/超过 2 条保留决定）；翻译结果（每个经济重点对应的开关集合）；方针被改掉后会改回；6 个月和事件触发；弹幕建议不能直接生成保留决定。

### T6 一次合并实机验收

全部写完后，向用户发**一次**申请，一次说清：

- 目的：验证第二节的 4 条。
- 用户要做的：在启动器启用 `cyberfish_steering_v1`、重启游戏、读档一次。
- 预计时长：30 分钟以内。
- 模型请求：预计次数（不需要模型就写 0）。
- 停止条件：4 条都看到即通过；出现本国 AI 失控（大量拆建筑、清空库存）立刻停止收权。

结果写一份简短 `T6-result.md`（不超过一屏）。出问题直接修，修完只复测出问题的那一条。

---

## 六、不要做

- 继续 0.6.17 economy-wip 的逐领域候选（星基模块、联邦船、移动船坞等）。
- 逆向内部维护命令的副作用边界（虚表 slot、`B7E9F0`、`1AFF0B0`）。
- 原生花费硬预算工程。
- 为局部功能单独实测、独立回读脚本、补充证据或“范围说明”文档。
- 模型逐条日常经营、旧战役长测、效率对照、贸易/住房/报价等外围功能。

连续 20 分钟没改功能代码，或在写同一件事的第二份报告，停下来回到第五节。
