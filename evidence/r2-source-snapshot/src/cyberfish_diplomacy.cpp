// Windows 4.5.2 only: engine-owned proposal factory + normal IsValid/PostCommand.
#include "cyberfish_diplomacy.hpp"
#include "command_builder.hpp"
#include "game_state.hpp"
#include "contacts_manager.hpp"
#include "cyberfish_war.hpp"
#include "cyberfish_war_layout.hpp"
#include <array>
#include <charconv>
#include <vector>

namespace bridge::cyberfish {
namespace {
struct Action {const char* name; uint32_t token;};
constexpr Action actions[] = {
    {"improve_relations",0x351D}, {"establish_embassy",0x3383},
    {"open_borders",0x3696}, {"close_borders",0x3695},
    {"research_agreement",0x2A2D}, {"commercial_pact",0x3CB4},
    {"non_aggression_pact",0x40DA}
};
struct Context {uintptr_t base; uint32_t token; void* result;};
void CreateAction(void* p, void*) {
    auto* ctx = (Context*)p;
    // Located from CDiploActionProposeCommand::ReadMembers, not Linux offsets.
    ctx->result = ((void*(*)(uint32_t))(ctx->base+0x9A9860))(ctx->token);
}
NativeCommand Proposal(uint32_t country, uint32_t token) {
    auto& builder = CommandBuilder::Get();
    auto command = builder.Create(sdk::cmd::diplo_action_propose_command::kSpec);
    if (!command) return command;
    Context context{builder.Base(),token,nullptr};
    if (!builder.CallGuarded(CreateAction,&context) || !context.result) return command;
    auto* action = (uint8_t*)context.result;
    *(uint32_t*)(action+sdk::ent::CDiplomaticAction::actor) = GameState::Get().GetPlayerCountryId();
    *(uint32_t*)(action+sdk::ent::CDiplomaticAction::recipient) = country;
    // Factory command starts with a null scoped action; its normal destructor
    // and PostCommand now own the factory allocation, including query-only calls.
    command.Set<void*>(0x20,context.result);
    return command;
}
struct Incoming {uint64_t id; uint32_t actor,recipient,token;void* type;};
bool ReadIncoming(std::vector<Incoming>& rows) {
    __try {
        auto* country=(uint8_t*)GameState::Get().GetPlayerCountry();
        if(!country) return false;
        const auto offset=sdk::ent::CCountry::incoming_actions;
        auto* entries=*(uint8_t**)(country+offset);
        const auto count=*(uint32_t*)(country+offset+0xC);
        if(count>128 || (count && !entries)) return false;
        for(uint32_t i=0;i<count;++i) {
            auto* action=*(uint8_t**)(entries+i*0x10+8);
            if(!action) continue;
            auto* type=*(uint8_t**)(action+0x40);
            Incoming row{*(uint64_t*)(action+0x30),*(uint32_t*)(action+0x20),*(uint32_t*)(action+0x24),type?*(uint32_t*)(type+0x50):0,type};
            if(row.id && row.recipient==GameState::Get().GetPlayerCountryId()) rows.push_back(row);
        }
        return true;
    } __except(EXCEPTION_EXECUTE_HANDLER) {return false;}
}
NativeCommand Response(uint64_t proposal,bool accept) {
    namespace response=sdk::cmd::diplo_action_respond_command;
    auto command=CommandBuilder::Get().Create(response::kSpec);
    command.Set<uint64_t>(response::id,proposal).Set<uint8_t>(response::accept,accept?1:0);
    return command;
}
}
nlohmann::json AttackOptions(uint32_t country,const std::string& requested,bool execute) {
    auto& builder=CommandBuilder::Get();
    if(!builder.SdkMatchesExe()||!WarLayoutMatches(builder.Base())||!GameState::Get().GetPlayerCountry())return {{"success",false},{"error","需要匹配版本的单人游戏"}};
    bool known=false;
    for(const auto& c:ContactsManager::Get().GetContactsInfo("empires").value("empires",nlohmann::json::array()))
        if(c.value("country_id",0xFFFFFFFFu)==country)known=true;
    if(!known||country==GameState::Get().GetPlayerCountryId())return {{"success",false},{"error","目标不是当前已知外国"}};
    // CDeclareWarAction factory token 0x2D52; embedded CWarGoal at +0x50.
    // Factory ctor initializes all other fields. Proposal owns the allocation.
    auto* db=*(uint8_t**)(builder.Base()+sdk::glob::TGameDatabase_CWarGoalTypeDatabase_pInstance);
    if(!db)return {{"success",false},{"error","战争目标数据库不可用"}};
    auto** data=*(void***)(db+0x50);auto count=*(uint32_t*)(db+0x5C);
    if(count>512||(count&&!data))return {{"success",false},{"error","战争目标数据库无效"}};
    auto options=nlohmann::json::array();
    for(uint32_t i=0;i<count;++i){
        auto* type=data[i];if(!type)continue;
        const auto key=*(std::string*)((uint8_t*)type+0x20);
        if(!requested.empty()&&key!=requested)continue;
        auto command=Proposal(country,0x2D52);if(!command)return {{"success",false},{"error",command.error()}};
        auto* action=*(uint8_t**)((uint8_t*)command.get()+0x20);
        if(!action||*(uintptr_t*)action!=builder.Base()+0x23B2438)return {{"success",false},{"error","宣战Action类型不匹配"}};
        *(void**)(action+0x58)=type;
        *(uint32_t*)(action+0x64)=GameState::Get().GetPlayerCountryId();
        *(uint32_t*)(action+0x68)=country;
        std::string reason;const bool legal=command.IsValid(&reason);
        if(!execute){options.push_back({{"goal_key",key},{"legal",legal},{"reason",reason}});continue;}
        if(!legal||!command.Post())return {{"success",false},{"error",reason.empty()?command.error():reason}};
        return {{"success",true},{"country_id",country},{"goal_key",key},{"phase","declaration_posted"}};
    }
    if(execute)return {{"success",false},{"error","战争目标已失效"}};
    return {{"country_id",country},{"options",options},{"source","engine_IsValid"}};
}
nlohmann::json PeaceOptions(uint32_t war,const std::string& requested,bool execute) {
    auto& builder=CommandBuilder::Get();
    if(!builder.SdkMatchesExe()||!WarLayoutMatches(builder.Base())||!GameState::Get().GetPlayerCountry())return {{"success",false},{"error","需要匹配版本的单人游戏"}};
    auto wars=Wars();uint32_t other=0xFFFFFFFFu;
    for(const auto& row:wars.value("wars",nlohmann::json::array()))if(row.value("war_id",0xFFFFFFFFu)==war)
        other=row.value("player_side",std::string())=="attacker"?row.value("primary_defender_id",0xFFFFFFFFu):row.value("primary_attacker_id",0xFFFFFFFFu);
    if(other==0xFFFFFFFFu)return {{"success",false},{"error","不是当前己方主参战战争"}};
    auto options=nlohmann::json::array();
    // CPeaceOffer::ReadMembers/Write: status 0=status_quo,1=surrender,2=demand_surrender.
    constexpr const char* names[]={"status_quo","surrender","demand_surrender"};
    for(uint32_t status=0;status<3;++status){
        if(!requested.empty()&&requested!=names[status])continue;
        auto command=Proposal(other,0x2D53);if(!command)return {{"success",false},{"error",command.error()}};
        auto* action=*(uint8_t**)((uint8_t*)command.get()+0x20);
        if(!action||*(uintptr_t*)action!=builder.Base()+0x23B25E0)return {{"success",false},{"error","议和Action类型不匹配"}};
        *(uint32_t*)(action+0x58)=GameState::Get().GetPlayerCountryId();
        *(uint32_t*)(action+0x5C)=other;*(uint32_t*)(action+0x60)=war;*(uint32_t*)(action+0x64)=status;
        std::string reason;const bool legal=command.IsValid(&reason);
        if(!execute){options.push_back({{"outcome",names[status]},{"legal",legal},{"reason",reason}});continue;}
        if(!legal||!command.Post())return {{"success",false},{"error",reason.empty()?command.error():reason}};
        return {{"success",true},{"war_id",war},{"outcome",names[status]},{"phase","peace_proposal_posted"}};
    }
    if(execute)return {{"success",false},{"error","未知议和方式"}};
    return {{"war_id",war},{"options",options},{"note","合法提议不代表敌方接受；须回读战争结束"}};
}
nlohmann::json Diplomacy(uint32_t country_id, const std::string& requested, bool execute) {
    auto& builder = CommandBuilder::Get();
    if (!builder.SdkMatchesExe() || !GameState::Get().GetPlayerCountry())
        return {{"success",false},{"error","Supported single-player world required"}};
    const auto contacts = ContactsManager::Get().GetContactsInfo("empires");
    bool known = false;
    for (const auto& contact : contacts.value("empires",nlohmann::json::array()))
        if (contact.value("country_id",0xFFFFFFFFu)==country_id) known=true;
    if (!known || country_id == GameState::Get().GetPlayerCountryId())
        return {{"success",false},{"error","Target is not a current known foreign empire"}};
    nlohmann::json options = nlohmann::json::array();
    for (const auto& action : actions) {
        if (!requested.empty() && requested != action.name) continue;
        auto proposal = Proposal(country_id,action.token);
        std::string reason;
        const bool legal = proposal.IsValid(&reason);
        if (!execute) {options.push_back({{"action",action.name},{"legal",legal},{"reason",reason}}); continue;}
        if (!legal) return {{"success",false},{"error",reason.empty()?"Native diplomacy conditions not met":reason}};
        if (!proposal.Post()) return {{"success",false},{"error",proposal.error()}};
        return {{"success",true},{"country_id",country_id},{"action",action.name},{"phase","proposal_posted"},
                {"note","Recipient acceptance and any treaty must be observed separately"}};
    }
    if (execute) return {{"success",false},{"error","Unsupported diplomatic action"}};
    return {{"country_id",country_id},{"options",options}};
}
nlohmann::json PendingDiplomacy() {
    std::vector<Incoming> rows;
    if(!ReadIncoming(rows)) return {{"error","Cannot validate incoming proposal array"}};
    nlohmann::json result=nlohmann::json::array();
    for(const auto& row:rows) {
        auto accept=Response(row.id,true); auto reject=Response(row.id,false);
        std::string action="unknown_"+std::to_string(row.token);
        for(const auto& type:actions) if(type.token==row.token) action=type.name;
        const auto key=row.type?*(std::string*)((uint8_t*)row.type+0x20):std::string();
        result.push_back({{"proposal",std::to_string(row.id)},{"actor_country_id",row.actor},
            {"recipient_country_id",row.recipient},{"action",action},
            {"action_key",key},{"action_name",SafeLocalize(CommandBuilder::Get().Base(),key)},
            {"can_accept",accept.IsValid()},{"can_reject",reject.IsValid()}});
    }
    return {{"pending",result}};
}
nlohmann::json RespondDiplomacy(const std::string& proposal,bool accept) {
    uint64_t identifier=0;
    auto parsed=std::from_chars(proposal.data(),proposal.data()+proposal.size(),identifier);
    if(parsed.ec!=std::errc() || parsed.ptr!=proposal.data()+proposal.size() || identifier==0)
        return {{"success",false},{"error","Invalid proposal identifier"}};
    std::vector<Incoming> rows;
    if(!ReadIncoming(rows)) return {{"success",false},{"error","Incoming proposal state unavailable"}};
    bool known=false; for(const auto& row:rows) if(row.id==identifier) known=true;
    if(!known) return {{"success",false},{"error","Proposal is no longer pending for this player"}};
    auto command=Response(identifier,accept);
    if(!command.Post()) return {{"success",false},{"error",command.error()}};
    return {{"success",true},{"proposal",proposal},{"accept",accept},{"phase","response_posted"}};
}
}
