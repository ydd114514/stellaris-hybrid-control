#pragma once
#include "common.hpp"
namespace bridge::cyberfish {
nlohmann::json CountryAILease(const nlohmann::json& params);
// Natural game main thread / Present boundary. No background gameplay calls.
void TickCountryAILease();
}
