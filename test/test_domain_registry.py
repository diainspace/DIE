import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'generate_domain_registry.py'
spec = importlib.util.spec_from_file_location('domain_generator', SCRIPT)
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


class DomainRegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.source = self.base / 'directadmin'
        shutil.copytree(Path(__file__).parent / 'fixtures' / 'directadmin', self.source)
        self.output = self.base / 'domains.json'
        self.history = self.base / 'domains.history.jsonl'

    def run_update(self):
        return generator.update_registry(self.source, self.output, self.history)

    def records(self):
        return [json.loads(line) for line in self.history.read_text().splitlines()]

    def test_initial_run_records_all_six_domains(self):
        result = self.run_update()
        domains = json.loads(self.output.read_text())['domains']
        self.assertEqual(len(domains), 6)
        self.assertTrue(result['history_added'])
        self.assertEqual(self.records()[0]['added'], domains)
        self.assertEqual(self.records()[0]['removed'], [])
        self.assertEqual(self.records()[0]['domains'], domains)
        self.assertTrue(self.records()[0]['timestamp'].endswith('+00:00'))
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o640)

    def test_unchanged_run_preserves_history_and_registry(self):
        self.run_update()
        before = (self.output.read_bytes(), self.history.read_bytes(), self.output.stat().st_mtime_ns)
        result = self.run_update()
        self.assertFalse(result['history_added'])
        self.assertFalse(result['registry_updated'])
        self.assertEqual(before, (self.output.read_bytes(), self.history.read_bytes(), self.output.stat().st_mtime_ns))

    def test_additions_append_without_rewriting_earlier_history(self):
        self.run_update()
        original = self.history.read_bytes()
        with (self.source / 'domains' / 'mainops.me.subdomains').open('a') as f:
            f.write('new-service\n')
        self.run_update()
        self.assertTrue(self.history.read_bytes().startswith(original))
        self.assertEqual(self.records()[-1]['added'], ['new-service.mainops.me'])
        self.assertEqual(self.records()[-1]['removed'], [])

    def test_removals_are_recorded_and_removed_from_current_registry(self):
        self.run_update()
        (self.source / 'domains' / 'diainspace.com.subdomains').write_text('bio\n')
        self.run_update()
        self.assertEqual(self.records()[-1]['removed'], ['labs.diainspace.com'])
        self.assertNotIn('labs.diainspace.com', json.loads(self.output.read_text())['domains'])

    def test_failed_discovery_preserves_both_files(self):
        self.run_update()
        before = (self.output.read_bytes(), self.history.read_bytes())
        (self.source / 'domains' / 'mainops.me.subdomains').unlink()
        with self.assertRaises(FileNotFoundError):
            self.run_update()
        self.assertEqual(before, (self.output.read_bytes(), self.history.read_bytes()))

    def test_empty_or_invalid_source_cannot_replace_a_valid_registry(self):
        for value in ['', '../unsafe\n']:
            with self.subTest(value=value):
                self.run_update()
                before = (self.output.read_bytes(), self.history.read_bytes())
                source_list = self.source / 'domains.list'
                original = source_list.read_text()
                source_list.write_text(value)
                with self.assertRaises(ValueError):
                    self.run_update()
                self.assertEqual(before, (self.output.read_bytes(), self.history.read_bytes()))
                source_list.write_text(original)

    def test_history_write_failure_prevents_registry_publication(self):
        self.run_update()
        before = (self.output.read_bytes(), self.history.read_bytes())
        (self.source / 'domains' / 'diainspace.com.subdomains').write_text('bio\n')
        with patch.object(generator, 'append_history', side_effect=OSError('disk unavailable')):
            with self.assertRaises(OSError):
                self.run_update()
        self.assertEqual(before, (self.output.read_bytes(), self.history.read_bytes()))

    def test_publication_failure_recovers_without_duplicate_history(self):
        self.run_update()
        original = self.output.read_bytes()
        (self.source / 'domains' / 'diainspace.com.subdomains').write_text('bio\n')
        with patch.object(generator, 'write_registry', side_effect=OSError('publication failed')):
            with self.assertRaises(OSError):
                self.run_update()
        self.assertEqual(self.output.read_bytes(), original)
        history = self.history.read_bytes()
        result = self.run_update()
        self.assertFalse(result['history_added'])
        self.assertTrue(result['registry_updated'])
        self.assertEqual(self.history.read_bytes(), history)
        self.assertNotIn('labs.diainspace.com', json.loads(self.output.read_text())['domains'])

    def test_corrupt_history_stops_updates(self):
        self.run_update()
        with self.history.open('a') as f:
            f.write('{partial')
        before = (self.output.read_bytes(), self.history.read_bytes())
        with self.assertRaises(ValueError):
            self.run_update()
        self.assertEqual(before, (self.output.read_bytes(), self.history.read_bytes()))

    def test_manual_and_scheduled_runs_do_not_duplicate_history(self):
        command = [sys.executable, str(SCRIPT), '--source', str(self.source),
                   '--output', str(self.output), '--history', str(self.history)]
        processes = [subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                     for _ in range(2)]
        for process in processes:
            output, error = process.communicate(timeout=10)
            self.assertEqual(process.returncode, 0, error.decode())
        self.assertEqual(len(self.records()), 1)
        self.assertEqual(len(json.loads(self.output.read_text())['domains']), 6)


if __name__ == '__main__':
    unittest.main()
