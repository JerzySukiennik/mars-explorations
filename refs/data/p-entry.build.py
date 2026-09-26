#!/usr/bin/env python3
"""Build p-entry.real.csv: Starship IFT-5 (13 Oct 2024) SHIP reentry, webcast-HUD telemetry.
Primary: Boldz5/Starship_Flight_Telemetry 'Starship IFT-5/Booster and Ship Telemetry/Ship_Telemetry.csv' (1 Hz OCR).
Window: first sample at/below 120 km (entry interface, T+2602 s) to flip start (speed bump, T+3923 s).
Raw values, no smoothing. Altitude is the HUD's integer-km readout."""
import csv, sys
src = sys.argv[1] if len(sys.argv) > 1 else "/home/user/refs/Boldz5/Starship_Flight_Telemetry/Starship IFT-5/Booster and Ship Telemetry/Ship_Telemetry.csv"
out = sys.argv[2] if len(sys.argv) > 2 else "/home/user/mars-explorations/refs/data/p-entry.real.csv"
rows = {}
for r in csv.DictReader(open(src)):
    rows[int(r["TIME[S]"])] = (int(r["SPEED"]), int(r["altitude"]))
T0 = min(t for t in rows if t > 2000 and rows[t][1] <= 120)
T1 = 3923  # last sample before flip-maneuver speed bump (333->336->337 km/h, then landing burn)
with open(out, "w", newline="") as f:
    w = csv.writer(f); w.writerow(["t", "ship_speed_kmh", "ship_alt_km"])
    for t in range(T0, T1 + 1):
        w.writerow([t, *rows[t]])
print(T0, T1)
