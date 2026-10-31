# SPDX-License-Identifier: GPL-3.0-only
"""Offline loader fingerprint gates; all process access is replaced by fixtures."""
import hashlib
import json
import importlib.util
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

NATIVE = Path(__file__).resolve().parents[1] / "native/research"
SPEC = importlib.util.spec_from_file_location("native_bridge_loader", NATIVE / "load_native_bridge.py")
loader = importlib.util.module_from_spec(SPEC)
sys.path.insert(0, str(NATIVE))
try:
    SPEC.loader.exec_module(loader)
finally:
    sys.path.remove(str(NATIVE))

REVIEWED_SHIPYARDS = "82c0914d3890fc87a6f222fa38c7a2a4ba31e44271f58efbab33989c961ade5b"
REVIEWED_MARKET_QUOTES = "247259c0c4a8e83387bbe47aad21be01f4213ccca309db9b5001b09ab8a1e029"
REVIEWED_GESTALT_WAR = "cc4ca2a860e8e1a7e6fa4febd7e9446c7e227e26d7b920f1f48ca8bab1f1f22f"
REVIEWED_MONTHLY = "8d8dff1c8fc20a6b1865cc6becd408acb053f15b72c62fe0a4b85af8b934539d"
REVIEWED_MONTHLY_QUOTES = "249b1011e5c4861efe208c95514a0327e11af5d0cfc1a0a6911884ed5eea354a"
REVIEWED_UPGRADE_PATHS = "2da799dc0857599f726a76e6f0c67e93107da4ed6ea3e374220e450e60d2b5be"
REVIEWED_TRADE_BUDGET = "84c5e4c4a5e062a85a59448ae5b5f69a1a36e00dc561b1517f9432be18ef4758"
REVIEWED_CLAIM_BUDGET = "b9936cf0d5ae7a11537916daaf5631f3f20a1b4562da3df8e69462f5e0bc6e52"
REVIEWED_COUNTRY_AI = "1315317a17fc0fd5a294311fd2595a897030c94d5ebf3d8d67523aa13354b292"

REVIEWED_COUNTRY_AI_P1_R2 = "53356faf2a90c123b3ba39a03498518ebd231b6e093530d4cad8f6241cbb7368"
REVIEWED_COUNTRY_AI_P1 = "740c408ea7fb5503349417945a1c3d7550e9b6938bb645fc551340b97c60a452"

REVIEWED_COUNTRY_AI_R2 = "f3e0cfa9cfaa64e567d297af1899a9a2b3c329f9ba00cab75c36a061d941556e"

class OfflinePreflightReached(Exception):
    pass


