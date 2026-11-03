#include "country_ai_routine_policy.hpp"
#include "country_ai_owner_policy.hpp"
#include "country_ai_queue_state.hpp"
#include "galaxy_camera_layout.hpp"
#include <cstdlib>
#include <iostream>
using namespace bridge::cyberfish;
void Check(bool value){if(!value)std::abort();}
int main(){
 OwnerProductionPolicy owner{true,true};
 Check(OwnerProductionBlocked(owner,0,true,true));Check(OwnerProductionBlocked(owner,11,true,false));
 Check(!OwnerProductionBlocked(owner,0,false,true)); // war or peace unknown: native defence keeps running
 Check(OwnerProductionBlocked(owner,3,true,true));Check(!OwnerProductionBlocked(owner,3,true,false)); // replacement possible
 for(auto cls:{1,2,4,5,6,7,8,9,10,255})Check(!OwnerProductionBlocked(owner,static_cast<uint8_t>(cls),true,true));
 Check(!OwnerProductionBlocked({},0,true,true));
 Check(OwnerScientistRecruitmentBlocked(owner,true,true,true,false,true));
 Check(!OwnerScientistRecruitmentBlocked(owner,false,true,true,false,true)); // war / peace unknown
 Check(!OwnerScientistRecruitmentBlocked(owner,true,false,true,false,true)); // missing explorer
 Check(!OwnerScientistRecruitmentBlocked(owner,true,true,false,false,true)); // other / unknown class
 Check(!OwnerScientistRecruitmentBlocked(owner,true,true,true,true,true)); // reuse existing leader
 Check(!OwnerScientistRecruitmentBlocked(owner,true,true,true,false,false)); // missing scientist: replacement allowed
 Check(!OwnerScientistRecruitmentBlocked({},true,true,true,false,true));
 Check(OwnerCommanderRecruitmentBlocked(owner,true,true,true,false,true));
 Check(!OwnerCommanderRecruitmentBlocked(owner,false,true,true,false,true));
 Check(!OwnerCommanderRecruitmentBlocked(owner,true,false,true,false,true));
 Check(!OwnerCommanderRecruitmentBlocked(owner,true,true,false,false,true));
 Check(!OwnerCommanderRecruitmentBlocked(owner,true,true,true,true,true));
 Check(!OwnerCommanderRecruitmentBlocked(owner,true,true,true,false,false));
 Check(!OwnerCommanderRecruitmentBlocked({},true,true,true,false,true));
 NativeRoutineRequest recruit;recruit.actor=0;recruit.name="hire_and_assign_leader";recruit.ownerPolicyBlocked=true;
 Check(!AllowNativeRoutine(recruit,0));recruit.actor=1;Check(AllowNativeRoutine(recruit,0));
 recruit.actor=0;recruit.ownerPolicyBlocked=false;Check(AllowNativeRoutine(recruit,0));
 Check(!OwnerEarlyOutpostBlocked(2225,99,true));
 Check(OwnerEarlyOutpostBlocked(2225,100,true));
 Check(OwnerEarlyOutpostBlocked(2299,120,true));
 Check(!OwnerEarlyOutpostBlocked(2300,120,true));
 Check(!OwnerEarlyOutpostBlocked(0,120,true));
 Check(!OwnerEarlyOutpostBlocked(2225,120,false)); // owned-system/resource station or unknown target
 NativeRoutineRequest outpost;outpost.actor=0;outpost.name="build_orbital_station_order";
 outpost.ownerPolicyBlocked=OwnerEarlyOutpostBlocked(2225,100,true);
 Check(!AllowNativeRoutine(outpost,0));outpost.actor=1;Check(AllowNativeRoutine(outpost,0));
 Check(OwnerSentinelDuplicateLimitApplies(2225,true,"building_sentinel_posts"));
 Check(!OwnerSentinelDuplicateLimitApplies(0,true,"building_sentinel_posts"));
 Check(!OwnerSentinelDuplicateLimitApplies(2300,true,"building_sentinel_posts"));
 Check(!OwnerSentinelDuplicateLimitApplies(2225,false,"building_sentinel_posts"));
 Check(!OwnerSentinelDuplicateLimitApplies(2225,true,"building_hive_node"));

 Check(GalaxyOverviewZoom(2861,16.0/9.0)==3000);
 Check(GalaxyOverviewZoom(5000,16.0/9.0)==3000);
 Check(GalaxyOverviewZoom(1000,16.0/9.0)==3000);
 Check(GalaxyOverviewZoom(500,0.5)==3000);
 Check(GalaxyOverviewZoom(10000,16.0/9.0)==0);
 Check(GalaxyOverviewZoom(0,1)==0);Check(GalaxyOverviewZoom(500,0)==0);
 NativeAIQueueState queue;queue.vtableRva=kCountryAIVtableRva;
 Check(NativeAIQueueEmpty(queue,0)); // Exact fresh-game dormant state.
 queue.initialized=1;Check(!NativeAIQueueEmpty(queue,0));queue.initialized=0;
 queue.data=0x10000;Check(!NativeAIQueueEmpty(queue,0));queue.data=0;
 queue.capacity=1;Check(!NativeAIQueueEmpty(queue,0));queue.capacity=0;
 queue.size=1;Check(!NativeAIQueueEmpty(queue,0));queue.size=0;
 queue.owner=1;Check(!NativeAIQueueEmpty(queue,0));queue.owner=0;
 Check(NativeAIQueueEmpty(queue,0));queue.vtableRva=kCountryAIStrategyVtableRva;Check(NativeAIQueueEmpty(queue,0));
 queue.owner=0xffffffffu;Check(!NativeAIQueueEmpty(queue,0));
 queue.vtableRva=0;queue.owner=0;Check(!NativeAIQueueEmpty(queue,0));
 NativeRoutineRequest r;r.actor=0;
 for(auto name:{"research_technology_command","add_buildable_to_queue_command","prepare_war_command","update_strat_war_data_command","ai_add_strategy_command","ai_remove_diplo_action_command","queue_fleet_order_command","set_council_agenda_command","unlock_council_position_command","add_to_council_command","pass_resolution_command","fail_resolution_command","pass_resolution_type_command","unknown"}){
  r.name=name;Check(AllowNativeRoutine(r,0));
 }
 for(auto name:{"diplo_action_propose_command","diplo_action_respond_command","diplo_action_vote_command","diplo_action_start_proxy_war_command","cast_vote_command","support_proposed_resolution_command","oppose_proposed_resolution_command","remove_support_for_proposed_resolution_command","propose_resolution_command","withdraw_proposed_resolution_command","veto_resolution_command","borrow_diplo_weight_for_resolution_command","join_community_command","leave_community_command","propose_emergency_measure_command","freeze_proposed_resolution_command","end_senate_session_command"}){
  r.name=name;Check(!AllowNativeRoutine(r,0));r.actor=1;Check(AllowNativeRoutine(r,0));r.actor=0;
 }
 // Activations are reserved even when the payload could not be classified.
 r.name="add_edict_command";Check(!AllowNativeRoutine(r,0));
 r.steeringSetting=true;Check(!AllowNativeRoutine(r,0));
 r.actor=1;Check(AllowNativeRoutine(r,0));r.steeringSetting=false;Check(AllowNativeRoutine(r,0));r.actor=0;
 for(auto name:{"add_policy_command","remove_edict_command"}){
  r.name=name;Check(AllowNativeRoutine(r,0));r.steeringSetting=true;Check(!AllowNativeRoutine(r,0));r.steeringSetting=false;
 }
 r.name="unknown";r.targetProtected=true;Check(!AllowNativeRoutine(r,0));r.actor=1;Check(AllowNativeRoutine(r,0));
 r.actor=0;r.targetProtected=false;Check(!AllowNativeRoutine(r,0,ReservedPolicy::Suspended));
 std::cout<<"default allow, reserved decisions and own-target protection passed\n";
}
