# p-refill: Starship orbital refilling sources

Gathered 2026-09-26. Several news sites and Wikipedia were blocked by the egress proxy (spacenews, spacepolicyonline, nasaspaceflight, wikipedia, spacex.com). For those, the quotes come from search-engine snippets of the pages and are marked as such. The NASA and ULA PDFs were downloaded and read in full.

**Status caveat:** as of Sep 2026, no Starship ship-to-ship propellant transfer has flown. The only flown transfer is the IFT-3 intra-ship header-to-main tank LOX transfer. Every quantity except that one is a stated plan or an estimate.

## Primary / official (read in full)

1. **NASA OIG, IG-26-004, "NASA's Management of the Human Landing System Contracts" (March 2026)**
   https://oig.nasa.gov/wp-content/uploads/2026/03/final-report-ig-26-004-nasas-management-of-the-human-landing-system-contracts.pdf
   - The depot launches first, "followed by more than 10 Starship tankers carrying propellant". Aggregation starts more than 200 days before crew launch. SpaceX targets "one tanker flight every 6 days". Tankers launch from Starbase and KSC. The fueled lander can loiter up to 100 days in NRHO.
   - "On Flight 3, SpaceX completed an in-space propellant transfer demonstration between two tanks within the Starship vehicle."
   - The vehicle-to-vehicle cryogenic transfer test slipped from March 2025 to March 2026 and will use Starship V3. Cryogenic fluid management is "one of the most significant technical challenges". The 12-24 day pad turnaround has not been demonstrated.
   - Used for: tankers_for_full_fill (">10"), context for full_transfer_time_h (cadence).

2. **NASA CFMP, Kenny et al., AIAA SciTech (NTRS 20230018652)**. "2020 Tipping Point contracts: SpaceX On-Orbit Large-Scale Cryogenic Propellant Management and Transfer Demonstration"
   https://ntrs.nasa.gov/api/citations/20230018652/downloads/AIAA_Scitech_Kenny_12272024_PDF.pdf
   - "large-scale on-orbit cryogenic fluid transfer (up to 10 metric tons) between tanks on a Starship". "Active settling maneuver". "Settled transfer between main propellant tank and header tank located in the nosecone". "~1 day mission duration".
   - Used for: flight3_transfer_demo_t = 10, the upper bound of full_transfer_time_h, and the fact that settling was used.

3. **Chojnacki, "HLS Update", IEEE Aerospace 2025 (NTRS 20240012719)**
   https://ntrs.nasa.gov/api/citations/20240012719/downloads/HLS%20Update%20Kent%20Chojnacki%20IEEE%20Aero%202025%20v2.pdf?attachment=true
   - Flight 3 (2024-03-14): "SpaceX demonstrated internal tank-to-tank cryogenic propellant transfer, as required by its NASA Tipping Point award ... transferring liquid oxygen (LOX) between the header and main tanks within Starship". SpaceX has three Starship variants: depot, tanker and HLS.
   - Used for: confirming flight3_transfer_demo_t was LOX, header to main tank.

4. **NASA HLS paper, IAC-22.B3.1.9 (NTRS 20220013431)**
   https://ntrs.nasa.gov/api/citations/20220013431/downloads/HLS%20IAC_Final.pdf
   - Architecture: depot launched first, then "several flights of Tanker Starships", then the HLS docks with the depot and loads propellant.
   - Used for: architecture only (depot then tankers then ship).

5. **Kutter & Zegler, "Settled Cryogenic Propellant Transfer", AIAA 2006-4436 (ULA)**
   https://www.ulalaunch.com/docs/default-source/extended-duration/settled-cryogenic-propellant-transfer-2006-4436.pdf
   - "For a representative 100 mT system, settling consumes 100 lb/hr of settling propellant, at 10-4 g. At 10-5 g ... 10 lb/hour." Centaur reduced parking-orbit settling "from 10-3 g to 2x10-4 g for short coast missions". For 20 min to 2 h coasts it uses 8x10-5 g. It has "demonstrated effective propellant control at accelerations down to 10-5 g". Saturn used 2x10-5 g.
   - Used for: settling_accel_mms2 = 1e-4 g = 0.98 mm/s^2, range 1e-5 to 1e-3 g.

