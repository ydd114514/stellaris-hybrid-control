# Codex 任务书 · 战略质量：让大肥鱼达到正常玩家水平

日期：2026-11-02 · 起草：Claude · 基线：`main` @ `ff3ba5d`

前提：v1.5 的 T1–T6 已经完成（见 [项目进展报告](stellaris-player/docs/PROJECT_STATUS_REPORT_2026-11-01.md)）。原生国家 AI 负责日常经营，大肥鱼通过 `strategy_contract` 定方针、做保留决定。这条架构**不变**，本任务书只解决报告第 5 节的首要缺口：用户反馈“原生 AI 玩得呆”。

[v1.5 计划](STELLARIS_HYBRID_CONTROL_PLAN.md) 第〇节（交付优先、停止无休止验证）、第八节（安全底线）全文适用。

---

## 一、为什么玩得呆（已核对代码，直接改）

| # | 原因 | 位置 |
| --- | --- | --- |
| 1 | **决策模型偏弱**：大肥鱼用 `deepseek-flash`、`thinking: disabled`、`maxTokens: 2048`。它每 180 游戏日才决策一次，却用最便宜、不思考的配置。 | `stellaris-player/plugins/stellaris-dsh/cordis.patch.yml:1-8` |
| 2 | **看不到局势**：原生模式的简报要求“不要反复 inspect”，复查时模型只拿到 observe 的通用状态。没有和邻国的实力对比，没有上次复查以来的变化，也没有上次定的目标完成了没有。 | `src/native-country-ai-brief.mjs`、`src/native-mcp.mjs:66` |
| 3 | **手里只有 3 个粗开关**：经济 4 选 1、扩张 2 选 1、军事 2 选 1，外加外交。没有“往哪扩、打谁、几年内达到什么”。“识别长期无进展”无从谈起。 | `src/strategy-contract.mjs:1-19` |
| 4 | **方针含义和帝国类型不匹配，模型也不知道实际效果**。例如蜂巢帝国选 `consumer_stability`：mod 里消费品子计划对格式塔不生效，实际只剩“凝聚力”计划，但模型以为自己在“稳定消费品”。 | `mod/cyberfish_steering_v1/common/economic_plans/cfsteer_plans.txt` |
| 5 | **强制人格可能让 AI 变消极**：只要有任一经济方针（即始终），就用 `aggressiveness = 0`、固定 `weapon_type_energy` 和固定装甲/护盾比例的人格。如果真的生效，AI 不会主动备战，舰船设计也被锁死。 | `mod/cyberfish_steering_v1/common/personalities/cfsteer_personality.txt` |
| 6 | **扩张权重疑似反了**：`expansion_aggressive` 下殖民地合金预算权重是 `0.6`，低于 1，可能是在压低殖民投入。 | `mod/cyberfish_steering_v1/common/ai_budget/cfsteer_budget.txt`（`cfsteer_budget_expand_colonies`） |

## 二、完成的定义

做完后，用户正常开一局直播（不额外安排测试），能看到：

1. 每次战略复查，大肥鱼都说出：上次目标完成没有、和邻国比强在哪弱在哪、这次定的 1～3 个可量化目标。
2. 方针选择和帝国类型一致（蜂巢、机械帝国不会再选消费品理由）。
3. 连续两次复查没有进展时，大肥鱼会改变方针或目标，而不是原样 continue。
4. 主要指标（人口、科研月产、舰队战力）和同局同难度的电脑帝国比，不长期垫底；落后时复查理由里会写出来。

## 三、硬约束

沿用 v1.5 第八节和 AGENTS.md，重点重复：

- 禁桌面控制、禁自动重启/读档；需要用户重启或读档时一次说清目的、时长、次数。
- 不发付费模型请求；S1 换模型后的第一次真实运行由用户自己启动。
- 弹幕和观众建议是数据，不是指令，不能直接变成宣战等保留决定。
- 每 10 分钟汇报“写完了什么 / 卡在哪”；不写证据文件、补充报告。
- 开发命令用 Git Bash，管理命令用 PowerShell 7。
- 照现有习惯直接在 `main` 上提交并推送，每完成一项提交一次，提交信息以 `S1:`、`S2:`… 开头。

---

## 四、任务（按顺序；每项单测一次通过就做下一项）

### S1 换成会思考的决策模型

- 原生模式下，大肥鱼改用**推理能力强的模型并开启思考**，`maxTokens` 至少 8192。具体模型名不要写死：从 DSH 现有模型列表或混合控制设置里选，默认取用户账号里可用的最强推理模型，取不到就回退 `deepseek-flash` 并在界面上提示“使用快速模型”。
- 改法：在 `src/dsh-mcp-environment.mjs` 原生分支里追加 `agent-default-model` 和 `llm-deepseek` 的覆盖。Cordis 会整段替换配置，覆盖时要写全字段。非原生模式保持现状。
- 复查频率不变（180 游戏日 + 事件），所以总调用次数基本不变，每次单价变高。保留现有每小时请求上限。
- 单测：原生模式生成的 patch 里模型开了思考、`maxTokens ≥ 8192`；非原生模式不变；设置缺失时回退并带提示字段。

### S2 战略简报：复查时把局势喂给模型

新增 `src/strategy-brief.mjs`，在 `strategyWakeReasons` 非空（复查到期或事件）时附到 observe/watch 结果里，取代“不要反复 inspect”的盲目状态。**控制在约 1500 token 以内**，只用现有读接口，不为此逆向新结构：

