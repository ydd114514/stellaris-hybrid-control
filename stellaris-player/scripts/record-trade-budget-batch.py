"""Record scoped offline evidence without replacing prior runtime evidence."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[1]
note = """## 2026年10月31日：P3即时贸易动态预算与在途停止保护

即时交易已改为真实整批含费报价、实际维护和共享预留判断。保留一个真实支出周期与三个月净亏损缓冲中较大者，保护其他任务承诺及战略底线；自身任务额度只扣除一次，不将未来卖出收益计作现金。移除固定500货币、库存容量20%、12个月卖出储备及95%/98%接收伪上限。未知维护、库存、容量或报价身份仍拒绝；接收以真实容量为限。例行高水位卖出仍有数量目标和滞回，仅为建议，不能授权执行。

最终派单在持久意图写入后复核当前资源/承诺；暂停会话下五秒内复用同一整批报价，超过期限或时钟回退重新报价。market查询现提供资源和结算币可用预算及保护组成，明确标记建议，真实执行仍核对整批报价。恢复采购改为战略底线加三个月净亏损，不再固定额外买24个月。新增规则尚未实机验证；本批没有游戏调用、模型调用、读档或桌面操作。

新增竞态回归先证明停止清理会越过未完成的普通命令，失败日志.local/trade-stop-before-fix.log保留。现已串行化普通提交，停止先等在途提交收束，再暂停清理，避免并发争用单连接。相关182项通过（.local/market-budget-delivery-tests.log）；最后输入约束和MCP环境10项通过（.local/market-budget-final-targeted.log），有重叠不累加。

DSH最终MCP配置现显式传递升级、月度条件与可信等待开关，调查对照强制关闭试点。当前已安装DSH插件本来会合并清理后的父环境，不能断言旧入口丢失开关；这次是减少继承依赖的加固。仅使用最终配置环境的隔离MCP子进程真实返回升级工具、月度条件和60秒等待契约，关联11项通过；没有付费DSH模型端到端测试。桥DLL及桌面源码未改，沿用上一批适用的桌面20项/类型/构建证据。

下一项继续审查海军容量软上限与维护评估，不能只删拒绝条件或虚构新增维护。新交易行为的必要实机验证合并至下一次确需游戏的验收，不为文案和小改动追加读档。

"""
for name in ['混合控制实施记录.md', '混合控制统一验收清单.md', '混合控制核心验收映射.md']:
    path = root / 'docs' / name
    old = path.read_text(encoding='utf-8')
    title, rest = old.split('\n', 1)
    if note.split('\n', 1)[0] not in old:
        path.write_text(title + '\n\n' + note + rest.lstrip('\n'), encoding='utf-8')

plan = root.parent / 'STELLARIS_HYBRID_CONTROL_PLAN.md'
old = plan.read_text(encoding='utf-8')
current = """# 大肥鱼群星混合控制实施计划

当前交付：现有DSH入口已接通混合调查、真实月度设置/调整/撤销及条件收回、有预算住房与建筑升级、可信队列最长60秒等待。默认桥0.6.11；真实升级、替换实例完工和旧月度显式恢复已有分阶段证据。详见stellaris-player/docs/混合控制实施记录.md，不将警报中断的脚本改为整轮通过。

最新P3修改：即时交易改用真实整批含费报价、实际维护、共享承诺和战略底线，消除固定500/20%容量/12个月旧门槛；修复停止清理越过在途普通提交的竞态；显式传递DSH最终MCP开关。182项相关定向通过，最终输入/MCP配置10项通过（重叠不累加），新增交易规则尚未实机验证。本批无游戏或模型调用，无需读档。下一优先级：海军容量软限制的真实维护评估，集中离线实现再合并必要验收。长期效率指标、30/60分钟长测及其他经营类别尚未全验收，完整目标继续。

"""
plan.write_text(current + old[old.index('版本：1.3'):], encoding='utf-8')

path = root / '.local/hybrid-control/pending-validation.json'
manifest = json.loads(path.read_text(encoding='utf-8'))
files = ['src/trade-spending-policy.mjs', 'src/market-maintenance.mjs', 'src/native-game.mjs', 'src/dsh-mcp-environment.mjs', 'scripts/play-native-dsh.mjs', 'scripts/validate-hybrid-unified.mjs', 'test/trade-spending-policy.test.mjs', 'test/market-maintenance.test.mjs', 'test/native-game.test.mjs', 'test/dsh-mcp-environment.test.mjs']
manifest['tradeBudgetBatch'] = {
    'recordedAt': datetime.now(timezone.utc).isoformat(),
    'offlineValidated': True, 'newTradeBehaviorRuntimeValidated': False,
    'gameCalls': 0, 'modelCalls': 0, 'manualLoads': 0,
    'tests': {'related': {'passed': 182, 'log': '.local/market-budget-delivery-tests.log'}, 'finalTargeted': {'passed': 10, 'log': '.local/market-budget-final-targeted.log'}, 'countsOverlap': True},
    'stopRaceFailureLog': '.local/trade-stop-before-fix.log',
    'mcpEnvironment': 'Explicit flags verified with isolated final-config MCP child; installed DSH currently also merges scrubbed parent environment. No paid host/model end-to-end test.',
    'sourceHashes': {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in files},
}
manifest['nextWork'] = {'priority': 'P3_naval_soft_capacity', 'scope': 'Assess actual upkeep evidence and implement planned soft-cap admission without inventing costs; batch offline changes before necessary runtime validation.', 'requiresGameNow': False}
manifest['updatedAt'] = datetime.now(timezone.utc).isoformat()
path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Recorded scoped trade/stop/MCP evidence and current plan priorities.')