6. **ULA, "Realistic Near-Term Propellant Depots" (2009)**
   https://www.ulalaunch.com/docs/default-source/extended-duration/propellant-depots-2009.pdf
   - Settled transfer using continuous low thrust. With a good operational tempo, LEO depot boil-off stays at "low single-digit percentages" per year.
   - Used for: context for boiloff_pct_per_day (its low end).

## Official statements (seen via search snippets; the pages were blocked)

7. **SpaceNews, "Starship lunar lander missions to require nearly 20 launches, NASA says" (Nov 2023)**
   https://spacenews.com/starship-lunar-lander-missions-to-require-nearly-20-launches-nasa-says/
   - NASA's Lakiesha Hawkins: the number of launches is "in the high teens", driven by boil-off, on a 6-day cadence. Used for the upper bound of tankers_for_full_fill (20).
8. **SpacePolicyOnline, "At Least 15 Starship Launches Needed to Execute Artemis III Lunar Landing"**
   https://spacepolicyonline.com/news/at-least-15-starship-launches-to-execute-artemis-iii-lunar-landing/
   - The NASA figure of at least 15 launches in total. Supports the upper part of the range.
9. **SpaceNews, "SpaceX making progress on Starship in-space refueling technologies" (2024)**
   https://spacenews.com/spacex-making-progress-on-starship-in-space-refueling-technologies/
   - Amit Kshatriya (NASA): "On Flight 3, they did an intertank transfer of cryogens, which was successful by all accounts." Aim: at least 10 t of LOX from header to main tank. SpaceX VP Bill Gerstenmaier estimated tanker launches at "10-ish" (quoted via snippets of this article and of Wikipedia/Starship HLS). Used for: flight3_transfer_demo_t and the central value of tankers_for_full_fill.
10. **GAO, "NASA Artemis Programs: Crewed Moon Landing Faces Multiple Challenges" (Nov 30 2023)**. Boil-off forces the tanker launches into quick succession. Found via search; used only qualitatively.

## Estimates and secondary sources

11. **Teslarati, "SpaceX's path to refueling Starships in space is clearer than it seems"**
    https://www.teslarati.com/spacex-how-to-refuel-starships-in-space/
    - Relays Musk (2021): "four and eight" tanker launches, with 4 for a half-filled lunar HLS. Payload is about 150 t, so at most 8 to fill 1200 t tanks. It relays a NASA estimate of 8-16 tankers carrying 100-150 t each. Its own analysis: pipes of 20-50 cm move "1000+ tons of propellant in a handful of hours", and settled transfer costs a "tax" of 20-50 t per refueling.
    - Used for: prop_per_tanker_t, the lower bound of tankers_for_full_fill, transfer_rate_t_per_min and full_transfer_time_h. These are **not official values**, so their tolerances are wide.
12. **Gunter's Space Page, Starship / Super Heavy**
    https://space.skyrocket.de/doc_lau/super-heavy-starship.htm
    - Ship propellant mass is 1200 t for Block 1 and 1500 t for Block 2. Used for: ship_prop_capacity_t.
13. **"Cryogenic thermal system analysis for orbital propellant depot", Acta Astronautica 2014**
    https://www.sciencedirect.com/science/article/abs/pii/S0094576514001738
    - Passive LEO depot loss rates: LOX 0.025 %/day, LH2 0.1 %/day, CH4 0.08 %/day (from the search snippet). Used for: boiloff_pct_per_day.
14. **IOP Progress in Energy review, "Thermodynamic effects and boil-off management in cryogenic propellant tanks"**
    https://iopscience.iop.org/article/10.1088/2515-7655/ae3643
    - Boil-off in orbit exceeds 0.1-0.4 %/day for minimally insulated tanks, and LOX can be as low as about 0.016 %/day. Used for: the boiloff_pct_per_day range.
15. **NASA, "An Updated Zero Boil-Off Cryogenic Propellant Storage Analysis Applied to Upper Stages or Depots in a LEO Environment"**
    https://ntrs.nasa.gov/api/citations/20030067928/downloads/20030067928.pdf
    - In LEO, active cooling saves mass over passive storage for missions longer than about 1 week for LOX and 2 weeks for CH4. Context: a Starship depot that aggregates propellant for more than 200 days (OIG) cannot rely on passive storage alone at the higher boil-off rates.
16. **SpaceDaily, "large-scale orbital refuelling"**
    https://spacedaily.com/t-starship-large-scale-orbital-refuelling-mars/
    - Reports that SpaceX had still not attempted ship-to-ship transfer after Flight 13 in July 2026. Used for: the status caveat.
