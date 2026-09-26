# p-rover: sources for the rover driving and recharging reference

The real artifact is `p-rover.real.csv`, built by `p-rover.build.py`.
Its columns are time_h, battery_soc_pct, mmrtg_power_W and load_W, at a 15-minute cadence over 0-24.5 h.
time_h is Earth hours since local midnight; one sol is 24.66 h.
It shows one representative **Perseverance drive sol**.

## Measured vs budgeted (read this first)

| Item | Status | Where it comes from |
|---|---|---|
| MMRTG output ~110 W (BOL) | Published design value (M2020) | JPL M2020 press kit |
| MMRTG diurnal swing of +/-5 W | **Measured** (Curiosity at landing: 114 W mean, 109-119 W over the sol) | Manning & Simon 2017, via the Planetary Society excerpt |
| MMRTG decay of ~1 W per 80 sols | **Measured** (Curiosity flight trend) | Manning & Simon 2017 |
| Battery 2 x 43 Ah, 8-cell ~28 V | Published design value | M2020 press kit; JPL Li-ion testing report |
| Sleep load 45-70 W, awake >=150 W, drive up to 500 W | Published Curiosity operating figures (engineering budget values, not a time series) | Manning & Simon 2017 |
| Mobility motors <200 W; peak demand 900 W | Published M2020 figures | NASA rover-components page; M2020 press kit |
| **Activity timeline** (when the rover wakes, drives and does relay passes) | **Budgeted / representative, NOT measured** | Built from the published ops pattern: overnight sleep and recharge, morning uplink, midday drive, post-drive imaging, UHF relay passes. The pattern is described in Curiosity team blogs and JPL AutoNav papers. |
| **battery_soc_pct** | **Computed** (energy integration of MMRTG minus load on a 2408 Wh pack, capped at 100%, starting at 75%, no charge/discharge inefficiency) | `p-rover.build.py` |

No measured SOC trace was available.
JPL does not archive rover battery telemetry in PDS.
The papers that show SOC plots (IEEE Aerospace 2023, "Preparing for a Productive Low Power Future on the Curiosity Mars Rover"; PHM 2023, "Battery State-of-Health Aware Path Planning for a Mars Rover", NTRS 20230016001) sit on hosts that are egress-blocked from this sandbox: ieeexplore, ntrs.nasa.gov, papers.phmsociety.org, jpl.nasa.gov, science.nasa.gov, planetary.org and wikipedia are all blocked for WebFetch.
Values from those pages were taken from search-engine extracts of the pages, not from full-text reads.
**Verify against the full text when a later pass can reach it.**

## Sources

1. **JPL Mars 2020 press kit, Power**: https://www.jpl.nasa.gov/news/press_kits/mars_2020/landing/mission/spacecraft/power (also the launch version: https://www.jpl.nasa.gov/news/press_kits/mars_2020/launch/mission/spacecraft/power/)
   - MMRTG "about 110 watts at the start of Perseverance's mission, declining a few percent each year".
   - Two Li-ion batteries, "each has a capacity of about 43 amp-hours", 26.5 kg total.
   - "Power demand can reach 900 watts during science activities."
2. **Manning, R. & Simon, W. L. (2017), *Mars Rover Curiosity / The Design and Engineering of Curiosity* (Springer-Praxis), MMRTG chapter.** Excerpt: https://www.planetary.org/articles/0514-book-excerpt-curiosity-mmrtg
   - At landing the MMRTG gave about 114 W, ranging 109-119 W over the sol. This is measured and was used for the diurnal swing.
   - Decay is "roughly 1 watt per 80 sols", close to linear. This is measured and was used for the decay tolerance.
   - The projection was 54 W at 17 years after fuelling (28 Oct 2025, sol 4702).
   - Two Li-ion batteries rated at 42 Ah each; multiple charge/discharge cycles per sol; kept at 70% SOC in cruise and brought to 100% 12 days before landing.
   - Loads: 45-70 W asleep, at least 150 W awake, up to 500 W driving. The rover is awake about 6 h per sol on average.
   - About 2.5 kWh per sol from the MMRTG (the excerpt says "9 MJ/day").
   (These points came through search-result extracts of the excerpt and of eepower.com / edn.com articles that summarize the same MSL figures.)
