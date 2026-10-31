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
       name=="diplo_action_vote_command"||name=="diplo_action_start_proxy_war_command")return false;
    if(request.steeringSetting&&(name=="add_policy_command"||name=="add_edict_command"||name=="remove_edict_command"))return false;
    return true; // Unknown commands and native internal maintenance run normally.
}
}
