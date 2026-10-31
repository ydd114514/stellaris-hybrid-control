"""Process identity fixtures only; never load a library or open a process."""
import sys,unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'native/research'))
from load_native_bridge import process_creation_time,load,ProbeError
class Creation(unittest.TestCase):
    def test_creation_time_keeps_high_bits_as_decimal_string(self):
        def read(handle,*pointers):
            self.assertEqual(handle,42);pointers[0]._obj.low=0x89abcdef;pointers[0]._obj.high=0x12345678;return 1
        self.assertEqual(process_creation_time(SimpleNamespace(GetProcessTimes=read),42),str(0x1234567889abcdef))
    def test_failed_identity_read_never_becomes_zero(self):
        with self.assertRaisesRegex(ProbeError,'cannot_verify'):process_creation_time(SimpleNamespace(GetProcessTimes=lambda *args:0),42)
    def test_invalid_expectation_rejected_before_any_file_or_process_access(self):
        for value in [123,'','-1','0'*21,'１２３']:
            with self.assertRaisesRegex(ProbeError,'invalid_expected'):load(1,'must-not-open','must-not-open',expected_creation_time=value)
if __name__=='__main__':unittest.main()
