"""UI-only distribution must never regenerate approved artwork."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "sync_brand.py"
spec = importlib.util.spec_from_file_location("sync_brand", SCRIPT)
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class UISyncTests(unittest.TestCase):
    def test_all_platforms_have_scoped_themes(self):
        themes = sync.load_themes()
        tokens = sync.build_token_block(themes)
        self.assertEqual(set(themes["platforms"]), set(sync.PLATFORM_META))
        for name, meta in sync.PLATFORM_META.items():
            self.assertIn(meta["panel_selector"], tokens)
            self.assertIn(meta["popup_selector"], tokens)
            for alias in meta["aliases"]:
                self.assertIn(f"--{alias}-text: var(--text-primary)", tokens)

    def test_ui_only_is_idempotent_and_does_not_touch_icons(self):
        themes = sync.load_themes()
        design = sync.build_design_system(themes)
        with tempfile.TemporaryDirectory() as temp:
            workspace = Path(temp)
            kit = workspace / "shared-download-kit"
            (kit / "shared").mkdir(parents=True)
            (kit / "shared" / "design-system.css").write_text(design, encoding="utf-8")
            (kit / "shared" / "panel.css").write_text(".dl-kit { color: black; }", encoding="utf-8")
            icons = []
            for meta in sync.PLATFORM_META.values():
                icon = workspace / meta["dir"] / "icons" / "icon128.png"
                icon.parent.mkdir(parents=True)
                icon.write_bytes(b"approved-icon-sentinel")
                icons.append(icon)
            with patch.object(sync, "KIT", kit), patch.object(sync, "WORKSPACE", workspace), \
                 patch.object(sync, "load_themes", return_value=themes), \
                 patch.object(sync, "process_master", side_effect=AssertionError("must not process icons")):
                names = list(sync.PLATFORM_META)
                sync.run(platforms=names, ui_only=True)
                snapshots = {p: p.read_bytes() for p in workspace.rglob("*") if p.is_file()}
                sync.run(platforms=names, ui_only=True, check=True)
                sync.run(platforms=names, ui_only=True)
                self.assertEqual(snapshots, {p: p.read_bytes() for p in workspace.rglob("*") if p.is_file()})
                for icon in icons:
                    self.assertEqual(icon.read_bytes(), b"approved-icon-sentinel")
                target = workspace / "youtube-downloader" / "shared" / "design-system.css"
                target.write_text("drift", encoding="utf-8")
                with self.assertRaisesRegex(SystemExit, "drift"):
                    sync.run(platforms=names, ui_only=True, check=True)


if __name__ == "__main__":
    unittest.main()
