#include "outliner_manager.hpp"
#include "game_state.hpp"
#include "command_builder.hpp"
#include "colony_query_layout.hpp"
#include <algorithm>
#include <set>
#include <string>

namespace bridge {
namespace {
template<class T> bool Read(uintptr_t address,T& value) {
    __try {value=*reinterpret_cast<const T*>(address);return true;}
    __except(EXCEPTION_EXECUTE_HANDLER){return false;}
}
uintptr_t FullRef(uintptr_t base,uintptr_t database_rva,uint32_t id,size_t id_offset) {
    if(id==0xFFFFFFFFu)return 0;
    uintptr_t database=0,table=0,obj=0;uint32_t count=0,actual=0;
    if(!Read(base+database_rva,database)||database<0x10000||!Read(database+0x18,table)||table<0x10000||
       !Read(database+0x20,count)||count>1000000||(id&0xFFFFFFu)>=count||
       !Read(table+(id&0xFFFFFFu)*16+8,obj)||obj<0x10000||!Read(obj+id_offset,actual)||actual!=id)return 0;
    return obj;
}

nlohmann::json CategoryMembership(uintptr_t colony) {
    auto unknown=[](const char* why){return nlohmann::json{{"known",false},{"member_keys",nullptr},{"error",why},{"execution_semantics_verified",false}};};
    uintptr_t backlink=0,data=0;uint32_t count=0;
    if(!Read(colony+0xF08,backlink)||backlink!=colony)return unknown("Automation colony backlink mismatch");
    constexpr size_t key_count=sizeof(colony_query_layout::CategoryKeys)/sizeof(colony_query_layout::CategoryKeys[0]);
    if(!Read(colony+0xF18,data)||!Read(colony+0xF24,count)||count>key_count||count>128||count&&data<0x10000)return unknown("Category list bounds unknown");
    std::set<std::string> seen;auto keys=nlohmann::json::array();
    for(uint32_t i=0;i<count;++i){
        uintptr_t category=0,text=0;uint64_t size=0,capacity=0;
        if(!Read(data+i*8,category)||category<0x10000||!Read(category+0x30,size)||!Read(category+0x38,capacity)||
            size<1||size>128||capacity<size||capacity>65536)return unknown("Category key bounds unknown");
        text=category+0x20;
        if(capacity>=16&&(!Read(category+0x20,text)||text<0x10000))return unknown("Category text pointer unknown");
        std::string key;key.reserve(static_cast<size_t>(size));
        for(uint64_t j=0;j<size;++j){char c=0;if(!Read(text+j,c)||!(c>='a'&&c<='z'||c>='0'&&c<='9'||c=='_'))return unknown("Category key unreadable");key.push_back(c);}
        bool recognized=false;for(const auto* allowed:colony_query_layout::CategoryKeys)if(key==allowed){recognized=true;break;}
        if(!recognized||!seen.insert(key).second)return unknown("Unrecognized or duplicate category key");
        keys.push_back(key);
    }
    uintptr_t final_data=0;uint32_t final_count=0;
    if(!Read(colony+0xF18,final_data)||!Read(colony+0xF24,final_count)||final_data!=data||final_count!=count)return unknown("Category list changed during read");
    return {{"known",true},{"member_keys",keys},{"member_count",count},{"execution_semantics_verified",false},
        {"definitions_sha256",colony_query_layout::CategoryDefinitionsSha256},{"effective_mod_configuration_verified",false}};
}
}

// Only this query is registered. No enable/disable command, category mutation,
// country default, multi-colony range or budget write is exposed by this build.
nlohmann::json OutlinerManager::GetColonyAutomationJson(const nlohmann::json& params) {
    nlohmann::json out={{"known",false},{"enabled",nullptr},{"read_only",true},
        {"scope","single_owned_settled_colony"},{"settings_known",false},{"budget_known",false}};
    auto fail=[&](const char* error){out["error"]=error;return out;};
    if(!params.contains("planet_id")||!params["planet_id"].is_number_integer())return fail("A full planet_id is required");
    const auto raw=params["planet_id"].get<int64_t>();
    if(raw<0||raw>=0xFFFFFFFFLL)return fail("Invalid planet handle");
    const auto pid=static_cast<uint32_t>(raw);out["planet_id"]=pid;
    if(!SdkMatchesImage(base_address_)||!colony_query_layout::Matches(base_address_))return fail("Colony automation layout fingerprint mismatch");
    auto country=reinterpret_cast<uintptr_t>(GameState::Get().GetPlayerCountry());uint32_t owner=0xFFFFFFFFu;
    if(!country||!Read(country+sdk::rt::CCountry_id,owner)||FullRef(base_address_,sdk::db::CCountry,owner,sdk::rt::CCountry_id)!=country)return fail("Current player country is unknown");
    const auto planet=FullRef(base_address_,sdk::db::CPlanet,pid,0x18);uint32_t actual_owner=0xFFFFFFFFu,cid=0xFFFFFFFFu,qid=0xFFFFFFFFu;
    if(!planet||!Read(planet+sdk::ent::CPlanet::owner,actual_owner)||actual_owner!=owner||
       !Read(planet+sdk::ent::CPlanet::colony,cid)||cid==0xFFFFFFFFu)return fail("Target is not a current owned colony");
    const auto colony=FullRef(base_address_,sdk::db::CColony,cid,0x10);uint32_t carrier=0xFFFFFFFFu;
    if(!colony||!Read(colony+sdk::ent::CColony::carrier,carrier)||carrier!=pid)return fail("Planet and colony handles do not agree");
    uintptr_t owned=0;uint32_t owned_count=0;bool member=false;
    if(!Read(country+sdk::ent::CCountry::owned_planets+8,owned)||!Read(country+sdk::ent::CCountry::owned_planets+0x14,owned_count)||owned_count>65536||owned_count&&!owned)return fail("Owned colony membership is unknown");
    for(uint32_t i=0;i<owned_count;++i){uint32_t ref=0xFFFFFFFFu;if(!Read(owned+i*4,ref))return fail("Owned colony list is unreadable");if(ref==cid)member=true;}
    if(!member)return fail("Colony is not in the player's owned list");
    uint8_t enabled=0xFF;if(!Read(colony+colony_query_layout::Enabled,enabled)||enabled>1)return fail("Automation state byte is unknown");
    if(!Read(planet+sdk::ent::CPlanet::build_queue,qid))return fail("Colony queue handle is unreadable");
    const auto queue=FullRef(base_address_,sdk::db::CConstructionQueue,qid,sdk::rt::CConstructionQueue_id);
    uintptr_t items=0;uint32_t count=0;
    if(!queue||!Read(queue+0x20,items)||!Read(queue+0x2C,count)||count>200||count&&!items)return fail("Colony queue is unknown");
    auto pending=nlohmann::json::array();
    for(uint32_t i=0;i<count;++i){uint32_t item=0xFFFFFFFFu;if(!Read(items+i*4,item)||!FullRef(base_address_,sdk::db::CConstructionQueueItem,item,sdk::rt::CConstructionQueueItem_id))return fail("Queued item handle is unknown");pending.push_back({{"item_id",item}});}
    out["known"]=true;out["enabled"]=enabled==1;out["owner_id"]=owner;out["colony_id"]=cid;
    out["category_membership"]=CategoryMembership(colony);
    out["queue"]={{"known",true},{"queue_id",qid},{"items",pending}};
    out["note"]="State, existing queue identities and serializer category membership only; category execution semantics, costs and spending bounds remain unverified";
    return out;
}
}
