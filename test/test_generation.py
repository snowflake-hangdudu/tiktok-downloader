import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

KIT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('new_platform', KIT / 'scripts' / 'new_platform.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)

class GenerationTests(unittest.TestCase):
    def test_new_extension_loads_shared_modules_and_preserves_existing_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            workspace = Path(directory)
            args = ['new_platform.py', '--id', 'template-check', '--title', '模板验收', '--match', 'https://example.com/*', '--theme', 'default']
            with patch.object(generator, 'WORKSPACE', workspace), patch.object(sys, 'argv', args):
                generator.main()
                dest = workspace / 'template-check-downloader'
                for name in ['manifest.json', 'manifest.firefox.json']:
                    manifest = json.loads((dest / name).read_text(encoding='utf-8'))
                    entry = manifest['content_scripts'][0]
                    self.assertIn('shared/settings.js', entry['js'])
                    self.assertEqual(entry['css'][-1], 'shared/design-system.css')
                    self.assertIn('http://124.222.62.190:8081/*', manifest['host_permissions'])
                    for file in entry['js'] + entry['css']:
                        self.assertTrue((dest / file).is_file(), file)
                for file in dest.rglob('*.js'):
                    subprocess.run(['node', '--check', str(file)], check=True, capture_output=True)
                snapshot = (dest / 'content' / 'content.js').read_bytes()
                with self.assertRaises(SystemExit): generator.main()
                self.assertEqual(snapshot, (dest / 'content' / 'content.js').read_bytes())

if __name__ == '__main__': unittest.main()
