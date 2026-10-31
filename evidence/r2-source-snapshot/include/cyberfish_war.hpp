#pragma once
#include "common.hpp"
namespace bridge::cyberfish {
nlohmann::json Wars();
nlohmann::json WarGoalCandidates(uint32_t war_id);
nlohmann::json SetDefenderWarGoal(uint32_t war_id,const std::string& key);
nlohmann::json CloseWarGoals();
nlohmann::json OpenWarGoals(uint32_t war_id);
bool IsWarDeclarationNotice(void* view);
nlohmann::json AcknowledgeWarDeclaration(void* view);
}
