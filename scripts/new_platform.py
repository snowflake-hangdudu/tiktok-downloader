"""从公共 kit 复制出一套新下载扩展骨架。不会改现有插件。"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
WORKSPACE = KIT.parent
BLOCKED = {
    "bilibili-downloader",
    "weibo-downloader",
    "xiaohongshu-downloader",
    "youtube-downloader",
    "douyin-downloader",
    "shared-download-kit",
    "shared-download-config",
}

PLATFORM_THEMES = {"bilibili", "youtube", "weibo", "xiaohongshu", "douyin", "default"}
CONFIG_HUB = "http://124.222.62.190:8081/api/config/{slug}"


def slugify(value: str) -> str:
    text = re.sub(r"[^a-z0-9-]+", "-", value.strip().lower())
    text = re.sub(r"-{2,}", "-", text).strip("-")
    if not re.fullmatch(r"[a-z][a-z0-9-]*", text):
        raise SystemExit("id 必须是小写字母开头的字母/数字/连字符，例如 douyin")
    return text


def replace_tokens(text: str, mapping: dict[str, str]) -> str:
    for key, value in mapping.items():
        text = text.replace("{{" + key + "}}", value)
    leftover = re.findall(r"\{\{[A-Z0-9_]+\}\}", text)
    if leftover:
        raise SystemExit(f"未替换占位符: {', '.join(sorted(set(leftover)))}")
    return text


def copy_tree(src: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for path in src.rglob("*"):
        if path.is_file():
            target = dest / path.relative_to(src)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)


def refresh_fixed_themes() -> set[str]:
    source = KIT.parents[1] / "主题" / "主题.json"
    snapshot = KIT / "shared" / "themes.json"
    if not source.is_file():
        return set()
    raw = source.read_bytes()
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SystemExit(f"固定主题 JSON 无效: {source}: {error}") from error
    themes = data.get("themes") if isinstance(data, dict) else None
    if not isinstance(themes, list) or not themes:
        raise SystemExit(f"固定主题 JSON 必须包含非空 themes 数组: {source}")
    ids: set[str] = set()
    for entry in themes:
        if not isinstance(entry, dict) or not re.fullmatch(r"[a-z][a-z0-9-]{0,40}", str(entry.get("id", ""))):
            raise SystemExit(f"固定主题包含无效 id: {source}")
        if entry["id"] in ids or not isinstance(entry.get("name"), str):
            raise SystemExit(f"固定主题 id 必须唯一且 name 必须是文本: {source}")
        if not isinstance(entry.get("colors"), dict) or not isinstance(entry.get("gradients"), dict):
            raise SystemExit(f"固定主题缺少 colors 或 gradients: {entry['id']}")
        ids.add(entry["id"])
    if not snapshot.exists() or snapshot.read_bytes() != raw:
        snapshot.parent.mkdir(parents=True, exist_ok=True)
        snapshot.write_bytes(raw)
    subprocess.run([sys.executable, str(KIT / "scripts" / "sync_brand.py"), "--kit-only"], check=True)
    return ids


def resolve_theme(plugin_id: str, theme_arg: str, fixed_theme_ids: set[str]) -> str:
    theme = (theme_arg or plugin_id or "default").strip().lower()
    known_themes = PLATFORM_THEMES | fixed_theme_ids
    if theme not in known_themes:
        raise SystemExit(
            f"未知主题 {theme!r}。请使用 --theme 指定其一: {', '.join(sorted(known_themes))}"
        )
    return theme


def main() -> None:
    parser = argparse.ArgumentParser(description="用公共弹窗壳创建新的下载扩展目录")
    parser.add_argument("--id", required=True, help="目录名与配置站 slug，例如 douyin")
    parser.add_argument("--title", required=True, help="产品名，例如 抖音下载助手")
    parser.add_argument("--match", required=True, help='content_scripts matches，例如 https://www.douyin.com/*')
    parser.add_argument("--home", default="", help="空态「打开网站」链接")
    parser.add_argument(
        "--theme",
        default="",
        help="平台主题或固定主题 JSON 的 id；默认与 --id 相同。未知主题会报错",
    )
    parser.add_argument("--force", action="store_true", help="已弃用；生成器不会覆盖已有目录")
    args = parser.parse_args()

    plugin_id = slugify(args.id)
    if plugin_id in BLOCKED or f"{plugin_id}-downloader" in BLOCKED:
        raise SystemExit("禁止覆盖现有插件或 kit 目录")

    dest = WORKSPACE / f"{plugin_id}-downloader"
    if dest.exists():
        raise SystemExit(f"目录已存在：{dest}。生成器不会删除或覆盖已有内容，请改用新的 --id。")

    fixed_theme_ids = refresh_fixed_themes()
    theme = resolve_theme(plugin_id, args.theme, fixed_theme_ids)

    mapping = {
        "TITLE": args.title,
        "ID_PREFIX": f"{plugin_id}-dl",
        "MESSAGE_PREFIX": f"{plugin_id.upper().replace('-', '_')}_DL",
        "PLUGIN_ID": plugin_id,
        "THEME_STORAGE_KEY": f"{plugin_id}-dl-theme.v1",
        "CONFIG_URL": CONFIG_HUB.format(slug=plugin_id),
        "MATCH_ORIGIN": args.match,
        "FAQ_URL": f"https://snowflake-hangdudu.github.io/{plugin_id}-downloader/faq.html",
        "PRIVACY_URL": f"https://snowflake-hangdudu.github.io/{plugin_id}-downloader/",
        "THEME": theme,
    }

    dest.mkdir(parents=True)

    copy_tree(KIT / "shared", dest / "shared")
    copy_tree(KIT / "popup", dest / "popup")
    copy_tree(KIT / "icons", dest / "icons")
    copy_tree(KIT / "docs", dest / "docs")
    scripts_dir = dest / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(KIT / "scripts" / "pack.py", scripts_dir / "pack.py")
    shutil.copy2(KIT / "scripts" / "pack_common.py", scripts_dir / "pack_common.py")
    shutil.copy2(KIT / "scripts" / "pack_firefox.py", scripts_dir / "pack_firefox.py")
    shutil.copy2(KIT / "scripts" / "gen_icons.py", scripts_dir / "gen_kit_icons.py")
    # Platform icon generator that reads brand-assets when present
    (scripts_dir / "gen_icons.py").write_text(
        '"""Generate icons from shared-download-kit brand-assets when available."""\n'
        "from pathlib import Path\n"
        "import sys\n"
        f"ROOT = Path(__file__).resolve().parents[1]\n"
        "KIT_SCRIPTS = ROOT.parent / 'shared-download-kit' / 'scripts'\n"
        "sys.path.insert(0, str(KIT_SCRIPTS))\n"
        "try:\n"
        "    from gen_platform_icons import generate_for\n"
        f"    generate_for({theme!r}, ROOT)\n"
        "except SystemExit as exc:\n"
        "    print('WARN:', exc)\n"
        "    print('Falling back to kit generic icons already copied.')\n",
        encoding="utf-8",
    )
    (dest / "popup" / "popup-config.example.js").unlink(missing_ok=True)

    for rel in ("manifest.json", "manifest.firefox.json", "background.js", "content/content.js"):
        src = KIT / "template" / rel
        out = dest / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(replace_tokens(src.read_text(encoding="utf-8"), mapping), encoding="utf-8")

    config = (KIT / "popup" / "popup-config.example.js").read_text(encoding="utf-8")
    config = config.replace("某某下载助手", args.title)
    config = config.replace("FOO_DL", mapping["MESSAGE_PREFIX"])
    config = re.sub(r"theme:\s*'[^']*'", f"theme: '{theme}'", config)
    config = re.sub(r"themeKey:\s*'[^']*'", f"themeKey: '{mapping['THEME_STORAGE_KEY']}'", config)
    host = re.sub(r"^https?://", "", args.match).split("/")[0].replace("*.", "")
    config = config.replace("example.com", host or "example.com")
    if args.home:
        config = re.sub(r"homeUrl: 'https://[^']+'", f"homeUrl: '{args.home}'", config)
        config = config.replace("打开网站", f"打开{args.title.replace('下载助手', '') or '网站'}")
    (dest / "popup" / "popup-config.js").write_text(config, encoding="utf-8")

    (dest / "package.json").write_text(
        json.dumps({
            "name": f"{plugin_id}-downloader",
            "version": "1.0.0",
            "private": True,
            "scripts": {
                "pack": "python scripts/pack.py && python scripts/pack_firefox.py",
                "pack:chromium": "python scripts/pack.py",
                "pack:firefox": "python scripts/pack_firefox.py"
            }
        }, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    # Ensure popup HTML carries theme + design-system
    popup_html = (dest / "popup" / "popup.html").read_text(encoding="utf-8")
    if "design-system.css" not in popup_html:
        popup_html = popup_html.replace(
            '<link rel="stylesheet" href="popup.css">',
            '<link rel="stylesheet" href="popup.css">\n  <link rel="stylesheet" href="../shared/design-system.css">',
        )
    popup_html = re.sub(r'data-theme="[^"]*"', f'data-theme="{theme}"', popup_html)
    if "data-theme=" not in popup_html:
        popup_html = popup_html.replace("<body", f'<body data-theme="{theme}"', 1)
    (dest / "popup" / "popup.html").write_text(popup_html, encoding="utf-8")

    readme = dest / "README.md"
    readme.write_text(
        f"# {args.title}\n\n"
        f"由 `shared-download-kit` 生成的公共弹窗骨架。\n\n"
        f"- 主题：`{theme}`（`shared/themes.json` + `shared/design-system.css`）\n"
        f"- 页面悬浮面板、工具栏 popup、公告/合作/评分/邮箱/调试区已接好\n"
        f"- 平台识别与下载写在 `content/content.js`，可用 `shell.debug.log(...)`\n"
        f"- 固定主题更新：`python ../shared-download-kit/scripts/sync_brand.py --kit-only` 后，将 kit 的 `shared/design-system.css` 同步到本扩展\n"
        f"- 打包：`python scripts/pack.py`（会关掉整块调试区）\n"
        f"- Firefox：`python scripts/pack_firefox.py`；两端一起打包可运行 `npm run pack`\n"
        f"- 配置站：`{mapping['CONFIG_URL']}`\n",
        encoding="utf-8",
    )

    print(json.dumps({"ok": True, "path": str(dest), "theme": theme, "themeCount": len(fixed_theme_ids)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
