#include "fleet_automation.hpp"
#include "fleet_access.hpp"
#include "game_state.hpp"
#include "command_builder.hpp"
#include "survey_layout.hpp"
#include "galaxy_manager.hpp"
#include <algorithm>
#include <set>
#include <array>

namespace bridge {
namespace {
template<class T> bool Read(uintptr_t address, T& value) {
    __try { value = *reinterpret_cast<const T*>(address); return true; }
    __except (EXCEPTION_EXECUTE_HANDLER) { return false; }
}
struct CloneContext { uintptr_t fn; const void* source; void* result; };
void CloneAutomation(void* ctx, void*) {
    auto* c=static_cast<CloneContext*>(ctx);
    c->result=((void*(*)(const void*))c->fn)(c->source);
}
}

nlohmann::json GetFleetAutomation(const nlohmann::json& params) {
    nlohmann::json result = {{"known",false},{"automation_enabled",nullptr},
        {"configuration_complete",false},{"read_only",true}};
    auto fail = [&](const char* reason) { result["error"] = reason; return result; };
    if (!params.contains("fleet_id") || !params["fleet_id"].is_number_integer())
        return fail("需要完整的己方科研舰队ID");
    const auto id64 = params["fleet_id"].get<int64_t>();
    if (id64 < 0 || id64 >= 0xFFFFFFFFLL) return fail("舰队ID无效");
    const auto id = static_cast<uint32_t>(id64);
    result["fleet_id"] = id;
    const auto base = CommandBuilder::Get().Base();
    if (!SdkMatchesImage(base) || !survey_layout::Matches(base)) return fail("自动调查布局指纹不匹配");
    auto* country = GameState::Get().GetPlayerCountry();
    if (!country) return fail("当前没有玩家帝国");
    const auto owned = fleets::Owned(country);
    if (std::find(owned.begin(), owned.end(), id) == owned.end()) return fail("舰队不属于当前玩家");
    auto* fleet = fleets::Find(base,id);
    if (!fleet || fleets::ClassOf(fleet) != fleets::ShipClass::ScienceShip)
        return fail("目标不是当前己方科研船");
    uintptr_t node=0, sentinel=0;
    if (!Read(base+survey_layout::NullGlobal,sentinel) || sentinel < 0x10000 ||
        !Read(reinterpret_cast<uintptr_t>(fleet)+survey_layout::Root,node))
        return fail("无法读取真实订单链");
    std::set<uintptr_t> seen;
    auto orders=nlohmann::json::array();
    size_t automation_count=0;
    while (node != sentinel) {
        if (node < 0x10000 || seen.size() >= 64 || !seen.insert(node).second)
            return fail("订单链无效或超出读取上限");
        uintptr_t vt=0,next=0;uint32_t token=0;
        if (!Read(node,vt) || !Read(node+survey_layout::Token,token) ||
            !Read(node+survey_layout::Next,next)) return fail("订单字段读取失败");
        nlohmann::json row={{"token",token},{"automation",vt==base+survey_layout::AutomationVtable}};
        if (vt==base+survey_layout::AutomationVtable) {
            uint16_t flags=0;int32_t option_count=0;
            if (!Read(node+0x70,flags) || !Read(node+0x54,option_count) || option_count<0 || option_count>128)
                return fail("自动化配置读取失败");
            row["settings_bits"]=flags;
            row["survey"]=(flags & 2)!=0;
            row["explore"]=(flags & 1)!=0;
            row["action_option_count"]=option_count;
            // Dynamic action names and exact settings semantics are not yet verified.
            row["options_known"]=false;
            ++automation_count;
        }
        orders.push_back(row);
        node=next;
    }
    result["known"]=true;
    result["automation_enabled"]=automation_count>0;
    result["automation_order_count"]=automation_count;
    result["order_chain_complete"]=true;
    result["orders"]=orders;
    result["configuration_complete"]=automation_count==0;
    return result;
}

nlohmann::json SetSurveyAutomation(const nlohmann::json& params) {
    if (!params.contains("enabled") || !params["enabled"].is_boolean() ||
        (params.contains("execute") && !params["execute"].is_boolean()))
        return {{"success",false},{"error","需要明确的enabled布尔值"}};
    const auto state=GetFleetAutomation(params);
    if (!state.value("known",false)) return {{"success",false},{"state",state},{"error","自动化状态未知，禁止更改"}};
    const auto id=state["fleet_id"].get<uint32_t>();
    const bool enabled=params["enabled"].get<bool>(), execute=params.value("execute",false);
    const bool active=state["automation_enabled"].get<bool>();
    if (!enabled && !active) return {{"success",true},{"changed",false},{"state",state},{"status","already_disabled"}};
    if (enabled && active) return {{"success",false},{"error","已有自动化订单，先核对并收回控制权"},{"state",state}};
    if (enabled && !state["orders"].empty()) return {{"success",false},{"error","科研船已有订单，禁止覆盖"},{"state",state}};
    if (!enabled) {
        if (!execute) return {{"success",true},{"execute",false},{"status","cancel_candidate"},{"state",state}};
        auto result=GalaxyManager::Get().CancelFleetOrders({id});
        result["status"]="pending_confirmation";
        result["completed"]=false;
        return result;
    }
    auto& builder=CommandBuilder::Get();const auto base=builder.Base();
    // Construct the same empty value as the verified UI constructor, then use
    // the engine's deep clone. The borrowed arrays are empty and never escape.
    alignas(8) std::array<unsigned char,0x78> borrowed{};
    auto put=[&](size_t off,auto value){memcpy(borrowed.data()+off,&value,sizeof(value));};
    uintptr_t sentinel=0;
    if (!Read(base+survey_layout::NullGlobal,sentinel)||!sentinel)
        return {{"success",false},{"error","无法读取空订单对象"}};
    put(0,base+survey_layout::AutomationVtable);put(8,sentinel);
    put(0x10,uint16_t(0x100));put(0x12,uint32_t(0xFFFFFFFF));
    put(0x18,uint32_t(0x4630));put(0x1C,uint32_t(0xFFFFFFFF));
    for(size_t i=0;i<3;++i)put(0x28+0x18*i,base+survey_layout::ArrayVtables[i]);
    put(0x70,uint16_t(2)); // survey only; explore and all other tasks disabled
    namespace q=sdk::cmd::queue_fleet_order_command;
    auto command=builder.Create(q::kSpec);
    if(!command)return {{"success",false},{"error",command.error()}};
    CloneContext context{base+survey_layout::Clone,borrowed.data(),nullptr};
    if(!builder.CallGuarded(CloneAutomation,&context)||!context.result)
        return {{"success",false},{"error","自动化订单构造失败"}};
    command.Set<uint32_t>(q::country,GameState::Get().GetPlayerCountryId())
        .Set<uint32_t>(q::fleet,id).Set<uint32_t>(q::queue,0).Set<void*>(0x30,context.result);
    std::string why;
    if(!command.IsValid(&why))return {{"success",false},{"error",why},{"execute",false}};
    if(!execute)return {{"success",true},{"execute",false},{"status","legal_candidate"},{"completed",false}};
    if(!command.Post())return {{"success",false},{"error",command.error()}};
    return {{"success",true},{"status","pending_confirmation"},{"completed",false},{"fleet_id",id}};
}
}