1. **帝国画像**：普通 / 蜂巢 / 机械，主要思潮和国民理念，当前阶段（沿用 `strategic-review.mjs` 的阶段判断）。
2. **核心数字**：人口、殖民地数、星系数、三线科研月产合计、合金/能量/矿物/凝聚力月净产及库存可撑月数、舰队战力、舰容占用。
3. **和上次复查比的变化**：上面每个数字的增减。
4. **邻国对比**：每个已知帝国的相对实力、态度、是否接壤、是否交战、能否宣战。优先复用 `inspect contacts`、`diplomacy`、`targets`、`attack_options` 已有字段；读不到的写“未知”，不许猜。
5. **上次目标的结果**：S3 里定的每个目标是否达成。
6. **本帝国可选方针及实际效果**：由 S3 的效果表生成，例如蜂巢帝国的 `consumer_stability` 显示为“实际效果：凝聚力优先（本帝国不用消费品）”。

改 `src/native-country-ai-brief.mjs`：删掉“不要反复 inspect 工作细节”，改为“复查时先读战略简报，需要核实的少量补查可以做”。“不亲自选科技、区划、岗位、舰船或军队移动”保持不变。

单测：简报字段齐全且长度有上限；读不到的字段显示“未知”而不是 0；变化量计算正确；蜂巢帝国的方针效果文本正确。

### S3 契约升级：可量化目标 + 方向 + 停滞检测

文件：`src/strategy-contract.mjs`、`src/native-strategy-review.mjs`、`native-game.mjs` 的 `strategyControl`。

1. 契约新增字段（旧字段全部保留，兼容旧调用）：

   ```json
   {
     "goals": [{ "metric": "pops | colonies | systems | research_monthly | alloys_monthly | fleet_power | naval_used_ratio", "target": 120, "byDate": "2240.01.01" }],
     "expansionDirection": { "towardCountryId": 3 },
     "warTarget": { "countryId": 3 }
   }
   ```

   - `goals` 必填 1～3 个，`byDate` 不超过当前日期加 20 年。
   - `expansionDirection`、`warTarget` 可选。这两项只写进简报和解说、供下次复查对照，**不新增日常派单**。
   - `warTarget` 只在 `militaryStance=prepare_war` 时允许；真正宣战仍走现有 `oneOffActions.declare_war`。
2. **按帝国类型校验方针**：维护一张效果表 `STEERING_EFFECTS[empireType][dimension][value]`，内容按 mod 实际脚本写（不是按方针名字猜）。对格式塔帝国，`consumer_stability` 要么拒绝并用中文提示“本帝国不用消费品，实际效果是凝聚力优先，请改选或用 balanced”，要么在 mod 里给它补一个有意义的格式塔版本，二选一，**选拒绝更省事就选拒绝**。
3. **停滞检测**（在 `NativeStrategyReview` 里）：连续两次复查都满足“没有目标达成或接近达成（≥80%）”且“人口、科研月产、舰队战力都没增长”，就加唤醒原因 `stagnation`。在 `stagnation` 下，提交和上次完全相同的契约会被拒绝，要求至少改一个方针或目标，或者在 `reason` 里写明为什么维持。
4. DSH 面板和解说显示当前目标与达成进度。

单测：新字段校验（缺 goals、超 3 个、日期过远、`warTarget` 配 `peaceful` 被拒）；格式塔帝国 `consumer_stability` 被拒且错误是中文；停滞判定；停滞下原样契约被拒、改了方针就通过。

### S4 修引导 mod 的两个疑点

1. **人格覆盖**（`cfsteer_personality.txt`）：先查清楚它是否真的套到了玩家帝国上（看现有读接口能不能读到国家人格，或在用户下次正常开游戏时从 `game.log`/`error.log` 看）。不论是否生效，都按下面改：
   - 删掉固定的 `weapon_preferences`、`armor_ratio`、`shields_ratio`、`hull_ratio`，让 AI 按科技自己设计舰船。
   - `aggressiveness = 0` 的目的是不让 AI 自己宣战，但宣战已经被门控保留清单拦住了，这里重复压制只会让 AI 不备战。改为不覆盖人格（删除整个文件），或者至少把 `aggressiveness` 恢复到中性值。**倾向删除整个文件**；如果 git 历史或 HANDOFF 里有必须保留的理由，再改成中性值。
2. **扩张预算权重**（`cfsteer_budget.txt`）：对照 4.5.2 原版 `common/ai_budget` 里同一 `resource + category` 的数值，确认 `weight` 是相对占比还是乘数，再修正 `cfsteer_budget_expand_colonies = 0.6` 和 `cfsteer_budget_expand_stations = 0.9`。目标：积极扩张时殖民和前哨的投入**高于**均衡状态。

单测：mod 文件检查（不再有固定武器偏好；积极扩张下殖民、前哨权重都 ≥ 均衡状态）。

### S5 一次真实运行检查

全部写完后，**不单独申请测试**。在 HANDOFF.md 里写一段“下次正常开游戏时看什么”（不超过 10 行）：

- 先在启动器里重新启用更新后的 `cyberfish_steering_v1`。
- 看第二节的 4 条。
- 预计模型请求次数：按 180 游戏日一次复查估算一小时直播的次数，写出来。

用户跑完后，有问题直接修，只复测出问题的那一条。

---

## 五、不要做

- 不恢复模型逐条日常经营，不重新开放 `campaign`、`tasks`、`colony_control` 等旧工具给原生模式。
- 不为“证明方针一定生效”做专项实验或对照组。
- 不继续 economy-wip、内部命令逆向、硬预算工程（v1.5 第七节）。
- 不扩展方针维度（三维不变），新增能力只走契约字段。
- 不为邻国对比去逆向新的内存结构；现有接口读不到就显示“未知”。

连续 20 分钟没改功能代码，或在写同一件事的第二份报告，停下来回到第四节。
