#!/usr/bin/env python3
"""Build p-rover.real.csv: representative Perseverance drive-sol battery SOC timeline.

Every input number below is a published NASA/JPL figure (see p-rover.sources.md).
The *timeline* (when each activity happens) is a representative drive-sol schedule,
NOT a downlinked telemetry trace: no measured SOC trace is publicly accessible.
"""
import math, os

SOL_H = 24.6597                      # Mars solar day in Earth hours (published constant)
DT = 0.25                            # 15-minute cadence
# Battery: 2 x 43 Ah Li-ion (M2020 press kit), 8-cell series ~28 V nominal bus (JPL/Yardney 8s cells)
CAP_WH = 2 * 43.0 * 28.0             # 2408 Wh
# MMRTG: ~110 W at start of mission (M2020 press kit).  Diurnal swing: Curiosity measured
# 109-119 W around 114 W mean at landing (Manning & Simon 2017) -> +/-5 W, max in the
# cold pre-dawn (largest hot/cold-junction dT), min mid-afternoon.
P_MEAN, P_SWING = 110.0, 5.0
def mmrtg(t):
    # peak ~05:00 local, trough ~17:00 local
    return P_MEAN + P_SWING * math.cos(2 * math.pi * (t - 5.0) / 24.0)

# Loads (Curiosity published: sleep 45-70 W, awake >= 150 W, driving up to 500 W;
# M2020: mobility motors < 200 W, peak science demand up to 900 W).
SLEEP_NIGHT, SLEEP_DAY = 60.0, 50.0
SCHEDULE = [  # (start_h, end_h, W, label) local mean solar time, Earth hours from midnight
    (3.50, 4.00, 180.0, "overnight UHF relay pass (awake + UHF radio)"),
    (8.50, 9.50, 250.0, "wake, X-band uplink, actuator/arm pre-heat"),
    (9.50, 11.00, 200.0, "remote-sensing science (Mastcam-Z/SuperCam)"),
    (11.00, 11.25, 180.0, "pre-drive imaging"),
    (11.25, 13.75, 400.0, "AutoNav drive: ~150 W avionics + <200 W motors + nav imaging/compute"),
    (13.75, 14.50, 200.0, "post-drive imaging for next-sol planning"),
    (14.50, 15.00, 200.0, "afternoon UHF relay pass (drive data downlink)"),
    (20.50, 21.00, 180.0, "evening UHF relay pass"),
]
def load(t):
    for a, b, w, _ in SCHEDULE:
        if a <= t < b:
            return w
    return SLEEP_DAY if 7.0 <= t < 19.0 else SLEEP_NIGHT

SOC0 = 75.0
rows, soc, t = [], SOC0, 0.0
n = int(round(24.5 / DT))
for i in range(n + 1):
    t = i * DT
    p, l = mmrtg(t), load(t)
    rows.append((t, soc, p, l))
    # integrate over [t, t+DT] with midpoint values
    pm, lm = mmrtg(t + DT / 2), load(t + DT / 2)
    soc = min(100.0, soc + (pm - lm) * DT / CAP_WH * 100.0)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "p-rover.real.csv")
with open(out, "w") as f:
    f.write("time_h,battery_soc_pct,mmrtg_power_W,load_W\n")
    for t, s, p, l in rows:
        f.write(f"{t:.2f},{s:.2f},{p:.2f},{l:.1f}\n")
e_gen = sum(mmrtg(i*DT+DT/2) for i in range(int(SOL_H/DT))) * DT
e_use = sum(load(i*DT+DT/2) for i in range(int(SOL_H/DT))) * DT
print(out, len(rows), "rows; min SOC %.1f max %.1f end %.1f; gen %.0f Wh use %.0f Wh" %
      (min(r[1] for r in rows), max(r[1] for r in rows), rows[-1][1], e_gen, e_use))
