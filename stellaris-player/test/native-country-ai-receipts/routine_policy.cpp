#include "country_ai_routine_policy.hpp"
#include <cstdlib>
#include <iostream>
using namespace bridge::cyberfish;
void Check(bool value){if(!value)std::abort();}
int main(){
 NativeRoutineRequest r;r.actor=0;
 for(auto name:{"research_technology_command","add_buildable_to_queue_command","prepare_war_command","update_strat_war_data_command","ai_add_strategy_command","ai_remove_diplo_action_command","queue_fleet_order_command","unknown"}){
  r.name=name;Check(AllowNativeRoutine(r,0));
 }
 for(auto name:{"diplo_action_propose_command","diplo_action_respond_command","diplo_action_vote_command","diplo_action_start_proxy_war_command"}){
  r.name=name;Check(!AllowNativeRoutine(r,0));r.actor=1;Check(AllowNativeRoutine(r,0));r.actor=0;
 }
 for(auto name:{"add_policy_command","add_edict_command","remove_edict_command"}){
  r.name=name;Check(AllowNativeRoutine(r,0));r.steeringSetting=true;Check(!AllowNativeRoutine(r,0));r.steeringSetting=false;
 }
 r.name="unknown";r.targetProtected=true;Check(!AllowNativeRoutine(r,0));r.actor=1;Check(AllowNativeRoutine(r,0));
 r.actor=0;r.targetProtected=false;Check(!AllowNativeRoutine(r,0,ReservedPolicy::Suspended));
 std::cout<<"default allow, reserved decisions and own-target protection passed\n";
}
