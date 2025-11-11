#!/usr/bin/env python3
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

IGNORE_EXTENSIONS = {".json", ".css", ".scss", ".png", ".jpg", ".svg", ".woff", ".woff2", ".ttf", ".eot"}
TS_EXTENSIONS = [".ts", ".tsx", ".mts"]
JS_EXTENSIONS = [".js", ".mjs"]

STATIC_IMPORT_RE = re.compile(r'(from\s+["\'])((?:\.{1,2}|\/)[^"\']*)(["\'"])')
DYNAMIC_IMPORT_RE = re.compile(r'(import\(\s*["\'])((?:\.{1,2}|\/)[^"\']*)(["\'"])')
EXPORT_FROM_RE = re.compile(r'(export\s+[^;]*?from\s+["\'])((?:\.{1,2}|\/)[^"\']*)(["\'"])')


def resolve_relative_spec(file_path: Path, spec: str) -> str | None:
    if spec.endswith(".js") or spec.endswith(".mjs") or spec.endswith(".cjs"):
        return None

    last_segment = spec.split("/")[-1]
    if "." in last_segment:
        # already has an extension (e.g., .json, .css)
        return None

    base_dir = file_path.parent
    target = (base_dir / spec).resolve()

    # Direct TypeScript source file
    for ext in TS_EXTENSIONS + JS_EXTENSIONS:
        candidate = target.with_suffix(ext)
        if candidate.exists():
            return spec + ".js"

    # Directory with index file
    if target.is_dir():
        for ext in TS_EXTENSIONS + JS_EXTENSIONS:
            candidate = target / ("index" + ext)
            if candidate.exists():
                return spec.rstrip("/") + "/index.js"

    return None


def update_specifiers(content: str, file_path: Path) -> tuple[str, bool]:
    changed = False

    for regex in (STATIC_IMPORT_RE, DYNAMIC_IMPORT_RE, EXPORT_FROM_RE):
        def _replace(match):
            nonlocal changed
            prefix, spec, suffix = match.groups()
            new_spec = resolve_relative_spec(file_path, spec)
            if new_spec and new_spec != spec:
                changed = True
                return f"{prefix}{new_spec}{suffix}"
            return match.group(0)

        content = regex.sub(_replace, content)

    return content, changed


def process_file(path: Path) -> bool:
    with path.open("r", encoding="utf-8") as f:
        content = f.read()

    new_content, changed = update_specifiers(content, path)

    if changed:
        with path.open("w", encoding="utf-8") as f:
            f.write(new_content)

    return changed


def main():
    total_files = 0
    changed_files = 0

    for directory in ["server", "shared", "client", "test", "scripts"]:
        dir_path = ROOT / directory
        if not dir_path.exists():
            continue

        for path in dir_path.rglob("*.ts"):
            if process_file(path):
                changed_files += 1
            total_files += 1

    print(f"Processed {total_files} TypeScript files. Updated {changed_files} files.")


if __name__ == "__main__":
    main()
