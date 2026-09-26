# p-mars-atmo: sources for the real Mars atmosphere profile

The real artifact is `p-mars-atmo.real.csv` (alt_km, density_kgm3, temperature_K, pressure_Pa; 0-130 km in 1 km steps).
The measured profile behind it is the **Viking 1 Lander entry profile** (20 July 1976, 22.3N 48.0W, about 16:13 local solar time, northern summer, Ls ~97).
It was reconstructed from the aeroshell accelerometers, the parachute-phase pressure and temperature sensors, and the Upper Atmosphere Mass Spectrometer (UAMS).

## Primary sources

1. **Seiff, A. & Kirk, D. B. (1977)**, "Structure of the atmosphere of Mars in summer at mid-latitudes", *J. Geophys. Res.* 82(28), 4364-4378, doi:10.1029/JS082i028p04364.
   This paper is the primary publication of the Viking 1 and 2 entry profiles.
2. **NASA PDS Atmospheres Node, Viking Lander entry profiles**: https://atmos.nmsu.edu/data_and_services/atmospheres_data/MARS/viking/entry_profiles.html
   - Raw file `VL1_entry_profile.txt` (https://atmos.nmsu.edu/data_and_services/atmospheres_data/MARS/viking/logs/VL1_entry_profile.txt) has columns t, V, z (km), rho (kg/m3), p (mb), T (K), -dz/dt.
     There are ~250 entry points from 120.19 to 5.04 km, extrapolated points from 3.01 to -1.49 km, parachute-descent points from 2.17 to 0.133 km, and retro-rocket-phase points from -0.49 to -1.49 km.
   - Raw file `VL2_entry_profile.txt` covers 110.3 to 26.0 km. It was used only to set tolerances (VL2/VL1 density ratio).
3. **NASA PDS Atmospheres Node, "Mars temperature/pressure" table** (Seiff & Kirk 1977 Tables I-III): https://atmos.nmsu.edu/planetary_datasets/mars_temppres.html (ASCII `marstemppres.txt`)
   - Table I (accelerometer, 4 km steps) was used to cross-check the 120-28 km values.
   - Table II (direct sensing near the surface) gives the landing-site offset (VL1 z=0 in Table II equals -1.49 km in the entry file, 7.62 mbar) and **H0 = 11.697 km**, mu = 44.36 for VL1.
   - Table III (UAMS) supplied the **130 km** point: p = 8.77e-7 mbar, T = 120 K, rho = 3.80e-9 kg/m3. The 135 km point was used only as an interpolation anchor.

The NMSU/PDS hosts are blocked from this sandbox (egress 403). I retrieved the raw PDS text files byte-for-byte from a GitHub mirror that keeps the original downloads unmodified under `raw/`:
https://github.com/Sansh-M/Hephaestus/tree/main/src/Data/Atmosphere_Data/Sourced/raw/mars (commit b9f37a62b12dffb0d07a56507b206467d5f06da6).
Local copy: /home/user/refs/Sansh-M/Hephaestus/src/Data/Atmosphere_Data/Sourced/raw/mars/.
The mirror's README credits the atmos.nmsu.edu URLs above.
I cross-checked it internally: the Table I values (e.g. 120 km: 4.14e-6 mbar / 136.3 K / 1.60e-8) agree with the high-rate file (120.19 km: 4.08e-6 / 135.6 / 1.58e-8).

## How the CSV was built (`p-mars-atmo.build.py`)

- **Points used:** entry points, parachute-descent points, retro-phase points and the two UAMS points (130, 135 km).
  The "extrapolation to the surface" block was left out because the parachute measurements cover that range.
- **Interpolation:** points were sorted by z and interpolated to integer km, linearly in log(rho), log(p) and in T.
- **Units:** pressure was converted mb to Pa (x100).
- **Rows 121-129 km** are log-linear interpolations between the accelerometer top (120.19 km) and UAMS 130 km. This region is the least certain part of the profile.
- **Rows 6-25 km** come from sparse parachute-phase and late-entry points about 1-2 km apart, so they are interpolated too.
- **Altitude reference:** the Viking-era Mars reference surface (6.1 mbar areoid). The VL1 site is at -1.49 km on this scale and about -3.6 km relative to the MOLA areoid.
  A simulation that uses MOLA-referenced altitude would see about a 2 km offset (~18% in density). The tolerances absorb this.

## Sources wanted but not reachable (for a later pass)

- **Mars Pathfinder ASI/MET EDL profile** (Magalhaes, Schofield & Seiff 1999, JGR 104(E4) 8943, doi:10.1029/1998JE900041).
  PDS volume mpam_0001, file `data/edl_rdr/edl_ddr.tab`: https://atmos.nmsu.edu/PDS/data/mpam_0001/ and https://pds.nasa.gov/data/mpfl-m-asimet-4-ddr-edl-v1.0/mpam_0001/document/edlddrds.htm.
  Both hosts are blocked here, and no GitHub mirror was found.
  From the dataset description (via web search), the profile covers 0-160 km, density is the primary quantity, and there is a ~10-12 km inversion. The profile falls below the CO2 condensation curve near 80 km, which is why the 80-130 km tolerance is looser.
- **MSL EDL reconstruction** to 134.1 km (Holstein-Rathlou et al. 2016, PSS, doi:10.1016/j.pss.2015.12.017), PDS readme https://pds.nasa.gov/datastandards/training/2017-dps/readme_MSLEDL.txt. Blocked.
- **NASA Mars Fact Sheet** (https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html). Blocked, so I did not fetch it.
  The values quoted in the tolerances note (surface pressure 636 Pa, surface density ~0.020 kg/m3, scale height 11.1 km) are well-known published figures, but I did not re-verify them in this session.
- **Secondary, not used:** CalcMySky `examples/mars.atmo` (https://github.com/10110111/CalcMySky) is a two-exponential fit to the same Viking 1 PDS data. I did not use it because it is a fit, not measured data.
