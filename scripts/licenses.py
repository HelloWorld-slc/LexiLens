"""Generate a public dependency inventory from local Cargo/npm metadata.

Usage: python scripts/licenses.py .local/cargo-metadata.json
The Cargo metadata input stays private; absolute paths are never copied.
"""
import hashlib
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
metadata = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
rows, documents = [], {}

def collect(name, version, license_name, source, directory, extra=None):
    found = []
    candidates = list(directory.glob('LICENSE*')) + list(directory.glob('COPYING*')) + list(directory.glob('NOTICE*'))
    if extra:
        candidates.append(directory / extra)
    for folder in ('licenses', 'LICENSES'):
        if (directory / folder).is_dir():
            candidates += list((directory / folder).rglob('*'))
    for path in sorted(set(candidates)):
        if not path.is_file() or path.stat().st_size > 400000:
            continue
        text = path.read_text(encoding='utf-8', errors='replace')
        digest = hashlib.sha256(text.encode()).hexdigest()[:16]
        documents.setdefault(digest, text)
        found.append(f'[{path.name}](third_party/licenses/{digest}.txt)')
    rows.append(f'| {name} | {version} | {license_name or "未声明"} | {source or ""} | {", ".join(found) or "见依赖源码"} |')

for package in metadata['packages']:
    if not package.get('source'):
        continue
    collect(package['name'], package['version'], package.get('license'),
            f'https://crates.io/crates/{package["name"]}/{package["version"]}',
            Path(package['manifest_path']).parent, package.get('license_file'))
lock = json.loads((root / 'package-lock.json').read_text())
for location, package in lock['packages'].items():
    if not location:
        continue
    directory = root / location
    if not (directory / 'package.json').exists():
        continue
    value = json.loads((directory / 'package.json').read_text())
    collect(value['name'], value['version'], value.get('license'),
            f'https://www.npmjs.com/package/{value["name"]}/v/{value["version"]}', directory)
folder = root / 'third_party/licenses'
folder.mkdir(parents=True, exist_ok=True)
for digest, text in documents.items():
    (folder / f'{digest}.txt').write_text(text, encoding='utf-8')
notice = '''# Third-party notices

LexiLens original source is MIT licensed. Dependencies retain their own licenses.
This inventory comes from the locked Cargo graph and locally installed npm packages;
it includes build, test and platform-specific packages, not only shipped runtime code.
Dual-license expressions retain the alternatives declared by upstream.

SQLite is in the public domain (https://sqlite.org/copyright.html).
AndroidX and Google Material Android components declare Apache-2.0; Android's system
WebView and Windows WebView2 are separately installed system runtimes. The Android
dependency metadata is listed in [Android declarations](docs/ANDROID_DEPENDENCIES.md); release runtime verification remains pending.
The NSIS test installer uses Tauri's bundled NSIS tooling; see
https://nsis.sourceforge.io/License and the generated installer distribution.

License and notice texts below are copied from local dependency sources. No user
materials, credentials, model results, or local filesystem paths are included.

| Dependency | Version | Declared license | Upstream | Included texts |
| --- | --- | --- | --- | --- |
'''
(root / 'THIRD_PARTY_NOTICES.md').write_text(notice + '\n'.join(sorted(rows)) + '\n', encoding='utf-8')
print(f'{len(rows)} dependency records; {len(documents)} unique license/notice texts')
