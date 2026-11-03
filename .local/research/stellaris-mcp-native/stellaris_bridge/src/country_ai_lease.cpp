#include "country_ai_lease.hpp"
#include "country_ai_control.hpp"
#include "country_ai_observation.hpp"
#include "country_ai_routine_gate.hpp"
#include "commands.hpp"
#include "game_state.hpp"
#include "country_ai_world.hpp"
#include "event_manager.hpp"
#include "cyberfish_war.hpp"
#include "galaxy_manager.hpp"
#include <algorithm>
#include <map>

namespace bridge::cyberfish {
namespace {
using Json=nlohmann::json;
std::string phase="idle",stopReason;
uint64_t generation=0,deadline=0,stopStarted=0;
uint64_t absoluteEnd=0;
Json baseline=nullptr,lastPost=nullptr,lastState=nullptr,lastGate=nullptr,lastObservation=nullptr;
Json reclaimWorld=nullptr;
Json lastOwnerExplorationMove=nullptr;
struct ExplorationRequest {Json signature,result;};
std::map<std::string,ExplorationRequest> explorationRequests;
unsigned maxDays=30;
uint64_t startDay=0;
uint64_t nextTick=0;
uint64_t startingAt=0,nextAttentionScan=0;
bool runConfirmed=false;
bool reviewDue=false,stopAtReview=false;
uint64_t nextReviewDay=0;
bool Active(){return phase!="idle"&&phase!="stopped";}
uint64_t Day(){auto date=GameState::Get().ReadDate();return uint64_t(date.year)*360+(date.month?date.month-1:0)*30+(date.day?date.day-1:0);}
bool SameWorld(const Json& state) {
    if(baseline.is_null()||!state.value("success",false))return false;
    auto a=baseline,b=state["precondition"];
    for(const auto* field:{"global_flags","sequence","date"}){a.erase(field);b.erase(field);}
    return a==b && Day()>=startDay;
}
bool Off(const Json& state){return state.value("success",false)&&state["global_flags"]["human_ai"]==false&&state["global_flags"]["force_human_ai"]==false;}
bool On(const Json& state){return state.value("success",false)&&state["global_flags"]["human_ai"]==true&&state["global_flags"]["force_human_ai"]==true;}
bool Receipt(const Json& state) {
    if(!lastPost.is_null()&&lastPost.value("phase",std::string())=="already_observed")return Off(state);
    return !lastPost.is_null() && state.contains("pending") && !state["pending"].is_null() &&
        lastPost.contains("pending") && !lastPost["pending"].is_null() &&
        state["pending"]["sequence"]==lastPost["pending"]["sequence"] &&
        state["pending"].value("phase",std::string())=="readback_confirmed" &&
        state["pending"].value("execute_receipts",0)==3;
}
void Stop(const std::string& reason) {
    if(phase=="stopping_pause"||phase=="stopping_off"||phase=="stop_unconfirmed")return;
    SuspendCountryAIRoutineGate();
    stopReason=reason;phase="stopping_pause";stopStarted=GetTickCount64();
}
Json State() {
    return {{"success",true},{"phase",phase},{"generation",generation},{"stop_reason",stopReason},
        {"lease_remaining_ms",deadline>GetTickCount64()?deadline-GetTickCount64():0},
        {"baseline",baseline},{"reclaim_world",reclaimWorld},{"last_native_state",lastState},{"last_post",lastPost},
        {"routine_gate",lastGate},{"observation",lastObservation},
        {"last_owner_exploration_move",lastOwnerExplorationMove},{"country_ai_owner_exploration",true},
        {"world_reload_policy","pause_invalidate_require_fresh_reclaim"},{"world_reload_live_verified",false},{"production_ready",false},
        {"run_confirmed",runConfirmed},{"review_due",reviewDue},{"stop_at_review",stopAtReview},{"autonomous_operation_verified",false}};
}
}
void TickCountryAILeaseImpl() {
    if(!Active())return;
    if(GetTickCount64()>deadline&&(phase=="prepared"||phase=="enabling"||phase=="ready_paused"||phase=="starting"||phase=="running"))Stop("lease_expired");
    if(GetTickCount64()<nextTick)return;
    nextTick=GetTickCount64()+100;
    lastState=CountryAIState();
    if(phase=="world_reclaim_off"||phase=="world_reclaim_unconfirmed") {
        auto now=lastState.value("precondition",Json::object()),expected=reclaimWorld;
        for(const auto* field:{"global_flags","sequence"}){now.erase(field);expected.erase(field);}
        if(!lastState.value("success",false)||now!=expected||!lastState.value("paused",false)) {
            Commands::Get().SetPaused(true);phase="scope_unknown";return;
        }
        if(Off(lastState)&&Receipt(lastState)) {
            lastGate=CountryAIRoutineGate({{"action","release_after_world_change"},{"expected",lastState["precondition"]}});
            if(lastGate.value("success",false)) {
                lastObservation=CountryAIObservation({{"action","stop"}});
                if(!lastObservation.value("success",false)){phase="world_reclaim_unconfirmed";return;}
                phase="stopped";stopReason="fresh_world_reclaim_confirmed";return;
            }
        }
        if(GetTickCount64()>stopStarted+5000)phase="world_reclaim_unconfirmed";
        return;
    }
    if(!SameWorld(lastState)) {
        // An unknown world is never authorization to resume, recover old
        // strategies, or write old country orders into the newly observed game.
        SuspendCountryAIRoutineGate();Commands::Get().SetPaused(true);phase="scope_unknown";stopReason="world_or_identity_changed";return;
    }
    lastGate=CountryAIRoutineGate({{"action","status"}});
    if(lastGate.value("coverage_faults",uint64_t(0))>0)Stop("native_gate_coverage_fault");
    if(phase=="starting") {
        if(!lastState.value("paused",true)&&On(lastState)){phase="running";runConfirmed=true;}
        else if(GetTickCount64()>startingAt+1000)Stop("unpause_not_confirmed");
    }
    if(phase=="running"&&(lastState.value("paused",false)||!On(lastState)))Stop("user_pause_or_ai_flags_changed");
    if(phase=="running"&&GetTickCount64()>=nextAttentionScan) {
        nextAttentionScan=GetTickCount64()+1000;
        if(!EventManager::Get().GetActiveEvents().empty()||Wars().value("warGoalsWindow",false))Stop("key_event_requires_takeover");
    }
    if(phase=="running"&&Day()>=nextReviewDay){reviewDue=true;if(stopAtReview)Stop("game_day_review_limit");}
    if(phase=="enabling"&&Receipt(lastState)) {
        if(lastState["global_flags"]["human_ai"]==true&&lastState["global_flags"]["force_human_ai"]==true)
            phase="ready_paused";
        else Stop("enable_state_mismatch");
    }
    if(phase=="stopping_pause") {
        if(!lastState.value("paused",false)){Commands::Get().SetPaused(true);return;}
        if(Off(lastState) && (lastPost.is_null()||Receipt(lastState))) {
            // Prepared but never enabled, or an already completed off request.
            phase="stopping_off";
        } else {
            lastPost=SetCountryAIState({{"human_ai",false},{"force_human_ai",false},
                {"restore_previous",true},{"expected",lastState["precondition"]}});
            if(!lastPost.contains("pending")&&lastPost.value("phase",std::string())!="already_observed") {phase="stop_unconfirmed";return;}
            phase="stopping_off";return;
        }
    }
    if(phase=="stopping_off"||phase=="stop_unconfirmed") {
        const bool neverEnabled=lastPost.is_null();
        if(lastState.value("paused",false)&&Off(lastState)&&(neverEnabled||Receipt(lastState))) {
            lastObservation=CountryAIObservation({{"action","status"}});
            if(!lastObservation.value("commands_drained",false)){phase="stop_unconfirmed";return;}
            lastGate=CountryAIRoutineGate({{"action","disarm"},{"expected",lastState["precondition"]}});
            if(!lastGate.value("success",false)){phase="stop_unconfirmed";return;}
            lastObservation=CountryAIObservation({{"action","stop"}});
            if(!lastObservation.value("success",false)){phase="stop_unconfirmed";return;}
            phase="stopped";return;
        }
        if(GetTickCount64()>stopStarted+5000)phase="stop_unconfirmed";
    }
}
void TickCountryAILease() {
    try {TickCountryAILeaseImpl();}
    catch(...) {
        SuspendCountryAIRoutineGate();
        try {Commands::Get().SetPaused(true);
            if(phase!="stopping_off"&&phase!="stop_unconfirmed") {phase="stopping_pause";stopStarted=GetTickCount64();}
            stopReason="lease_monitor_exception";
        }catch(...){}
    }
}
Json CountryAILease(const Json& params) {
    const auto action=params.value("action",std::string("status"));
    TickCountryAILease();
    if(!Active())lastState=CountryAIState();
    if(action=="prepare") {
        if(Active())return {{"success",false},{"error","country_ai_lease_already_active"}};
        auto state=CountryAIState();
        if(!state.value("success",false)||!state.value("paused",false)||!state.value("single_local_human_guard",false)||
            !Off(state)||!params.contains("expected")||params["expected"]!=state["precondition"])
            return {{"success",false},{"error","country_ai_lease_requires_off_paused_local_snapshot"}};
        if(params.contains("stop_at_review")&&!params["stop_at_review"].is_boolean())
            return {{"success",false},{"error","country_ai_stop_at_review_must_be_boolean"}};
        auto days=params.value("max_game_days",unsigned(30));if(days<1||days>720)return {{"success",false},{"error","country_ai_review_days_out_of_range"}};
        const auto wall=params.value("max_wall_ms",uint64_t(120000));
        if(wall<1000||wall>3600000)return {{"success",false},{"error","country_ai_wall_limit_out_of_range"}};
        if(!InstallCountryAIWorldHooks())return {{"success",false},{"error","country_ai_world_start_hooks_unverified"}};
        lastGate=CountryAIRoutineGate({{"action","arm"},{"policy",params.value("policy",std::string("full_with_reserved"))},{"expected",state["precondition"]},{"protected_targets",params.value("protected_targets",Json::object())},{"owner_policy",params.value("owner_policy",Json::object())}});
        if(!lastGate.value("success",false))return lastGate;
        lastObservation=CountryAIObservation({{"action","start"},{"expected",state["precondition"]}});
        if(!lastObservation.value("success",false)) {
            CountryAIRoutineGate({{"action","disarm"},{"expected",state["precondition"]}});return lastObservation;
        }
        ++generation;baseline=state["precondition"];lastState=state;lastPost=nullptr;
        startDay=Day();maxDays=days;stopReason.clear();phase="prepared";
        reviewDue=false;stopAtReview=params.value("stop_at_review",false);nextReviewDay=startDay+maxDays;
        absoluteEnd=GetTickCount64()+wall;deadline=std::min(absoluteEnd,GetTickCount64()+15000);
        reclaimWorld=nullptr;
        runConfirmed=false;
        lastOwnerExplorationMove=nullptr;explorationRequests.clear();
    } else if(action!="status") {
        if(!params.contains("generation")||params["generation"]!=generation||!Active())
            return {{"success",false},{"error","country_ai_lease_generation_mismatch"}};
        if(action=="reclaim_changed_world") {
            auto current=CountryAIState();
            if(phase!="scope_unknown"||!current.value("success",false)||!current.value("paused",false)||
                !current.value("single_local_human_guard",false)||!params.contains("expected")||params["expected"]!=current["precondition"])
                return {{"success",false},{"error","changed_world_reclaim_requires_fresh_paused_binding"}};
            reclaimWorld=current["precondition"];
            lastPost=SetCountryAIState({{"human_ai",false},{"force_human_ai",false},{"expected",current["precondition"]}});
            if(!lastPost.contains("pending")&&lastPost.value("phase",std::string())!="already_observed")
                return {{"success",false},{"error","changed_world_reclaim_unconfirmed"},{"native_result",lastPost}};
            stopStarted=GetTickCount64();deadline=stopStarted+15000;phase="world_reclaim_off";
        } else if(action=="update_exploration_protection") {
            const auto current=CountryAIState();
            if(phase!="running"||!SameWorld(current)||!On(current))
                return {{"success",false},{"error","exploration_protection_requires_running_owned_world"}};
            if(!params.contains("fleet_id")||!params["fleet_id"].is_number_integer()||params["fleet_id"].get<int64_t>()<0||
                params["fleet_id"].get<uint64_t>()>=0xffffffffu||!params.contains("protected")||!params["protected"].is_boolean()||
                !params.contains("expected_protected_targets")||!params["expected_protected_targets"].is_object())
                return {{"success",false},{"error","exploration_protection_delta_invalid"}};
            if(params["protected"].get<bool>()&&current.value("paused",true))return {{"success",false},{"error","exploration_protection_requires_running_owned_world"}};
            const auto result=UpdateCountryAIExplorationProtection(params["fleet_id"].get<uint32_t>(),params["protected"].get<bool>(),
                current["precondition"],params["expected_protected_targets"]);
            if(!result.value("success",false))return result;
            lastGate=CountryAIRoutineGate({{"action","status"}});
        } else if(action=="owner_exploration_move") {
            auto finish=[&](Json result){lastOwnerExplorationMove=result;auto output=State();
                output["success"]=result.value("success",false);output["movement_result"]=std::move(result);return output;};
            auto reject=[&](const char* error){Json result={{"success",false},{"accepted",false},{"phase","rejected"},{"error",error},
                {"request_id",params.value("request_id",Json(nullptr))}};
                for(const auto* key:{"fleet_id","system_id","expected_from_system_id"})if(params.contains(key))result[key]=params[key];
                return finish(std::move(result));};
            for(const auto* key:{"fleet_id","system_id","expected_from_system_id"})
                if(!params.contains(key)||!params[key].is_number_integer()||params[key].get<int64_t>()<0||params[key].get<uint64_t>()>=0xffffffffu)
                    return reject("owner_exploration_ref_invalid");
            if(!params.contains("request_id")||!params["request_id"].is_string()||params["request_id"].get<std::string>().empty()||params["request_id"].get<std::string>().size()>128)
                return reject("owner_exploration_request_id_invalid");
            const auto id=params["request_id"].get<std::string>();
            const Json signature={{"fleet_id",params["fleet_id"]},{"system_id",params["system_id"]},{"expected_from_system_id",params["expected_from_system_id"]}};
            const auto previous=explorationRequests.find(id);
            if(previous!=explorationRequests.end()) {
                if(previous->second.signature!=signature)return reject("owner_exploration_request_id_reused");
                auto result=previous->second.result;result["replayed"]=true;return finish(std::move(result));
            }
            const auto current=CountryAIState();
            if(phase!="running"||!SameWorld(current)||!On(current)||current.value("paused",true))return reject("owner_exploration_requires_running_owned_world");
            if(!CountryAIExplorationPeaceConfirmed())return reject("owner_exploration_requires_peace");
            if(!CountryAIExplorationFleetProtected(params["fleet_id"].get<uint32_t>()))return reject("owner_exploration_fleet_not_protected");
            if(explorationRequests.size()>=256)return reject("owner_exploration_request_limit");
            // Reserve the id before any engine call. Unknown Post outcomes are
            // retained and never automatically resent by a repeated request.
            Json result={{"success",false},{"accepted",nullptr},{"phase","post_unconfirmed"},{"request_id",id},
                {"fleet_id",params["fleet_id"]},{"system_id",params["system_id"]},{"expected_from_system_id",params["expected_from_system_id"]}};
            explorationRequests.emplace(id,ExplorationRequest{signature,result});
            try {
                auto moved=GalaxyManager::Get().MoveOwnerExplorationFleet(params["fleet_id"].get<uint32_t>(),params["system_id"].get<uint32_t>(),params["expected_from_system_id"].get<uint32_t>());
                for(const auto& field:moved.items())result[field.key()]=field.value();
                if(!moved.contains("accepted")){result["accepted"]=false;result["phase"]="rejected";}
            } catch(...) {result["error"]="owner_exploration_native_outcome_unknown";}
            explorationRequests.at(id).result=result;return finish(std::move(result));
        } else if(action=="update_owner_policy") {
            const auto current=CountryAIState();
            if(phase!="running"||!SameWorld(current)||!On(current))return {{"success",false},{"error","owner_policy_requires_running_owned_world"}};
            const auto gate=CountryAIRoutineGate({{"action","update_owner_policy"},{"expected",current["precondition"]},{"owner_policy",params.value("owner_policy",Json::object())}});
            if(!gate.value("success",false))return gate;
            lastGate=gate;
        } else if(action=="acknowledge_review") {
            if(phase!="running"||!SameWorld(lastState)||!On(lastState))return {{"success",false},{"error","country_ai_review_requires_running_owned_world"}};
            reviewDue=false;nextReviewDay=Day()+maxDays;
        } else if(action=="stop")Stop("explicit_stop");
        else if(action=="heartbeat") {
            if(phase=="scope_unknown"||phase=="stopping_pause"||phase=="stopping_off"||phase=="stop_unconfirmed"||phase=="world_reclaim_off"||phase=="world_reclaim_unconfirmed")
                return {{"success",false},{"error","country_ai_stopping_cannot_renew"},{"state",State()}};
            deadline=std::min(absoluteEnd,GetTickCount64()+15000);
        } else if(action=="enable") {
            if(phase!="prepared"||!SameWorld(lastState)||!lastState.value("paused",false))
                return {{"success",false},{"error","country_ai_enable_not_prepared"}};
            lastPost=SetCountryAIState({{"human_ai",true},{"force_human_ai",true},{"expected",lastState["precondition"]}});
            if(!lastPost.contains("pending")){Stop("enable_rejected_or_unknown");return State();}
            phase="enabling";
        } else if(action=="run") {
            if(phase!="ready_paused"||!Receipt(lastState)||!lastState.value("paused",false))
                return {{"success",false},{"error","country_ai_run_requires_confirmed_control"}};
            // v1.5 full native operation; explicit lease is the authority.
            auto current=CountryAIState();
            if(!SameWorld(current)||!current.value("paused",false)||!On(current)||!Receipt(current)||
                !EventManager::Get().GetActiveEvents().empty()||Wars().value("warGoalsWindow",false))
                return {{"success",false},{"error","country_ai_run_scope_or_key_event_blocked"}};
            auto result=Commands::Get().SetPaused(false);
            if(!result.value("success",false)){Stop("unpause_failed");return State();}
            startingAt=GetTickCount64();phase="starting";
        } else return {{"success",false},{"error","unknown_country_ai_lease_action"}};
    }
    return State();
}
}
