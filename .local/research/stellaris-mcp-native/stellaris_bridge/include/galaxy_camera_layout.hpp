#pragma once
#include <cmath>
#include <algorithm>
namespace bridge::cyberfish {
inline float GalaxyOverviewZoom(double radius,double aspect){
 if(!std::isfinite(radius)||radius<=0||radius>10000||!std::isfinite(aspect)||aspect<0.25||aspect>5)return 0;
 // Vanilla 35-degree vertical FOV; margin for the outliner and tilted plane.
 const double required=radius/(std::tan(35.0*3.141592653589793/360.0)*0.65*std::min(1.0,aspect));
 return required<=20000?static_cast<float>(std::max(3000.0,required)):0;
}
}
