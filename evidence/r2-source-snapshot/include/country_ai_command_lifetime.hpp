#pragma once
#include <cstdint>
#include <set>
namespace bridge::cyberfish {
struct NativeAICommandLifetime {
    bool postEntered=false,postReturned=false,originalReleased=false,uncertain=false;
    uint32_t deserialized=0,cloned=0,executed=0;
    uint32_t activeClones=0,activeExecutions=0;
    std::set<uintptr_t> liveCopies;
    bool Drained() const {
        if(uncertain||!originalReleased||!liveCopies.empty()||activeClones||activeExecutions)return false;
        if(!postEntered)return true;
        return postReturned&&(deserialized>0||cloned>0||executed>0);
    }
};
}
