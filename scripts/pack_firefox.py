"""Build a Firefox XPI with its Firefox-specific manifest."""
from pack_common import ROOT, package_release


if __name__ == "__main__":
    package_release("manifest.firefox.json", f"{ROOT.name}-firefox.xpi")
