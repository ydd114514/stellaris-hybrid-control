#include "country_ai_control.hpp"
#include "command_builder.hpp"
#include "game_state.hpp"
#include "country_ai_receipts.hpp"
#include "country_ai_world.hpp"
#include <array>
#include <deque>
#include <MinHook.h>

namespace bridge::cyberfish {
namespace {
using Json = nlohmann::json;
constexpr uint32_t invalid = 0xffffffffu;
template<class T> bool Read(uintptr_t address, T& value) {
    SIZE_T copied = 0;
    return address >= 0x10000 && ReadProcessMemory(GetCurrentProcess(),
        reinterpret_cast<void*>(address), &value, sizeof(T), &copied) && copied == sizeof(T);
}
bool Bytes(uintptr_t address, const uint8_t* expected, size_t length) {
    std::array<uint8_t, 32> actual{}; SIZE_T copied = 0;
    return length <= actual.size() && ReadProcessMemory(GetCurrentProcess(),
        reinterpret_cast<void*>(address), actual.data(), length, &copied) && copied == length &&
        memcmp(actual.data(), expected, length) == 0;
}
bool abiVerified=false;
bool VerifiedABI() {
    auto& builder = CommandBuilder::Get();
    if (!builder.SdkMatchesExe()) return false;
    if (abiVerified) return true; // Execute entry bytes change only after our verified detours.
    // Windows 4.5.2 SHA400df27c...: entire Execute leaves and IsValid(true).
    static constexpr uint8_t human[]{0x0f,0xb6,0x41,0x20,0x88,0x05,0x1f,0xa9,0xeb,0x01,
        0x0f,0xb6,0x41,0x20,0x88,0x05,0x0f,0xa9,0xeb,0x01,0xc3};
    static constexpr uint8_t force[]{0x0f,0xb6,0x41,0x20,0x88,0x05,0xbf,0xa7,0xeb,0x01,0xc3};
    static constexpr uint8_t valid[]{0xb0,0x01,0xc3};
    auto base = builder.Base();
    uintptr_t h = 0, f = 0, hv = 0, fv = 0;
    abiVerified = Bytes(base+0x959f10,human,sizeof human) && Bytes(base+0x95a070,force,sizeof force) &&
        Bytes(base+0x1ae1f0,valid,sizeof valid) &&
        Read(base+sdk::cmd::human_ai_command::kVtableRva+9*8,h) && h==base+0x959f10 &&
        Read(base+sdk::cmd::force_human_ai_command::kVtableRva+9*8,f) && f==base+0x95a070 &&
        Read(base+sdk::cmd::human_ai_command::kVtableRva+8*8,hv) && hv==base+0x1ae1f0 &&
        Read(base+sdk::cmd::force_human_ai_command::kVtableRva+8*8,fv) && fv==base+0x1ae1f0;
    return abiVerified;
}
uint64_t sequence = 0;
Json pending = nullptr;
using Execute = void (*)(void*);
Execute originalHuman=nullptr, originalForce=nullptr;
std::atomic<uintptr_t> expectedHuman{0}, expectedForce{0};
std::mutex receiptMutex;
AICommandIdentity humanIdentity,forceIdentity;
uint64_t receiptStart=0,executionEvent=0;
std::deque<AICommandExecution> executions;
std::atomic<unsigned> receiptLoss{0};
using Destroy=void* (*)(void*,unsigned);
Destroy originalDestroy=nullptr;
bool hooksInstalled=false;
AICommandIdentity Identity(void* command) {
    AICommandIdentity key;auto p=reinterpret_cast<uintptr_t>(command);
    key.object=p;
    key.valid=Read(p+8,key.client)&&Read(p+0x18,key.sequence)&&Read(p+0x20,key.value)&&
        key.client!=0xffffffffu&&key.value<=1;
    return key;
}
void RecordExecution(void* command,unsigned kind) {
    auto key=Identity(command);
    std::lock_guard<std::mutex> lock(receiptMutex);
    if(executions.size()>=64)executions.pop_front();
    executions.push_back({key,++executionEvent,kind});
}
void HumanExecuted(void* command) {
    originalHuman(command);
    try {RecordExecution(command,1);}catch(...){++receiptLoss;}
}
void ForceExecuted(void* command) {
    originalForce(command);
    try {RecordExecution(command,2);}catch(...){++receiptLoss;}
}
void* OriginalCommandDestroyed(void* command,unsigned flags) {
    // The session serializes/recreates commands before execution. Its final
    // assigned client/sequence are captured while the original is still alive.
    const auto p=reinterpret_cast<uintptr_t>(command);
    try {if(expectedHuman.load()==p) {
        auto key=Identity(command);std::lock_guard<std::mutex> lock(receiptMutex);
        humanIdentity=key;expectedHuman=0;
    }
    if(expectedForce.load()==p) {
        auto key=Identity(command);std::lock_guard<std::mutex> lock(receiptMutex);
        forceIdentity=key;expectedForce=0;
    }}catch(...){++receiptLoss;}
    return originalDestroy(command,flags);
}
bool InstallExecutionReceipts() {
    if(hooksInstalled) return true;
    auto base=CommandBuilder::Get().Base();
    auto h=reinterpret_cast<void*>(base+0x959f10), f=reinterpret_cast<void*>(base+0x95a070);
    auto d=reinterpret_cast<void*>(base+0x1af5b0);
    static constexpr uint8_t destroyBytes[]{0x40,0x53,0x48,0x83,0xec,0x20,0x48,0x8d,0x05,0x73,0x60,0x19,0x02,0x48,0x8b,0xd9};
    uintptr_t hd=0,fd=0;
    if(!Bytes(base+0x1af5b0,destroyBytes,sizeof destroyBytes)||
        !Read(base+sdk::cmd::human_ai_command::kVtableRva,hd)||hd!=base+0x1af5b0||
        !Read(base+sdk::cmd::force_human_ai_command::kVtableRva,fd)||fd!=base+0x1af5b0)return false;
    if(MH_CreateHook(h,reinterpret_cast<void*>(&HumanExecuted),reinterpret_cast<void**>(&originalHuman))!=MH_OK)
        return false;
    if(MH_CreateHook(f,reinterpret_cast<void*>(&ForceExecuted),reinterpret_cast<void**>(&originalForce))!=MH_OK) {
        MH_RemoveHook(h); return false;
    }
    if(MH_CreateHook(d,reinterpret_cast<void*>(&OriginalCommandDestroyed),reinterpret_cast<void**>(&originalDestroy))!=MH_OK) {
        MH_RemoveHook(h);MH_RemoveHook(f);return false;
    }
    if(MH_EnableHook(h)!=MH_OK || MH_EnableHook(f)!=MH_OK || MH_EnableHook(d)!=MH_OK) {
        MH_DisableHook(h); MH_DisableHook(f);MH_DisableHook(d);
        MH_RemoveHook(h); MH_RemoveHook(f);MH_RemoveHook(d);return false;
    }
    hooksInstalled=true; return true;
}
Json Failure(const char* error) {return {{"success",false},{"error",error},{"research_only",true}};}
bool LocalHumanIdentity(uintptr_t base, uint32_t own, int32_t& localPlayer, uint8_t& network) {
    // 24c580 selects player rows by session+94; 2659f0 uses row+5c
    // for an assigned player and row+60 for observer fallback. Never use fallback.
    uintptr_t app=0, service=0, vt=0, getter=0, session=0, state=0, rows=0, idler=0;
    uint32_t count=0;
    static constexpr uint8_t getterBytes[]{0x48,0x8b,0x81,0x50,0x04,0,0,0xc3};
    if(!Read(base+0x3114e70,app) || !Read(app+0x140,service) || !Read(service,vt) ||
        !Read(vt+0x70,getter) || getter!=base+0x1ae180 ||
        !Bytes(getter,getterBytes,sizeof getterBytes) || !Read(service+0x450,session) ||
        !Read(session+0x94,localPlayer) || !Read(base+sdk::glob::g_CurrentGameState,state) ||
        !Read(state+0x18,rows) || !Read(state+0x24,count) || count==0 || count>64 || !rows ||
        !Read(base+sdk::glob::g_CurrentInGameIdler,idler) || !Read(idler+0x180,network) || network>1)
        return false;
    unsigned matches=0;
    for(uint32_t i=0;i<count;++i) {
        auto row=rows+i*0x68; int32_t id=0; uint32_t country=invalid; uintptr_t assigned=0;
        if(!Read(row+0x48,id) || !Read(row+0x38,assigned) || !Read(row+0x5c,country)) return false;
        if(id==localPlayer) {if(!assigned || country!=own) return false; ++matches;}
    }
    return matches==1;
}
}

Json CountryAIState() {
    if (!VerifiedABI()) return Failure("country_ai_abi_unverified");
    auto base = CommandBuilder::Get().Base();
    uint8_t normal=0,human=0,force=0,paused=0; uintptr_t db=0,slots=0;
    uint32_t capacity=0;
    auto local = reinterpret_cast<uintptr_t>(GameState::Get().GetPlayerCountry());
    auto idler = reinterpret_cast<uintptr_t>(GameState::Get().GetInGameIdler());
    uint32_t own=invalid;
    if (!local || !idler || !Read(local+0x20,own) || own==invalid ||
        !Read(idler+0x594,paused) || paused>1 ||
        !Read(base+0x2814832,normal) || normal>1 ||
        !Read(base+0x2814833,human) || human>1 ||
        !Read(base+0x2814839,force) || force>1 ||
        !Read(base+0x3114c38,db) || !Read(db+0x18,slots) ||
        !Read(db+0x20,capacity) || capacity==0 || capacity>65536 || !slots)
        return Failure("country_ai_state_unreadable");
    Json humans=Json::array(); bool localFound=false; uint32_t live=0, localFlags=0;
    uintptr_t localType=0;
    for (uint32_t i=0;i<capacity;++i) {
        uintptr_t country=0;
        if (!Read(slots+i*16+8,country)) return Failure("country_ai_country_coverage_incomplete");
        if (!country) continue;
        uint32_t id=invalid,count=0;
        if (!Read(country+0x20,id)) return Failure("country_ai_country_coverage_incomplete");
        if (id==invalid) continue;
        if ((id&0xffffffu)!=i) return Failure("country_ai_country_slot_identity_mismatch");
        ++live;
        if (!Read(country+0x314c,count) || count>64)
            return Failure("country_ai_human_coverage_incomplete");
        if (count) {
            uintptr_t data=0; if (!Read(country+0x3140,data) || !data)
                return Failure("country_ai_human_coverage_incomplete");
            Json ids=Json::array();
            for(uint32_t j=0;j<count;++j) {int32_t player=0;
                if (!Read(data+j*4,player)) return Failure("country_ai_human_coverage_incomplete");
                ids.push_back(player);
            }
            humans.push_back({{"country_id",id},{"human_ids",ids}});
        }
        if(country==local && id==own) {
            localFound=true;
            if(!Read(country+0x2a68,localType) || !Read(localType+0x8c,localFlags))
                return Failure("country_ai_type_settings_unreadable");
        }
    }
    if(!localFound) return Failure("country_ai_player_identity_unresolved");
    int32_t localPlayer=0; uint8_t network=1;
    const bool assignedLocalHuman=LocalHumanIdentity(base,own,localPlayer,network);
    const bool single = !CountryAIWorldLoading() && humans.size()==1 && humans[0]["country_id"]==own &&
        humans[0]["human_ids"].size()==1 && assignedLocalHuman && network==0 &&
        humans[0]["human_ids"][0]==localPlayer;
    Json flags{{"normal_ai",normal!=0},{"human_ai",human!=0},{"force_human_ai",force!=0}};
    // Snapshot CAS is a short paused-operation guard, not a save/world generation ID.
    const auto date=GameState::Get().ReadDate().formatted;
    if(date.empty())return Failure("country_ai_world_date_unreadable");
    Json precondition{{"country_id",own},{"country_address",local},{"idler_address",idler},
        {"date",date},{"global_flags",flags},
        {"human_countries",humans},{"sequence",sequence},{"world_generation",CountryAIWorldGeneration()},{"local_player_id",localPlayer},
        {"assigned_local_human_verified",assignedLocalHuman},{"network_flag",network}};
    if(!pending.is_null()) {
        auto before=pending["identity_before"], now=precondition;
        before.erase("global_flags"); before.erase("sequence");
        now.erase("global_flags"); now.erase("sequence");
        pending["identity_matches"]=before==now;
        unsigned executed=0;
        {std::lock_guard<std::mutex> lock(receiptMutex);
            auto keyJson=[](const AICommandIdentity& key){return Json{{"valid",key.valid},{"client",key.client},{"command_sequence",key.sequence},{"value",key.value},{"object_address",key.object}};};
            Json observed=Json::array();
            for(const auto& execution:executions) {
                if(MatchesAIReceipt(humanIdentity,execution,1,receiptStart))executed|=1;
                if(MatchesAIReceipt(forceIdentity,execution,2,receiptStart))executed|=2;
                if(execution.event>receiptStart)observed.push_back({{"event",execution.event},{"kind",execution.kind},{"identity",keyJson(execution.identity)}});
            }
            pending["observed_executions_since_post"]=observed;
            pending["human_command_identity"]=keyJson(humanIdentity);
            pending["force_command_identity"]=keyJson(forceIdentity);
        }
        pending["execute_receipts"]=executed;
        pending["receipt_loss"]=receiptLoss.load();
        if(before==now && executed==3 && receiptLoss.load()==0 && pending["desired_flags"]==flags)
            pending["phase"]="readback_confirmed";
    }
    return {{"success",true},{"research_only",true},{"scope","global_human_countries"},
        {"country_id",own},{"paused",paused!=0},{"global_flags",flags},
        {"world_loading",CountryAIWorldLoading()},{"world_generation_tracking",CountryAIWorldHooksInstalled()},
        {"human_countries",humans},{"country_coverage_complete",true},{"live_countries",live},
        {"single_local_human_guard",single},{"precondition",precondition},{"pending",pending},
        {"assigned_local_human_verified",assignedLocalHuman},{"network_flag",network},
        {"country_type_ai_flags",localFlags},{"country_type_settings_scope","shared_country_type"},
        {"country_type_ai_enabled",(localFlags&1)!=0},
        {"autonomous_operation_verified",false},{"major_decision_boundary_verified",false},
        {"per_country_domain_settings_verified",false},{"execution_receipt_hooks_installed",hooksInstalled},
        {"execution_receipt_scheme","session_client_sequence_payload"}};
}

Json SetCountryAIState(const Json& params) {
    if(!params.contains("human_ai") || !params["human_ai"].is_boolean() ||
        !params.contains("force_human_ai") || !params["force_human_ai"].is_boolean() ||
        !params.contains("expected") || !params["expected"].is_object())
        return Failure("country_ai_explicit_flags_and_snapshot_required");
    auto state=CountryAIState();
    if(!state.value("success",false)) return state;
    if(!state["paused"].get<bool>()) return Failure("country_ai_paused_research_only");
    if(!state["single_local_human_guard"].get<bool>()) return Failure("country_ai_not_single_local_human");
    if(params["expected"]!=state["precondition"]) return Failure("country_ai_stale_snapshot");
    const bool h=params["human_ai"], f=params["force_human_ai"];
    auto desired=state["global_flags"]; desired["human_ai"]=h; desired["force_human_ai"]=f;
    const bool unsettled=!pending.is_null() && pending.value("phase",std::string())!="readback_confirmed";
    const bool restore=unsettled && params.value("restore_previous",false) &&
        pending.value("identity_matches",false) && desired==pending["original_flags"];
    if(unsettled && !restore) return Failure("country_ai_previous_post_unconfirmed");
    if(desired==state["global_flags"] && !restore)
        return {{"success",true},{"phase","already_observed"},{"state",state}};
    auto hc=CommandBuilder::Get().Create(sdk::cmd::human_ai_command::kSpec);
    auto fc=CommandBuilder::Get().Create(sdk::cmd::force_human_ai_command::kSpec);
    hc.Set<uint8_t>(sdk::cmd::human_ai_command::ai,h?1:0);
    fc.Set<uint8_t>(sdk::cmd::force_human_ai_command::ai,f?1:0);
    if(!hc.IsValid() || !fc.IsValid()) return Failure("country_ai_native_command_invalid");
    if(!InstallExecutionReceipts()) return Failure("country_ai_execution_receipts_unavailable");
    {std::lock_guard<std::mutex> lock(receiptMutex);humanIdentity={};forceIdentity={};receiptStart=executionEvent;receiptLoss=0;}
    expectedHuman.store(reinterpret_cast<uintptr_t>(hc.get()));
    expectedForce.store(reinterpret_cast<uintptr_t>(fc.get()));
    auto original=restore?pending["original_flags"]:state["global_flags"];
    auto superseded=restore?pending["sequence"]:Json(nullptr);
    pending={{"sequence",++sequence},{"phase","posted_unconfirmed"},
        {"original_flags",original},{"desired_flags",desired},{"superseded_sequence",superseded},
        {"country_id",state["country_id"]},{"identity_before",state["precondition"]}};
    // Both payloads are validated before posting. Engine queue order first sets H/F
    // through human_ai, then restores the requested F via force_human_ai.
    const bool first=hc.Post(); const bool second=first && fc.Post();
    if(!first || !second) pending["phase"]="post_failure_unconfirmed";
    return {{"success",first&&second},{"phase",pending["phase"]},{"pending",pending},
        {"requires_independent_readback",true},{"research_only",true}};
}
}
