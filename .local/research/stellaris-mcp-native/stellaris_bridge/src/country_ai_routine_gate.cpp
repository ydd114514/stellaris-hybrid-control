#include "country_ai_routine_gate.hpp"
#include "country_ai_routine_policy.hpp"
#include "country_ai_queue_state.hpp"
#include "country_ai_control.hpp"
#include "command_builder.hpp"
#include "country_ai_world.hpp"
#include "country_ai_ship_layout.hpp"
#include "country_ai_owner_policy.hpp"
#include "country_ai_fleet_protection.hpp"
#include "fleet_access.hpp"
#include "game_state.hpp"
#include <MinHook.h>
#include <map>
#include <set>
#include <memory>

namespace bridge::cyberfish {
namespace {
using Json=nlohmann::json;
using AddAI=void (*)(void*,void*);
AddAI originalAddAI=nullptr;
std::atomic<uint32_t> gatedCountry{0xffffffffu};
std::atomic<uintptr_t> gatedCountryObject{0};
std::atomic<ReservedPolicy> reservedPolicy{ReservedPolicy::Suspended};
std::atomic<uint64_t> admitted{0},blocked{0},faults{0};
std::atomic<uint64_t> postAdmitted{0},postBlocked{0},protectedRejected{0};
std::mutex countMutex;
std::map<uintptr_t,uint64_t> blockedVtables;
struct CommandCounts {uint64_t admitted=0,blocked=0;};
std::map<std::string,CommandCounts> commandCounts;
const sdk::CmdSpec* const specs[]{
#include "country_ai_command_specs.inc"
};
std::string CommandName(uintptr_t vt) {
    for(auto* spec:specs)if(vt==CommandBuilder::Get().Base()+spec->vtable_rva)return spec->name;
    return "unknown";
}
void Count(uintptr_t vt,bool allowed){std::lock_guard<std::mutex> lock(countMutex);auto& row=commandCounts[CommandName(vt)];if(allowed)++row.admitted;else ++row.blocked;}

Json boundSnapshot=nullptr;
bool installed=false;
uint64_t generation=0;
struct ProtectedTargets {std::set<uint32_t> jobs,colonies,shipyards,fleets,explorationFleets;};
std::shared_ptr<const ProtectedTargets> protections=std::make_shared<const ProtectedTargets>();
std::shared_ptr<const OwnerProductionPolicy> ownerProduction=std::make_shared<const OwnerProductionPolicy>();

std::atomic<uint64_t> boundWorld{0};
std::set<uint32_t> AllProtectedFleets(const ProtectedTargets& targets) {
    auto result=targets.fleets;result.insert(targets.explorationFleets.begin(),targets.explorationFleets.end());return result;
}
Json ProtectedTargetsJson(const ProtectedTargets& targets) {
    return {{"jobs",targets.jobs},{"colonies",targets.colonies},{"shipyards",targets.shipyards},{"fleets",AllProtectedFleets(targets)}};
}
template<class T> bool Read(uintptr_t p,T& v){SIZE_T n=0;
    return p>=0x10000&&ReadProcessMemory(GetCurrentProcess(),(void*)p,&v,sizeof v,&n)&&n==sizeof v;
}
bool SafeReadPdxString(const void* address,std::string& out) {
    const auto at=(uintptr_t)address;uint64_t size=0,capacity=0;uintptr_t data=at;
    if(!Read(at+0x10,size)||!Read(at+0x18,capacity)||size>160||capacity<size)return false;
    if(capacity>=16&&!Read(at,data))return false;
    char bytes[161]{};SIZE_T n=0;if(size&&(!ReadProcessMemory(GetCurrentProcess(),(void*)data,bytes,size,&n)||n!=size))return false;
    out.assign(bytes,size);return true;
}
bool OwnIdentity(uintptr_t base,uint32_t id) {
    uintptr_t db=0,slots=0,country=0;uint32_t capacity=0,actual=0xffffffffu;
    return Read(base+0x3114c38,db)&&Read(db+0x18,slots)&&Read(db+0x20,capacity)&&
        (id&0xffffffu)<capacity&&Read(slots+(id&0xffffffu)*16+8,country)&&
        country==gatedCountryObject.load()&&Read(country+0x20,actual)&&actual==id;
}
bool EmptyOwnQueue(uintptr_t country,uint32_t own) {
    uintptr_t ai=0,vt=0;NativeAIQueueState state;
    if(!Read(country+0x1b28,ai)||!Read(ai,vt))return false;
    state.vtableRva=vt-CommandBuilder::Get().Base();
    if(state.vtableRva!=kCountryAIVtableRva&&state.vtableRva!=kCountryAIStrategyVtableRva)return false;
    if(!Read(ai+0x3a0,state.owner)||!Read(ai+sdk::ent::CCountryAI::initialized,state.initialized)||
       !Read(ai+0x530,state.data)||!Read(ai+0x538,state.capacity)||!Read(ai+0x53c,state.size))return false;
    return NativeAIQueueEmpty(state,own);
}
uintptr_t FullRef(uintptr_t base,uintptr_t databaseRva,uint32_t id,uintptr_t identityOffset) {
    uintptr_t db=0,slots=0,object=0;uint32_t capacity=0,actual=0xffffffffu;
    if(id==0xffffffffu||!Read(base+databaseRva,db)||!Read(db+0x18,slots)||!Read(db+0x20,capacity)||
        (id&0xffffffu)>=capacity||!Read(slots+(id&0xffffffu)*16+8,object)||!Read(object+identityOffset,actual)||actual!=id)return 0;
    return object;
}
bool OwnedColony(uintptr_t base,uint32_t own,uint32_t colonyId) {
    const auto colony=FullRef(base,sdk::db::CColony,colonyId,0x10);
    uint32_t planetId=0xffffffffu,owner=0xffffffffu,backReference=0xffffffffu;
    if(!colony||!Read(colony+sdk::ent::CColony::carrier,planetId))return false;
    const auto planet=FullRef(base,sdk::db::CPlanet,planetId,0x18);
    if(!planet||!Read(planet+sdk::ent::CPlanet::owner,owner)||owner!=own||
        !Read(planet+sdk::ent::CPlanet::colony,backReference)||backReference!=colonyId)return false;
    uintptr_t refs=0;uint32_t count=0;const auto country=FullRef(base,sdk::db::CCountry,own,0x20);
    if(!Read(country+sdk::ent::CCountry::owned_planets+8,refs)||!Read(country+sdk::ent::CCountry::owned_planets+0x14,count)||
        count>65536||(count&&!refs))return false;
    for(uint32_t i=0;i<count;++i){uint32_t id=0xffffffffu;if(!Read(refs+i*4,id))return false;if(id==colonyId)return true;}
    return false;
}
bool PeaceConfirmed(uintptr_t country) {
    // CCountry's inline relations manager contains the serialized CWar ref
    // array. Never infer peace from a primary-war-only summary.
    const auto wars=country+sdk::ent::CCountry::relations_manager+sdk::ent::CCountryRelationsManager::wars;
    uintptr_t data=0;uint32_t count=0;
    return Read(wars+8,data)&&Read(wars+0x14,count)&&count==0;
}
bool ExistingScienceConfirmed(uintptr_t country,uintptr_t base) {
    for(const auto id:fleets::Owned((void*)country)) {
        const auto fleet=fleets::Find(base,id);
        if(fleets::ClassOf(fleet)==fleets::ShipClass::ScienceShip&&!fleets::ShipIds(fleet).empty())return true;
    }
    return false;
}
bool ExistingMilitaryConfirmed(uintptr_t country,uintptr_t base) {
    for(const auto id:fleets::Owned((void*)country)) {
        const auto fleet=fleets::Find(base,id);
        if(fleets::ClassOf(fleet)==fleets::ShipClass::Military&&!fleets::ShipIds(fleet).empty())return true;
    }
    return false;
}
bool LeaderClass(uintptr_t base,uint32_t id,std::string& key) {
    const auto leader=FullRef(base,sdk::db::CLeader,id,sdk::rt::CLeader_id);
    uintptr_t type=0;
    return leader&&Read(leader+sdk::ent::CLeader::class_,type)&&type>=0x10000&&
        SafeReadPdxString((void*)(type+0x20),key)&&!key.empty();
}
bool OwnedLeaderRefs(uintptr_t country,std::vector<uint32_t>& ids) {
    // CCountry::owned_leaders is the serialized full-ref hired roster used by
    // GetLeadersJson. The separate candidate-pool/manager layout is not guessed.
    const auto array=country+sdk::ent::CCountry::owned_leaders;
    uintptr_t data=0,after=0;uint32_t size=0,capacity=0,afterSize=0,afterCapacity=0;
    if(!Read(array+8,data)||!Read(array+0x10,capacity)||!Read(array+0x14,size)||
        size>4096||size>capacity||(size&&!data))return false;
    for(uint32_t i=0;i<size;++i){uint32_t id=0xffffffffu;
        if(!Read(data+i*4,id)||id==0xffffffffu)return false;ids.push_back(id);}
    return Read(array+8,after)&&Read(array+0x10,afterCapacity)&&Read(array+0x14,afterSize)&&
        data==after&&size==afterSize&&capacity==afterCapacity;
}
bool LeaderRecruitmentBlocked(uintptr_t command,uintptr_t base) {
    const auto policy=std::atomic_load(&ownerProduction);
    const auto country=gatedCountryObject.load();const auto own=gatedCountry.load();
    if((!policy->useExistingScience&&!policy->peacefulExploration)||!PeaceConfirmed(country))return false;
    // CHireLeaderCommand and CHireAndAssignLeaderCommand share these two
    // pinned SDK fields. Plain CAssignLeaderCommand never enters this branch.
    uint32_t actor=0xffffffffu,candidate=0xffffffffu;
    if(!Read(command+sdk::cmd::hire_and_assign_leader::country,actor)||actor!=own||
        !Read(command+sdk::cmd::hire_and_assign_leader::leader,candidate))return false;
    std::string candidateClass;if(!LeaderClass(base,candidate,candidateClass))return false;
    const bool scientist=candidateClass=="scientist",commander=candidateClass=="commander";
    if(!scientist&&!commander)return false;
    const bool sciencePresent=scientist&&policy->useExistingScience&&ExistingScienceConfirmed(country,base);
    const bool militaryPresent=commander&&policy->peacefulExploration&&ExistingMilitaryConfirmed(country,base);
    if(!sciencePresent&&!militaryPresent)return false;
    std::vector<uint32_t> owned;
    if(!OwnedLeaderRefs(country,owned))return false;
    bool alreadyOwned=false,sameClassPresent=false;
    for(const auto id:owned){
        if(id==candidate)alreadyOwned=true;
        const auto leader=FullRef(base,sdk::db::CLeader,id,sdk::rt::CLeader_id);
        uint32_t owner=0xffffffffu;std::string key;
        if(!leader||!Read(leader+sdk::ent::CLeader::country,owner)||owner!=own||!LeaderClass(base,id,key))return false;
        if(key==candidateClass)sameClassPresent=true;
    }
    return scientist?OwnerScientistRecruitmentBlocked(*policy,true,sciencePresent,true,alreadyOwned,sameClassPresent):
        OwnerCommanderRecruitmentBlocked(*policy,true,militaryPresent,true,alreadyOwned,sameClassPresent);
}
bool EarlyOutpostBlocked(uintptr_t command,uintptr_t base) {
    namespace orbital=sdk::cmd::build_orbital_station_order;
    uint8_t shipClass=0xff;
    uint32_t target=0xffffffffu;
    if(!Read(command+orbital::class_,shipClass)||shipClass!=static_cast<uint8_t>(fleets::ShipClass::Starbase)||
        !Read(command+orbital::galactic_object,target))return false;
    const auto system=FullRef(base,sdk::db::CGalacticObject,target,sdk::rt::CGalacticObject_id);
    uint32_t owner=0;
    if(!system||!Read(system+sdk::rt::CGalacticObject_owner,owner)||owner!=0xffffffffu)return false;
    int32_t empireSize=0;
    if(!Read(gatedCountryObject.load()+sdk::ent::CCountry::empire_size,empireSize))return false;
    return OwnerEarlyOutpostBlocked(GameState::Get().ReadDate().year,empireSize,true);
}
struct NewBuildingTarget {
    uintptr_t definition=0;
    uint32_t colony=0xffffffffu,zone=0xffffffffu;
};
bool ReadNewBuildingTarget(uintptr_t buildable,NewBuildingTarget& target) {
    // CBuildableBuilding payload shared with OutlinerManager::FillBuildable.
    uint32_t existing=0;
    return Read(buildable+8,target.definition)&&target.definition>=0x10000&&
        Read(buildable+0x10,target.colony)&&Read(buildable+0x14,target.zone)&&
        Read(buildable+0x18,existing)&&existing==0xffffffffu;
}
bool ZoneHasBuilding(uintptr_t zone,uintptr_t definition,uintptr_t base) {
    const auto members=zone+sdk::ent::CZone::buildings;
    uintptr_t refs=0;uint32_t count=0;
    if(!Read(members+8,refs)||!refs||!Read(members+0x14,count)||count>256)return false;
    for(uint32_t i=0;i<count;++i) {
        uint32_t id=0xffffffffu;uintptr_t type=0;
        if(!Read(refs+i*4,id))continue;
        const auto building=FullRef(base,sdk::db::CBuilding,id,sdk::rt::CBuilding_id);
        if(building&&Read(building+sdk::ent::CBuilding::type,type)&&type==definition)return true;
    }
    return false;
}
bool QueueHasNewBuilding(const NativeRoutineRequest& request,const NewBuildingTarget& target,uintptr_t base) {
    const auto queue=FullRef(base,sdk::db::CConstructionQueue,request.queue,sdk::rt::CConstructionQueue_id);
    uint32_t owner=0xffffffffu,count=0;uintptr_t refs=0;
    const auto items=queue+sdk::ent::CConstructionQueue::items;
    if(!queue||!Read(queue+sdk::ent::CConstructionQueue::owner,owner)||owner!=request.actor||
        !Read(items+8,refs)||!refs||!Read(items+0x14,count)||count>200)return false;
    for(uint32_t i=0;i<count;++i) {
        uint32_t id=0xffffffffu,actualQueue=0xffffffffu;uintptr_t action=0,vt=0;
        if(!Read(refs+i*4,id))continue;
        const auto item=FullRef(base,sdk::db::CConstructionQueueItem,id,sdk::rt::CConstructionQueueItem_id);
        NewBuildingTarget queued;
        if(item&&Read(item+sdk::ent::CConstructionQueueItem::queue,actualQueue)&&actualQueue==request.queue&&
            Read(item+sdk::ent::CConstructionQueueItem::back,action)&&Read(action,vt)&&
            vt==base+sdk::vt::CBuildableBuilding&&ReadNewBuildingTarget(action,queued)&&
            queued.definition==target.definition&&queued.colony==target.colony&&queued.zone==target.zone)return true;
    }
    return false;
}
bool DuplicateSentinelBlocked(const NativeRoutineRequest& request,uintptr_t buildable,uintptr_t base) {
    if(request.actor!=gatedCountry.load())return false;
    NewBuildingTarget target;std::string key;
    if(!ReadNewBuildingTarget(buildable,target)||!SafeReadPdxString((void*)(target.definition+0x20),key)||
        !OwnerSentinelDuplicateLimitApplies(GameState::Get().ReadDate().year,PeaceConfirmed(gatedCountryObject.load()),key)||
        !OwnedColony(base,request.actor,target.colony))return false;
    const auto colony=FullRef(base,sdk::db::CColony,target.colony,sdk::rt::CColony_id);
    const auto zone=FullRef(base,sdk::db::CZone,target.zone,sdk::rt::CZone_id);
    uintptr_t district=0,districtColony=0;
    // Same zone/district/colony backlinks used in OutlinerManager::ColonyZones.
    if(!zone||!colony||!Read(zone+0x18,district)||!Read(district+0x18,districtColony)||districtColony!=colony)return false;
    return ZoneHasBuilding(zone,target.definition,base)||QueueHasNewBuilding(request,target,base);
}
void DescribeShipTarget(NativeRoutineRequest& request,uintptr_t buildable,uintptr_t base) {
    uint32_t starbaseId=0xffffffffu,designId=0xffffffffu,owner=0xffffffffu,queueId=0xffffffffu,ownerType=0xffffffffu;
    uint8_t type=0,extra=1;
    if(!Read(buildable+ship_layout::orbitable,starbaseId)||!Read(buildable+ship_layout::orbitableType,type)||
        !Read(buildable+ship_layout::orbitableExtra,extra)||type!=ship_layout::starbaseType||extra)return;
    const auto starbase=FullRef(base,sdk::db::CStarbase,starbaseId,sdk::rt::CStarbase_id);
    // Static starbase shipyard only. The alternate ship-carried queue used by
    // mobile carriers is deliberately not inferred from an arbitrary CShip.
    if(!starbase||!Read(starbase+sdk::ent::CStarbase::shipyard_build_queue,queueId)||queueId!=request.queue)return;
    const auto queue=FullRef(base,sdk::db::CConstructionQueue,queueId,sdk::rt::CConstructionQueue_id);
    request.queueOwned=queue&&Read(queue+sdk::ent::CConstructionQueue::owner,owner)&&owner==request.actor;
    request.targetOwned=request.queueOwned;
    request.targetProtected=std::atomic_load(&protections)->shipyards.count(starbaseId)!=0;
    if(!Read(buildable+ship_layout::design,designId))return;
    const auto design=FullRef(base,sdk::db::CShipDesign,designId,sdk::rt::CShipDesign_id);
    request.definitionPresent=design&&Read(design+sdk::ent::CShipDesign::ship_owner_type,ownerType)&&ownerType==0;
}
NativeRoutineRequest Describe(uintptr_t command,uintptr_t vt,uintptr_t base) {
    NativeRoutineRequest request;
    request.actor=gatedCountry.load(); // Natural producer/own-pending provenance, not guessed payload offsets.
    for(auto* spec:specs)if(vt==base+spec->vtable_rva){request.name=spec->name;break;}
    if(request.name=="add_policy_command") {
        uintptr_t definition=0;std::string key;
        if(Read(command+0x20,definition)&&SafeReadPdxString((void*)(definition+0x20),key))request.steeringSetting=key.rfind("cfsteer_",0)==0;
    } else if(request.name=="add_edict_command"||request.name=="remove_edict_command") {
        std::string key;if(SafeReadPdxString((void*)(command+0x30),key))request.steeringSetting=key.rfind("cfsteer_",0)==0;
    }
    if(vt==base+sdk::cmd::hire_leader::kVtableRva||vt==base+sdk::cmd::hire_and_assign_leader::kVtableRva) {
        request.ownerPolicyBlocked=LeaderRecruitmentBlocked(command,base);
    } else if(vt==base+sdk::cmd::build_orbital_station_order::kVtableRva) {
        request.ownerPolicyBlocked=EarlyOutpostBlocked(command,base);
    }
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
        else if(buildableVt==base+ship_layout::shipVtable)request.buildable=NativeRoutineBuildable::Ship;
        else if(buildableVt==base+sdk::vt::CBuildableColonyShip)request.buildable=NativeRoutineBuildable::ColonyShip;
        if(request.buildable==NativeRoutineBuildable::Building) {
            request.ownerPolicyBlocked=DuplicateSentinelBlocked(request,buildable,base);
        } else if(request.buildable==NativeRoutineBuildable::Ship||request.buildable==NativeRoutineBuildable::ColonyShip) {
            DescribeShipTarget(request,buildable,base);
            // The real embedded implementation is present in every ordinary
            // buildable, independent of which static/mobile queue produced it.
            // Unknown classes retain the default native path.
            uint8_t shipClass=0xff;
            const auto policy=std::atomic_load(&ownerProduction);
            if(request.actor==gatedCountry.load()&&Read(buildable+ship_layout::implementation+sdk::rt::CShipDesignImplementation_ship_class,shipClass))
                request.ownerPolicyBlocked=OwnerProductionBlocked(*policy,shipClass,
                    policy->peacefulExploration&&PeaceConfirmed(gatedCountryObject.load()),
                    policy->useExistingScience&&shipClass==3&&ExistingScienceConfirmed(gatedCountryObject.load(),base));
        }
    } else if(vt==base+sdk::cmd::change_job_priority_command::kVtableRva) {
        uint32_t jobId=0xffffffffu,colonyId=0xffffffffu;
        request.command=NativeRoutineCommand::WorkforceLimit;
        if(!Read(command+0x20,request.actor)||!Read(command+0x24,jobId))return {};
        const auto job=FullRef(base,sdk::db::CPopJob,jobId,sdk::rt::CPopJob_id);
        request.targetOwned=job&&Read(job+sdk::ent::CPopJob::planet,colonyId)&&OwnedColony(base,request.actor,colonyId);
        const auto protectedRefs=std::atomic_load(&protections);
        request.targetProtected=protectedRefs->jobs.count(jobId)||protectedRefs->colonies.count(colonyId);
    } else if(vt==base+sdk::cmd::set_colony_type_command::kVtableRva) {
        uint32_t colonyId=0xffffffffu;uintptr_t designation=0,definitionVt=0;
        request.command=NativeRoutineCommand::ColonyDesignation;
        if(!Read(command+0x24,request.actor)||!Read(command+0x20,colonyId)||!Read(command+0x28,designation))return {};
        request.targetOwned=OwnedColony(base,request.actor,colonyId);
        request.targetProtected=std::atomic_load(&protections)->colonies.count(colonyId)!=0;
        request.definitionPresent=Read(designation,definitionVt)&&definitionVt>=base;
    }
    const auto protectedRefs=std::atomic_load(&protections);
    const auto protectedFleetCommand=[&](const auto& refs){
        const auto match=MatchProtectedFleetCommand(request.name,command,refs,[](auto at,auto& value){return Read(at,value);});
        return match.recognized&&(!match.known||match.targetProtected);
    };
    request.targetProtected=request.targetProtected||protectedFleetCommand(protectedRefs->fleets)||protectedFleetCommand(protectedRefs->explorationFleets);
    return request;
}
void Reject(void* command,uintptr_t vt,bool beforeQueue=true) {
    // Exact ownership rejection used by b7e8d0 when IsValid returns false:
    // invoke this engine-owned command's deleting destructor once, flags=1.
    // This runs in the original producer's natural thread, not a remote call.
    if(beforeQueue)++blocked;
    Count(vt,false);
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
    if(!OwnIdentity(base,own)||!AllowNativeRoutine(request,own,reservedPolicy.load())) {
        if(request.targetProtected)++protectedRejected;
        Reject(command,vt);return;
    }
    ++admitted;Count(vt,true);originalAddAI(ai,command);
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
void SuspendCountryAIRoutineGate(){reservedPolicy=ReservedPolicy::Suspended;}
bool CountryAIRoutineGateArmed(){return gatedCountry.load()!=0xffffffffu;}
bool CountryAIExplorationFleetProtected(uint32_t fleet) {
    return gatedCountry.load()!=0xffffffffu&&reservedPolicy.load()!=ReservedPolicy::Suspended&&
        CountryAIWorldGeneration()==boundWorld.load()&&OwnIdentity(CommandBuilder::Get().Base(),gatedCountry.load())&&
        std::atomic_load(&protections)->explorationFleets.count(fleet)!=0;
}
bool CountryAIExplorationPeaceConfirmed() {
    return gatedCountry.load()!=0xffffffffu&&CountryAIWorldGeneration()==boundWorld.load()&&
        OwnIdentity(CommandBuilder::Get().Base(),gatedCountry.load())&&PeaceConfirmed(gatedCountryObject.load());
}
Json UpdateCountryAIExplorationProtection(uint32_t fleet,bool protect,const Json& expected,const Json& expectedProtectedTargets) {
    const auto state=CountryAIState();
    if(gatedCountry.load()==0xffffffffu||reservedPolicy.load()==ReservedPolicy::Suspended||
        CountryAIWorldGeneration()!=boundWorld.load()||!state.value("success",false)||
        !state.value("single_local_human_guard",false)||state["country_id"]!=gatedCountry.load()||
        expected!=state["precondition"]||state["precondition"]["country_address"]!=gatedCountryObject.load())
        return {{"success",false},{"error","exploration_protection_requires_owned_live_binding"}};
    const auto prior=std::atomic_load(&protections);
    if(expectedProtectedTargets!=ProtectedTargetsJson(*prior))return {{"success",false},{"error","exploration_protection_compare_failed"}};
    if(protect) {
        const auto base=CommandBuilder::Get().Base(),object=gatedCountryObject.load();
        const auto candidate=fleets::Find(base,fleet);
        if(!PeaceConfirmed(object)||!IsOwnedProtectedFleetRef(fleet,fleets::Owned((void*)object),[&](uint32_t ref){return fleets::Find(base,ref)!=nullptr;})||
            fleets::ClassOf(candidate)!=fleets::ShipClass::Military||fleets::ShipIds(candidate).empty())
            return {{"success",false},{"error","exploration_protection_requires_peace_owned_military_fleet"}};
    }
    // Remove only this feature's extra ref, including after war/destruction.
    // In particular an original protected fleet stays protected on release.
    auto next=std::make_shared<ProtectedTargets>(*prior);
    if(protect){if(next->explorationFleets.size()>=16&&!next->explorationFleets.count(fleet))return {{"success",false},{"error","exploration_fleet_limit"}};next->explorationFleets.insert(fleet);}
    else next->explorationFleets.erase(fleet);
    std::atomic_store(&protections,std::shared_ptr<const ProtectedTargets>(next));
    return {{"success",true},{"protected_targets",ProtectedTargetsJson(*next)},{"exploration_protected_fleets",next->explorationFleets}};
}
bool AdmitCountryAIRoutinePost(void* command,uint32_t sourceCountry) {
    // Starting a passive observer must never enable command filtering.
    const auto own=gatedCountry.load();if(own==0xffffffffu||sourceCountry!=own)return true;
    uintptr_t vt=0;const auto base=CommandBuilder::Get().Base();
    if(!Read(reinterpret_cast<uintptr_t>(command),vt)){++faults;return false;}
    const auto request=Describe(reinterpret_cast<uintptr_t>(command),vt,base);
    if(sourceCountry!=own||CountryAIWorldGeneration()!=boundWorld.load()||
        !OwnIdentity(base,own)||!AllowNativeRoutine(request,own,reservedPolicy.load())) {
        if(request.targetProtected)++protectedRejected;
        ++postBlocked;Reject(command,vt,false);return false;
    }
    ++postAdmitted;Count(vt,true);return true;
}
Json CountryAIRoutineGate(const Json& params) {
    const auto action=params.value("action",std::string("status"));
    if(action=="update_owner_policy") {
        const auto state=CountryAIState();
        if(gatedCountry.load()==0xffffffffu||CountryAIWorldGeneration()!=boundWorld.load()||!state.value("success",false)||
            !state.value("single_local_human_guard",false)||state["country_id"]!=gatedCountry.load()||
            !params.contains("expected")||params["expected"]!=state["precondition"]||
            state["precondition"]["country_address"]!=gatedCountryObject.load())
            return {{"success",false},{"error","owner_policy_requires_owned_live_binding"}};
        const auto requested=params.value("owner_policy",Json::object());
        if(!requested.is_object())return {{"success",false},{"error","owner_policy_must_be_object"}};
        for(const auto& entry:requested.items())
            if((entry.key()!="peaceful_exploration"&&entry.key()!="use_existing_science")||!entry.value().is_boolean())
                return {{"success",false},{"error","owner_policy_invalid"}};
        auto next=std::make_shared<OwnerProductionPolicy>();
        next->peacefulExploration=requested.value("peaceful_exploration",false);
        next->useExistingScience=requested.value("use_existing_science",false);
        std::atomic_store(&ownerProduction,std::shared_ptr<const OwnerProductionPolicy>(next));
    } else if(action=="arm"||action=="disarm"||action=="release_after_world_change") {
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
            const auto policy=params.value("policy",std::string("full_with_reserved"));
            if(policy!="full_with_reserved"&&policy!="research"&&policy!="planet_construction"&&policy!="research_and_planet_construction"&&policy!="economy"&&policy!="economy_and_ship_production")return {{"success",false},{"error","routine_gate_policy_unsupported"}};
            auto nextProtections=std::make_shared<ProtectedTargets>();
            auto nextOwnerPolicy=std::make_shared<OwnerProductionPolicy>();
            const auto ownerPolicy=params.value("owner_policy",Json::object());
            if(!ownerPolicy.is_object())return {{"success",false},{"error","owner_policy_must_be_object"}};
            for(const auto& entry:ownerPolicy.items())
                if((entry.key()!="peaceful_exploration"&&entry.key()!="use_existing_science")||!entry.value().is_boolean())
                    return {{"success",false},{"error","owner_policy_invalid"}};
            nextOwnerPolicy->peacefulExploration=ownerPolicy.value("peaceful_exploration",false);
            nextOwnerPolicy->useExistingScience=ownerPolicy.value("use_existing_science",false);
            // Immutable within a lease. Only fresh, owned full refs can be
            // protected; malformed or stale constraints reject the whole arm.
            const auto requested=params.value("protected_targets",Json::object());
            if(!requested.is_object())return {{"success",false},{"error","protected_targets_must_be_object"}};
            for(const auto& entry:requested.items()) {
                if(entry.key()!="jobs"&&entry.key()!="colonies"&&entry.key()!="shipyards"&&entry.key()!="fleets")return {{"success",false},{"error","unknown_protected_target_kind"}};
                if(!entry.value().is_array()||entry.value().size()>256)return {{"success",false},{"error","protected_target_list_invalid"}};
                for(const auto& value:entry.value()) {
                    if(!value.is_number_integer()||value.get<int64_t>()<0||value.get<uint64_t>()>=0xffffffffu)return {{"success",false},{"error","protected_target_ref_invalid"}};
                    const auto id=value.get<uint32_t>();bool valid=false;const auto base=CommandBuilder::Get().Base();
                    if(entry.key()=="colonies") {
                        valid=OwnedColony(base,own,id);nextProtections->colonies.insert(id);
                    } else if(entry.key()=="jobs") {
                        const auto job=FullRef(base,sdk::db::CPopJob,id,sdk::rt::CPopJob_id);uint32_t colony=0xffffffffu;
                        valid=job&&Read(job+sdk::ent::CPopJob::planet,colony)&&OwnedColony(base,own,colony);nextProtections->jobs.insert(id);
                    } else if(entry.key()=="fleets") {
                        valid=IsOwnedProtectedFleetRef(id,fleets::Owned((void*)object),[&](uint32_t ref){return fleets::Find(base,ref)!=nullptr;});
                        nextProtections->fleets.insert(id);
                    } else {
                        const auto starbase=FullRef(base,sdk::db::CStarbase,id,sdk::rt::CStarbase_id);uint32_t queueId=0xffffffffu,owner=0xffffffffu;
                        const auto queue=starbase&&Read(starbase+sdk::ent::CStarbase::shipyard_build_queue,queueId)?FullRef(base,sdk::db::CConstructionQueue,queueId,sdk::rt::CConstructionQueue_id):0;
                        valid=queue&&Read(queue+sdk::ent::CConstructionQueue::owner,owner)&&owner==own;nextProtections->shipyards.insert(id);
                    }
                    if(!valid)return {{"success",false},{"error","protected_target_not_proven_owned"}};
                }
            }
            if(!Install())return {{"success",false},{"error","routine_gate_abi_unverified"}};
            std::atomic_store(&protections,std::shared_ptr<const ProtectedTargets>(nextProtections));
            std::atomic_store(&ownerProduction,std::shared_ptr<const OwnerProductionPolicy>(nextOwnerPolicy));
            boundSnapshot=state["precondition"];++generation;admitted=0;blocked=0;faults=0;postAdmitted=0;postBlocked=0;protectedRejected=0;
            {std::lock_guard<std::mutex> lock(countMutex);blockedVtables.clear();commandCounts.clear();}
            reservedPolicy=ReservedPolicy::FullWithReserved;
            boundWorld=CountryAIWorldGeneration();gatedCountryObject=object;gatedCountry=own;
        } else {
            if(action=="release_after_world_change"&&CountryAIWorldGeneration()==boundWorld.load())
                return {{"success",false},{"error","routine_gate_world_generation_unchanged"}};
            if(action!="release_after_world_change"&&(gatedCountry.load()!=own||gatedCountryObject.load()!=object))
                return {{"success",false},{"error","routine_gate_binding_changed"}};
            gatedCountry=0xffffffffu;gatedCountryObject=0;
            std::atomic_store(&protections,std::make_shared<const ProtectedTargets>());reservedPolicy=ReservedPolicy::Suspended;
            std::atomic_store(&ownerProduction,std::make_shared<const OwnerProductionPolicy>());
        }
    } else if(action!="status")return {{"success",false},{"error","unknown_routine_gate_action"}};
    Json counts=Json::array(),named=Json::object();{std::lock_guard<std::mutex> lock(countMutex);
        for(const auto& row:blockedVtables)counts.push_back({{"vtable_rva",row.first-CommandBuilder::Get().Base()},{"count",row.second}});
        for(const auto& row:commandCounts)named[row.first]={{"admitted",row.second.admitted},{"blocked",row.second.blocked}};
    }
    const auto protectedRefs=std::atomic_load(&protections);
    const auto ownerPolicy=std::atomic_load(&ownerProduction);
    return {{"success",true},{"protected_targets",ProtectedTargetsJson(*protectedRefs)},{"exploration_protected_fleets",protectedRefs->explorationFleets},{"armed",gatedCountry.load()!=0xffffffffu},{"generation",generation},
        {"owner_policy",{{"peaceful_exploration",ownerPolicy->peacefulExploration},{"use_existing_science",ownerPolicy->useExistingScience}}},
        {"binding",boundSnapshot},{"reserved_policy","full_with_reserved"},{"suspended",reservedPolicy.load()==ReservedPolicy::Suspended},{"command_counts",named},
        {"admitted_to_native_validation",admitted.load()},
        {"protected_target_commands_blocked",protectedRejected.load()},
        {"blocked_before_native_queue",blocked.load()},{"blocked_vtables",counts},{"coverage_faults",faults.load()},
        {"admitted_at_own_session_post",postAdmitted.load()},{"blocked_at_own_session_post",postBlocked.load()},
        {"enables_ai",false},{"unpauses_game",false},{"native_budget_hard_limit",false},
        {"coverage","AddAICommand_and_source_proven_own_pending_session_post"},{"production_ready",false},
        {"live_acceptance",false},{"lease_cleanup_implemented",false}};
}
}
