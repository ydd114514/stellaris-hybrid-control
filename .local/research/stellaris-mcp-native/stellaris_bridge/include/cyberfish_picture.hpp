#pragma once
#include "common.hpp"
namespace bridge::cyberfish {
void OnPresent(IDXGISwapChain* chain);
nlohmann::json PictureState();
nlohmann::json CaptureFrame();
nlohmann::json FocusFleet(uint32_t fleet_id);
nlohmann::json FocusPlanet(uint32_t planet_id);
nlohmann::json ShowPanel(const std::string& panel);
nlohmann::json CameraState();
nlohmann::json ShowGalaxyMap(float zoom_override=0);
}
