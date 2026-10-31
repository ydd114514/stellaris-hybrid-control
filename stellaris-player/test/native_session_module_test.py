"""Offline module admission fixtures; no process or pipe is opened."""
import io,sys,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native/research'))
import native_session as session
from stellaris_memory_probe import ProbeError
class Memory:
    base=0x100000000
    handle=1
    def __init__(self,*args):
        def times(_handle,*pointers):pointers[0]._obj.low=123;return 1
        self.kernel=SimpleNamespace(GetProcessTimes=times)
    def read(self,address,count):return next(bytes.fromhex(prefix) for rva,prefix in session.ANCHORS if self.base+rva==address)
    def close(self):pass
class Module(unittest.TestCase):
    def inspect(self,found=None,error=None,creation='123'):
        with patch.object(session.Path,'open',return_value=io.BytesIO(b'fixture')),patch.object(session.hashlib,'file_digest',return_value=SimpleNamespace(hexdigest=lambda:session.BUILD_SHA256)),patch.object(session,'ReadOnlyProcess',Memory),patch.object(session,'find_module',return_value=found,side_effect=error):
            return session.inspect({'op':'bridge_module','pid':12,'creationTime':creation})
    def test_absence_is_known_only_after_successful_enumeration(self):
        r=self.inspect();self.assertEqual(r['bridgeModule'],{'known':True,'loaded':False,'path':None});self.assertEqual(r['creationTime'],'123')
    def test_existing_module_keeps_exact_path(self):self.assertEqual(self.inspect((0x10000,'E:/old/stellaris_bridge.dll'))['bridgeModule']['path'],'E:/old/stellaris_bridge.dll')
    def test_enumeration_failure_and_pid_reuse_are_not_absence(self):
        with self.assertRaises(ProbeError):self.inspect(error=ProbeError('module_snapshot_failed'))
        with self.assertRaises(ProbeError):self.inspect(creation='old')
if __name__=='__main__':unittest.main()
