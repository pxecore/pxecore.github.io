#!/usr/bin/env python3
"""
Single-Source-of-Truth Palette Synchronizer.
Reads css/theme_palettes.json and updates:
  - script/theme-palettes.js
  - THEME_CORE in script/boot-theme.js
"""

import json
import os
import re

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PALETTES_JSON = os.path.join(ROOT_DIR, 'css', 'theme_palettes.json')
THEME_PALETTES_JS = os.path.join(ROOT_DIR, 'script', 'theme-palettes.js')
BOOT_THEME_JS = os.path.join(ROOT_DIR, 'script', 'boot-theme.js')
NOTE_PAGE_JS = os.path.join(ROOT_DIR, 'script', 'note-page.js')


def main():
    with open(PALETTES_JSON, 'r', encoding='utf-8') as f:
        palettes = json.load(f)

    # 1. Regenerate script/theme-palettes.js from css/theme_palettes.json
    js_body = json.dumps(palettes, indent=4, ensure_ascii=False)
    indented = '\n'.join('    ' + line if i > 0 else line for i, line in enumerate(js_body.splitlines()))
    theme_palettes_content = (
        "// Auto-generated from css/theme_palettes.json via scripts/sync_palettes.py\n"
        "(function (window) {\n"
        "    'use strict';\n\n"
        f"    const DEFAULT_PALETTES = {indented};\n\n"
        "    window.PXECORE_PALETTES = DEFAULT_PALETTES;\n"
        "})(window);\n"
    )
    with open(THEME_PALETTES_JS, 'w', encoding='utf-8') as f:
        f.write(theme_palettes_content)

    # 2. Sync THEME_CORE accents in script/boot-theme.js
    dark = palettes['dark']
    light = palettes['light']
    with open(BOOT_THEME_JS, 'r', encoding='utf-8') as f:
        boot_src = f.read()

    new_core = (
        "    var THEME_CORE = {\n"
        f"        dark: {{ bg: '#0E0D0C', accent: '{dark['accent']}', rgb: '{dark['accent_rgb']}' }},\n"
        f"        light: {{ bg: '#E2DBD0', accent: '{light['accent']}', rgb: '{light['accent_rgb']}' }}\n"
        "    };"
    )
    updated_boot, count = re.subn(
        r'    var THEME_CORE = \{[\s\S]*?\n    \};',
        new_core,
        boot_src,
        count=1
    )
    if count != 1:
        raise RuntimeError('Failed to locate THEME_CORE block in script/boot-theme.js')

    with open(BOOT_THEME_JS, 'w', encoding='utf-8') as f:
        f.write(updated_boot)

    # 3. Sync THEME_CORE accents in script/note-page.js
    with open(NOTE_PAGE_JS, 'r', encoding='utf-8') as f:
        note_src = f.read()

    updated_note, n_count = re.subn(
        r'    var THEME_CORE = \{[\s\S]*?\n    \};',
        new_core,
        note_src,
        count=1
    )
    if n_count != 1:
        raise RuntimeError('Failed to locate THEME_CORE block in script/note-page.js')

    with open(NOTE_PAGE_JS, 'w', encoding='utf-8') as f:
        f.write(updated_note)

    print('✓ Synced theme palettes from css/theme_palettes.json -> theme-palettes.js, boot-theme.js, note-page.js')


if __name__ == '__main__':
    main()
