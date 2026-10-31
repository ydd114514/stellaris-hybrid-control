// MIT fork extension. Exact Windows 4.5.2 normal merge command and read queries.
#include "cyberfish_tactics.hpp"
#include "command_builder.hpp"
#include "game_state.hpp"
#include "fleet_access.hpp"
#include <algorithm>
#include <array>
#include <set>

namespace bridge::cyberfish {
namespace {
constexpr uint32_t invalid=0xFFFFFFFFu;
struct Fleet {uint32_t id,system=invalid;void* object=nullptr;int limit=0;int64_t size=0,power=0;std::vector<uint32_t> ships;std::string status;};
bool Query(Fleet& row) {
    row.object=fleets::Find(CommandBuilder::Get().Base(),row.id);
    if(!row.object || fleets::ClassOf(row.object)!=fleets::ShipClass::Military) return false;
    struct Context {uintptr_t base;void* fleet;uint32_t system;int limit;int64_t size,power;};
    Context ctx{CommandBuilder::Get().Base(),row.object,invalid,0,0,0};
    auto query=[](void* p,void*) {
        auto* x=(Context*)p;auto* f=(uint8_t*)x->fleet;
        auto iface=(uintptr_t)f+sdk::rt::CFleet_coordinate_base;
        auto fn=(*(const void*(***)(uintptr_t))iface)[sdk::vt::CFleet_GetCoordinate];
        const auto* coordinate=(const uint8_t*)fn(iface);
        if(coordinate) x->system=*(uint32_t*)(coordinate+sdk::ent::CCelestialCoordinate::origin);
        x->limit=((int(*)(void*,void*))(x->base+0xC6BD70))(f,nullptr);
        x->size=*(int64_t*)(f+0x1288);
        ((int64_t*(*)(void*,int64_t*,int,bool))(x->base+sdk::fn::CFleet_CalcMilitaryPower))(f,&x->power,0,false);
    };
    if(!CommandBuilder::Get().CallGuarded(query,&ctx) || ctx.limit<=0 || ctx.limit>100000 || ctx.size<0 || ctx.size>10000000000ll) return false;
    row.system=ctx.system;row.limit=ctx.limit;row.size=ctx.size;row.power=ctx.power;
    row.ships=fleets::ShipIds(row.object);row.status=fleets::OrdersText(row.object);
    return true;
}
bool Available(const Fleet& row) {
    return row.system!=invalid && row.status.find("失踪")==std::string::npos && row.status.find("战斗")==std::string::npos &&
        row.status.find("作战")==std::string::npos && row.status.find("升级")==std::string::npos && row.status.find("改装")==std::string::npos;
}
NativeCommand MergeCommand(const std::vector<uint32_t>& ids) {
    namespace C=sdk::cmd::merge_fleets_command;
    auto& builder=CommandBuilder::Get();auto prototype=builder.Create(C::kSpec);
    if(!prototype) return prototype;
    std::array<uint8_t,C::kSize> borrowed{};
    std::memcpy(borrowed.data(),prototype.get(),borrowed.size());
    *(uint32_t*)(borrowed.data()+C::country)=GameState::Get().GetPlayerCountryId();
    // Audited factory A70B30 / clone A6F490: ref-array interface, data, capacity,
    // size. Only the engine's deep clone owns copied storage; borrowed is never
    // destroyed as a game object and C++ heap pointers never escape into a command.
    *(const uint32_t**)(borrowed.data()+C::fleets+8)=ids.data();
    *(uint32_t*)(borrowed.data()+C::fleets+16)=(uint32_t)ids.size();
    *(uint32_t*)(borrowed.data()+C::fleets+20)=(uint32_t)ids.size();
    *(uint8_t*)(borrowed.data()+C::mia_reinforce)=0;
    *(uint8_t*)(borrowed.data()+C::cancel_orders)=1;
    struct Context {void* borrowed;void* clone;};Context ctx{borrowed.data(),nullptr};
    auto clone=[](void* p,void*) {auto* x=(Context*)p;auto vt=*(void***)x->borrowed;x->clone=((void*(*)(void*))vt[12])(x->borrowed);};
    if(!builder.CallGuarded(clone,&ctx) || !ctx.clone) return builder.Adopt(C::kSpec,nullptr);
    return builder.Adopt(C::kSpec,ctx.clone);
}
std::string PowerText(int64_t value) {
    struct Literal {const char* text;uint32_t length;uint8_t flag;uint8_t padding[3];};
    struct Context {uintptr_t base;int64_t value;Literal text;};
    Context ctx{CommandBuilder::Get().Base(),value,{"$VALUE$",7,0,{0,0,0}}};
    auto format=[](void* p,void* out) {auto* x=(Context*)p;
        // UI caller 1649B80 passes this exact power type to 812DD0, which builds
        // native numeric variant tag 8. Let the engine format its own units.
        ((void*(*)(void*,void*,void*,int64_t*))(x->base+0x812DD0))(out,&x->text,nullptr,&x->value);
    };
    std::string text;if(!CommandBuilder::Get().CallForText(format,&ctx,&text)) return "";return text;
}
std::vector<Fleet> OwnFleets() {
    std::vector<Fleet> rows;
    for(auto id:fleets::Owned(GameState::Get().GetPlayerCountry())) {
        if(rows.size()>=64) break;Fleet row{};row.id=id;if(Query(row)) rows.push_back(std::move(row));
    }
    return rows;
}
}
nlohmann::json FleetTactics(bool details) {
    const auto rows=OwnFleets();nlohmann::json fleets=nlohmann::json::array(),candidates=nlohmann::json::array();
    for(const auto& row:rows) {
        nlohmann::json entry={{"fleet_id",row.id},{"system_id",row.system},{"command_limit",row.limit},{"actual_naval_size",row.size/100000.0},
            {"total_ships",row.ships.size()},{"status",row.status},{"power_ui_text",PowerText(row.power)},{"available_to_merge",Available(row)}};
        if(details) {entry["ship_ids"]=row.ships;entry["power_raw"]=row.power;}
        fleets.push_back(entry);
    }
    for(size_t a=0;a<rows.size() && candidates.size()<12;++a) for(size_t b=a+1;b<rows.size() && candidates.size()<12;++b) {
        const auto& x=rows[a];const auto& y=rows[b];
        if(x.system!=y.system || !Available(x) || !Available(y) || x.size+y.size>int64_t(std::min(x.limit,y.limit))*100000) continue;
        auto cmd=MergeCommand({x.id,y.id});if(!cmd.IsValid()) continue;
        candidates.push_back({{"fleet_ids",{x.id,y.id}},{"system_id",x.system},{"combined_ships",x.ships.size()+y.ships.size()},
            {"combined_naval_size",(x.size+y.size)/100000.0},{"command_limit",std::min(x.limit,y.limit)},{"legal",true}});
    }
    return {{"fleets",fleets},{"merge_candidates",candidates}};
}
nlohmann::json MergeFleets(const std::vector<uint32_t>& ids) {
    if(ids.size()<2 || ids.size()>4 || std::set<uint32_t>(ids.begin(),ids.end()).size()!=ids.size()) return {{"success",false},{"error","Select 2..4 distinct owned military fleets"}};
    const auto owned=fleets::Owned(GameState::Get().GetPlayerCountry());
    uint32_t system=invalid;int limit=100000;int64_t size=0;std::vector<uint32_t> ships;
    for(auto id:ids) {
        Fleet row{};row.id=id;
        if(std::find(owned.begin(),owned.end(),id)==owned.end() || !Query(row) || !Available(row)) return {{"success",false},{"error","Merge needs active owned military fleets outside battle, MIA and upgrade"}};
        if(system==invalid) system=row.system;
        if(row.system!=system) return {{"success",false},{"error","Move these fleets to the same safe system before merging"}};
        limit=std::min(limit,row.limit);size+=row.size;ships.insert(ships.end(),row.ships.begin(),row.ships.end());
    }
    if(size>int64_t(limit)*100000) return {{"success",false},{"error","Combined fleet would exceed command limit; keep separate task groups"}};
    auto command=MergeCommand(ids);if(!command.Post()) return {{"success",false},{"error",command.error()}};
    return {{"success",true},{"fleet_ids",ids},{"before_ship_ids",ships},{"system_id",system},{"phase","merge_posted"},
        {"note","Normal merge command posted; confirm that the ships now belong to one fleet"}};
}
}
