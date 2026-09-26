#!/usr/bin/env python3
"""Build refs/data/p-ascent.real.csv: SpaceX Starship IFT-5 (2024-10-13) webcast
HUD telemetry resampled to 1 s, T+0 .. T+512 s (ship SECO ~T+509 s).

Primary source : SofieBrink/StarshipTelemetryExtractor "Examples/IFT-5 Telemetry.csv"
                 (per-frame 30 fps OCR of the official webcast HUD; t = frame/30 s).
Ship gap fill  : jordixucla/starship_telemetry telemetry_ift5.txt (1 Hz OCR incl. ship
                 values during hot staging), clock shifted +1 s to match primary.
Cross-check    : Boldz5/Starship_Flight_Telemetry IFT-5 Booster_Telemetry.csv (1 Hz).
"""
import csv, statistics, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
TEL = os.path.join(HERE, '..', 'real', 'telemetry')
T_END = 512
T_STAGE = 160   # last second where ship == booster on the HUD (jordixucla shows split at T+2:40/2:41)

def num(s):
    s = s.strip()
    return float(s) if s else None

rows = list(csv.reader(open(os.path.join(TEL, 'IFT5_telemetry_30fps_sofiebrink.csv'))))[1:]
# per-frame: (t, b_alt, b_v, s_alt_raw, s_v_raw); use RAW ship (corrected ship column is
# linearly interpolated from 0 before the ship gauge first reads, i.e. synthetic)
frames = []
for i, r in enumerate(rows):
    t = (i + 1) / 30.0
    frames.append((t, num(r[3]), num(r[5]), num(r[6]), num(r[8])))

def window(t, col, half=0.5):
    vals = [f[col] for f in frames if t - half <= f[0] < t + half and f[col] is not None]
    return statistics.median(vals) if vals else None

# jordixucla: HH:MM:SS \t b_alt \t b_v \t s_alt \t s_v ; keep last row per clock second
jx = {}
seen_later = set()
for line in open(os.path.join(TEL, 'IFT5_telemetry_jordixucla.tsv')):
    q = line.split('\t')[0]
    try:
        h, m, s_ = map(int, q.split(':')); seen_later.add(h*3600+m*60+s_+1)
    except ValueError: pass
for line in open(os.path.join(TEL, 'IFT5_telemetry_jordixucla.tsv')):
    p = line.rstrip('\n').split('\t')
    if len(p) < 5 or p[0].count(':') != 2: continue
    try: [int(x) for x in p[0].split(':')]
    except ValueError: continue
    h, m, s = map(int, p[0].split(':'))
    k = h * 3600 + m * 60 + s + 1
    # repeated clock readings (OCR froze the clock, e.g. three rows at 00:02:39 followed by
    # 00:02:42) are spread over the following unused seconds
    while k in jx and k + 1 not in jx and len(jx[k]) >= 1 and k < 170 and (k + 1) not in seen_later:
        k += 1
    jx.setdefault(k, []).append([num(x) for x in p[1:5]])

# frames are dense; bin once for speed
bins = {}
for f in frames:
    k = int(round(f[0]))
    if k <= T_END + 1: bins.setdefault(k, []).append(f)
def med(t, col):
    v = [f[col] for f in bins.get(t, []) if f[col] is not None]
    return statistics.median(v) if v else None

out = []
for t in range(0, T_END + 1):
    ba, bv, sa, sv = med(t, 1), med(t, 2), med(t, 3), med(t, 4)
    if t <= T_STAGE:
        sa, sv = ba, bv
    elif sv is None or sa is None:
        j = jx.get(t)
        if j:
            j = j[-1]
            sa = sa if sa is not None else j[2]
            sv = sv if sv is not None else j[3]
    out.append([t, bv, ba, sv, sa])

# fill isolated single-second OCR dropouts by linear interpolation (flagged count)
filled = 0
for c in range(1, 5):
    for i in range(1, len(out) - 1):
        if out[i][c] is None and out[i-1][c] is not None and out[i+1][c] is not None:
            out[i][c] = (out[i-1][c] + out[i+1][c]) / 2; filled += 1
print('interpolated single-sample gaps:', filled, file=sys.stderr)

def fmt(x):
    if x is None: return ''
    return str(int(x)) if float(x).is_integer() else f'{x:.1f}'
with open(os.path.join(HERE, 'p-ascent.real.csv'), 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['t', 'booster_speed_kmh', 'booster_alt_km', 'ship_speed_kmh', 'ship_alt_km'])
    for r in out: w.writerow([r[0]] + [fmt(x) for x in r[1:]])

# cross-check vs Boldz5 booster (1 Hz, explicit T+ seconds)
bz = {int(r[0]): (float(r[1]), float(r[2])) for r in list(csv.reader(open(os.path.join(TEL, 'IFT5_booster_telemetry_boldz5.csv'))))[1:]}
dv = [abs(r[1] - bz[r[0]][0]) for r in out if r[1] is not None and r[0] in bz]
da = [abs(r[2] - bz[r[0]][1]) for r in out if r[2] is not None and r[0] in bz]
print('booster vs Boldz5: n=%d  |dv| median %.1f p95 %.1f max %.1f km/h ; |dalt| median %.1f max %.1f km' % (
    len(dv), statistics.median(dv), sorted(dv)[int(.95*len(dv))], max(dv), statistics.median(da), max(da)), file=sys.stderr)
dv = []; da = []
for r in out:
    j = jx.get(r[0])
    if j and r[3] is not None and j[-1][3] is not None and r[0] > T_STAGE: dv.append(abs(r[3] - j[-1][3]))
    if j and r[4] is not None and j[-1][2] is not None and r[0] > T_STAGE: da.append(abs(r[4] - j[-1][2]))
print('ship vs jordixucla(+1s): n=%d |dv| median %.1f p95 %.1f max %.1f ; |dalt| median %.1f p95 %.1f' % (
    len(dv), statistics.median(dv), sorted(dv)[int(.95*len(dv))], max(dv), statistics.median(da), sorted(da)[int(.95*len(da))]), file=sys.stderr)
