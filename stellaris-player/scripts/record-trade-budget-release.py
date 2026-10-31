"""Attach new runtime acceptance separately from immutable candidate evidence."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
root = Path(__file__).resolve().parents[1]
report_path = '.local/trade-budget-acceptance-1793416847940/report.json'
report = json.loads((root / report_path).read_text(encoding='utf-8'))
assert report['passed'] and report['selected']['crossesLegacyFloor']
assert report['before']['date']['formatted'] == report['after']['date']['formatted']
assert report['cleanup']['pauseConfirmed'] and report['cleanup']['bindingConfirmed']
runtime = root / '.local/native-bridge/runtime/cyberfish-0.6.12-trade-budget-r1'
candidate = json.loads((runtime / 'candidate.json').read_text(encoding='utf-8'))
assert hashlib.sha256((runtime / 'stellaris_bridge.dll').read_bytes()).hexdigest() == candidate['dllSha256']
files = ['src/native-bootstrap.mjs', 'src/native-game.mjs', 'src/bridge-capabilities.mjs', 'src/monthly-trade-execution.mjs', 'src/trade-spending-policy.mjs', 'src/market-maintenance.mjs', 'src/dsh-mcp-environment.mjs', 'scripts/play-native-dsh.mjs', 'native/research/load_native_bridge.py', 'scripts/accept-trade-budget.mjs']
release = {'recordedAt': datetime.now(timezone.utc).isoformat(), 'version': candidate['version'], 'dllSha256': candidate['dllSha256'], 'runtimeValidated': True, 'productionDefault': True, 'report': report_path, 'gamePid': 38980, 'gameDate': '2202.07.01', 'gameTimeAdvanced': False, 'actualTransactions': 1, 'details': {'food': [3062,2962], 'settlement': [1971.51,2041.51], 'units': 100, 'engineFeeInclusiveTotal': 70}, 'offlineEvidence': {'adapterAndMcpTests': {'passed': 38, 'log': '.local/trade-budget-production-tests.log'}, 'loaderTests': {'passed': 14, 'log': '.local/trade-budget-production-loader-tests.log'}}, 'sourceHashes': {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in files}, 'limits': ['One paused surplus sale and readback; not full long-run or all trade directions.', 'No new desktop build: desktop source unchanged, previous checks reused.', 'Military projected maintenance and other operating areas remain outside this acceptance.']}
for name in ['runtime-acceptance.json', 'production-activation.json']:
 (runtime / name).write_text(json.dumps(release, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
note = """## 2026年10月31日：动态贸易已真实成交，0.6.12提升为默认桥

用户真正重启后为新进程38980（11:19启动），0.6.12加载及功能核验成功，基础档暂停日期2202.07.01。单笔卖出食物100：库存3062→2962，结算币1971.51→2041.51，真实整笔含费报价70与实际增减完全相符，突破旧3000固定库存门槛。报告.local/trade-budget-acceptance-1793416847940/report.json通过，停止pauseConfirmed/bindingConfirmed=true，日期不变，未调用模型、未操控桌面。

这补齐了本批控制器→原生末次预算检查→真实成交→结果回读→停止链路。生产默认已改为cyberfish-0.6.12-trade-budget-r1，固定SHA256=84c5e4c4a5e062a85a59448ae5b5f69a1a36e00dc561b1517f9432be18ef4758；同目录runtime-acceptance.json/production-activation.json记录当前结果，编译时candidate.json保持原始待验收状态不重写。原始旧桥拒单、沙箱失败及未真正重启的报告全部保留。

现有DSH入口直接使用本机更新源码；生产路径/MCP环境38项、加载器14项通过，日志.local/trade-budget-production-tests.log及.local/trade-budget-production-loader-tests.log。原生政策边界和前批交易/停止证据继续适用，不累加重叠测试。桌面源码未改，无新增桌面构建或目视验收；无需安装包。明确tradeBudget:false可回退0.6.11；monthlyTrade:false保留旧基础模式。基础模式可复用的已审查版本含当前桥共五代，加载器界限同步为5，仍逐项核验路径和指纹。

