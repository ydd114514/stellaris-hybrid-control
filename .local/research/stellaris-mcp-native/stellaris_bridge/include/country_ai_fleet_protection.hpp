#pragma once
#include "sdk/stellaris_sdk.hpp"
#include <algorithm>
#include <cstdint>
#include <iterator>
#include <limits>
#include <set>
#include <string_view>

namespace bridge::cyberfish {

struct ProtectedFleetCommandField {
    std::string_view name;
    std::uintptr_t offset;
    bool array;
};

// Only the acting fleet fields named by the pinned Windows 4.5.2 SDK.
// A follow/attack target is not the fleet whose orders this command replaces.
// Return, move, repair and upgrade order subtypes also enter through the
// queue_fleet(s)_order payloads below; do not guess an inner order's layout.
inline constexpr ProtectedFleetCommandField kProtectedFleetCommandFields[]{
#define CF_FLEET_FIELD(command, field, isArray) {sdk::cmd::command::kSpec.name, sdk::cmd::command::field, isArray}
    CF_FLEET_FIELD(use_bypass_command, fleet, false),
    CF_FLEET_FIELD(follow_command, fleet, false),
    CF_FLEET_FIELD(mia_command, fleets, true),
    CF_FLEET_FIELD(change_fleet_name_command, fleet, false),
    CF_FLEET_FIELD(move_ships_to_fleet_command, fleet, false),
    CF_FLEET_FIELD(cancel_fleets_contract_command, fleet, true),
    CF_FLEET_FIELD(disband_fleets_command, fleet, true),
    CF_FLEET_FIELD(fleet_cancel_orders, fleets, true),
    CF_FLEET_FIELD(fleet_cancel_order, fleet, false),
    CF_FLEET_FIELD(fleet_fly_to_coordinates, fleet, false),
    CF_FLEET_FIELD(active_reconnaissance_command, fleet, false),
    CF_FLEET_FIELD(research_anomalies, fleet, false),
    CF_FLEET_FIELD(deactivate_cloaking, fleet, false),
    CF_FLEET_FIELD(activate_cloaking, fleet, false),
    CF_FLEET_FIELD(remove_fleet_variable_command, fleet, false),
    CF_FLEET_FIELD(clear_fleet_flag_command, fleet, false),
    CF_FLEET_FIELD(toggle_armada_command_state_command, fleet, false),
    CF_FLEET_FIELD(remove_fleet_from_armada_command, fleet, false),
    CF_FLEET_FIELD(add_fleet_to_armada_command, fleet, false),
    CF_FLEET_FIELD(terraform_fleet_command, fleet, false),
    CF_FLEET_FIELD(set_force_evasive_pathfinding_command, fleet, false),
    CF_FLEET_FIELD(capture_space_critter_command, fleet, false),
    CF_FLEET_FIELD(send_gravity_snare_command, fleet, false),
    CF_FLEET_FIELD(sustain_cosmic_storm_command, fleet, false),
    CF_FLEET_FIELD(initiate_cosmic_storm_command, fleet, false),
    CF_FLEET_FIELD(explore_astral_rift_fleet_order_command, fleet, false),
    CF_FLEET_FIELD(queue_fleets_order_command, fleets, true),
    CF_FLEET_FIELD(queue_fleet_order_command, fleet, false),
    CF_FLEET_FIELD(switch_space_fauna_growth_stance_command, fleet, false),
    CF_FLEET_FIELD(switch_fleet_stance_command, fleet, false),
    CF_FLEET_FIELD(excavate_archaeological_site_fleet_order_command, fleet, false),
    CF_FLEET_FIELD(collect_data_fleet_order_command, fleet, false),
    CF_FLEET_FIELD(merge_fleets_command, fleets, true),
    CF_FLEET_FIELD(lock_bypass_command, fleet, false),
    CF_FLEET_FIELD(explore_bypass_command, fleet, false),
    CF_FLEET_FIELD(build_megastructure_command, fleet, false),
    CF_FLEET_FIELD(rally_troops_command, fleet, false),
    CF_FLEET_FIELD(friends_should_follow_command, fleet, false),
    CF_FLEET_FIELD(assist_detection_command, fleet, false),
    CF_FLEET_FIELD(switch_mission_command, fleet, false),
    CF_FLEET_FIELD(queue_scripted_orders_command, fleet, false),
    CF_FLEET_FIELD(station_upgrade_design_command, fleet, false),
    CF_FLEET_FIELD(fleet_upgrade_design_command, fleet, false),
    CF_FLEET_FIELD(fleet_land_armies_command, fleet, false),
    CF_FLEET_FIELD(fleet_orbit_planet, fleet, false),
    CF_FLEET_FIELD(set_fleet_ground_support_stance_command, fleet, false),
    CF_FLEET_FIELD(research_anomaly_order, fleet, false),
    CF_FLEET_FIELD(survey_planet_order, fleet, false),
    CF_FLEET_FIELD(colonize_planet_order, fleet, false),
    CF_FLEET_FIELD(build_orbital_station_order, fleet, false),
    CF_FLEET_FIELD(fleet_send_to_location, fleet, false),
#undef CF_FLEET_FIELD
};

struct ProtectedFleetCommandMatch {
    bool recognized=false;
    bool known=true;
    bool targetProtected=false;
};

// Read has the same bool(address, T&) contract as the gate's checked Read.
// No engine calls, allocations, writes or inferred entity-reference offsets.
// A recognized but unreadable payload must be rejected by the caller rather
// than treated as an unprotected fleet; unrelated commands remain unchanged.
template<class Read>
ProtectedFleetCommandMatch MatchProtectedFleetCommand(std::string_view name,
    std::uintptr_t command,const std::set<std::uint32_t>& protectedRefs,Read&& read) {
    const auto* field=std::find_if(std::begin(kProtectedFleetCommandFields),
        std::end(kProtectedFleetCommandFields),[&](const auto& row){return row.name==name;});
    if(field==std::end(kProtectedFleetCommandFields))return {};
    ProtectedFleetCommandMatch result{true,true,false};
    if(protectedRefs.empty())return result;
    if(command<0x10000||command>std::numeric_limits<std::uintptr_t>::max()-field->offset-0x18)
        return {true,false,false};
    const auto address=command+field->offset;
    if(!field->array){
        std::uint32_t ref=0xffffffffu;
        if(!read(address,ref)||ref==0xffffffffu)return {true,false,false};
        result.targetProtected=protectedRefs.count(ref)!=0;
        return result;
    }
    // CPdxArray<TPdxRef<CFleet>>, identical to galaxy_manager.cpp SetRefArray:
    // embedded vtable, data +8, capacity +0x10, size +0x14, uint32_t elements.
    std::uintptr_t data=0;std::uint32_t capacity=0,size=0;
    if(!read(address+8,data)||!read(address+0x10,capacity)||!read(address+0x14,size)||
        size>256||size>capacity||(size&&(data<0x10000||
        data>std::numeric_limits<std::uintptr_t>::max()-size*sizeof(std::uint32_t))))
        return {true,false,false};
    for(std::uint32_t i=0;i<size;++i){
        std::uint32_t ref=0xffffffffu;
        if(!read(data+i*sizeof(ref),ref)||ref==0xffffffffu)return {true,false,false};
        result.targetProtected=result.targetProtected||protectedRefs.count(ref)!=0;
    }
    std::uintptr_t afterData=0;std::uint32_t afterCapacity=0,afterSize=0;
    if(!read(address+8,afterData)||!read(address+0x10,afterCapacity)||!read(address+0x14,afterSize)||
        data!=afterData||capacity!=afterCapacity||size!=afterSize)return {true,false,false};
    return result;
}

// Arm-time only: Owned must come from fleets::Owned(the freshly confirmed
// bound country), and findFullRef from fleets::Find(base,ref), which checks the
// CFleet full id at sdk::rt::CFleet_id (including generation bits).
template<class Owned,class FindFullRef>
bool IsOwnedProtectedFleetRef(std::uint32_t ref,const Owned& owned,FindFullRef&& findFullRef){
    return ref!=0xffffffffu&&std::find(owned.begin(),owned.end(),ref)!=owned.end()&&
        static_cast<bool>(findFullRef(ref));
}

// Intentionally not inferred: reinforce_fleet_command names CFleetTemplate,
// create_fleet_command/disband_ships_command name CShip. They need a separate
// full-ref/ownership-checked relationship reader before claiming coverage.
// Combat emergency FTL remains available as an actual escape, not a routine
// exploration reassignment. Release protections before war/unsafe exploration.
} // namespace bridge::cyberfish
