#pragma once
#include "common.hpp"

namespace bridge::cyberfish {
// Main-thread only. Research candidate: a global human-country switch guarded
// for the single local human country, NOT a per-country engine setting.
nlohmann::json CountryAIState();
nlohmann::json SetCountryAIState(const nlohmann::json& params);
}