3. **NASA JPL, "Performance Testing of Li-ion Cells and Batteries at JPL in Support of Present and Future NASA Missions"**: https://www.nasa.gov/wp-content/uploads/2024/01/performacne-testing-of-li-ion-cells-and-batteries-at-jpl-in-support-of-present-and-future-nasa-mission.pdf
   - MSL mission-simulation testing on 43 Ah Yardney Li-ion cells in 8-cell batteries. I used 28 V nominal, giving 2 x 43 Ah x 28 V = 2408 Wh.
4. **NASA Perseverance rover components (wheels/mobility)**: https://science.nasa.gov/mission/mars-2020-perseverance/rover-components/ (formerly mars.nasa.gov/mars2020/spacecraft/rover/wheels)
   - Top speed on flat hard ground is 4.2 cm/s = 152 m/h. Mobility consumes "less than 200 watts".
5. **Verma, V. et al. (2023), "Autonomous robotics is driving Perseverance rover's progress on Mars", *Science Robotics* 8, eadi3099**: https://www.science.org/doi/10.1126/scirobotics.adi3099
   - AutoNav performance context. Via coverage: about 100 m/h autonomous drive rate, and up to 120 m/h quoted for enhanced AutoNav.
6. **JPL PIA26645, "NASA's Perseverance Breaks Own Rover-Driving Record"**: https://www.jpl.nasa.gov/images/pia26645-nasas-perseverance-breaks-own-rover-driving-record/
   - 411.7 m in one sol (sol 1540, 19 Jun 2025) over about 4 h 24 min. The previous record was 347.7 m (sol 753, 3 Apr 2023).
7. **Curiosity mission blogs (NASA Science)**, qualitative support for the sol pattern (naps to recharge, deficit sols followed by recharge sols, heater load in cold hours):
   - Sols 3994-3995 "Bewitched Battery": https://science.nasa.gov/blog/sols-3994-3995-bewitched-battery/
   - Sols 4607-4608 "Deep Dip" and 4609-4610 "Recharged and Ready To Roll Onwards": https://science.nasa.gov/blog/curiosity-blog-sols-4607-4608-deep-dip/ and https://science.nasa.gov/blog/curiosity-blog-sols-4609-4610-recharged-and-ready-to-roll-onwards/
   - Sol 3068 "Time to re-gift" (power carried over between sols): https://science.nasa.gov/blog/sol-3068-time-to-re-gift
8. **IEEE Aerospace Conference 2023, "Preparing for a Productive Low Power Future on the Curiosity Mars Rover"**: https://ieeexplore.ieee.org/document/10115900/
   - Only the abstract was reachable via search: an average of 50 Wh/sol less wasted energy and a 10% improvement in modeled SOC after ops changes. This backs the size of daily SOC margins (a few tens of Wh is a few percent). Not used numerically.
9. **NASA MMRTG fact sheet**: https://science.nasa.gov/wp-content/uploads/2024/02/mmrtg-factsheet-updated-5-18-20-1.pdf
   - About 110 W electrical from about 2000 W thermal at BOL; 14-year design life. It was blocked for full text; the figures are consistent with sources 1-2.

## Schedule used (budgeted, `p-rover.build.py`)

Default sleep load is 60 W at night and 50 W by day.

| Local time (h) | Load (W) | Activity |
|---|---|---|
| 03:30-04:00 | 180 | UHF relay pass |
| 08:30-09:30 | 250 | Wake, uplink, actuator pre-heat |
| 09:30-11:00 | 200 | Remote science |
| 11:00-11:15 | 180 | Pre-drive imaging |
| 11:15-13:45 | 400 | AutoNav drive (about 250-300 m at 100-120 m/h) |
| 13:45-14:30 | 200 | Post-drive imaging |
| 14:30-15:00 | 200 | UHF relay pass |
| 20:30-21:00 | 180 | UHF relay pass |

Sol energy: generated about 2.70 kWh, used about 2.99 kWh.
SOC goes 75 -> 92 (pre-wake peak) -> 45 (post-drive minimum) -> 63 at the end of the sol.
