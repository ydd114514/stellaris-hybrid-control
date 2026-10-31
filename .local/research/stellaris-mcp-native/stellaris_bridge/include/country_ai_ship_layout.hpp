#pragma once
#include <cstdint>
namespace bridge::cyberfish::ship_layout {
// Windows 4.5.2 pinned image: AB5AC0 creates the owner-type-zero ship at
// AB5BCA..AB5C22. Its serializer B05A10 independently reads impl+8 and
// orbitable+540. B064F0 creates the existing SDK colony-ship subtype.
// The other factory branches (federation/other owner types) are NOT admitted.
inline constexpr uintptr_t shipVtable=0x23A39D8;
inline constexpr uintptr_t implementation=0x8;
inline constexpr uintptr_t design=0x538;
inline constexpr uintptr_t orbitable=0x540;
inline constexpr uintptr_t orbitableType=0x544;
inline constexpr uintptr_t orbitableExtra=0x548;
inline constexpr uint8_t starbaseType=2;
}
