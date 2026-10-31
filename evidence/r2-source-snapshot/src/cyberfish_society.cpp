#include "cyberfish_society.hpp"
#include "command_builder.hpp"
#include "game_state.hpp"
#include "government_manager.hpp"
#include "leader_manager.hpp"
#include <vector>

namespace bridge::cyberfish {
namespace {
struct Definition {void* object; void* category;};
bool ReadDefinitions(bool ascension,std::vector<Definition>& definitions) {
    __try {
        auto base=CommandBuilder::Get().Base();
        auto address=ascension ? sdk::glob::TGameDatabase_CAscensionPerkDatabase_pInstance : sdk::glob::TGameDatabase_CTraditionTypeDatabase_pInstance;
        auto* database=*(uint8_t**)(base+address);
        if(!database) return false;
        auto** array=*(void***)(database+0x50); uint32_t count=*(uint32_t*)(database+0x5C);
        if(count>1024 || (count && !array)) return false;
        for(uint32_t i=0;i<count;++i) if(array[i]) {
            definitions.push_back({array[i],ascension?nullptr:*(void**)((uint8_t*)array[i]+0x50)});
        }
        return true;
    } __except(EXCEPTION_EXECUTE_HANDLER) {return false;}
}
std::string Key(void* p) {
    if(!p) return "";
    // Only used for definitions obtained from the bounded native databases.
    return *(std::string*)((uint8_t*)p+0x20);
}
NativeCommand Candidate(const Definition& definition,bool ascension) {
    auto cmd=CommandBuilder::Get().Create(ascension ? sdk::cmd::activate_ascension_perk_command::kSpec : sdk::cmd::activate_tradition_command::kSpec);
    cmd.Set<uint32_t>(0x20,GameState::Get().GetPlayerCountryId()).Set<void*>(0x28,definition.object);
    return cmd;
}
}
nlohmann::json SocietyCandidates(bool ascension) {
    std::vector<Definition> definitions;
    if(!GameState::Get().GetPlayerCountry() || !ReadDefinitions(ascension,definitions)) return {{"error","Native society definition database unavailable"}};
    nlohmann::json candidates=nlohmann::json::array();
    for(const auto& definition:definitions) {
        auto command=Candidate(definition,ascension); std::string reason;
        if(!command.IsValid(&reason)) continue;
        auto key=Key(definition.object);
        if(!ascension && (key.ends_with("_finish") || key.ends_with("_finisher"))) continue;
        nlohmann::json row={{"key",key},{"name",SafeLocalize(CommandBuilder::Get().Base(),key)},{"legal",true}};
        if(definition.category) {auto category=Key(definition.category); row["tree_key"]=category;}
        candidates.push_back(row);
    }
    return {{"candidates",candidates},{"kind",ascension?"ascension_perk":"tradition"},
            {"note","Only candidates accepted by the normal native command's IsValid"}};
}
nlohmann::json AdoptAscension(const std::string& key) {
    std::vector<Definition> definitions;
    if(!ReadDefinitions(true,definitions)) return {{"success",false},{"error","Ascension database unavailable"}};
    for(const auto& definition:definitions) if(Key(definition.object)==key) {
        auto command=Candidate(definition,true);
        if(!command.Post()) return {{"success",false},{"error",command.error()}};
        return {{"success",true},{"perk_key",key},{"phase","ascension_posted"}};
    }
    return {{"success",false},{"error","Unknown ascension key"}};
}
nlohmann::json CouncilCandidates() {
    const auto government=GovernmentManager::Get().GetGovernmentJson();
    const auto leaders=LeaderManager::Get().GetLeadersJson();
    nlohmann::json candidates=nlohmann::json::array();
    for(const auto& seat:government.value("council_seats",nlohmann::json::array())) {
        if(seat.value("is_ruler",true) || seat.value("is_assigned",true)) continue;
        // Only these vanilla positions have audited class requirements. Other
        // civic/modded seats remain unavailable until their native UI predicate
        // is adapted; command IsValid alone only validates the two handles.
        const auto key=seat.value("position_key",std::string());
        const std::string required=key=="councilor_research"?"scientist":key=="councilor_defense"?"commander":key=="councilor_state"?"official":"";
        if(required.empty() || seat.value("position_id",0xFFFFFFFFu)==0xFFFFFFFFu) continue;
        for(const auto& leader:leaders.value("hired_leaders",nlohmann::json::array())) {
            if(leader.value("assignment_type",std::string())!="unassigned") continue;
            if(leader.value("class",std::string())!=required) continue;
            bool assigned=false;
            for(const auto& occupied:government.value("council_seats",nlohmann::json::array()))
                if(occupied.contains("leader") && occupied["leader"].is_object() && occupied["leader"].value("id",0xFFFFFFFFu)==leader.value("id",0xFFFFFFFFu)) assigned=true;
            if(assigned) continue;
            namespace assign=sdk::cmd::add_to_council_command;
            auto command=CommandBuilder::Get().Create(assign::kSpec);
            command.Set<uint32_t>(assign::leader,leader.value("id",0xFFFFFFFFu))
                .Set<uint32_t>(assign::council_position,seat.value("position_id",0xFFFFFFFFu));
            if(command.IsValid()) candidates.push_back({{"leader_id",leader["id"]},{"seat_index",seat["seat_index"]},
                {"position_id",seat["position_id"]},{"leader_name",leader.value("name",std::string())},
                {"position",seat.value("position_name",std::string())},{"legal",true}});
        }
    }
    return {{"candidates",candidates}};
}
nlohmann::json AssignCouncilor(uint32_t leader,uint32_t seat) {
    const auto current=CouncilCandidates();
    for(const auto& row:current["candidates"]) if(row["leader_id"]==leader && row["seat_index"]==seat) {
        namespace C=sdk::cmd::add_to_council_command;
        auto cmd=CommandBuilder::Get().Create(C::kSpec);
        cmd.Set<uint32_t>(C::leader,leader).Set<uint32_t>(C::council_position,row["position_id"].get<uint32_t>());
        if(!cmd.Post()) return {{"success",false},{"error",cmd.error()}};
        return {{"success",true},{"leader_id",leader},{"seat_index",seat},{"position_id",row["position_id"]},{"phase","council_assignment_posted"}};
    }
    return {{"success",false},{"error","No current owned, vacant, compatible council appointment"}};
}
}
