#!/usr/bin/env python3
"""Build a blind A/B pair for the critic.

Images:  blind.py img  <real> <ours> [--crop-real x0,y0,x1,y1] [--crop-ours x0,y0,x1,y1] [--size 1024x768] [--gray]
Series:  blind.py series <real.csv> <ours.csv> --x COL --y COL[,COL...] [--xlabel ..] [--ylabel ..]

Both sides are normalised identically (same crop aspect, same size, same JPEG
re-encode at q=88, metadata stripped) so file-level tells disappear. Output goes to
work/blind/<id>/{A,B}.png. The answer key is written OUTSIDE the critic's view to
$BLIND_KEYS (default: ~/.blind_keys/<id>.json). The script prints only the pair dir.
"""
import sys, os, json, io, secrets, argparse
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEYS = os.environ.get('BLIND_KEYS', os.path.expanduser('~/.blind_keys'))

def box(s):
    return tuple(int(v) for v in s.split(',')) if s else None

def norm_img(path, crop, size, gray):
    im = Image.open(path)
    im = im.convert('L' if gray else 'RGB')
    if crop: im = im.crop(crop)
    tw, th = size
    # centre-crop to target aspect, then resize
    w, h = im.size; ta = tw / th
    if w / h > ta:
        nw = int(h * ta); im = im.crop(((w - nw) // 2, 0, (w - nw) // 2 + nw, h))
    else:
        nh = int(w / ta); im = im.crop((0, (h - nh) // 2, w, (h - nh) // 2 + nh))
    im = im.resize((tw, th), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=88); buf.seek(0)
    return Image.open(buf).convert(im.mode)

def plot_series(path, xcol, ycols, xlabel, ylabel, out):
    import csv
    import matplotlib; matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    rows = list(csv.DictReader(open(path)))
    fig, ax = plt.subplots(figsize=(8, 5), dpi=110)
    for yc in ycols:
        xs, ys = [], []
        for r in rows:
            try:
                x, y = float(r[xcol]), float(r[yc])
            except (ValueError, KeyError):
                continue
            if x == x and y == y: xs.append(x); ys.append(y)
        ax.plot(xs, ys, lw=1.2, label=yc)
    ax.set_xlabel(xlabel or xcol); ax.set_ylabel(ylabel or ','.join(ycols)); ax.grid(alpha=.3); ax.legend()
    fig.tight_layout(); fig.savefig(out); plt.close(fig)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('mode', choices=['img', 'series'])
    ap.add_argument('real'); ap.add_argument('ours')
    ap.add_argument('--crop-real'); ap.add_argument('--crop-ours')
    ap.add_argument('--size', default='1024x768'); ap.add_argument('--gray', action='store_true')
    ap.add_argument('--x'); ap.add_argument('--y'); ap.add_argument('--xlabel'); ap.add_argument('--ylabel')
    ap.add_argument('--piece', default='')
    a = ap.parse_args()
    pid = secrets.token_hex(4)
    d = os.path.join(ROOT, 'work', 'blind', pid); os.makedirs(d, exist_ok=True)
    real_is_a = secrets.randbelow(2) == 0
    names = {'real': 'A' if real_is_a else 'B', 'ours': 'B' if real_is_a else 'A'}
    if a.mode == 'img':
        size = tuple(int(v) for v in a.size.split('x'))
        norm_img(a.real, box(a.crop_real), size, a.gray).save(os.path.join(d, names['real'] + '.png'))
        norm_img(a.ours, box(a.crop_ours), size, a.gray).save(os.path.join(d, names['ours'] + '.png'))
    else:
        ycols = a.y.split(',')
        plot_series(a.real, a.x, ycols, a.xlabel, a.ylabel, os.path.join(d, names['real'] + '.png'))
        plot_series(a.ours, a.x, ycols, a.xlabel, a.ylabel, os.path.join(d, names['ours'] + '.png'))
    os.makedirs(KEYS, exist_ok=True)
    json.dump({'id': pid, 'piece': a.piece, 'real': names['real'], 'ours': names['ours'],
               'real_src': a.real, 'ours_src': a.ours}, open(os.path.join(KEYS, pid + '.json'), 'w'))
    print(d)

if __name__ == '__main__':
    main()
