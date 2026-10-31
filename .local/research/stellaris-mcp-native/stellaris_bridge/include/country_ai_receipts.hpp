#pragma once
#include <cstdint>
namespace bridge::cyberfish {
struct AICommandIdentity {
    uint32_t client=0xffffffffu;
    uint32_t sequence=0;
    uint8_t value=0;
    bool valid=false;
    uintptr_t object=0; // Diagnostic only; deliberately excluded from matching.
};
struct AICommandExecution {
    AICommandIdentity identity;
    uint64_t event=0;
    unsigned kind=0;
};
inline bool MatchesAIReceipt(const AICommandIdentity& expected,
    const AICommandExecution& execution,unsigned kind,uint64_t after) {
    return expected.valid && execution.identity.valid && execution.event>after &&
        execution.kind==kind && execution.identity.client==expected.client &&
        execution.identity.sequence==expected.sequence && execution.identity.value==expected.value;
}
}
