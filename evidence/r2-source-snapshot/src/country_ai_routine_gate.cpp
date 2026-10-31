#include "country_ai_routine_gate.hpp"
#include "country_ai_routine_policy.hpp"
#include "country_ai_control.hpp"
#include "command_builder.hpp"
#include "country_ai_world.hpp"
#include <MinHook.h>
#include <map>

namespace bridge::cyberfish {
namespace {
using Json=nlohmann::json;
using AddAI=void (*)(void*,void*);
AddAI originalAddAI=nullptr;
std::atomic<uint32_t> gatedCountry{0xffffffffu};
std::atomic<uintptr_t> gatedCountryObject{0};
std::atomic<bool> researchAllowed{false},constructionAllowed{false};
std::atomic<uint64_t> admitted{0},blocked{0},faults{0};
std::atomic<uint64_t> postAdmitted{0},postBlocked{0};
std::mutex countMutex;
std::map<uintptr_t,uint64_t> blockedVtables;
Json boundSnapshot=nullptr;
bool installed=false;
uint64_t generation=0;
std::atomic<uint64_t> boundWorld{0};
template<class T> bool Read(uintptr_t p,T& v){SIZE_T n=0;
    return p>=0x10000&&ReadProcessMemory(GetCurrentProcess(),(void*)p,&v,sizeof v,&n)&&n==sizeof v;
}
bool OwnIdentity(uintptr_t base,uint32_t id) {
    uintptr_t db=0,slots=0,country=0;uint32_t capacity=0,actual=0xffffffffu;
    return Read(base+0x3114c38,db)&&Read(db+0x18,slots)&&Read(db+0x20,capacity)&&
        (id&0xffffffu)<capacity&&Read(slots+(id&0xffffffu)*16+8,country)&&
        country==gatedCountryObject.load()&&Read(country+0x20,actual)&&actual==id;
}
bool EmptyOwnQueue(uintptr_t country,uint32_t own) {
    uintptr_t ai=0,vt=0;uint32_t owner=0xffffffffu,size=0;
    return Read(country+0x1b28,ai)&&Read(ai,vt)&&vt==CommandBuilder::Get().Base()+0x23c9240&&
        Read(ai+0x3a0,owner)&&owner==own&&Read(ai+0x53c,size)&&size==0;
}
NativeRoutineRequest Describe(uintptr_t command,uintptr_t vt,uintptr_t base) {
    NativeRoutineRequest request;
    if(vt==base+sdk::cmd::research_technology_command::kVtableRva) {
        uintptr_t technology=0;
        request.command=NativeRoutineCommand::ResearchTechnology;
        if(!Read(command+0x20,request.actor)||!Read(command+0x28,technology))return {};
        request.technologyPresent=technology>=0x10000;
    } else if(vt==base+sdk::cmd::add_buildable_to_queue_command::kVtableRva) {
        uintptr_t buildable=0,buildableVt=0;
        request.command=NativeRoutineCommand::AddBuildable;
        if(!Read(command+0x28,request.actor)||!Read(command+0x2c,request.queue)||
            !Read(command+0x20,buildable)||!Read(buildable,buildableVt))return {};
        if(buildableVt==base+sdk::vt::CBuildableBuilding)request.buildable=NativeRoutineBuildable::Building;
        else if(buildableVt==base+sdk::vt::CBuildableDistrict)request.buildable=NativeRoutineBuildable::District;
        else if(buildableVt==base+sdk::vt::CBuildableUpgradeBuilding)request.buildable=NativeRoutineBuildable::BuildingUpgrade;
        else if(buildableVt==base+sdk::vt::CBuildableZone)request.buildable=NativeRoutineBuildable::Zone;
    }
    return request;
}
void Reject(void* command,uintptr_t vt,bool beforeQueue=true) {
    // Exact ownership rejection used by b7e8d0 when IsValid returns false:
    // invoke this engine-owned command's deleting destructor once, flags=1.
    // This runs in the original producer's natural thread, not a remote call.
    if(beforeQueue)++blocked;
    try {std::lock_guard<std::mutex> lock(countMutex);++blockedVtables[vt];}catch(...){++faults;}
    auto destroy=*(void* (**)(void*,unsigned))vt;
    destroy(command,1);
}
void GuardedAddAI(void* ai,void* command) {
    const auto own=gatedCountry.load();
    if(own==0xffffffffu){originalAddAI(ai,command);return;}
    uint32_t owner=0xffffffffu;uintptr_t vt=0;
    const auto base=CommandBuilder::Get().Base();
    if(!Read(reinterpret_cast<uintptr_t>(command),vt)){++faults;return;} // Quarantine; do not invoke an unreadable object.
    if(!Read(reinterpret_cast<uintptr_t>(ai)+0x3a0,owner)) {++faults;Reject(command,vt);return;}
    if(CountryAIWorldGeneration()!=boundWorld.load()) {
        // The human-AI flags are process-global. Until their owned lease has
        // been closed, never let an old delegation operate a new human empire.
        // Ordinary computer empires retain their original submission path.
        uintptr_t db=0,slots=0,country=0;uint32_t capacity=0,actual=0xffffffffu,humans=0;
        if(!Read(base+0x3114c38,db)||!Read(db+0x18,slots)||!Read(db+0x20,capacity)||
            (owner&0xffffffu)>=capacity||!Read(slots+(owner&0xffffffu)*16+8,country)||
            !Read(country+0x20,actual)||actual!=owner||!Read(country+0x314c,humans)) {
            ++faults;Reject(command,vt);return;
        }
        if(humans){Reject(command,vt);return;}
        originalAddAI(ai,command);return;
    }
    if(owner!=own){originalAddAI(ai,command);return;}
    const auto request=Describe(reinterpret_cast<uintptr_t>(command),vt,base);
    if(!OwnIdentity(base,own)||!AllowNativeRoutine(request,own,researchAllowed.load(),constructionAllowed.load())) {
        Reject(command,vt);return;
    }
    ++admitted;originalAddAI(ai,command);
}
bool Install() {
    if(installed)return true;
    auto base=CommandBuilder::Get().Base();
    static const uint8_t expected[]{0x48,0x89,0x5c,0x24,0x08,0x48,0x89,0x54,0x24,0x10,0x57,0x48,0x83,0xec,0x30};
    uint8_t actual[sizeof expected]{};SIZE_T n=0;auto address=(void*)(base+0xb7e8d0);
    if(!CommandBuilder::Get().SdkMatchesExe()||!ReadProcessMemory(GetCurrentProcess(),address,actual,sizeof actual,&n)||
        n!=sizeof actual||memcmp(actual,expected,sizeof actual))return false;
    if(MH_CreateHook(address,(void*)&GuardedAddAI,(void**)&originalAddAI)!=MH_OK)return false;
    if(MH_EnableHook(address)!=MH_OK){MH_RemoveHook(address);return false;}
    installed=true;return true;
}
}
void SuspendCountryAIRoutineGate(){researchAllowed=false;constructionAllowed=false;}
bool CountryAIRoutineGateArmed(){return gatedCountry.load()!=0xffffffffu;}
bool AdmitCountryAIRoutinePost(void* command,uint32_t sourceCountry) {
    // Starting a passive observer must never enable command filtering.
    const auto own=gatedCountry.load();if(own==0xffffffffu)return true;
    uintptr_t vt=0;const auto base=CommandBuilder::Get().Base();
    if(!Read(reinterpret_cast<uintptr_t>(command),vt)){++faults;return false;}
    const auto request=Describe(reinterpret_cast<uintptr_t>(command),vt,base);
    if(sourceCountry!=own||CountryAIWorldGeneration()!=boundWorld.load()||
        !OwnIdentity(base,own)||!AllowNativeRoutine(request,own,researchAllowed.load(),constructionAllowed.load())) {
        ++postBlocked;Reject(command,vt,false);return false;
    }
    ++postAdmitted;return true;
}
Json CountryAIRoutineGate(const Json& params) {
    const auto action=params.value("action",std::string("status"));
    if(action=="arm"||action=="disarm"||action=="release_after_world_change") {
        auto state=CountryAIState();
        if(!state.value("success",false)||!state.value("paused",false)||!state.value("single_local_human_guard",false)||
            !params.contains("expected")||params["expected"]!=state["precondition"])
            return {{"success",false},{"error","routine_gate_requires_fresh_paused_local_snapshot"}};
        if(state["global_flags"]["human_ai"]!=false||state["global_flags"]["force_human_ai"]!=false)
            return {{"success",false},{"error","routine_gate_requires_country_ai_off"}};
        auto own=state["country_id"].get<uint32_t>();auto object=state["precondition"]["country_address"].get<uintptr_t>();
        if(action!="release_after_world_change"&&!EmptyOwnQueue(object,own))return {{"success",false},{"error","routine_gate_existing_native_queue_not_proven_empty"}};
        if(action=="arm") {
            if(gatedCountry.load()!=0xffffffffu)return {{"success",false},{"error","routine_gate_already_armed"}};
            const auto policy=params.value("policy",std::string());
            if(policy!="research"&&policy!="planet_construction"&&policy!="research_and_planet_construction")return {{"success",false},{"error","routine_gate_policy_unsupported"}};
            if(!Install())return {{"success",false},{"error","routine_gate_abi_unverified"}};
            boundSnapshot=state["precondition"];++generation;admitted=0;blocked=0;faults=0;postAdmitted=0;postBlocked=0;
            {std::lock_guard<std::mutex> lock(countMutex);blockedVtables.clear();}
            researchAllowed=policy!="planet_construction";constructionAllowed=policy!="research";
            boundWorld=CountryAIWorldGeneration();gatedCountryObject=object;gatedCountry=own;
        } else {
            if(action=="release_after_world_change"&&CountryAIWorldGeneration()==boundWorld.load())
                return {{"success",false},{"error","routine_gate_world_generation_unchanged"}};
            if(action!="release_after_world_change"&&(gatedCountry.load()!=own||gatedCountryObject.load()!=object))
                return {{"success",false},{"error","routine_gate_binding_changed"}};
            gatedCountry=0xffffffffu;gatedCountryObject=0;researchAllowed=false;constructionAllowed=false;
        }
    } else if(action!="status")return {{"success",false},{"error","unknown_routine_gate_action"}};
    Json counts=Json::array();{std::lock_guard<std::mutex> lock(countMutex);
        for(const auto& row:blockedVtables)counts.push_back({{"vtable_rva",row.first-CommandBuilder::Get().Base()},{"count",row.second}});}
    return {{"success",true},{"armed",gatedCountry.load()!=0xffffffffu},{"generation",generation},
        {"binding",boundSnapshot},{"research_allowed",researchAllowed.load()},
        {"planet_construction_allowed",constructionAllowed.load()},{"admitted_to_native_validation",admitted.load()},
        {"blocked_before_native_queue",blocked.load()},{"blocked_vtables",counts},{"coverage_faults",faults.load()},
        {"admitted_at_own_session_post",postAdmitted.load()},{"blocked_at_own_session_post",postBlocked.load()},
        {"enables_ai",false},{"unpauses_game",false},{"native_budget_hard_limit",false},
        {"coverage","AddAICommand_and_source_proven_own_pending_session_post"},{"production_ready",false},
        {"live_acceptance",false},{"lease_cleanup_implemented",false}};
}
}