class LoaderFingerprintContracts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.game = root / "stellaris.exe"
        self.dll = root / "stellaris_bridge.dll"
        self.game.write_bytes(b"offline game fingerprint fixture")
        self.dll.write_bytes(b"unreviewed offline library fixture")
        self.game_hash = hashlib.sha256(self.game.read_bytes()).hexdigest()

    def reviewed_digests(self, stream, algorithm):
        # A digest boundary fixture supplies the audited DLL pin without shipping
        # a binary in the tests. Paths and both fingerprint gates remain real.
        self.assertEqual(algorithm, "sha256")
        digest = self.game_hash if Path(stream.name) == self.game else REVIEWED_SHIPYARDS
        return SimpleNamespace(hexdigest=lambda: digest)

    def test_reviewed_shipyards_bridge_passes_binary_gate_before_process_access(self):
        self.assertEqual(loader.SHIPYARDS_DLL_SHA256, REVIEWED_SHIPYARDS)
        self.assertIn(REVIEWED_SHIPYARDS, loader.REVIEWED_DLL_HASHES)
        with patch.object(loader, "BUILD_SHA256", self.game_hash), \
             patch.object(loader.hashlib, "file_digest", side_effect=self.reviewed_digests), \
             patch.object(loader, "ReadOnlyProcess", side_effect=OfflinePreflightReached) as process:
            with self.assertRaises(OfflinePreflightReached):
                loader.load(1234, str(self.game), str(self.dll))
        process.assert_called_once_with(1234, str(self.game))

    def test_unreviewed_library_is_rejected_before_process_access(self):
        self.assertNotIn(hashlib.sha256(self.dll.read_bytes()).hexdigest(), loader.REVIEWED_DLL_HASHES)
        with patch.object(loader, "BUILD_SHA256", self.game_hash), \
             patch.object(loader, "ReadOnlyProcess") as process:
            with self.assertRaisesRegex(loader.ProbeError, r"^binary_sha256_mismatch:stellaris_bridge\.dll$"):
                loader.load(1234, str(self.game), str(self.dll))
        process.assert_not_called()

    def test_five_explicit_supersets_can_reuse_only_matching_reviewed_file(self):
        paths = [str(self.dll.parent / str(i) / "stellaris_bridge.dll") for i in range(4)] + [str(self.dll)]
        with patch.object(loader.hashlib, "file_digest", side_effect=self.reviewed_digests):
            self.assertEqual(loader.reviewed_compatible_library(str(self.dll), paths), REVIEWED_SHIPYARDS)
        self.assertIsNone(loader.reviewed_compatible_library("unmatched.dll", paths))
        with self.assertRaisesRegex(loader.ProbeError, "binary_sha256_mismatch"):
            loader.reviewed_compatible_library(str(self.dll), paths)
        with self.assertRaisesRegex(loader.ProbeError, "invalid_compatible_library_list"):
            loader.reviewed_compatible_library(str(self.dll), paths + [str(self.dll)])

    def test_reviewed_library_does_not_bypass_game_fingerprint(self):
        with patch.object(loader, "BUILD_SHA256", "0" * 64), \
             patch.object(loader.hashlib, "file_digest", side_effect=self.reviewed_digests), \
             patch.object(loader, "ReadOnlyProcess") as process:
            with self.assertRaisesRegex(loader.ProbeError, r"^binary_sha256_mismatch:stellaris\.exe$"):
                loader.load(1234, str(self.game), str(self.dll))
        process.assert_not_called()

    def test_reviewed_library_does_not_bypass_live_anchor_gate(self):
        expected = bytes.fromhex(loader.ANCHORS[0][1])
        wrong = bytes([expected[0] ^ 0xFF]) + expected[1:]
        process = SimpleNamespace(base=0, read=lambda address, size: wrong, close=lambda: None)
        with patch.object(loader, "BUILD_SHA256", self.game_hash), \
             patch.object(loader.hashlib, "file_digest", side_effect=self.reviewed_digests), \
             patch.object(loader, "ReadOnlyProcess", return_value=process), \
             patch.object(loader, "find_module") as modules:
            with self.assertRaisesRegex(loader.ProbeError, r"^live_game_anchor_mismatch$"):
                loader.load(1234, str(self.game), str(self.dll))
        modules.assert_not_called()

    def test_existing_release_and_first_contact_pins_are_retained(self):
        original = {
            "33397bfb804c299ca289c358808abee64f1cd146478229de8170b2f984cc302d",
            "4a54662dd9c9555ccdf5eedaf6ef611f30d139dfc3459c2d3135d57363059d8e",
            "4d432e4870604616b9d10f473391052a2d91e2af7c6d77a23055c9c378926503",
            "4ae2db8d1486ea5309426c82c107d34f3a323fa2129dbd5c21fa28dff0168770",
            "5e2b06ef9ab68e964cb454d3d3b2a6aecaedafb13571004027540dc10069569d",
            "b9b953e3c719edab57573a5793e859eb970598f1cc124033e21b07bb8c24d3d0",
            "940def49e90ec99129b795a38debe7f610f344e89850b9a080304a539f3790b4",
            "d5c793eb0e5ca5053d0ae99280478ef200e6d38343d9932f77f3e5df08a1f3db",
            "c9bfd884df419b8ce15fda1c13fb63238dfc44d12ea2035272fbbe7cd1fd3489",
            "0d8d251686406cd1aaf5da3225576f0ff4d7769a468db2a77578c0469a0fb581",
            "00ea2aaf737484ee22cc2dfb27a0e6562b93ea7594e0161f9d731dcedaaf149d",
            "f0feb0e36157c94734675e7585b565d87d93ad310c03147d414d408202fa1dd9",
        }
        self.assertEqual(loader.REVIEWED_DLL_HASHES, original | {REVIEWED_SHIPYARDS, REVIEWED_MARKET_QUOTES, REVIEWED_GESTALT_WAR, REVIEWED_MONTHLY, REVIEWED_MONTHLY_QUOTES, REVIEWED_UPGRADE_PATHS, REVIEWED_TRADE_BUDGET, REVIEWED_CLAIM_BUDGET, REVIEWED_COUNTRY_AI, REVIEWED_COUNTRY_AI_R2, REVIEWED_COUNTRY_AI_P1, REVIEWED_COUNTRY_AI_P1_R2, "1ac53fa552f851e6a684a8c0cee0a76f7b9d462a5be15b1ba97e8e17c5c1b231", "bbeb50b3ec826fded88e7054c9691ff13cdc5b71e95fa8ed0c59cb9c6d459a6b"})

    def test_p1_candidates_have_exact_binary_and_source_without_claiming_acceptance(self):
        for version,digest in [('cyberfish-0.6.16-country-ai-p1-r1',REVIEWED_COUNTRY_AI_P1),('cyberfish-0.6.16-country-ai-p1-r2',REVIEWED_COUNTRY_AI_P1_R2)]:
            root=NATIVE.parents[1] / '.local/native-bridge/runtime' / version
            self.assertEqual(hashlib.sha256((root/'stellaris_bridge.dll').read_bytes()).hexdigest(),digest)
            manifest=json.loads((root/'manifest.json').read_text(encoding='utf8'))
            self.assertFalse(manifest['autonomousOperationVerified'])
            self.assertFalse(manifest['coreGoalComplete'])
            self.assertFalse(manifest['defaultProductionBridgeChanged'])
            for name,sourceDigest in manifest['sourceFiles'].items():
                self.assertEqual(hashlib.sha256((root/'source-snapshot'/name).read_bytes()).hexdigest(),sourceDigest)

    def test_country_ai_candidates_are_exact_and_not_marked_live_accepted(self):
        for version,digest in [('cyberfish-0.6.15-country-ai-p0-r1',REVIEWED_COUNTRY_AI),('cyberfish-0.6.15-country-ai-p0-r2',REVIEWED_COUNTRY_AI_R2)]:
            root=NATIVE.parents[1] / '.local/native-bridge/runtime' / version
            self.assertIn(digest, loader.REVIEWED_DLL_HASHES)
            self.assertEqual(hashlib.sha256((root/'stellaris_bridge.dll').read_bytes()).hexdigest(),digest)
            manifest=json.loads((root/'manifest.json').read_text(encoding='utf8'))
            self.assertEqual(manifest['dllSha256'],digest)
            self.assertFalse(manifest['autonomousOperationVerified'])
            self.assertFalse(manifest['defaultProductionBridgeChanged'])
            snapshot=root/'source-snapshot/stellaris_bridge'
            for name,expected in manifest['sourceFiles'].items():
                self.assertEqual(hashlib.sha256((snapshot/name).read_bytes()).hexdigest(),expected,name)

    def test_trade_budget_candidate_matches_exact_reviewed_pin(self):
        artifact=NATIVE.parents[1] / '.local/native-bridge/runtime/cyberfish-0.6.12-trade-budget-r1/stellaris_bridge.dll'
        self.assertIn(REVIEWED_TRADE_BUDGET, loader.REVIEWED_DLL_HASHES)
        self.assertTrue(artifact.is_file())
        self.assertEqual(hashlib.sha256(artifact.read_bytes()).hexdigest(), REVIEWED_TRADE_BUDGET)

    def test_upgrade_candidate_artifact_matches_reviewed_pin_when_present(self):
        artifact=NATIVE.parents[1] / '.local/native-bridge/runtime/cyberfish-0.6.11-upgrade-paths-r1/stellaris_bridge.dll'
        self.assertIn(REVIEWED_UPGRADE_PATHS, loader.REVIEWED_DLL_HASHES)
        if artifact.exists():
            self.assertEqual(hashlib.sha256(artifact.read_bytes()).hexdigest(), REVIEWED_UPGRADE_PATHS)

    def test_current_gestalt_artifact_matches_reviewed_pin(self):
        artifact=NATIVE.parents[1] / '.local/native-bridge/runtime/cyberfish-0.6.6-gestalt-war-r1/stellaris_bridge.dll'
        self.assertEqual(loader.GESTALT_WAR_DLL_SHA256, REVIEWED_GESTALT_WAR)
        if artifact.exists():
            self.assertEqual(hashlib.sha256(artifact.read_bytes()).hexdigest(), REVIEWED_GESTALT_WAR)


if __name__ == "__main__":
    unittest.main()
