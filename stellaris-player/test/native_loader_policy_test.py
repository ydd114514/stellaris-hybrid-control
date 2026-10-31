"""Offline fixtures only: never open a process or a pipe."""
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "native" / "research"))
from load_native_bridge import reviewed_compatible_library, ProbeError


class CompatibleLibraryTests(unittest.TestCase):
    def test_only_explicit_and_reviewed_existing_library_is_reused(self):
        with tempfile.TemporaryDirectory(prefix="fish-loader-policy-") as directory:
            file = Path(directory) / "stellaris_bridge.dll"
            file.write_bytes(b"offline fixture, not a PE or executable")
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            with patch("load_native_bridge.REVIEWED_DLL_HASHES", {digest}):
                self.assertEqual(reviewed_compatible_library(str(file), [str(file)]), digest)
                self.assertIsNone(reviewed_compatible_library(str(file), []))
                self.assertIsNone(reviewed_compatible_library(str(file), [str(file.parent / "other.dll")]))
            with self.assertRaisesRegex(ProbeError, "binary_sha256_mismatch"):
                reviewed_compatible_library(str(file), [str(file)])

    def test_malformed_compatibility_list_is_rejected(self):
        for paths in ["anything", [1], ["a", "b", "c", "d", "e", "f"]]:
            with self.assertRaises(ProbeError):
                reviewed_compatible_library("ignored", paths)


if __name__ == "__main__":
    unittest.main()
