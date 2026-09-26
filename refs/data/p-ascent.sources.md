# p-ascent: real references (Starship launch ascent)

**Flight chosen: Starship Integrated Flight Test 5 (IFT-5), 13 Oct 2024, 12:25 UTC, Booster 12 / Ship 30.**
It was a full-duration nominal ascent. All 33 booster engines ran to hot staging, the booster did boostback and a landing burn and was caught by the tower, and the ship reached SECO at about T+8:29 at 26,502 km/h and 150 km before a controlled splashdown. IFT-5 is the latest nominal flight with **three independent** OCR extractions of the SpaceX webcast HUD (IFT-6 has two; IFT-7 and IFT-8 lost the ship during ascent).

Output: `p-ascent.real.csv`, 1 s cadence, T+0 to T+512 s, columns `t,booster_speed_kmh,booster_alt_km,ship_speed_kmh,ship_alt_km`.
It is built reproducibly by `p-ascent.build.py` from the local copies in `refs/real/telemetry/`.

## Sources

1. **SofieBrink/StarshipTelemetryExtractor**, `Examples/IFT-5 Telemetry.csv`
   https://github.com/SofieBrink/StarshipTelemetryExtractor (local: `refs/real/telemetry/IFT5_telemetry_30fps_sofiebrink.csv`)
   - Per-frame (30 fps) Tesseract OCR of the official 1080p webcast HUD.
   - Used as the **primary** series. For each integer second t, I took the median of the frames in [t-0.5, t+0.5), with t = frame/30. This timing matches Boldz5's explicit T+ clock; the booster peak of 5274-5275 km/h falls at T+157 in both.
   - Booster columns: `*_Corrected`. Ship columns: `*_Raw` only. The "corrected" ship columns before the ship gauge first reads (T+167.8) are a synthetic linear ramp from 0, so I discarded them.
   - Up to T+160 the vehicle is stacked, so ship = booster.
2. **jordixucla/starship_telemetry**, `telemetry_ift5.txt` (captured from the X live stream, 1 Hz)
   https://github.com/jordixucla/starship_telemetry (local: `refs/real/telemetry/IFT5_telemetry_jordixucla.tsv`)
   - Columns are: clock, booster alt, booster speed, ship alt, ship speed.
   - Its clock runs 1 s behind the frame timing, so I shifted it by +1 s.
   - It fills the ship values for T+161-162 (hot staging), where SofieBrink has no ship reading. The clock OCR froze at 00:02:39 for three rows, and those rows were spread over 2:39-2:41. T+162 is an interpolated value.
   - Cross-check for the ship after staging: median |Δv| 9 km/h, p95 22, max 25 km/h. Altitude agrees exactly (p95 0 km).
3. **Boldz5/Starship_Flight_Telemetry**, `Starship IFT-5/Booster and Ship Telemetry/{Booster,Ship}_Telemetry.csv` (1 Hz, explicit T+ seconds)
   https://github.com/Boldz5/Starship_Flight_Telemetry (local: `refs/real/telemetry/IFT5_{booster,ship}_telemetry_boldz5.csv`)
   - Independent cross-check for the booster: median |Δv| 9.5 km/h, p95 55, max 69 km/h; altitude within 1 km everywhere.
   - Used to confirm the time zero, and the catch at T+417-418 (speed about 0 at alt 0).
4. **NASASpaceFlight: "SpaceX Catches a Super Heavy Booster During a Milestone Flight 5"**, https://www.nasaspaceflight.com/2024/10/starship-flight-5-catch/
   - MECO at T+02:33.
   - All 33 engines ran to hot staging.
   - Landing-burn relight at about T+6:30.
5. **Space.com: Flight 5 booster catch**, https://www.space.com/spacex-starship-flight-5-launch-super-heavy-booster-catch-success-video
   - Booster caught "nearly seven minutes after launch"; this matches the HUD speed reaching 0 at T+418.
   - Also used for the nominal-flight confirmation.
6. SpaceX official Flight 5 page, https://www.spacex.com/launches/starship-flight-5. It is the original source of the HUD numbers (webcast), but it is blocked from this environment and was not fetched directly.

## Other telemetry found but not used for the artifact
- chrisjbillington/starship_telemetry (IFT-1, which failed before staging).
- meithan/Starship_IFT2 and Starship_IFT3 (IFT-2 ship lost near SECO; IFT-3 was complete but has a single source).
- SofieBrink IFT-4 and IFT-6, and jordixucla IFT-3/4/6. IFT-6 is a valid alternate with two sources.
- sanitaravel/Space-Launch-Telemetry-Analyzer has ROI configs for IFT-6 through IFT-12 but no extracted numbers.

## Caveats
- The HUD "speed" is SpaceX's displayed speed, understood to be Earth-relative/surface speed, not inertial. It starts at 0 on the pad.
- Altitude is shown as integer km, so the altitude columns are staircases.
- The booster columns are blank after T+429, where the HUD stops showing booster values after the catch.
