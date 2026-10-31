#pragma once
#include <cstdint>
#include <limits>
// Pinned Windows4.5.2 RVA0x7498A0: fixed-point ratio, then the engine's
// actual coefficient unless its country/global branch retains the raw ratio.
// This is a multiplier projection, never a quote for total fleet expenses.
namespace bridge::capacity_upkeep {
struct Result { bool known; int64_t factor; };
inline Result project(int64_t used,int64_t capacity,int64_t coefficient,bool retain_raw_ratio) {
 constexpr int64_t scale=100000;
 if(used<0||capacity<=0||coefficient<0||used>std::numeric_limits<int64_t>::max()/scale)return {false,0};
 const int64_t ratio=used>capacity?used*scale/capacity:scale;
 if(retain_raw_ratio)return {true,ratio};
 const int64_t excess=ratio-scale;
 if(coefficient&&excess>std::numeric_limits<int64_t>::max()/coefficient)return {false,0};
 const int64_t increment=excess*coefficient/scale;
 if(increment>std::numeric_limits<int64_t>::max()-scale)return {false,0};
 return {true,scale+increment};
}
}
