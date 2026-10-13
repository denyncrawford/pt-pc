#!/usr/bin/env python3
"""Fail closed on non-source files added/changed relative to the native baseline."""
import pathlib, subprocess, sys
base = sys.argv[1] if len(sys.argv) > 1 else '61139aa3752a4afbd41318015db77d8084efe9bd'
paths = subprocess.check_output(['git', 'diff', '--name-only', '--diff-filter=ACMR', base, '--cached', '-z']).decode().split('\0')
source = {'.cpp','.h','.c','.cs','.csproj','.py','.sh','.ts','.tsx','.js','.mjs','.json','.html','.css','.txt','.md','.yml','.yaml','.lock'}
errors = []
for name in filter(None, paths):
    p = pathlib.Path(name)
    if p.suffix not in source and p.name not in {'.gitignore', '.dockerignore', 'Dockerfile'}:
        errors.append(f'Unapproved file type: {name}'); continue
    if any(x in p.parts for x in ('.data','.cache','node_modules','dist','outputs','build','bin','obj','extracted','dump')):
        errors.append(f'Local data/build directory: {name}')
    data = subprocess.check_output(['git','show', ':'+name])
    if b'\0' in data or len(data) > 1_000_000:
        errors.append(f'Binary or oversized source: {name}')
    for marker in (b'-----BEGIN PRIVATE KEY', b'-----BEGIN OPENSSH PRIVATE KEY', b'github_pat_', b'/Users/', b'/var/folders/'):
        if marker in data and name != 'tools/web/audit-publication.py': errors.append(f'Private/local marker: {name}')
if errors:
    print('\n'.join(errors)); sys.exit(1)
print(f'Publication audit passed: {len(list(filter(None, paths)))} source files; no new binaries or local asset directories.')
