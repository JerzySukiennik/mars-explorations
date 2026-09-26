#!/usr/bin/env python3
"""Restore the NASA raw-image reference set listed in refs/real/MANIFEST.json.

The NASA images are public domain but large, so git keeps only the manifest. Each
manifest entry with an original_url_if_known is re-downloaded to its path if missing.
SpaceX webcast frames are not redistributed; their manifest entries record the
official broadcast URL and timestamp they were extracted from.
"""
import json, os, sys, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
man = json.load(open(os.path.join(ROOT, 'refs/real/MANIFEST.json')))
entries = man if isinstance(man, list) else man.get('files', [])
n = 0
for e in entries:
    if not e['category'].startswith('mars_'): continue
    path = os.path.join(ROOT, e['path']) if not os.path.isabs(e['path']) else e['path']
    url = e.get('original_url_if_known') or e.get('url')
    if os.path.exists(path) or not url: continue
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        urllib.request.urlretrieve(url.replace('http://mars.jpl.nasa.gov', 'https://mars.nasa.gov'), path); n += 1
    except Exception as ex:
        print('failed', url, ex, file=sys.stderr)
print('downloaded', n)
