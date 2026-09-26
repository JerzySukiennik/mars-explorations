# p-vehicle sources (Vehicle and Raptor numbers)

Note: spacex.com, en.wikipedia.org, and space.skyrocket.de could not be fetched from this sandbox (egress blocked). Values were checked against search-engine extracts of these pages.

- SpaceX Starship / Raptor vehicle page: https://www.spacex.com/vehicles/starship/ (and /raptor)
  - Raptor 2: 230 tf sea level, 258 tf vacuum (RVac). Raptor 3: 250 / 275 tf (not used; Block 2 flies Raptor 2).
  - Super Heavy: 33 Raptors, 3400 t propellant, 7590 tf liftoff thrust. Stack "more than 100 t to orbit, fully reusable".
- Wikipedia, SpaceX Starship / SpaceX Super Heavy / Starship (spacecraft): https://en.wikipedia.org/wiki/SpaceX_Starship , https://en.wikipedia.org/wiki/SpaceX_Super_Heavy , https://en.wikipedia.org/wiki/SpaceX_Starship_(spacecraft)
  - Super Heavy Block 1/2: dry about 275 t, propellant 3400 t, max thrust 73.5 MN (Block 3: 80.8 MN).
  - Starship Block 2: propellant 1500 t, dry about 85 t (Musk statements put the figure near 100 t; we used 100 t).
- Wikipedia, SpaceX Raptor: https://en.wikipedia.org/wiki/SpaceX_Raptor
  - Isp 327 s sea level (Raptor 2); RVac 380 s vacuum.
- Starship flight test 7 (Wikipedia) and CNBC: https://en.wikipedia.org/wiki/Starship_flight_test_7 , https://www.cnbc.com/2025/01/16/spacex-launch-starship-flight-seven-starlink-satellite-test.html
  - First Block 2 stack (B14/S33). Launch mass about 5500 t; 33 Raptors produce 16.7 Mlbf (about 74.3 MN). This matches 7590 tf.
- /home/user/refs/chrisjbillington/starship_telemetry (IFT-1 webcast telemetry): used only for context. Booster MECO occurs at about 160 s after throttling, so the tolerance on the full-throttle burn time is loose.

## Derived quantities (g0 = 9.80665)
- raptor_sl_thrust_kN = 230 x 9.80665 = 2255.5
- liftoff_thrust_MN = 33 x 2255.5 kN = 74.43
- stack_liftoff_mass_t = 275 + 3400 + 100 + 1500 = 5275 (no payload)
- liftoff_TW = 7590 / 5275 = 1.439
- booster_full_throttle_burn_time_s = 3.4e6 kg / (33 x 2255.5e3 / (327 x 9.80665)) = 146.5
- ship_dv_vac_100t_payload_ms = 380 x 9.80665 x ln(1700/200) = 7975
