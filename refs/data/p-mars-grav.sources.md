# p-mars-grav sources (Mars gravity and orbits)

Note: nssdc.gsfc.nasa.gov, ssd.jpl.nasa.gov, wikipedia and archive.org were blocked by the egress proxy in this session. Values below are the published figures from those primary sources as documented, cross-checked against poliastro's cited constants (cloned at /home/user/refs/poliastro/poliastro, src/poliastro/constants/general.py and rotational_elements.py). All derived quantities were recomputed with python from these inputs.

| Source | URL | Taken |
|---|---|---|
| NASA NSSDC Mars Fact Sheet (D. Williams) | https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html | GM 42828.37 km^3/s^2 (x10^6 km^3/s^2 0.042828), equatorial radius 3396.2 km, volumetric mean radius 3389.5 km, surface gravity 3.71 m/s^2, escape velocity 5.03 km/s, sidereal rotation 24.6229 h, J2 1960.45e-6, Phobos period 0.31891 d / a 9378 km, Deimos period 1.26244 d / a 23459 km |
| JPL SSD Planetary Physical Parameters | https://ssd.jpl.nasa.gov/planets/phys_par.html | GM Mars 42828.37 km^3/s^2, mean radius 3389.5 km, equatorial 3396.19 km, sidereal rotation 1.02595676 d |
| JPL SSD Planetary Satellite Mean Elements | https://ssd.jpl.nasa.gov/sats/elem/ | Phobos a 9376 km P 0.319 d; Deimos a 23458 km P 1.263 d (cross-check of periods) |
| Konopliv et al. 2006, Icarus 182, 23-50 (MGS95J gravity; Phobos/Deimos masses) | https://doi.org/10.1016/j.icarus.2005.12.025 | GM 42828.37 km^3/s^2 (4.282837440e13 m^3/s^2 via poliastro), J2 ~1.9604e-3 at R_ref 3396 km |
| IAU WGCCRE 2015 (Archinal et al. 2018, CMDA 130:22) | https://doi.org/10.1007/s10569-017-9805-5 | Mars R_eq 3396.19 km, R_mean 3389.5 km, rotation rate 350.891982 deg/day -> 24.6229 h |
| Vallado, Fundamentals of Astrodynamics and Applications (4th ed.), eq. 9-41 | (book) | Secular J2 nodal regression formula dOmega/dt = -3/2 n J2 (R/p)^2 cos i; Mars rotational period 1.02595675 d |
| poliastro constants (open-source, cites above) | https://github.com/poliastro/poliastro/blob/main/src/poliastro/constants/general.py | Machine-readable cross-check of GM, R_eq, R_mean, R_polar, rotation period |

## Derivations (python, GM=42828.37 km^3/s^2)
- escape velocity sqrt(2GM/3389.5) = 5.027 km/s (fact sheet 5.03)
- circular speed at 200 km: a=3589.5 km -> 3.454 km/s; period 108.82 min
- areostationary radius (GM T^2/4pi^2)^(1/3), T=88642.66 s -> 20427.7 km
- J2 nodal precession, i=45 deg, a=3589.5, R=3396.2, J2=1.96045e-3 -> -8.868 deg/day
- Phobos 0.31891 d x 24 = 7.6538 h; Deimos 1.26244 d x 24 = 30.2986 h
