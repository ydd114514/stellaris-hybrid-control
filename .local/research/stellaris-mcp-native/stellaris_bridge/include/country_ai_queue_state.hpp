#pragma once
#include <cstdint>

namespace bridge::cyberfish {
// Pinned 4.5.2 CCountryAI and strategy-reader variant. Both use the same
// initialized/owner/queue layout; the fresh human empire starts uninitialized.
inline constexpr uintptr_t kCountryAIVtableRva=0x233e8e8;
inline constexpr uintptr_t kCountryAIStrategyVtableRva=0x23c9240;
struct NativeAIQueueState {
    uintptr_t vtableRva=0;
    uint32_t owner=0xffffffffu;
    uint8_t initialized=0;
    uintptr_t data=0;
    uint32_t capacity=0;
    uint32_t size=0;
};
inline bool NativeAIQueueEmpty(const NativeAIQueueState& state,uint32_t own) {
    if(state.vtableRva!=kCountryAIVtableRva&&state.vtableRva!=kCountryAIStrategyVtableRva)return false;
    if(state.size!=0)return false;
    if(state.owner==own)return true;
    // Only the exact dormant CCountryAI state is allowed without an owner.
    // Foreign, unknown or partly initialized objects are never treated as empty.
    return state.vtableRva==kCountryAIVtableRva&&state.owner==0xffffffffu&&
        state.initialized==0&&state.data==0&&state.capacity==0;
}
}
