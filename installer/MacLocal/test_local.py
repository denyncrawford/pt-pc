"""Integration checks using installer/Tests' synthetic PKGs; no game assets."""
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

binary, fixtures, viewer = (Path(p).resolve() for p in sys.argv[1:4])

def run(*args, cwd=None, input=None):
    return subprocess.run([str(binary), *map(str, args)], cwd=cwd, input=input,
                          text=True, capture_output=True, timeout=30)

with tempfile.TemporaryDirectory(prefix='pt-mac-test-') as tmp:
    root = Path(tmp)
    output = root / 'extracted'
    result = run(fixtures / 'fixture.pkg', output)
    assert result.returncode == 0, result.stderr
    manifest = json.loads((output / 'manifest.json').read_text())
    assert len(manifest['files']) == 3
    for f in manifest['files']:
        data = (output / f['name']).read_bytes()
        assert f['bytes'] == len(data)
        assert f['sha256'] == hashlib.sha256(data).hexdigest()
        assert data == (fixtures / 'extracted' / f['name']).read_bytes()
    print('PASS extraction bytes and SHA-256 manifest')

    sentinel = output / 'keep.txt'
    sentinel.write_text('preserve')
    assert run(fixtures / 'fixture.pkg', output).returncode != 0
    assert sentinel.read_text() == 'preserve'
    print('PASS existing destination preserved')

    for name in ('retail.pkg', 'invalid.pkg'):
        target = root / name.replace('.pkg', '-failed')
        result = run(fixtures / name, target)
        assert result.returncode != 0
        assert not target.exists()
        assert not list(root.glob('.pt-extract-*'))
    print('PASS rejected PKGs leave no partial output')

    path = root / "archivo con espacios y 'comilla'.pkg"
    path.write_bytes((fixtures / 'fixture.pkg').read_bytes())
    result = run(cwd=root, input=shlex.quote(str(path)) + '\n')
    assert result.returncode == 0, result.stderr
    assert len(list((root / 'extraidos').glob('PT-*/chunk1.psarc'))) == 1
    # Finder-style backslash escaping, independent of shlex's single-quote form.
    escaped = str(path).replace(' ', '\\ ').replace("'", "\\'")
    result = run(cwd=root, input=escaped + '\n')
    assert result.returncode == 0, result.stderr
    assert len(list((root / 'extraidos').glob('PT-*/chunk1.psarc'))) == 2
    print('PASS interactive Finder paths, spaces and quotes')

    server = subprocess.Popen([str(binary), '--serve', str(viewer)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for attempt in range(50):
            assert server.poll() is None, server.stderr.read().decode()
            try:
                with urllib.request.urlopen('http://127.0.0.1:8081/', timeout=1) as response:
                    assert response.read() == (viewer / 'index.html').read_bytes()
                break
            except urllib.error.URLError:
                time.sleep(.1)
        else:
            raise AssertionError('server did not start')
        with urllib.request.urlopen('http://127.0.0.1:8081/geometry.wasm') as response:
            assert response.headers['Content-Type'] == 'application/wasm'
            assert response.read() == (viewer / 'geometry.wasm').read_bytes()
        for path in ('/../LICENSE', '/extraidos/chunk1.psarc', '/missing'):
            try:
                urllib.request.urlopen('http://127.0.0.1:8081' + path)
                raise AssertionError('unexpected exposed path')
            except urllib.error.HTTPError as e:
                assert e.code == 404
        try:
            urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8081/', method='POST', data=b'test'))
            raise AssertionError('POST was accepted')
        except urllib.error.HTTPError as e:
            assert e.code == 405
        print('PASS loopback viewer, WASM MIME, blocked private paths and POST')
    finally:
        server.terminate()
        server.communicate(timeout=5)
