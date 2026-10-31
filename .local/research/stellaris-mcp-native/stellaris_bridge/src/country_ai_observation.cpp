#include "country_ai_observation.hpp"
#include "country_ai_control.hpp"
#include "command_builder.hpp"
#include "country_ai_lease.hpp"
#include "country_ai_command_lifetime.hpp"
#include "country_ai_routine_gate.hpp"
#include "country_ai_world.hpp"
#include "country_ai_ship_layout.hpp"
#include <MinHook.h>
#include <deque>
#include <map>
#include <algorithm>
#include <tuple>

namespace bridge::cyberfish {
namespace {
using Json=nlohmann::json;
using Producer=void (*)(void*,int);
using Post=void (*)(void*,void*);
Producer originalProducer=nullptr; Post originalPost=nullptr;
std::atomic<uint32_t> observedCountry{0xffffffffu};
std::atomic<uintptr_t> observedObject{0};
std::atomic<uint64_t> losses{0};
bool installed=false;
std::mutex observationMutex;
uint64_t eventSequence=0,decisionSequence=0;
std::deque<Json> events;
std::map<uintptr_t,Json> pending;
using WireKey=std::tuple<uint32_t,uint32_t,uint32_t>;
struct Tracked {
    uint64_t id=0;uintptr_t original=0;Json source;NativeAICommandLifetime life;
    bool hasKey=false;WireKey key{};
    std::set<WireKey> keys;
};
using Track=std::shared_ptr<Tracked>;
std::map<uint64_t,Track> tracked;
std::map<uintptr_t,Track> originals;
std::map<uintptr_t,Track> instances;
std::map<WireKey,Track> serialized;
uint64_t trackingSequence=0;
std::atomic<uint64_t> trackingFaults{0};
using WriteCommand=void (*)(void*,void*);
using ReadCommand=void* (*)(const void*,int);
using ExecuteCommand=void (*)(void*);
using DestroyCommand=void* (*)(void*,unsigned);
WriteCommand originalWrite=nullptr;ReadCommand originalRead=nullptr;
ExecuteCommand originalResearchExecute=nullptr,originalBuildExecute=nullptr;
ExecuteCommand originalWorkforceExecute=nullptr,originalDesignationExecute=nullptr;
DestroyCommand originalResearchDestroy=nullptr,originalBuildDestroy=nullptr;
using CloneCommand=void* (*)(void*);
CloneCommand originalResearchClone=nullptr,originalBuildClone=nullptr;
CloneCommand originalWorkforceClone=nullptr,originalDesignationClone=nullptr;
Json binding=nullptr;
template<class T> bool Read(uintptr_t a,T& v) {SIZE_T n=0;
    return a>=0x10000&&ReadProcessMemory(GetCurrentProcess(),(void*)a,&v,sizeof v,&n)&&n==sizeof v;
}
void Emit(Json row) {
    row["event_sequence"]=++eventSequence;
    if(events.size()>=512){events.pop_front();++losses;}
    events.push_back(std::move(row));
}
const sdk::CmdSpec* const specs[]{
#include "country_ai_command_specs.inc"
};
uintptr_t LookupRef(uintptr_t databaseRva,uint32_t id,uintptr_t identityOffset) {
    uintptr_t db=0,slots=0,object=0;uint32_t capacity=0,actual=0xffffffffu;const auto base=CommandBuilder::Get().Base();
    if(id==0xffffffffu||!Read(base+databaseRva,db)||!Read(db+0x18,slots)||!Read(db+0x20,capacity)||
        (id&0xffffffu)>=capacity||!Read(slots+(id&0xffffffu)*16+8,object)||!Read(object+identityOffset,actual)||actual!=id)return 0;
    return object;
}
std::string DefinitionKey(uintptr_t definition) {
    const auto string=definition+0x20;uint64_t size=0,capacity=0;uintptr_t data=string;
    if(!Read(string+0x10,size)||!Read(string+0x18,capacity)||size==0||size>160||capacity<size)return {};
    if(capacity>=16&&!Read(string,data))return {};
    char bytes[161]{};SIZE_T n=0;
    if(!ReadProcessMemory(GetCurrentProcess(),(void*)data,bytes,size,&n)||n!=size)return {};
    for(size_t i=0;i<size;++i)if(!((bytes[i]>='a'&&bytes[i]<='z')||(bytes[i]>='A'&&bytes[i]<='Z')||(bytes[i]>='0'&&bytes[i]<='9')||bytes[i]=='_'||bytes[i]=='.'||bytes[i]=='-'))return {};
    return std::string(bytes,size);
}
void SemanticTarget(Json& result,uintptr_t command,const sdk::CmdSpec& spec,uintptr_t base) {
    uint32_t actor=0xffffffffu;
    if(spec.token==sdk::cmd::research_technology_command::kToken) {
        uintptr_t technology=0;
        if(Read(command+0x20,actor)&&Read(command+0x28,technology)) {
            result["payload_country_id"]=actor;result["domain"]="research";
            const auto key=DefinitionKey(technology);if(!key.empty())result["technology_key"]=key;
        }
    } else if(spec.token==sdk::cmd::change_job_priority_command::kToken) {
        uint32_t job=0xffffffffu;uint64_t desired=0;
        if(Read(command+0x20,actor)&&Read(command+0x24,job)&&Read(command+0x28,desired)) {
            result["payload_country_id"]=actor;result["domain"]="workforce";result["job_reference"]=job;
            result["desired_workforce_limit_raw"]=std::to_string(static_cast<int64_t>(desired));
            uintptr_t db=0,slots=0,object=0;uint32_t capacity=0,actual=0xffffffffu,colony=0xffffffffu;
            if(Read(base+sdk::db::CPopJob,db)&&Read(db+0x18,slots)&&Read(db+0x20,capacity)&&
                (job&0xffffffu)<capacity&&Read(slots+(job&0xffffffu)*16+8,object)&&Read(object+sdk::rt::CPopJob_id,actual)&&actual==job) {
                int64_t limit=0,maximum=0;
                if(Read(object+sdk::ent::CPopJob::planet,colony))result["colony_reference"]=colony;
                if(Read(object+sdk::ent::CPopJob::workforce_limit,limit))result["workforce_limit_before_raw"]=std::to_string(limit);
                if(Read(object+sdk::ent::CPopJob::max_workforce,maximum))result["max_workforce_raw"]=std::to_string(maximum);
            }
        }
    } else if(spec.token==sdk::cmd::set_colony_type_command::kToken) {
        uint32_t colony=0xffffffffu;uintptr_t designation=0;
        if(Read(command+0x24,actor)&&Read(command+0x20,colony)&&Read(command+0x28,designation)) {
            result["payload_country_id"]=actor;result["colony_reference"]=colony;result["domain"]="colony_designation";
            const auto key=DefinitionKey(designation);if(!key.empty())result["designation_key"]=key;
            const auto object=LookupRef(sdk::db::CColony,colony,0x10);uintptr_t before=0;
            if(object&&Read(object+0x100,before))result["designation_before_key"]=DefinitionKey(before);
        }
    } else if(spec.token==sdk::cmd::add_buildable_to_queue_command::kToken) {
        uintptr_t buildable=0,vt=0,definition=0;uint32_t queue=0xffffffffu,colony=0xffffffffu;
        if(!Read(command+0x28,actor)||!Read(command+0x2c,queue)||!Read(command+0x20,buildable)||!Read(buildable,vt))return;
        result["payload_country_id"]=actor;result["queue_id"]=queue;
        std::string kind;
        if(vt==base+sdk::vt::CBuildableBuilding)kind="building";
        else if(vt==base+sdk::vt::CBuildableDistrict)kind="district";
        else if(vt==base+sdk::vt::CBuildableUpgradeBuilding)kind="building_upgrade";
        else if(vt==base+sdk::vt::CBuildableZone)kind="zone";
        if(vt==base+ship_layout::shipVtable||vt==base+sdk::vt::CBuildableColonyShip) {
            result["domain"]="ship_production";
            result["buildable_kind"]=vt==base+ship_layout::shipVtable?"ship":"colony_ship";
            uint32_t design=0xffffffffu,starbase=0xffffffffu;uint8_t type=0,extra=1;
            if(Read(buildable+ship_layout::design,design))result["design_reference"]=design;
            if(Read(buildable+ship_layout::orbitable,starbase))result["starbase_reference"]=starbase;
            if(Read(buildable+ship_layout::orbitableType,type))result["orbitable_type"]=type;
            if(Read(buildable+ship_layout::orbitableExtra,extra))result["orbitable_has_extra"]=extra!=0;
            return;
        }
        if(kind.empty())return;
        result["domain"]="planet_construction";result["buildable_kind"]=kind;
        if(Read(buildable+0x10,colony))result["colony_reference"]=colony; // CColony, NOT an assumed CPlanet ID.
        if(Read(buildable+8,definition)){const auto key=DefinitionKey(definition);if(!key.empty())result["definition_key"]=key;}
    }
}
Json Describe(uintptr_t command) {
    uintptr_t vt=0;uint8_t flag=0;
    if(!Read(command,vt)||!Read(command+0x16,flag))return nullptr;
    auto base=CommandBuilder::Get().Base();
    Json result{{"command_address",command},{"ai_flag",flag},{"vtable_rva",vt-base}};
    for(auto* spec:specs) if(base+spec->vtable_rva==vt) {
        result["command_name"]=spec->name;result["command_token"]=spec->token;
        SemanticTarget(result,command,*spec,base);
        const size_t length=std::min<size_t>(spec->size,128);
        uint8_t bytes[128]{};SIZE_T n=0;
        if(length>=0x20&&ReadProcessMemory(GetCurrentProcess(),(void*)command,bytes,length,&n)&&n==length) {
            std::string hex;static const char digits[]="0123456789abcdef";
            for(size_t i=0x20;i<length;++i){hex+=digits[bytes[i]>>4];hex+=digits[bytes[i]&15];}
            result["payload_hex"]=hex;result["payload_offset"]=0x20;
            result["payload_truncated"]=spec->size>length;
        }
        break;
    }
    return result;
}
uint32_t AllowedToken(uintptr_t object) {
    uintptr_t vt=0;if(!Read(object,vt))return 0;auto base=CommandBuilder::Get().Base();
    if(vt==base+sdk::cmd::research_technology_command::kVtableRva)return sdk::cmd::research_technology_command::kToken;
    if(vt==base+sdk::cmd::add_buildable_to_queue_command::kVtableRva)return sdk::cmd::add_buildable_to_queue_command::kToken;
    if(vt==base+sdk::cmd::change_job_priority_command::kVtableRva)return sdk::cmd::change_job_priority_command::kToken;
    if(vt==base+sdk::cmd::set_colony_type_command::kVtableRva)return sdk::cmd::set_colony_type_command::kToken;
    return 0;
}
bool Identity(uintptr_t object,uint32_t token,WireKey& key) {
    uint32_t client=0xffffffffu,sequence=0;
    if(!token||!Read(object+8,client)||!Read(object+0x18,sequence)||client==0xffffffffu)return false;
    key={client,sequence,token};return true;
}
Track Find(uintptr_t object,uint32_t token) {
    auto instance=instances.find(object);
    if(instance!=instances.end()&&instance->second->life.liveCopies.count(object)&&
        instance->second->source.value("command_token",uint32_t(0))==token)return instance->second;
    WireKey key;
    if(Identity(object,token,key)){auto it=serialized.find(key);if(it!=serialized.end())return it->second;}
    auto it=originals.find(object);
    if(it==originals.end()||it->second->life.originalReleased)return {};
    if(it->second->source.value("command_token",uint32_t(0))!=token)return {};
    if(it->second->hasKey&&Identity(object,token,key)&&it->second->key!=key)return {};
    return it->second;
}
void ReceiptEvent(const Track& record,const char* stage,uintptr_t instance=0,Json effect=nullptr) {
    auto row=record->source;row["stage"]=stage;row["tracking_id"]=record->id;
    if(instance)row["instance_address"]=instance;
    if(record->hasKey){row["client_id"]=std::get<0>(record->key);row["command_sequence"]=std::get<1>(record->key);}
    if(!effect.is_null())row["effect_readback"]=std::move(effect);
    Emit(std::move(row));
}
void Retire(Track record) {
    if(!record->life.Drained())return;
    ReceiptEvent(record,"native_command_resolved");tracked.erase(record->id);
    auto original=originals.find(record->original);if(original!=originals.end()&&original->second==record)originals.erase(original);
    pending.erase(record->original);
    for(const auto& key:record->keys){auto wire=serialized.find(key);if(wire!=serialized.end()&&wire->second==record)serialized.erase(wire);}
}
void WritingCommand(void* command,void* writer) {
    if(observedCountry.load()!=0xffffffffu)try {
        auto object=(uintptr_t)command;auto token=AllowedToken(object);WireKey key;
        std::lock_guard<std::mutex> lock(observationMutex);auto record=Find(object,token);
        if(record&&Identity(object,token,key)){
            auto existing=serialized.find(key);
            if(existing!=serialized.end()&&existing->second!=record){record->life.uncertain=true;existing->second->life.uncertain=true;++trackingFaults;}
            record->key=key;record->hasKey=true;record->keys.insert(key);serialized[key]=record;ReceiptEvent(record,"native_command_serialized",object);
        }
    }catch(...){++trackingFaults;}
    originalWrite(command,writer);
}
void* ReadingCommand(const void* bytes,int length) {
    auto command=originalRead(bytes,length);
    if(command&&observedCountry.load()!=0xffffffffu)try {
        auto object=(uintptr_t)command;WireKey key;auto token=AllowedToken(object);
        std::lock_guard<std::mutex> lock(observationMutex);
        if(Identity(object,token,key)) {auto it=serialized.find(key);if(it!=serialized.end()) {
            auto record=it->second;
            if(object==record->original&&!record->life.originalReleased){record->life.uncertain=true;++trackingFaults;}
            record->life.liveCopies.insert(object);++record->life.deserialized;
            instances[object]=record;
            ReceiptEvent(record,"native_command_deserialized",object);
        }}
    }catch(...){++trackingFaults;}
    return command;
}
Json ShipQueueEffect(const Json& source) {
    Json result{{"known",false},{"source","direct_read_at_native_execute_boundary"}};
    const auto queueId=source.value("queue_id",uint32_t(0xffffffffu));
    const auto actor=source.value("payload_country_id",uint32_t(0xffffffffu));
    const auto queue=LookupRef(sdk::db::CConstructionQueue,queueId,sdk::rt::CConstructionQueue_id);
    uintptr_t refs=0;uint32_t count=0,owner=0xffffffffu;
    if(!queue||!Read(queue+sdk::ent::CConstructionQueue::owner,owner)||owner!=actor||
        !Read(queue+sdk::ent::CConstructionQueue::items+8,refs)||!Read(queue+sdk::ent::CConstructionQueue::items+0x14,count)||
        count>200||(count&&!refs))return result;
    Json items=Json::array();std::set<uint32_t> unique;
    const auto base=CommandBuilder::Get().Base();
    for(uint32_t i=0;i<count;++i) {
        uint32_t id=0xffffffffu,back=0xffffffffu,payer=0xffffffffu;uintptr_t buildable=0,vt=0;
        if(!Read(refs+i*4,id)||!unique.insert(id).second)return result;
        const auto item=LookupRef(sdk::db::CConstructionQueueItem,id,sdk::rt::CConstructionQueueItem_id);
        if(!item||!Read(item+sdk::ent::CConstructionQueueItem::queue,back)||back!=queueId||
            !Read(item+sdk::ent::CConstructionQueueItem::paying_country,payer))return result;
        Json row{{"item_id",id},{"queue_id",back},{"paying_country",payer}};
        if(!Read(item+sdk::ent::CConstructionQueueItem::back,buildable)||!Read(buildable,vt))return result;
        if(vt==base+ship_layout::shipVtable||vt==base+sdk::vt::CBuildableColonyShip) {
            uint32_t design=0xffffffffu,starbase=0xffffffffu;uint8_t type=0,extra=1;
            if(!Read(buildable+ship_layout::design,design)||!Read(buildable+ship_layout::orbitable,starbase)||
                !Read(buildable+ship_layout::orbitableType,type)||!Read(buildable+ship_layout::orbitableExtra,extra))return result;
            row["buildable_kind"]=vt==base+ship_layout::shipVtable?"ship":"colony_ship";
            row["design_reference"]=design;row["starbase_reference"]=starbase;row["orbitable_type"]=type;row["orbitable_has_extra"]=extra!=0;
        }
        items.push_back(std::move(row));
    }
    result["known"]=true;result["owner_id"]=owner;result["queue_id"]=queueId;result["items"]=std::move(items);return result;
}
Json AdministrativeEffect(const Json& source) {
    const auto domain=source.value("domain",std::string());
    if(domain!="workforce"&&domain!="colony_designation"&&domain!="ship_production")return nullptr;
    Json result{{"known",false},{"source","direct_read_at_native_execute_boundary"}};
    if(binding.is_null()||CountryAIWorldLoading()||binding.value("world_generation",uint64_t(-1))!=CountryAIWorldGeneration())return result;
    if(domain=="ship_production")return ShipQueueEffect(source);
    if(domain=="workforce") {
        const auto jobId=source.value("job_reference",uint32_t(0xffffffffu));
        const auto job=LookupRef(sdk::db::CPopJob,jobId,sdk::rt::CPopJob_id);
        uint32_t colony=0xffffffffu;int64_t actual=0,maximum=0;
        if(job&&Read(job+sdk::ent::CPopJob::planet,colony)&&source.value("colony_reference",uint32_t(0xffffffffu))==colony&&
            Read(job+sdk::ent::CPopJob::workforce_limit,actual)&&Read(job+sdk::ent::CPopJob::max_workforce,maximum)) {
            result["known"]=true;result["job_reference"]=jobId;result["colony_reference"]=colony;
            result["workforce_limit_raw"]=std::to_string(actual);result["max_workforce_raw"]=std::to_string(maximum);
        }
    } else {
        const auto colonyId=source.value("colony_reference",uint32_t(0xffffffffu));
        const auto colony=LookupRef(sdk::db::CColony,colonyId,0x10);uintptr_t definition=0;
        if(colony&&Read(colony+0x100,definition)) {
            const auto key=DefinitionKey(definition);
            if(!key.empty()){result["known"]=true;result["colony_reference"]=colonyId;result["designation_key"]=key;}
        }
    }
    return result;
}
void ExecutingCommand(void* command,ExecuteCommand original,uint32_t token) {
    Track record;
    if(observedCountry.load()!=0xffffffffu)try {
        std::lock_guard<std::mutex> lock(observationMutex);record=Find((uintptr_t)command,token);
        if(record){++record->life.activeExecutions;ReceiptEvent(record,"native_execute_entered",(uintptr_t)command,AdministrativeEffect(record->source));}
        else {
            auto row=Describe((uintptr_t)command);
            if(!row.is_null()&&row.value("payload_country_id",uint32_t(0xffffffffu))==observedCountry.load()) {
                row["stage"]="native_execute_unmatched";Emit(row);++trackingFaults;
            }
        }
    }catch(...){++trackingFaults;}
    original(command);
    if(record)try {std::lock_guard<std::mutex> lock(observationMutex);
        --record->life.activeExecutions;++record->life.executed;
        ReceiptEvent(record,"native_execute_returned",(uintptr_t)command,AdministrativeEffect(record->source));Retire(record);
    }catch(...){++trackingFaults;}
}
void ResearchExecuted(void* command){ExecutingCommand(command,originalResearchExecute,sdk::cmd::research_technology_command::kToken);}
void BuildExecuted(void* command){ExecutingCommand(command,originalBuildExecute,sdk::cmd::add_buildable_to_queue_command::kToken);}
void WorkforceExecuted(void* command){ExecutingCommand(command,originalWorkforceExecute,sdk::cmd::change_job_priority_command::kToken);}
void DesignationExecuted(void* command){ExecutingCommand(command,originalDesignationExecute,sdk::cmd::set_colony_type_command::kToken);}
void* CloningCommand(void* command,CloneCommand original,uint32_t token) {
    Track record;
    if(observedCountry.load()!=0xffffffffu)try {
        std::lock_guard<std::mutex> lock(observationMutex);record=Find((uintptr_t)command,token);
        if(record)++record->life.activeClones;
    }catch(...){++trackingFaults;}
    auto copy=original(command);
    if(record)try {
        std::lock_guard<std::mutex> lock(observationMutex);
        --record->life.activeClones;
        if(!copy||AllowedToken((uintptr_t)copy)!=token||!record->life.liveCopies.insert((uintptr_t)copy).second){record->life.uncertain=true;++trackingFaults;}
        else {instances[(uintptr_t)copy]=record;++record->life.cloned;ReceiptEvent(record,"native_command_cloned",(uintptr_t)copy);}
    }catch(...){++trackingFaults;}
    return copy;
}
void* ResearchCloned(void* command){return CloningCommand(command,originalResearchClone,sdk::cmd::research_technology_command::kToken);}
void* BuildCloned(void* command){return CloningCommand(command,originalBuildClone,sdk::cmd::add_buildable_to_queue_command::kToken);}
void* WorkforceCloned(void* command){return CloningCommand(command,originalWorkforceClone,sdk::cmd::change_job_priority_command::kToken);}
void* DesignationCloned(void* command){return CloningCommand(command,originalDesignationClone,sdk::cmd::set_colony_type_command::kToken);}
void* DestroyingCommand(void* command,unsigned flags,DestroyCommand original) {
    if(observedCountry.load()!=0xffffffffu)try {
        auto object=(uintptr_t)command;auto token=AllowedToken(object);
        std::lock_guard<std::mutex> lock(observationMutex);auto record=Find(object,token);
        if(record){
            if(record->life.liveCopies.erase(object)){instances.erase(object);ReceiptEvent(record,"native_copy_disposed",object);}
            else if(object==record->original){record->life.originalReleased=true;ReceiptEvent(record,"native_original_disposed",object);}
            else {record->life.uncertain=true;++trackingFaults;}
            Retire(record);
        }
    }catch(...){++trackingFaults;}
    return original(command,flags);
}
void* ResearchDestroyed(void* command,unsigned flags){return DestroyingCommand(command,flags,originalResearchDestroy);}
void* BuildDestroyed(void* command,unsigned flags){return DestroyingCommand(command,flags,originalBuildDestroy);}
void AfterProducer(void* array,int count) {
    // This function has a single verified caller, ProcessAI on the main thread.
    // Keep lease protection on game updates too, independently of rendering.
    TickCountryAILease();
    originalProducer(array,count);
    // Natural engine main-thread boundary: parallel producers have joined and
    // ProcessAI has not yet drained country queues. Never call the AI updater.
    auto own=observedCountry.load();if(own==0xffffffffu)return;
    try {
        if(count<0||count>4096){++losses;++trackingFaults;return;}
        for(int i=0;i<count;++i) {
            uintptr_t ai=0;uint32_t owner=0xffffffffu;
            if(!Read(reinterpret_cast<uintptr_t>(array)+i*8,ai)||!Read(ai+0x3a0,owner)){++losses;++trackingFaults;continue;}
            if(owner!=own)continue;
            uint32_t objectId=0xffffffffu;
            if(!Read(observedObject.load()+0x20,objectId)||objectId!=own){++losses;++trackingFaults;continue;}
            uintptr_t data=0;uint32_t size=0;
            if(!Read(ai+0x530,data)||!Read(ai+0x53c,size)||size>4096||(size&&!data)){++losses;++trackingFaults;continue;}
            std::lock_guard<std::mutex> lock(observationMutex);
            const auto decision=++decisionSequence;
            Emit({{"stage","native_producer_joined"},{"country_id",own},{"decision_sequence",decision},{"pending_count",size}});
            for(uint32_t j=0;j<size;++j) {
                uintptr_t command=0;if(!Read(data+j*8,command)){++losses;++trackingFaults;continue;}
                auto row=Describe(command);if(row.is_null()){++losses;++trackingFaults;continue;}
                row["country_id"]=own;row["decision_sequence"]=decision;
                row["stage"]="native_country_pending";
                if(pending.size()>=4096){++losses;++trackingFaults;continue;}
                pending[command]=row;Emit(row);
                // Unsupported commands are rejected before session Post below.
                // Never create an unresolvable lifetime with no typed hooks.
                if(!AllowedToken(command))continue;
                auto record=std::make_shared<Tracked>();record->id=++trackingSequence;record->original=command;record->source=row;
                tracked[record->id]=record;originals[command]=record;
            }
        }
    }catch(...){++losses;++trackingFaults;}
}
void ObservedPost(void* transport,void* command) {
    Json row=nullptr;
    if(observedCountry.load()!=0xffffffffu)try {
        std::lock_guard<std::mutex> lock(observationMutex);
        auto it=pending.find(reinterpret_cast<uintptr_t>(command));
        if(it!=pending.end()){row=it->second;pending.erase(it);}
    }catch(...){++losses;++trackingFaults;}
    if(!row.is_null()) {
        // Parallel producers have joined. A source-proven own command may have
        // bypassed AddAICommand; enforce the same policy at its final Post too.
        // Never hold observationMutex across the engine deleting destructor.
        if(!AdmitCountryAIRoutinePost(command,row["country_id"].get<uint32_t>())) {
            std::lock_guard<std::mutex> lock(observationMutex);
            row["stage"]="native_session_post_blocked";Emit(row);return;
        }
        std::lock_guard<std::mutex> lock(observationMutex);
        if(!AllowedToken((uintptr_t)command))++trackingFaults; // Passive observation cannot certify an untyped lifetime.
        row["stage"]="native_session_post_entered";Emit(row);
        auto record=originals.find((uintptr_t)command);if(record!=originals.end())record->second->life.postEntered=true;
    }
    originalPost(transport,command);
    if(!row.is_null())try {std::lock_guard<std::mutex> lock(observationMutex);
        row["stage"]="native_session_post_returned";Emit(row);
        auto record=originals.find((uintptr_t)command);if(record!=originals.end()){record->second->life.postReturned=true;Retire(record->second);}
    }catch(...){++losses;++trackingFaults;}
}
bool Install() {
    auto base=CommandBuilder::Get().Base();
    uintptr_t app=0,service=0,session=0,transport=0,vt=0,postFunction=0;
    if(!Read(base+0x3114e70,app)||!Read(app+0x140,service)||!Read(service+0x450,session)||
        !Read(session+0x60,transport)||!Read(transport,vt)||!Read(vt+0x28,postFunction)||
        postFunction!=base+0x1aeb700)return false;
    if(installed)return true;
    struct Hook {uintptr_t rva;const char* bytes;void* detour;void** original;};
    Hook hooks[]{
        {0xb86900,"48895c241055565741564157488bec48",(void*)&AfterProducer,(void**)&originalProducer},
        {0x1aeb700,"4885d20f845b08000048895424104889",(void*)&ObservedPost,(void**)&originalPost},
        {0x1a7c6c0,"48895c2408574883ec40488d057720ae",(void*)&WritingCommand,(void**)&originalWrite},
        {0x1a7cbe0,"48895c24084889742410574881ecd005",(void*)&ReadingCommand,(void**)&originalRead},
        {0x6bb3d0,"488b156198a5024c8bc94885d2742a44",(void*)&ResearchExecuted,(void**)&originalResearchExecute},
        {0xacb910,"4883ec28488d542438e8320100004883",(void*)&BuildExecuted,(void**)&originalBuildExecute},
        {0x1af570,"40534883ec20488d05b3601902488bd9",(void*)&ResearchDestroyed,(void**)&originalResearchDestroy},
        {0xacb660,"48895c2408574883ec20488d05ef648f",(void*)&BuildDestroyed,(void**)&originalBuildDestroy}
        ,{0x6d06f0,"40534883ec20488bd9b930000000e865",(void*)&ResearchCloned,(void**)&originalResearchClone}
        ,{0xacd630,"40534883ec20488bd9b930000000e825",(void*)&BuildCloned,(void**)&originalBuildClone}
        ,{0x6b6e30,"488b1591dea5024c8bd14885d2742a44",(void*)&WorkforceExecuted,(void**)&originalWorkforceExecute}
        ,{0x6b4c50,"48895c2408574883ec20488b15c701a6",(void*)&DesignationExecuted,(void**)&originalDesignationExecute}
        ,{0x6b8000,"40534883ec20488bd9b930000000e855",(void*)&WorkforceCloned,(void**)&originalWorkforceClone}
        ,{0x6b8670,"40534883ec20488bd9b930000000e8e5",(void*)&DesignationCloned,(void**)&originalDesignationClone}
    };
    if(!CommandBuilder::Get().SdkMatchesExe())return false;
    for(auto& hook:hooks){uint8_t bytes[16]{};SIZE_T n=0;
        if(!ReadProcessMemory(GetCurrentProcess(),(void*)(base+hook.rva),bytes,16,&n)||n!=16)return false;
        for(size_t i=0;i<16;++i){char text[3]{hook.bytes[i*2],hook.bytes[i*2+1],0};
            if(bytes[i]!=strtoul(text,nullptr,16))return false;}
    }
    size_t created=0;
    for(auto& hook:hooks){if(MH_CreateHook((void*)(base+hook.rva),hook.detour,hook.original)!=MH_OK)break;++created;}
    bool ok=created==std::size(hooks);
    if(ok)for(auto& hook:hooks)if(MH_EnableHook((void*)(base+hook.rva))!=MH_OK){ok=false;break;}
    if(!ok){for(size_t i=0;i<created;++i){MH_DisableHook((void*)(base+hooks[i].rva));MH_RemoveHook((void*)(base+hooks[i].rva));}return false;}
    installed=true;return true;
}
}
Json CountryAIObservation(const Json& params) {
    const auto action=params.value("action",std::string("status"));
    if(action=="start") {
        auto state=CountryAIState();
        if(!state.value("success",false)||!state.value("paused",false)||!state.value("single_local_human_guard",false)||
            !params.contains("expected")||params["expected"]!=state["precondition"])
            return {{"success",false},{"error","observation_requires_fresh_paused_local_snapshot"}};
        if(observedCountry.load()!=0xffffffffu)return {{"success",false},{"error","observation_already_armed"}};
        if(!Install())return {{"success",false},{"error","observation_abi_unavailable"}};
        std::lock_guard<std::mutex> lock(observationMutex);if(!tracked.empty())return {{"success",false},{"error","native_commands_not_drained"}};
        events.clear();pending.clear();originals.clear();instances.clear();serialized.clear();losses=0;trackingFaults=0;
        eventSequence=0;decisionSequence=0;binding=state["precondition"];
        observedObject=binding["country_address"].get<uintptr_t>();
        observedCountry=state["country_id"].get<uint32_t>();
    } else if(action=="stop") {
        std::lock_guard<std::mutex> lock(observationMutex);
        if(!tracked.empty()||trackingFaults.load())return {{"success",false},{"error","native_command_drain_unconfirmed"},
            {"unresolved_commands",tracked.size()},{"tracking_faults",trackingFaults.load()}};
        observedCountry=0xffffffffu;observedObject=0;
    }
    else if(action!="status")return {{"success",false},{"error","unknown_observation_action"}};
    const auto after=params.value("after_sequence",uint64_t(0));
    std::lock_guard<std::mutex> lock(observationMutex);Json rows=Json::array();
    for(const auto& row:events)if(row["event_sequence"].get<uint64_t>()>after)rows.push_back(row);
    return {{"success",true},{"armed",observedCountry.load()!=0xffffffffu},{"binding",binding},{"events",rows},
        {"unresolved_commands",tracked.size()},{"tracking_faults",trackingFaults.load()},{"commands_drained",tracked.empty()&&trackingFaults.load()==0},{"lost_events",losses.load()},{"last_event_sequence",eventSequence},
        {"source","native_country_ai_serialized_execution_lifetime"},{"execution_verified",false},
        {"changes_ai_policy",CountryAIRoutineGateArmed()},{"major_decision_boundary_verified",false}};
}
}
