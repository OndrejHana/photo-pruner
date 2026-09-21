"""Download licensed camera fixtures outside git; verify before native tests."""
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request

root = Path(__file__).resolve().parent.parent
directory = root / "artifacts/fixtures"
directory.mkdir(parents=True, exist_ok=True)
for fixture in json.loads((root / "tests/fixtures/orf-manifest.json").read_text()):
    target = directory / fixture["name"]
    if not target.exists():
        url = urllib.parse.quote(fixture["url"], safe=":/()")
        with urllib.request.urlopen(url, timeout=120) as response:
            data = response.read()
        target.write_bytes(data)
    if hashlib.sha256(target.read_bytes()).hexdigest() != fixture["sha256"]:
        target.unlink()
        raise RuntimeError(f"Fixture digest mismatch: {fixture['name']}")
    print(f"Verified {fixture['name']} ({fixture['license']})")
