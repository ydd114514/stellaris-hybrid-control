# SPDX-License-Identifier: GPL-3.0-only
"""Offline checks for primary-war handles; never open the live game."""
import sys,struct,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"native/research"))
from war_state import read_wars,read_war_goal_window
from stellaris_memory_probe import ProbeError

class Memory:
    base=0x140000000
    def __init__(self):self.data={}
    def value(self,address,value,fmt="<Q"):
        for i,b in enumerate(struct.pack(fmt,value)):self.data[address+i]=b
    def read(self,address,size):
        try:return bytes(self.data[address+i] for i in range(size))
        except KeyError as error:raise ProbeError("unreadable") from error

class WarState(unittest.TestCase):
    def setUp(self):
        self.m=Memory()
        for address,value,fmt in ((self.m.base+0x3114D10,0x1000,"<Q"),(0x1020,1,"<I"),(0x1018,0x2000,"<Q"),
            (0x2008,0x3000,"<Q"),(0x3020,0x1000000,"<I"),(0x30D8,0,"<Q"),(0x30F8,0,"<Q"),
            (0x30E4,0x1000004,"<I"),(0x30E8,0,"<I"),(0x3104,0xFFFFFFFF,"<I"),(0x3108,0xFFFFFFFF,"<I"),
            (0x3088,0x4000,"<Q"),(0x3094,1,"<I"),(0x30A0,0x5000,"<Q"),(0x30AC,1,"<I"),
            (0x4008,0x1000004,"<I"),(0x5008,0,"<I"),(0x3110,1,"<B"),(0x3118,25000,"<q"),(0x3120,45000,"<q")):
            self.m.value(address,value,fmt)
    def test_zero_country_and_full_generation_war_handle(self):
        row=read_wars(self.m,0)[0]
        self.assertEqual(row["war_id"],0x1000000)
        self.assertEqual(row["primary_attacker_id"],0x1000004)
        self.assertEqual(row["player_side"],"defender")
        self.assertTrue(row["have_defender_war_goal"])
        self.assertEqual(row["defender_exhaustion"],.45)
    def test_unset_goal_actor_does_not_hide_primary_defender(self):
        self.assertEqual(read_wars(self.m,0)[0]["defender_goal"]["actor_country_id"],0xFFFFFFFF)
    def test_foreign_primary_war_excluded(self):self.assertEqual(read_wars(self.m,1),[])
    def test_invalid_slot_generation_is_not_resolved(self):
        self.m.value(0x3020,0x1000001,"<I")
        self.assertEqual(read_wars(self.m,0),[])
    def test_oversized_database_rejected(self):
        self.m.value(0x1020,4097,"<I")
        with self.assertRaisesRegex(ProbeError,"war_database_bounds"):read_wars(self.m,0)
    def test_participant_array_bound_is_enforced(self):
        self.m.value(0x30AC,129,"<I")
        self.assertEqual(read_wars(self.m,0),[])
    def test_window_requires_exact_native_type_and_shown_flag(self):
        self.m.value(self.m.base+0x3114E68,0x6000)
        self.m.value(0x6C18,0x7000)
        self.m.value(0x7000,self.m.base+0x240F2D0)
        self.m.value(0x7078,0x8000)
        self.m.value(0x8041,1,"<B")
        self.assertTrue(read_war_goal_window(self.m))
        self.m.value(0x7000,self.m.base+0x240F2D8)
        self.assertFalse(read_war_goal_window(self.m))

if __name__=="__main__":unittest.main()
