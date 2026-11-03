#pragma once
#include "common.hpp"
namespace bridge::cyberfish {
void OnPresent(IDXGISwapChain* chain);
nlohmann::json PictureState();
nlohmann::json CaptureFrame();
nlohmann::json FocusFleet(uint32_t fleet_id);
nlohmann::json FocusPlanet(uint32_t planet_id);
nlohmann::json ShowPlanetView(uint32_t planet_id, const std::string& tab="construction");
nlohmann::json ShowStarbaseView(uint32_t system_id, uint32_t starbase_id=0xFFFFFFFFu);
nlohmann::json ShowPanel(const std::string& panel);
nlohmann::json CameraState();
nlohmann::json ShowGalaxyMap(float zoom_override=0);
}
