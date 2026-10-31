"""Record actual native refusal and prepared candidate, without claiming acceptance."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
root = Path(__file__).resolve().parents[1]
note = """## 2026年10月31日：短测发现原生重复门槛，0.6.12候选已修复待加载

在旧进程40712、暂停日期2204.04.05做了一次最短定向检查：矿物1680.77、净流量+46.94、实际支出36，卖100的真实含费报价70。控制器按动态预算允许，但0.6.11原生桥仍因旧max(500,20%容量,12个月净亏损)拒绝，未成交；报告.local/trade-budget-acceptance-1793416465545/report.json保留为失败。停止回读pauseConfirmed/bindingConfirmed=true。首次沙箱无法核验管道归属也保留报告1793416452991，不改写为通过。

现已修复桥内交易末次检查：真实支出周期与三个月净亏损取较大者、真实接收容量、库存/维护/净流量可知性，不叠加固定500或容量比例。新增expense_known区分读取失败与实际零；控制器仍额外保护任务承诺和战略底线。没有新增内存偏移或引擎调用，仍通过既有主线程普通交易命令。原生政策边界1个CTest、适配层33项和加载器14项通过；相关日志为.local/native-market-policy-tests/Testing/Temporary/LastTest.log、.local/trade-budget-bridge-final-tests.log、.local/trade-budget-loader-tests.log，重叠不累加。

Release候选cyberfish-0.6.12-trade-budget-r1已独立快照，DLL SHA256=84c5e4c4a5e062a85a59448ae5b5f69a1a36e00dc561b1517f9432be18ef4758。默认生产仍0.6.11；0.6.12只供显式验收，不热替换已载桥。统一脚本scripts/accept-trade-budget.mjs --load-candidate只做最多100单位单笔盈余卖出，保持暂停、日期不变、确认结果并停止，不调用模型。

用户第一次回复已载入后，核对仍为旧PID40712（10:01启动），加载器正确拒绝换桥，未发送交易，报告.local/trade-budget-acceptance-1793416765192/report.json。已说明需要真正退出程序再启动，目的1–2分钟、重启1次/读档1次。海军软容量后续缺口为新增维护报价，当前只具真实舰容/造价，不能虚构维护后放行。

基础模式桥兼容列表原有3项但加载器限2，已修复为明确四代上限，并补回0.6.10路径；只复用已加载、显式路径与已审查哈希，不加载任意替代库。初次旧上限测试失败记录.local/bridge-reuse-python-before-bound-update.log保留，最终14项已含更新后的边界及候选指纹。

"""
for name in ['混合控制实施记录.md', '混合控制统一验收清单.md', '混合控制核心验收映射.md']:
 p = root / 'docs' / name
 old = p.read_text(encoding='utf-8')
 if note.split('\n', 1)[0] not in old:
  title, rest = old.split('\n', 1)
  p.write_text(title + '\n\n' + note + rest.lstrip('\n'), encoding='utf-8')
plan = root.parent / 'STELLARIS_HYBRID_CONTROL_PLAN.md'
old = plan.read_text(encoding='utf-8')
header = """# 大肥鱼群星混合控制实施计划

当前可用交付：现有DSH入口已接通混合调查、真实月度设置/调整/撤销与条件收回、有预算住房与建筑升级、可信队列最长60秒等待。生产默认桥仍0.6.11，既有实机与分阶段证据见实施记录。

最新P3状态：控制器动态贸易预算和在途停止保护已通过定向检查；短测发现0.6.11桥内仍有重复固定库存门槛，实际矿物卖100被拒绝、未成交。原生修复已完成、0.6.12候选Release/原生边界/适配33项/加载器14项通过，尚未实机加载，不把源码改动算成交成功。下一步在用户真正重启并载入后，做1–2分钟、最多100单位的暂停单笔验收，重启1次/读档1次，不推进时间、不跑十分钟对照。首次回复仍是旧进程40712，已明确说明。本机入口保持旧桥，候选通过后再提升默认。海军新增维护报价及后续经营范围继续推进，长期目标未完成。

"""
plan.write_text(header + old[old.index('版本：1.3'):], encoding='utf-8')
usage = root / 'docs/混合控制核心版使用说明.md'
old = usage.read_text(encoding='utf-8')
title = '## 动态即时贸易的当前交付边界'
if title not in old:
 usage.write_text(old + '\n' + title + '\n\n控制器已接通真实维护、任务承诺、战略底线及整笔含费报价预算；market查询提供建议额度。当前默认0.6.11桥内部仍会使用旧固定库存门槛拒单，所以不能宣称新规则已在原生执行生效。0.6.12候选已编译，待用户手动重启后的单笔验收；通过后更新默认。失败或未确认均不盲目重发，停止会等待在途普通命令收束后清理。\n', encoding='utf-8')
p = root / '.local/hybrid-control/pending-validation.json'
d = json.loads(p.read_text(encoding='utf-8'))
files = ['src/native-bootstrap.mjs', 'src/bridge-capabilities.mjs', 'src/monthly-trade-execution.mjs', 'native/research/load_native_bridge.py', 'scripts/accept-trade-budget.mjs', 'scripts/prepare-trade-budget-bridge.py', 'test/native-bootstrap.test.mjs', 'test/native_bridge_loader_test.py', 'test/native_loader_policy_test.py', 'test/bridge-capabilities.test.mjs']
d['nativeTradeBudgetRepair'] = {'candidate': '.local/native-bridge/runtime/cyberfish-0.6.12-trade-budget-r1/candidate.json', 'runtimeValidated': False, 'productionDefault': False, 'actualOldBridgeRefusal': '.local/trade-budget-acceptance-1793416465545/report.json', 'loadedOldProcessRefusal': '.local/trade-budget-acceptance-1793416765192/report.json', 'userActionPending': 'Fully exit and restart game, then manually load baseline and pause;1-2minutes;1restart/1load', 'sourceHashes': {f: hashlib.sha256((root / f).read_bytes()).hexdigest() for f in files}}
d['nextWork'] = {'priority': 'P3_native_trade_budget_acceptance', 'scope': 'After user restart, paused one transaction and stop; meanwhile naval upkeep evidence can be investigated offline.', 'requiresGameNow': True, 'manualRestartRequired': True, 'notBlockingOtherImplementation': True}
d['updatedAt'] = datetime.now(timezone.utc).isoformat()
p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Recorded native refusal, candidate evidence and exact pending user action.')
