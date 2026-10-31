"""Offline save text fixtures only; no real user saves, processes or game calls."""
from pathlib import Path
import importlib.util,unittest
spec=importlib.util.spec_from_file_location('upgrade_fixture',Path(__file__).resolve().parents[1]/'scripts/prepare-upgrade-save-fixture.py')
fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

class UpgradeFixtureTests(unittest.TestCase):
    def test_only_player_technology_block_is_changed(self):
        text='date="2202.07.01" country={0={name="brace } # quoted" tech_status={technology="existing" level=1}} 1={tech_status={technology="other" level=1}}}'
        result,edit=fixture.add_technology(text)
        self.assertEqual(result.replace(edit['insertion'],'',1),text)
        self.assertEqual(result.count(fixture.TECH),1)
        self.assertIn('1={tech_status={technology="other" level=1}}',result)
    def test_nested_country_decoys_and_comment_braces_are_not_selected(self):
        text='decoy={country={0={tech_status={}}}} # country={\ncountry={0={tech_status={}}}'
        result,edit=fixture.add_technology(text)
        self.assertGreater(edit['insertionOffset'],text.index('\ncountry='))
        self.assertEqual(result.replace(edit['insertion'],'',1),text)
    def test_duplicate_missing_and_unbalanced_blocks_are_rejected(self):
        for text in ['country={0={tech_status={} tech_status={}}}','country={1={tech_status={}}}','country={0={tech_status={}}']:
            with self.assertRaises(ValueError):fixture.add_technology(text)
    def test_existing_technology_is_never_duplicated(self):
        with self.assertRaisesRegex(ValueError,'already present'):
            fixture.add_technology('country={0={tech_status={technology="'+fixture.TECH+'" level=1}}}')
    def test_pair_precedes_research_queues_in_the_learned_sequence(self):
        text='country={0={tech_status={technology="existing" level=1 physics_queue={{technology="queued" progress=1}} auto_researching_physics=no}}}'
        result,edit=fixture.add_technology(text)
        self.assertLess(result.index(fixture.TECH),result.index('physics_queue'))
        self.assertGreater(edit['insertionOffset'],text.index('level=1'))

if __name__=='__main__':unittest.main()
