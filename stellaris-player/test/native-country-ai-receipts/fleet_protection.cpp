#include "country_ai_fleet_protection.hpp"
#include <cstring>
#include <iostream>
#include <map>
#include <stdexcept>
#include <type_traits>
#include <vector>
using namespace bridge::cyberfish;
namespace {
void Check(bool value){if(!value)throw std::runtime_error("fleet protection assertion failed");}
struct Memory {
    std::map<std::uintptr_t,unsigned char> bytes;
    std::size_t reads=0;
    template<class T> void Put(std::uintptr_t at,T value){
        const auto* p=reinterpret_cast<const unsigned char*>(&value);
        for(std::size_t i=0;i<sizeof(T);++i)bytes[at+i]=p[i];
    }
    template<class T> bool Read(std::uintptr_t at,T& value){
        ++reads;unsigned char data[sizeof(T)];
        for(std::size_t i=0;i<sizeof(T);++i){auto it=bytes.find(at+i);if(it==bytes.end())return false;data[i]=it->second;}
        std::memcpy(&value,data,sizeof(T));return true;
    }
};
constexpr std::uintptr_t command=0x10000,data=0x20000;
constexpr std::uint32_t protectedId=0x01000007u;
void Array(Memory& memory,std::uintptr_t offset,std::vector<std::uint32_t> refs){
    memory.Put(command+offset+8,data);
    memory.Put(command+offset+0x10,std::uint32_t(refs.size()));
    memory.Put(command+offset+0x14,std::uint32_t(refs.size()));
    for(std::size_t i=0;i<refs.size();++i)memory.Put(data+i*4,refs[i]);
}
}
int main(){
    const std::set<std::uint32_t> protectedRefs{0,protectedId};
    // Every table entry compiles against SDK constants and reads the complete
    // reference, not its 24-bit slot index. Mixed arrays are rejected atomically.
    for(const auto& field:kProtectedFleetCommandFields){
        Memory memory;
        if(field.array)Array(memory,field.offset,{5,protectedId});else memory.Put(command+field.offset,protectedId);
        auto read=[&](auto address,auto& value){return memory.Read(address,value);};
        auto result=MatchProtectedFleetCommand(field.name,command,protectedRefs,read);
        Check(result.recognized&&result.known&&result.targetProtected);
        if(field.array)Array(memory,field.offset,{5,7});else memory.Put(command+field.offset,std::uint32_t{7});
        result=MatchProtectedFleetCommand(field.name,command,protectedRefs,read);
        Check(result.recognized&&result.known&&!result.targetProtected);
        if(field.array)Array(memory,field.offset,{0});else memory.Put(command+field.offset,std::uint32_t{0});
        Check(MatchProtectedFleetCommand(field.name,command,protectedRefs,read).targetProtected);
    }
    Memory memory;auto read=[&](auto address,auto& value){return memory.Read(address,value);};
    auto result=MatchProtectedFleetCommand("queue_fleet_order_command",command,protectedRefs,read);
    Check(result.recognized&&!result.known&&!result.targetProtected);
    memory.Put(command+sdk::cmd::queue_fleet_order_command::fleet,std::uint32_t{0xffffffffu});
    Check(!MatchProtectedFleetCommand("queue_fleet_order_command",command,protectedRefs,read).known);
    memory.reads=0;
    Check(!MatchProtectedFleetCommand("unknown",command,protectedRefs,read).recognized&&memory.reads==0);
    Check(MatchProtectedFleetCommand("queue_fleet_order_command",command,{},read).known&&memory.reads==0);
    Check(!MatchProtectedFleetCommand("reinforce_fleet_command",command,protectedRefs,read).recognized);
    Check(!MatchProtectedFleetCommand("disband_ships_command",command,protectedRefs,read).recognized);
    Check(!MatchProtectedFleetCommand("fleet_combat_emergency_ftl_command",command,protectedRefs,read).recognized);
    // A second fleet being followed must not freeze the unrelated actor.
    memory.Put(command+sdk::cmd::follow_command::fleet,std::uint32_t{5});
    memory.Put(command+sdk::cmd::follow_command::target_fleet,protectedId);
    Check(!MatchProtectedFleetCommand("follow_command",command,protectedRefs,read).targetProtected);
    Array(memory,sdk::cmd::merge_fleets_command::fleets,{});
    Check(MatchProtectedFleetCommand("merge_fleets_command",command,protectedRefs,read).known);
    memory.Put(command+sdk::cmd::merge_fleets_command::fleets+0x14,std::uint32_t{257});
    Check(!MatchProtectedFleetCommand("merge_fleets_command",command,protectedRefs,read).known);
    Array(memory,sdk::cmd::merge_fleets_command::fleets,{5,protectedId});
    memory.Put(command+sdk::cmd::merge_fleets_command::fleets+0x10,std::uint32_t{1});
    Check(!MatchProtectedFleetCommand("merge_fleets_command",command,protectedRefs,read).known);
    Array(memory,sdk::cmd::merge_fleets_command::fleets,{5,protectedId});
    memory.Put(command+sdk::cmd::merge_fleets_command::fleets+8,std::uintptr_t{8});
    Check(!MatchProtectedFleetCommand("merge_fleets_command",command,protectedRefs,read).known);
    Array(memory,sdk::cmd::merge_fleets_command::fleets,{5,protectedId});
    unsigned pointerReads=0;
    auto movingRead=[&](auto at,auto& value){
        bool ok=memory.Read(at,value);
        if(at==command+sdk::cmd::merge_fleets_command::fleets+8&&++pointerReads==2)value=static_cast<std::remove_reference_t<decltype(value)>>(data+8);
        return ok;
    };
    Check(!MatchProtectedFleetCommand("merge_fleets_command",command,protectedRefs,movingRead).known);
    const std::vector<std::uint32_t> owned{0,protectedId};
    auto find=[&](std::uint32_t ref){return ref==0||ref==protectedId;};
    Check(IsOwnedProtectedFleetRef(0,owned,find));Check(IsOwnedProtectedFleetRef(protectedId,owned,find));
    Check(!IsOwnedProtectedFleetRef(7,owned,find));Check(!IsOwnedProtectedFleetRef(0xffffffffu,owned,find));
    Check(!IsOwnedProtectedFleetRef(protectedId,std::vector<std::uint32_t>{0},find));
    Check(!IsOwnedProtectedFleetRef(protectedId,owned,[](auto){return false;}));
    std::cout<<"fleet protection: SDK fields, whole refs, ownership, bounded arrays and unknown coverage passed\n";
}
