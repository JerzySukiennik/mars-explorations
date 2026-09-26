# p-transfer (Earth-Mars transfer burn): reference sources

## Network caveat
ntrs.nasa.gov, ssd.jpl.nasa.gov, naif.jpl.nasa.gov, web.archive.org, wikipedia, nature.com and
semanticscholar were all blocked by the egress proxy, so the NASA handbook tables could not be read directly.
The porkchop minima were therefore **recomputed with the same method the handbook uses**
(patched-conic ballistic Lambert, no deep-space maneuver) on JPL's DE421 ephemeris, and the solver was
checked against published flown-mission C3 values. Script: `refs/data/p-transfer.porkchop.py`
(`pip install jplephem skyfield-data pyerfa scipy`; DE421 ships in the `skyfield-data` PyPI package).

## Sources
1. **Burke, Falck & McGuire, "Interplanetary Mission Design Handbook: Earth-to-Mars Mission Opportunities
   2026 to 2045", NASA/TM-2010-216764, NASA Glenn, 2010.** https://ntrs.nasa.gov/citations/20100037210
   (PDF: https://ntrs.nasa.gov/api/citations/20100037210/downloads/20100037210.pdf).
   The primary source for the 2026/2028/2031 energy minima (C3, launch and arrival dates, arrival v_inf) produced by MIDAS,
   a patched-conic optimizer. We could not download it, so we reproduced its method (see above). Quantities:
   c3_min_2026/2028/2031, tof_2026, vinf_arrival_2026.
2. **JPL DE421 planetary ephemeris** (Folkner et al., JPL IOM 343R-08-003), taken from the PyPI package
   `skyfield-data` (https://pypi.org/project/skyfield-data/). It supplies the heliocentric Earth and Mars states used in the porkchop scan.
3. **InSight launch C3 = 8.19 km2/s2** (launched 2018-05-05, landed 2018-11-26). Web-search summary of the JPL
   InSight trajectory reconstruction (https://dataverse.jpl.nasa.gov/dataset.xhtml?persistentId=hdl:2014/45976)
   and D. Adamo, "InSight's Earth Departure for Mars" (http://www.aiaahouston.org/Horizons/InSightDepartureR0.pdf).
   Our solver gives 8.196. This is the validation point.
4. **MSL launch C3 = 10.78 km2/s2 for a 2011-11-25 launch; entry speed about 5.9 km/s.** ULA Atlas V MSL Mission
   Overview (https://www.ulalaunch.com/docs/default-source/news-items/av_msl_mob.pdf) and JPL DESCANSO
   monograph ch. 8 (https://descanso.jpl.nasa.gov/monograph/series13/DeepCommo_Chapter8--141029.pdf).
   Our solver gives 10.60 for launch on 11-26 and arrival on 2012-08-06, and a 6.07 km/s entry at 125 km. This is a second validation point
   and the sanity range for the entry speed.
5. **Curtis, "Orbital Mechanics for Engineering Students", Ch. 8 (Hohmann Earth-to-Mars example, about 259 d),
   and Vallado, "Fundamentals of Astrodynamics and Applications".** These give the idealised Hohmann TOF and v_inf
   (2.94 km/s depart, 2.65 km/s arrive). Our recomputation with mu_sun = 1.32712440018e11 and a_Mars = 1.523679 AU
   gives TOF 258.87 d. LEO->TMI dv = 3.590 km/s from 300 km (3.611 from 200 km). This is consistent with the
   "LEO to Mars transfer ~3.6 km/s" row of https://en.wikipedia.org/wiki/Delta-v_budget and with
   https://en.wikipedia.org/wiki/Hohmann_transfer_orbit.
6. **NASA Mars Fact Sheet** (https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html). It gives the synodic period
   779.94 d, the Mars sidereal period 686.980 d, GM_Mars 42828 km3/s2 and the equatorial radius 3396.2 km (used for entry speed).
   The Earth sidereal year is 365.256 d.

## Computed minimum-C3 points (DE421, ballistic)
| Opp. | Type | Depart | Arrive | TOF d | C3 km2/s2 | v_inf arr km/s | Entry km/s (125 km, inertial) | dv from 300 km LEO |
|---|---|---|---|---|---|---|---|---|
| 2026 | I  | 2026-11-12 | 2027-08-11 | 272.4 | 10.42 | 2.92 | 5.73 | 3.67 |
| 2026 | II | 2026-10-31 | 2027-08-19 | 292.3 | **9.18** | 2.72 | 5.63 | 3.61 |
| 2028 | I  | 2028-12-10 | 2029-07-20 | 221.7 | 9.02 | 4.87 | 6.93 | 3.61 |
| 2028 | II | 2028-11-29 | 2029-10-10 | 314.8 | **8.99** | 3.16 | 5.86 | 3.60 |
| 2031 | I  | 2031-01-27 | 2031-08-05 | 189.8 | 8.97 | 5.60 | 7.46 | 3.60 |
| 2031 | II | 2031-02-22 | 2032-01-08 | 320.1 | **8.17** | 5.52 | 7.41 | 3.57 |

In 2026 the C3 valley is flat: C3 < min+0.5 covers TOF 276-342 d, departure 2026-10-23 to 11-06 and arrival v_inf 2.56-3.12.

## Conventions used in the real values
- LEO means a 300 km circular orbit, with an impulsive burn, no gravity loss and no launch-declination penalty.
- Entry speed is inertial, at r = 3396.2 + 125 km. The atmosphere-relative speed is about 0.2 km/s lower.
- The 2026 TOF, v_inf and entry values belong to the global minimum-C3 (Type II) solution.
