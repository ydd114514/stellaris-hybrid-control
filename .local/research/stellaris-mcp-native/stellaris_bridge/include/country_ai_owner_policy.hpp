#pragma once
#include <cstdint>
namespace bridge::cyberfish {
// EShipClass from the pinned SDK, not a ship-size name whitelist. Policies
// apply to every real production queue, including a newly acquired shipyard.
struct OwnerProductionPolicy {bool peacefulExploration=false,useExistingScience=false;};
inline bool OwnerProductionBlocked(const OwnerProductionPolicy& policy,uint8_t shipClass,
    bool peaceConfirmed,bool existingScienceConfirmed) {
    if(policy.peacefulExploration&&peaceConfirmed&&(shipClass==0||shipClass==11))return true;
    return policy.useExistingScience&&existingScienceConfirmed&&shipClass==3;
}
}
