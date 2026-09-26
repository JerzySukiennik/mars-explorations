# p-entry sources: Starship ship reentry (IFT-5, 13 Oct 2024)

**Flight:** SpaceX Starship Integrated Flight Test 5 (Flight 5), Ship 30. This was the first flight where the ship completed a fully controlled reentry, flip, landing burn and on-target splashdown in the Indian Ocean. The booster was caught by the tower on the same flight.

**Measured quantity:** the official SpaceX webcast HUD. SPEED is in km/h (the Earth-relative value SpaceX displays), ALTITUDE is in whole km, and t is webcast mission time in seconds. Three independent hobbyist pipelines OCR'd the HUD, and the reference was cross-checked against all three.

**Real artifact:** `p-entry.real.csv` (t, ship_speed_kmh, ship_alt_km). It has 1325 rows at 1 Hz covering T+2599 s to T+3923 s: from the entry interface (the first 120 km reading) to the start of the flip. The values are raw with no smoothing. `p-entry.build.py` regenerates the file.

## Sources

1. **Boldz5/Starship_Flight_Telemetry** (primary). https://github.com/Boldz5/Starship_Flight_Telemetry, commit a01a3fe6dfe54ce35e3f887f0a14b2514369a5c7, file `Starship IFT-5/Booster and Ship Telemetry/Ship_Telemetry.csv` (`TIME[S],SPEED,altitude`, 1 Hz).
   - **What I took:** the whole series in the window, used as-is. Within the window no seconds are missing and there are no OCR jumps (no step larger than 150 km/h or 2 km from one second to the next).
2. **jordixucla/starship_telemetry** (cross-check). https://github.com/jordixucla/starship_telemetry/blob/main/telemetry_ift5.txt, commit 7fbdd5cd939dd22fad3dc6d617cc4fab98c976b6. The README says the IFT-5 telemetry was "captured directly from X stream". Format is HH:MM:SS followed by booster alt, booster speed, ship alt and ship speed, tab-separated.
   - **Clock:** its clock is aligned with source 1 at offset 0 s.
   - **Agreement in the window:** speed median |diff| 8 km/h (p95 20, max 28). Altitude max |diff| 1 km.
3. **SofieBrink/StarshipTelemetryExtractor** (cross-check). https://github.com/SofieBrink/StarshipTelemetryExtractor/blob/main/Examples/IFT-5%20Telemetry.csv, commit 88c01a780ea26c862923e1145b70dad1aaf52583. This is 30 fps Tesseract OCR, and MissionTime is stored in days (multiply by 86400 to get seconds). I used the `StarshipVelocity_Corrected` and `StarshipAltitude_Corrected` columns.
   - **Clock:** its clock is 2 s behind source 1 (best-fit offset).
   - **Agreement in the window:** speed median |diff| 3 km/h (p95 10, max 12). Altitude max |diff| 1 km.
4. **Local mirror of the same files:** `refs/real/telemetry/IFT5_ship_telemetry_boldz5.csv`, `IFT5_telemetry_jordixucla.tsv` and `IFT5_telemetry_30fps_sofiebrink.csv`. These are identical copies of sources 1–3.

## Derived checkpoints (all from source 1, confirmed by sources 2 and 3)

| Event | Time | Speed | Altitude |
|---|---|---|---|
| Entry interface (first 120 km reading) | T+2599 s | 26 639 km/h | 120 km |
| Peak speed | T+2814 s | 26 756 km/h | ~90 km |
| Speed falls below 10 000 km/h | T+3601 s | 9 995 km/h | 46 km |
| Speed falls below 1 000 km/h | T+3784 s | 994 km/h | 20 km |
| Terminal speed (last seconds before the flip) | – | ~333 km/h | – |
| Flip / landing burn begins | T+3924 s | speed bump 332 → 337 km/h, then drops to ~50 km/h by T+3933 | – |

**Lift-supported altitude plateau:** altitude holds at 69–70 km from about T+3000 s to T+3210 s, while speed falls from 25 700 to 22 600 km/h.

**Peak along-track deceleration:** about 1.55 g near T+3692 s, at 37 km. This comes from a 10 s central difference of the speed series.

## Not used / blocked

- **Primary SpaceX and news sources:** spacex.com, YouTube and en.wikipedia.org are blocked by the egress proxy, so the timeline could not be cross-checked there.
- **Why there is no independent event-time source:** the HUD itself is SpaceX's primary published telemetry, which the three OCR sets reproduce.
- **Other flights:** IFT-4 and IFT-6 OCR sets exist (SofieBrink, jordixucla) and could serve as alternates. I chose IFT-5 because it has two fully independent 1 Hz extractions plus a 30 fps one, and it ends in a nominal controlled splashdown. IFT-4 lost a flap during reentry.
