#pragma once
#include <cstdint>
#include <string_view>
namespace bridge::cyberfish {
// EShipClass from the pinned SDK, not a ship-size name whitelist. Policies
// apply to every real production queue, including a newly acquired shipyard.
struct OwnerProductionPolicy {bool peacefulExploration=false,useExistingScience=false;};
inline bool OwnerProductionBlocked(const OwnerProductionPolicy& policy,uint8_t shipClass,
    bool peaceConfirmed,bool existingScienceConfirmed) {
    if(policy.peacefulExploration&&peaceConfirmed&&(shipClass==0||shipClass==11))return true;
    return policy.useExistingScience&&existingScienceConfirmed&&shipClass==3;
}
// Recruitment is distinct from assigning an already hired scientist. Only a
// positively classified new scientist is restrained; ordinary defence and
// every other leader class retain native control. Unknown facts pass through.
inline bool OwnerScientistRecruitmentBlocked(const OwnerProductionPolicy& policy,
    bool peaceConfirmed,bool existingScienceShipConfirmed,bool candidateScientist,
    bool candidateAlreadyOwned,bool existingScientistConfirmed) {
    return policy.useExistingScience&&peaceConfirmed&&existingScienceShipConfirmed&&
        candidateScientist&&!candidateAlreadyOwned&&existingScientistConfirmed;
}
inline bool OwnerCommanderRecruitmentBlocked(const OwnerProductionPolicy& policy,
    bool peaceConfirmed,bool existingMilitaryConfirmed,bool candidateCommander,
    bool candidateAlreadyOwned,bool existingCommanderConfirmed) {
    return policy.peacefulExploration&&peaceConfirmed&&existingMilitaryConfirmed&&
        candidateCommander&&!candidateAlreadyOwned&&existingCommanderConfirmed;
}

inline bool OwnerEarlyOutpostBlocked(uint32_t year,int32_t empireSize,bool unownedStarbaseTarget) {
    return unownedStarbaseTarget&&year>0&&year<2300&&empireSize>=100;
}

inline bool OwnerSentinelDuplicateLimitApplies(uint32_t year,bool peaceConfirmed,std::string_view buildingKey) {
    return year>0&&year<2300&&peaceConfirmed&&buildingKey=="building_sentinel_posts";
}

}
