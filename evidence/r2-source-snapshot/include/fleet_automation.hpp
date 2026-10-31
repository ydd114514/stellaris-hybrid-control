#pragma once
#include "common.hpp"
namespace bridge {
// Main-thread only. Reads authoritative order state; never dispatches commands.
nlohmann::json GetFleetAutomation(const nlohmann::json& params);
nlohmann::json SetSurveyAutomation(const nlohmann::json& params);
}
