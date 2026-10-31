import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native/research'))
from colony_settings_probe import colony_category_membership
from colony_ownership_test import Memory
from stellaris_memory_probe import ProbeError

KEY='planet_automation_amenities'
def fixture():
    m=Memory();colony=0x90000;category=0xB0000
    m.put(colony+0xF08,colony);m.put(colony+0xF24,1,'<I');m.put(colony+0xF18,0xA0000);m.put(0xA0000,category)
    m.put(category+0x20,0xC0000);m.put(category+0x30,len(KEY));m.put(category+0x38,63)
    for i,byte in enumerate(KEY.encode()):m.bytes[0xC0000+i]=byte
    return m,colony
class Settings(unittest.TestCase):
    def test_decodes_actual_serializer_keys_without_claiming_budget_or_execution(self):
        m,c=fixture();r=colony_category_membership(m,c,{KEY});self.assertEqual(r['memberKeys'],[KEY]);self.assertFalse(r['budgetKnown']);self.assertFalse(r['executionSemanticsVerified'])
    def test_empty_list_remains_known_without_inventing_default_categories(self):
        m,c=fixture();m.put(c+0xF24,0,'<I');m.put(c+0xF18,0)
        self.assertEqual(colony_category_membership(m,c,{KEY})['memberKeys'],[])
    def test_rejects_wrong_backlink_oversize_unknown_key_and_duplicate(self):
        for address,value,fmt in [(0x90000+0xF08,0x90001,'<Q'),(0x90000+0xF24,129,'<I'),(0xB0000+0x30,129,'<Q'),(0xB0000+0x38,2,'<Q')]:
            m,c=fixture();m.put(address,value,fmt)
            with self.assertRaises(ProbeError):colony_category_membership(m,c,{KEY})
        m,c=fixture()
        with self.assertRaises(ProbeError):colony_category_membership(m,c,{'other'})
        m.put(c+0xF24,2,'<I');m.put(0xA0008,0xB0000)
        with self.assertRaises(ProbeError):colony_category_membership(m,c,{KEY,'other'})
    def test_rejects_unreadable_or_changed_list(self):
        m,c=fixture();del m.bytes[0xC0000]
        with self.assertRaises(ProbeError):colony_category_membership(m,c,{KEY})
        m,c=fixture();read=m.read;calls=0
        def changing(address,count):
            nonlocal calls
            if address==c+0xF24:
                calls+=1
                if calls==2:m.put(address,0,'<I')
            return read(address,count)
        m.read=changing
        with self.assertRaises(ProbeError):colony_category_membership(m,c,{KEY})
if __name__=='__main__':unittest.main()
