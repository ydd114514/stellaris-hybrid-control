#pragma once
#include "common.hpp"
namespace bridge::cyberfish {
// Configures submission admission only. Never enables AI or unpauses the game.
nlohmann::json CountryAIRoutineGate(const nlohmann::json& params);
void SuspendCountryAIRoutineGate();
// Called only for a source-proven own-country pending command at the engine's
// normal session Post boundary. Rejection consumes the object exactly once.
bool AdmitCountryAIRoutinePost(void* command, uint32_t sourceCountry);
bool CountryAIRoutineGateArmed();
// Lease-only, main-thread deltas. Baseline protected_targets are never replaced.
nlohmann::json UpdateCountryAIExplorationProtection(uint32_t fleet, bool protect,
    const nlohmann::json& expected, const nlohmann::json& expectedProtectedTargets);
bool CountryAIExplorationFleetProtected(uint32_t fleet);
bool CountryAIExplorationPeaceConfirmed();
}
