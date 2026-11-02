#pragma once
#include <cstdint>
#include <string_view>
namespace bridge::cyberfish {
enum class NativeRoutineCommand { Unknown, ResearchTechnology, AddBuildable, WorkforceLimit, ColonyDesignation };
enum class NativeRoutineBuildable { Unknown, Building, District, BuildingUpgrade, Zone, Ship, ColonyShip };
struct NativeRoutineRequest {
    NativeRoutineCommand command=NativeRoutineCommand::Unknown;
    NativeRoutineBuildable buildable=NativeRoutineBuildable::Unknown;
    uint32_t actor=0xffffffffu;
    uint32_t queue=0xffffffffu;
    bool technologyPresent=false;
    bool targetOwned=false;
    bool definitionPresent=false;
    bool queueOwned=false;
    bool targetProtected=false;
    std::string_view name="unknown";
    bool steeringSetting=false;
    bool ownerPolicyBlocked=false;
};
enum class ReservedPolicy { FullWithReserved, Suspended };
// Exact decision names: do not match "resolution"/"council" broadly. Engine
// resolution settlement and the empire's ordinary council agenda must keep running.
inline constexpr std::string_view kReservedNativeDecisions[]{
    "diplo_action_propose_command", "diplo_action_respond_command",
    "diplo_action_vote_command", "diplo_action_start_proxy_war_command",
    "cast_vote_command", "support_proposed_resolution_command",
    "oppose_proposed_resolution_command", "remove_support_for_proposed_resolution_command",
    "propose_resolution_command", "withdraw_proposed_resolution_command",
    "veto_resolution_command", "borrow_diplo_weight_for_resolution_command",
    "join_community_command", "leave_community_command",
    "propose_emergency_measure_command", "freeze_proposed_resolution_command",
    "end_senate_session_command"
};
inline bool IsReservedNativeDecision(std::string_view name) {
    for(const auto reserved:kReservedNativeDecisions)if(name==reserved)return true;
    return false;
}
inline bool AllowNativeRoutine(const NativeRoutineRequest& request,uint32_t own,
    ReservedPolicy policy=ReservedPolicy::FullWithReserved) {
    if(request.actor!=own)return true;
    if(policy==ReservedPolicy::Suspended||request.targetProtected||request.ownerPolicyBlocked)return false;
    const auto name=request.name;
    if(IsReservedNativeDecision(name))return false;
    if(request.steeringSetting&&(name=="add_policy_command"||name=="add_edict_command"||name=="remove_edict_command"))return false;
    return true; // Unknown commands and native internal maintenance run normally.
}
}
