import unittest,struct,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native/research'))
from colony_ownership_probe import owned_colony_relationship
from stellaris_memory_probe import ProbeError

class Memory:
    def __init__(self):self.bytes={}
    def put(self,address,value,fmt='<Q'):
        for index,byte in enumerate(struct.pack(fmt,value)):self.bytes[address+index]=byte
    def read(self,address,count):
        try:return bytes(self.bytes[address+i] for i in range(count))
        except KeyError:raise ProbeError('unreadable_fixture')

def fixture():
    m=Memory();base=0x100000000
    for rva,db,table,obj,handle,id_offset in [(0x3114E10,0x10000,0x20000,0x30000,3,0x18),(0x3114C38,0x40000,0x50000,0x60000,0,0x20),(0x3114E28,0x70000,0x80000,0x90000,0,0x10)]:
        m.put(base+rva,db);m.put(db+0x18,table);m.put(db+0x20,8,'<I');m.put(table+handle*16+8,obj);m.put(obj+id_offset,handle,'<I')
    for address,value in [(0x30000+0xD0,0),(0x30000+0xE0,0),(0x30000+0xE4,0),(0x90000+0xF78,3),(0x60000+0x26CC,1),(0xA0000,0)]:m.put(address,value,'<I')
    m.put(0x60000+0x26C0,0xA0000);return m,base

class Ownership(unittest.TestCase):
    def test_zero_country_colony_and_queue_are_valid_without_claiming_local_player_identity(self):
        m,b=fixture();r=owned_colony_relationship(m,b,3,0,0)
        self.assertTrue(r['ownershipRelationshipVerified']);self.assertFalse(r['playerBindingVerified']);self.assertEqual(r['constructionQueueId'],0)
    def test_stale_planet_or_colony_generation_never_resolves_a_reused_slot(self):
        m,b=fixture()
        with self.assertRaises(ProbeError):owned_colony_relationship(m,b,0x1000003,0,0)
        m.put(0x90000+0x10,0x1000000,'<I')
        with self.assertRaises(ProbeError):owned_colony_relationship(m,b,3,0,0)
    def test_owner_membership_backlink_and_unreadable_lists_are_all_required(self):
        for address,value in [(0x30000+0xD0,1),(0x90000+0xF78,4),(0xA0000,1),(0x60000+0x26CC,65537)]:
            m,b=fixture();m.put(address,value,'<I')
            with self.assertRaises(ProbeError):owned_colony_relationship(m,b,3,0,0)

if __name__=='__main__':unittest.main()
