#pragma once
#include "common.hpp"
namespace bridge::cyberfish {
nlohmann::json AttackOptions(uint32_t country,const std::string& goal="",bool execute=false);
nlohmann::json PeaceOptions(uint32_t war,const std::string& outcome="",bool execute=false);
nlohmann::json Diplomacy(uint32_t country_id, const std::string& action, bool execute);
nlohmann::json PendingDiplomacy();
nlohmann::json RespondDiplomacy(const std::string& proposal, bool accept);
}