本轮只有1笔实际成交，不能推定所有买入、各种储备边界或长期维护行为均实机通过。当前无需继续保持游戏或再次读档；下一项离线补海军软容量维护评估的实际数据来源，不能仅凭容量比例猜新增维护。其他经营领域、30/60分钟长测和效率目标仍未冒称完成。

"""
for name in ['混合控制实施记录.md', '混合控制统一验收清单.md', '混合控制核心验收映射.md']:
 p = root / 'docs' / name
 old = p.read_text(encoding='utf-8')
 if note.split('\n',1)[0] not in old:
  title, rest = old.split('\n',1)
  p.write_text(title+'\n\n'+note+rest.lstrip('\n'),encoding='utf-8')
plan = root.parent / 'STELLARIS_HYBRID_CONTROL_PLAN.md'
old=plan.read_text(encoding='utf-8')
header="""# 大肥鱼群星混合控制实施计划

当前交付：现有DSH入口已接通混合调查、真实月度设置/调整/撤销与条件收回、有预算住房与建筑升级、可信队列最长60秒等待。默认桥已提升至0.6.12，动态即时贸易真实成交通过：暂停2202.07.01卖食物100，3062→2962、结算币+70与整笔含费报价一致，停止确认、日期不变。旧桥重复固定门槛已在控制器及原生两层修复；旧失败报告保留。详见stellaris-player/docs/混合控制实施记录.md顶部。

最新P3批次还修复在途普通命令与停止清理争用连接、显式传递DSH最终MCP开关、桥回退兼容列表界限。相关182项、最后生产路径/MCP38项、加载器14项通过（重叠不累加）。当前无需游戏或读档，继续海军软容量的新增维护评估及其他离线经营能力。完整经营范围、长期效率指标和30/60分钟长测尚未全验收，长期目标继续，不将单笔验收冒称全部完成。

"""
plan.write_text(header+old[old.index('版本：1.3'):],encoding='utf-8')
usage=root/'docs/混合控制核心版使用说明.md'
old=usage.read_text(encoding='utf-8')
title='## 动态即时贸易的当前交付边界'
section="""## 动态即时贸易的当前交付边界

当前默认0.6.12桥和控制器都按真实整批含费报价、实际维护、任务承诺及战略底线判断，不再要求固定500储备或库存容量20%。维护保护取实际支出周期与三个月净亏损中的较大者；接收按真实容量检查，未知数据不能授权交易。market查询额度仅为建议，最终提交仍复核报价和实时资源。新桥已真实卖出食物100并回读库存与结算币增减，游戏时间不推进；尚未据此宣称全部买入和储备边界实机通过。

旧0.6.11桥仍有固定门槛，查询会提示当前桥能力，模型不应更换requestId反复尝试同一拒单。启动入口默认选择已通过的0.6.12；已载旧桥需用户手动重启，控制器不热替换、不自动关闭或读档。源码参数tradeBudget:false可回退0.6.11。停止先等在途普通命令收束，再暂停清理。
"""
if title in old: old=old[:old.index(title)]+section
else: old+='\n'+section
old=old.replace('默认桥已更新为cyberfish-0.6.11-upgrade-paths-r1，固定DLL SHA256为2da799dc0857599f726a76e6f0c67e93107da4ed6ea3e374220e450e60d2b5be','默认桥已更新为cyberfish-0.6.12-trade-budget-r1，固定DLL SHA256为84c5e4c4a5e062a85a59448ae5b5f69a1a36e00dc561b1517f9432be18ef4758')
usage.write_text(old,encoding='utf-8')
p=root/'.local/hybrid-control/pending-validation.json'
d=json.loads(p.read_text(encoding='utf-8'))
d['nativeTradeBudgetRepair'].update({'runtimeValidated':True,'productionDefault':True,'runtimeEvidence':report_path,'userActionPending':None,'productionActivation':str((runtime/'production-activation.json').relative_to(root))})
d['nextWork']={'priority':'P3_naval_soft_capacity','scope':'Find actual projected ship upkeep and affordable planned soft-cap path; no guessed multipliers, continue independent implementation.','requiresGameNow':False}
d['updatedAt']=datetime.now(timezone.utc).isoformat()
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Recorded real trade acceptance, production default and remaining scope.')
