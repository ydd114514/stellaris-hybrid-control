#pragma once
#include "common.hpp"
namespace bridge::cyberfish {
nlohmann::json FleetTactics(bool details=false);
nlohmann::json MergeFleets(const std::vector<uint32_t>& ids);
}
