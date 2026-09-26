#!/usr/bin/env python3
"""Score a critic's blind pick against the hidden key.

usage: judge.py <pair_dir> <pick A|B> <piece> <round> [--gap "..."] [--tests pass|fail|na]
Prints JSON {ours_won, real_label, ours_label}. Appends the round to work/progress.jsonl.
ours_won requires the critic to have picked OUR image/series as the real one AND (for
physics pieces) the tolerance tests to pass.
"""
import sys, os, json, argparse, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEYS = os.environ.get('BLIND_KEYS', os.path.expanduser('~/.blind_keys'))
ap = argparse.ArgumentParser()
ap.add_argument('pair_dir'); ap.add_argument('pick'); ap.add_argument('piece'); ap.add_argument('round', type=int)
ap.add_argument('--gap', default=''); ap.add_argument('--tests', default='na')
a = ap.parse_args()
pid = os.path.basename(os.path.normpath(a.pair_dir))
key = json.load(open(os.path.join(KEYS, pid + '.json')))
pick = a.pick.strip().upper()[:1]
won = pick == key['ours'] and a.tests != 'fail'
rec = {'t': datetime.datetime.utcnow().isoformat(timespec='seconds') + 'Z', 'piece': a.piece, 'round': a.round,
       'pair': pid, 'pick': pick, 'ours_label': key['ours'], 'ours_won': won, 'tests': a.tests, 'gap': a.gap}
with open(os.path.join(ROOT, 'work', 'progress.jsonl'), 'a') as f: f.write(json.dumps(rec) + '\n')
print(json.dumps({'ours_won': won, 'real_label': key['real'], 'ours_label': key['ours'], 'critic_pick': pick}))
