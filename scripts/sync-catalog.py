#!/usr/bin/env python3
"""Regenerate marketplace.json and .bb/plugins.json from the plugin directories.

Every top-level directory with a package.json that declares `bb` is a plugin.
Store text comes from the plugin itself (bb.name, bb.description, bb.branding,
PLUGIN_OVERVIEW.md), so run this after any release instead of editing the
catalog by hand. `--check` exits 1 when the committed files are stale.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPO_URL = "https://github.com/bisovka-labs/bb-plugins.git"
OWNER = {"name": "Eugene Bisovka", "github": "bisovka-labs", "url": "https://github.com/bisovka-labs"}
# Plugins written by someone else and shipped here as a patched fork.
FORKS = {"handoff": {"name": "Vedran Burojević", "github": "vburojevic", "url": "https://github.com/vburojevic"}}


def plugins():
    for pkg in sorted(ROOT.glob("*/package.json")):
        manifest = json.loads(pkg.read_text())
        if "bb" in manifest:
            yield pkg.parent, manifest


def entry(path, manifest):
    bb = manifest["bb"]
    plugin_id = manifest["name"].removeprefix("bb-plugin-")
    icon = bb.get("branding", {}).get("icon", "Puzzle")
    if icon.startswith("./"):
        icon = {"url": f"./{path.name}/{icon[2:]}"}
    item = {
        "id": plugin_id,
        "displayName": bb["name"],
        "description": bb["description"],
        "icon": icon,
        "author": FORKS.get(plugin_id, OWNER),
        "source": {"git": {"url": REPO_URL, "ref": "main", "subdir": path.name}},
    }
    overview = path / "PLUGIN_OVERVIEW.md"
    if overview.exists():
        item["overview"] = overview.read_text().strip() + "\n"
    return item


def render():
    found = list(plugins())
    marketplace = {
        "$schema": "https://getbb.app/schemas/marketplace-v2.schema.json",
        "schemaVersion": 2,
        "name": "bisovka",
        "displayName": "Bisovka Plugins",
        "description": "Every bb plugin and improvement Eugene Bisovka builds, in one place.",
        "collections": [
            {"id": "bisovka", "displayName": "Bisovka Plugins", "pluginIds": [entry(p, m)["id"] for p, m in found]}
        ],
        "plugins": [entry(p, m) for p, m in found],
    }
    collection = {
        "$schema": "https://getbb.app/schemas/plugins.schema.json",
        "schemaVersion": 1,
        "name": "bisovka",
        "plugins": [{"name": entry(p, m)["id"], "source": f"./{p.name}"} for p, m in found],
    }
    dump = lambda data: json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    return {ROOT / "marketplace.json": dump(marketplace), ROOT / ".bb" / "plugins.json": dump(collection)}


def main():
    outputs = render()
    if "--check" in sys.argv:
        stale = [str(p.relative_to(ROOT)) for p, text in outputs.items() if not p.exists() or p.read_text() != text]
        if stale:
            sys.exit("stale: " + ", ".join(stale) + " (run scripts/sync-catalog.py)")
        return
    for path, text in outputs.items():
        path.parent.mkdir(exist_ok=True)
        path.write_text(text)
        print(f"wrote {path.relative_to(ROOT)}")


main()
