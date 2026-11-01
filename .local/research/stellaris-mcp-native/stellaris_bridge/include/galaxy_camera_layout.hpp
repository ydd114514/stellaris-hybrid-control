#pragma once
#include <cmath>
#include <algorithm>
namespace bridge::cyberfish {
inline float GalaxyOverviewZoom(double radius,double aspect){
 if(!std::isfinite(radius)||radius<=0||radius>10000||!std::isfinite(aspect)||aspect<0.25||aspect>5)return 0;
 // Galaxy coordinates are in world units. NGraphics CAMERA_DISTANCE_TO_ZOOM
 // is 10: the camera's zoom field is not a world-space distance. Stay within
 // the native galaxy zoom steps, otherwise galaxy icons are culled entirely.
 const double required=radius/(10.0*std::tan(35.0*3.141592653589793/360.0)*0.65*std::min(1.0,aspect));
 for(const float step:{100.f,200.f,400.f,600.f,900.f,1500.f,3000.f})if(step>=required)return step;
 return 0;
}
}
