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
};
enum class ReservedPolicy { FullWithReserved, Suspended };
inline bool AllowNativeRoutine(const NativeRoutineRequest& request,uint32_t own,
    ReservedPolicy policy=ReservedPolicy::FullWithReserved) {
    if(request.actor!=own)return true;
    if(policy==ReservedPolicy::Suspended||request.targetProtected)return false;
    const auto name=request.name;
    if(name=="diplo_action_propose_command"||name=="diplo_action_respond_command"||
       name=="diplo_action_vote_command"||name=="diplo_action_start_proxy_war_command"||
       name=="cast_vote_command"||name=="support_proposed_resolution_command"||
       name=="oppose_proposed_resolution_command"||name=="remove_support_for_proposed_resolution_command"||
       name=="propose_resolution_command"||name=="withdraw_proposed_resolution_command"||
       name=="veto_resolution_command"||name=="borrow_diplo_weight_for_resolution_command"||
       name=="join_community_command"||name=="leave_community_command")return false;
    if(request.steeringSetting&&(name=="add_policy_command"||name=="add_edict_command"||name=="remove_edict_command"))return false;
    return true; // Unknown commands and native internal maintenance run normally.
}
}
