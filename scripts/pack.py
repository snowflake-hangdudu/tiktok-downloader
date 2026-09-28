"""Build the Chromium release ZIP from runtime files only."""
from pack_common import package_release


if __name__ == "__main__":
    from pack_common import ROOT
    package_release("manifest.json", f"{ROOT.name}-chromium.zip")


if __name__ == "__main__":
    main()
