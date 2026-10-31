// Pinned Windows 4.5.2: normal defender goal commands, always on TaskQueue.
#include "cyberfish_war.hpp"
#include "command_builder.hpp"
#include "game_state.hpp"
#include <vector>

namespace bridge::cyberfish {
namespace {
constexpr uint32_t invalid=0xFFFFFFFFu;
struct War {uint32_t id,attacker,defender; void* attacker_type; void* defender_type; bool chosen; int64_t a_exhaustion,d_exhaustion;};
bool ReadWars(std::vector<War>& rows) {
    __try {
        auto base=CommandBuilder::Get().Base();
        auto* db=*(uint8_t**)(base+0x3114D10);
        if(!db) return false;
        auto* slots=*(uint8_t**)(db+0x18); auto count=*(uint32_t*)(db+0x20);
        if(count>4096 || (count && !slots)) return false;
        auto own=GameState::Get().GetPlayerCountryId();
        for(uint32_t slot=0;slot<count;++slot) {
            auto* p=*(uint8_t**)(slots+slot*16+8); if(!p) continue;
            auto id=*(uint32_t*)(p+0x20); if(id==invalid || (id&0xFFFFFF)!=slot) continue;
            auto* a=*(uint8_t**)(p+0x88); auto ac=*(uint32_t*)(p+0x94);
            auto* d=*(uint8_t**)(p+0xA0); auto dc=*(uint32_t*)(p+0xAC);
            if(!a || !d || ac==0 || dc==0 || ac>128 || dc>128) continue;
            auto attacker=*(uint32_t*)(a+8),defender=*(uint32_t*)(d+8);
            if(own!=attacker && own!=defender) continue;
            rows.push_back({id,attacker,defender,*(void**)(p+0xD8),*(void**)(p+0xF8),*(uint8_t*)(p+0x110)!=0,
                *(int64_t*)(p+0x118),*(int64_t*)(p+0x120)});
        }
        return true;
    } __except(EXCEPTION_EXECUTE_HANDLER) {return false;}
}
bool GoalTypes(std::vector<void*>& rows) {
    __try {
        auto* db=*(uint8_t**)(CommandBuilder::Get().Base()+sdk::glob::TGameDatabase_CWarGoalTypeDatabase_pInstance);
        if(!db) return false;
        auto** data=*(void***)(db+0x50); auto count=*(uint32_t*)(db+0x5C);
        if(count>512 || (count && !data)) return false;
        for(uint32_t i=0;i<count;++i) if(data[i]) rows.push_back(data[i]);
        return true;
    } __except(EXCEPTION_EXECUTE_HANDLER) {return false;}
}
std::string Key(void* type) {return type?*(std::string*)((uint8_t*)type+0x20):std::string();}
void* VisibleView() {
    __try {
        auto base=CommandBuilder::Get().Base(); auto* idler=*(uint8_t**)(base+sdk::glob::g_CurrentInGameIdler);
        if(!idler) return nullptr;
        auto* view=*(uint8_t**)(idler+0xC18);
        if(!view || *(uintptr_t*)view!=base+0x240F2D0) return nullptr;
        auto* window=*(uint8_t**)(view+0x78);
        return window && *(uint8_t*)(window+0x41) ? view : nullptr;
    } __except(EXCEPTION_EXECUTE_HANDLER) {return nullptr;}
}
NativeCommand GoalCommand(uint32_t war,void* type) {
    namespace C=sdk::cmd::diplo_action_set_defender_war_goal_command;
    auto cmd=CommandBuilder::Get().Create(C::kSpec);
    // UI keeps the other embedded CWarGoal fields at factory defaults. IsValid
    // verifies primary defender, current full war handle and legal goal type.
    cmd.Set<uint32_t>(C::country,GameState::Get().GetPlayerCountryId()).Set<uint32_t>(C::war,war)
        .Set<void*>(C::defender_war_goal+8,type);
    return cmd;
}
bool PendingDefender(uint32_t war) {
    std::vector<War> rows; if(!ReadWars(rows)) return false;
    for(const auto& row:rows) if(row.id==war && row.defender==GameState::Get().GetPlayerCountryId() && !row.chosen) return true;
    return false;
}
void HideView(void* ctx,void*) {auto* view=ctx; auto** vt=*(void***)view; ((void(*)(void*))vt[7])(view);}
}
nlohmann::json Wars() {
    std::vector<War> rows;
    if(!CommandBuilder::Get().SdkMatchesExe() || !ReadWars(rows)) return {{"error","Primary-war state unavailable"}};
    nlohmann::json result=nlohmann::json::array();
    auto own=GameState::Get().GetPlayerCountryId();
    for(const auto& row:rows) result.push_back({{"war_id",row.id},{"player_side",row.attacker==own?"attacker":"defender"},
        {"primary_attacker_id",row.attacker},{"primary_defender_id",row.defender},
        {"attacker_goal",{{"key",Key(row.attacker_type)}}},{"defender_goal",{{"key",Key(row.defender_type)}}},
        {"have_defender_war_goal",row.chosen},{"attacker_exhaustion",row.a_exhaustion/100000.0},{"defender_exhaustion",row.d_exhaustion/100000.0}});
    return {{"wars",result},{"warGoalsWindow",VisibleView()!=nullptr},{"scope","primary_participant"}};
}
nlohmann::json WarGoalCandidates(uint32_t war_id) {
    if(!PendingDefender(war_id)) return {{"war_id",war_id},{"candidates",nlohmann::json::array()},{"reason","No unselected local primary-defender goal"}};
    std::vector<void*> types;
    if(!GoalTypes(types)) return {{"error","War goal database unavailable"}};
    nlohmann::json result=nlohmann::json::array();
    for(auto* type:types) {
        auto cmd=GoalCommand(war_id,type); if(!cmd.IsValid()) continue;
        auto key=Key(type); result.push_back({{"key",key},{"name",SafeLocalize(CommandBuilder::Get().Base(),key)},{"legal",true}});
    }
    return {{"war_id",war_id},{"candidates",result}};
}
nlohmann::json SetDefenderWarGoal(uint32_t war_id,const std::string& key) {
    if(!PendingDefender(war_id)) return {{"success",false},{"error","No unselected local primary-defender goal"}};
    if(!VisibleView()) return {{"success",false},{"error","Open the normal war-goals window before choosing a goal"}};
    std::vector<void*> types; if(!GoalTypes(types)) return {{"success",false},{"error","War goal database unavailable"}};
    for(auto* type:types) if(Key(type)==key) {
        auto cmd=GoalCommand(war_id,type);
        if(!cmd.Post()) return {{"success",false},{"error",cmd.error()}};
        return {{"success",true},{"war_id",war_id},{"goal_key",key},{"phase","goal_posted"}};
    }
    return {{"success",false},{"error","Unknown war goal key"}};
}
nlohmann::json OpenWarGoals(uint32_t war_id) {
    std::vector<War> rows;if(!ReadWars(rows)) return {{"success",false},{"error","War state unavailable"}};
    uint32_t opponent=invalid;
    for(const auto& row:rows) if(row.id==war_id && row.defender==GameState::Get().GetPlayerCountryId() && !row.chosen) opponent=row.attacker;
    if(opponent==invalid) return {{"success",false},{"error","No unselected local primary-defender war goal"}};
    auto* idler=(uint8_t*)GameState::Get().GetInGameIdler();
    auto* gui=idler?*(uint8_t**)(idler+0xC18):nullptr;
    auto base=CommandBuilder::Get().Base();
    if(!gui || *(uintptr_t*)gui!=base+0x240F2D0) return {{"success",false},{"error","War-goals view type mismatch"}};
    // Exact calls made by the declaration dialog's Set War Goal button
    // (0x1183B80). The stored GUI interface is +18 within the primary view.
    struct Context {uintptr_t base;void* idler;void* primary;uint32_t war;};
    Context ctx{base,idler,gui-0x18,war_id};
    auto open=[](void* p,void*) {auto* x=(Context*)p;
        ((void(*)(void*))(x->base+0x926250))(x->idler);
        ((void(*)(void*,uint32_t*))(x->base+0x1110E70))(x->primary,&x->war);
    };
    if(!CommandBuilder::Get().CallGuarded(open,&ctx)) return {{"success",false},{"error","Normal war-goals opener failed"}};
    return {{"success",VisibleView()!=nullptr},{"war_id",war_id},{"warGoalsWindow",VisibleView()!=nullptr}};
}
nlohmann::json CloseWarGoals() {
    std::vector<War> rows; if(!ReadWars(rows)) return {{"success",false},{"error","War state unavailable"}};
    for(const auto& row:rows) if(row.defender==GameState::Get().GetPlayerCountryId() && !row.chosen)
        return {{"success",false},{"error","Choose the local defender war goal first"}};
    auto* view=VisibleView();
    if(view && !CommandBuilder::Get().CallGuarded(HideView,view)) return {{"success",false},{"error","Normal war-goals hide failed"}};
    return {{"success",VisibleView()==nullptr},{"warGoalsWindow",VisibleView()!=nullptr}};
}
bool IsWarDeclarationNotice(void* view) {
    __try {
        auto base=CommandBuilder::Get().Base();
        if(!view || *(uintptr_t*)view!=base+0x2416E00) return false;
        auto* action=*(uint8_t**)((uint8_t*)view+0x4E8);
        if(!action || *(uint64_t*)((uint8_t*)view+0x4F0)!=0) return false;
        auto* type=*(uint8_t**)(action+0x40);
        return type && *(uint32_t*)(type+0x50)==0x2D52 &&
            *(uint32_t*)(action+0x24)==GameState::Get().GetPlayerCountryId();
    } __except(EXCEPTION_EXECUTE_HANDLER) {return false;}
}
nlohmann::json AcknowledgeWarDeclaration(void* view) {
    if(!IsWarDeclarationNotice(view)) return {{"success",false},{"error","Not a current local informational declaration of war"}};
    auto wars=Wars();
    if(wars.value("warGoalsWindow",false)) return {{"success",false},{"error","Handle the war-goals window first"}};
    auto actor=*(uint32_t*)(*(uint8_t**)((uint8_t*)view+0x4E8)+0x20);
    bool goalChosen=false;
    for(const auto& row:wars.value("wars",nlohmann::json::array())) if(row["primary_attacker_id"]==actor && row.value("player_side",std::string())=="defender" && row.value("have_defender_war_goal",false)) goalChosen=true;
    if(!goalChosen) return {{"success",false},{"error","Read and choose the defender goal before acknowledging this declaration"}};
    // Audited button callback: proposal==0 means this informational notice only
    // closes its own view. Nonzero incoming proposals are deliberately excluded.
    struct Context {uintptr_t base;void* view;}; Context ctx{CommandBuilder::Get().Base(),view};
    auto confirm=[](void* p,void*) {auto* x=(Context*)p; ((void(*)(void*))(x->base+0x117FB70))(x->view);};
    if(!CommandBuilder::Get().CallGuarded(confirm,&ctx)) return {{"success",false},{"error","War declaration confirmation raised an exception"}};
    return {{"success",true},{"message","Informational war declaration acknowledged with its normal confirm callback"}};
}
}
