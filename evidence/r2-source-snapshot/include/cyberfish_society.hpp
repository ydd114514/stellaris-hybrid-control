#pragma once
#include "common.hpp"
namespace bridge::cyberfish {
nlohmann::json SocietyCandidates(bool ascension);
nlohmann::json AdoptAscension(const std::string& key);
nlohmann::json CouncilCandidates();
nlohmann::json AssignCouncilor(uint32_t leader,uint32_t seat);
}
