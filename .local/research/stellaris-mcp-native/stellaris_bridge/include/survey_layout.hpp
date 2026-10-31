#pragma once
#include <cstring>
namespace bridge::survey_layout {
inline constexpr uintptr_t Root = 0x2C8, Next = 8, Token = 0x18;
inline constexpr uintptr_t NullGlobal = 0x3112F78, AutomationVtable = 0x23D4120;
inline constexpr uintptr_t Clone = 0xCD8120;
inline constexpr uintptr_t ArrayVtables[] = {0x22FE568,0x23D40C8,0x22FE5B0};
inline bool Matches(uintptr_t base) {
  const unsigned char root_read[] = {0x48,0x8b,0x89,0xc8,0x02,0x00,0x00};
  if (memcmp((const void*)(base+0xC755AD), root_read, sizeof(root_read))) return false;
  const unsigned char clear_root[] = {0x48,0x8b,0x89,0xc8,0x02,0x00,0x00};
  if (memcmp((const void*)(base+0xC6AE90), clear_root, sizeof(clear_root))) return false;
  const unsigned char next_order[] = {0x48,0x8b,0x4f,0x08};
  if (memcmp((const void*)(base+0xC6AED5), next_order, sizeof(next_order))) return false;
  const unsigned char order_token[] = {0x8b,0x47,0x18};
  if (memcmp((const void*)(base+0xC6AEE7), order_token, sizeof(order_token))) return false;
  const unsigned char automation_size[] = {0xb9,0x78,0x00,0x00,0x00};
  if (memcmp((const void*)(base+0xCD8132), automation_size, sizeof(automation_size))) return false;
  const unsigned char automation_flags_copy[] = {0x0f,0xb7,0x47,0x30,0x66,0x89,0x43,0x70};
  if (memcmp((const void*)(base+0x1265A3A), automation_flags_copy, sizeof(automation_flags_copy))) return false;
  const unsigned char survey_bit[] = {0x0f,0xb6,0x7d,0x70};
  if (memcmp((const void*)(base+0xCF2A1A), survey_bit, sizeof(survey_bit))) return false;
  const unsigned char engine_run_bit_set[] = {0xb8,0x00,0x04,0x00,0x00,0x66,0x09,0x47,0x70};
  if (memcmp((const void*)(base+0xCF366D), engine_run_bit_set, sizeof(engine_run_bit_set))) return false;
  const unsigned char engine_run_bit_clear[] = {0xb8,0xff,0xfb,0x00,0x00,0x66,0x21,0x47,0x70};
  if (memcmp((const void*)(base+0xCF33DE), engine_run_bit_clear, sizeof(engine_run_bit_clear))) return false;
  return true;
}
}
