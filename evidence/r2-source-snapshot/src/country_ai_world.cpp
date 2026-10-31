#include "country_ai_world.hpp"
#include "command_builder.hpp"
#include <MinHook.h>
namespace bridge::cyberfish {
namespace {
std::atomic<uint64_t> worldGeneration{0};
std::atomic<bool> worldLoading{false};
using Started=void (*)(void*);
Started originalNew=nullptr,originalSaved=nullptr;
using ReadMember=bool (*)(void*,void*,uint32_t);
ReadMember originalReadMember=nullptr;
std::atomic<bool> installed{false};
void NewStarted(void* state){++worldGeneration;worldLoading=true;originalNew(state);worldLoading=false;}
void SavedStarted(void* state){++worldGeneration;originalSaved(state);worldLoading=false;}
bool ReadingWorld(void* state,void* reader,uint32_t token){
    if(!worldLoading.exchange(true))++worldGeneration;
    return originalReadMember(state,reader,token);
}
bool Signature(uintptr_t address,const uint8_t* expected) {
    uint8_t actual[16]{};SIZE_T n=0;
    return ReadProcessMemory(GetCurrentProcess(),(void*)address,actual,16,&n)&&n==16&&!memcmp(actual,expected,16);
}
}
uint64_t CountryAIWorldGeneration(){return worldGeneration.load();}
bool CountryAIWorldLoading(){return worldLoading.load();}
bool CountryAIWorldHooksInstalled(){return installed.load();}
bool InstallCountryAIWorldHooks(){
    if(installed)return true;
    auto base=CommandBuilder::Get().Base();
    static constexpr uint8_t newBytes[]{0x48,0x89,0x5c,0x24,0x10,0x48,0x89,0x74,0x24,0x18,0x48,0x89,0x7c,0x24,0x20,0x55};
    static constexpr uint8_t savedBytes[]{0x48,0x89,0x5c,0x24,0x18,0x48,0x89,0x74,0x24,0x20,0x48,0x89,0x4c,0x24,0x08,0x55};
    // CGameState vtable 2348890 slot 4: ReadMember(self, reader, token).
    // Entry saves r8d as token, rdx as reader, rcx as self, then token-switches
    // BEFORE reading any world member. This invalidates queued old writes at
    // the start of loading, rather than only after OnSavedGameStarted.
    static constexpr uint8_t readBytes[]{0x48,0x89,0x5c,0x24,0x08,0x48,0x89,0x74,0x24,0x10,0x55,0x57,0x41,0x54,0x41,0x56};
    auto n=(void*)(base+sdk::fn::CGameState_OnNewGameStarted),s=(void*)(base+sdk::fn::CGameState_OnSavedGameStarted);
    auto r=(void*)(base+0x248910);
    if(!CommandBuilder::Get().SdkMatchesExe()||!Signature((uintptr_t)n,newBytes)||!Signature((uintptr_t)s,savedBytes)||!Signature((uintptr_t)r,readBytes))return false;
    if(MH_CreateHook(n,(void*)&NewStarted,(void**)&originalNew)!=MH_OK)return false;
    if(MH_CreateHook(s,(void*)&SavedStarted,(void**)&originalSaved)!=MH_OK){MH_RemoveHook(n);return false;}
    if(MH_CreateHook(r,(void*)&ReadingWorld,(void**)&originalReadMember)!=MH_OK){MH_RemoveHook(n);MH_RemoveHook(s);return false;}
    if(MH_EnableHook(n)!=MH_OK||MH_EnableHook(s)!=MH_OK||MH_EnableHook(r)!=MH_OK){MH_DisableHook(n);MH_DisableHook(s);MH_DisableHook(r);MH_RemoveHook(n);MH_RemoveHook(s);MH_RemoveHook(r);return false;}
    installed=true;return true;
}
}
