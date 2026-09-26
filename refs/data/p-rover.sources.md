# p-rover: measured battery state-of-charge reference

This piece supersedes the voided budget-based attempt in `voided/`.
The CSV is now a **digitised flight-telemetry-derived SOC trace**, not a model.

## Primary source (the trace)

**Larsen, R., Herman, J., Rink, K., Wong, A., Quade, J., Wood, E.,**
"Preparing for a Productive Low Power Future on the Curiosity Mars Rover", IEEE Aerospace Conference 2023. JPL, Clearance CL23-0051.

- Full-text PDF (JPL Dataverse, open): https://dataverse.jpl.nasa.gov/api/access/datafile/82105 (dataset doi:10.48577/jpl.RCBX2N, file CL23_0051.pdf, 12 pages)
- IEEE record: https://ieeexplore.ieee.org/document/10115900/

**What was taken:** Figure 7, "State of Charge Modeling Improvement from Capacity Model Update", on page 7 (PDF embedded image xref 44, 1000x500 px). It is saved as `refs/data/p-rover.figure.png`.

- The figure shows three series:
  - the black dots, "Estimated SOC": the ground estimate of SOC computed from Curiosity's telemetered battery voltage, current and temperature;
  - the blue line: original capacity model prediction;
  - the red line: updated capacity model prediction.
- Only the **black dots** were digitised.
- The x axis is "Hours Since Discharge Start" and runs 0-30 h, a little over one sol.
- Per the text of section 3 and Figure 8, the discharge is the Sol-2985 discharge (Curiosity, 2020).
- The trace covers a long net discharge from about 95% to about 56% with intermittent activity steps, two MMRTG recharge intervals (about 21-22.6 h and 28.5-30 h), and estimator spikes.

**Caveat, from the paper's own text (page 6):** telemetry is low-cadence, so "the ground based SOC estimate bounces around wildly, as much as ten percent, during periods of high current change".
The spikes at about 0.5-1, 2.5-3.5, 7.7, 12.2, 23.2 and 25.9 h are that effect.
They are not real SOC swings.
This is the reason for the tolerance in `p-rover.tolerances.json`.

### Digitisation method

- Extracted the embedded raster with pymupdf.
- Calibrated the axes from the plot frame, which was detected as full-length dark lines:
  - x = 124 px is 0 h and x = 899 px is 30 h (25.83 px/h);
  - y = 449 px is 40% and y = 49 px is 100% (6.667 px per %).
- Cross-checked against the dotted gridlines at 15 h (512 px) and 25 h (770 px). Both agree within 0.5 px.
- Built a colour mask for black pixels (R, G and B all < 90) inside the frame, excluding the legend box.
- Applied a 3x3 binary opening to remove the 1-px dotted gridlines.
- Binned at 0.1 h and took the median y of the dot pixels in each bin. This gives 300 rows, and a bin with no dots is skipped.
- The overlay check is `refs/data/p-rover.digitise_check.png`, with green points over the original.
- Estimated digitisation error is about +/-0.3% SOC and +/-0.04 h.
- The per-bin median follows the dense main trace. Isolated outlier dots are down-weighted.

## Secondary sources (context and tolerance cross-checks)

- **Gaines, D. et al., "Productivity Challenges for Mars Rover Operations: A Case Study of Mars Science Laboratory Operations", JPL report D-97908 (2016).** https://ai.jpl.nasa.gov/public/documents/papers/gaines-report-roverProductivity.pdf
  - Figures 27, 49 and 70 (pages 62, 88 and 112) give actual measured per-sol minimum and handover SOC for Curiosity sols 780-798, Artist's Drive and Marias Pass.
  - Actual minimum SOC over sols 780-798 was about 50-93%, and handover SOC was about 60-97%.
  - The operational floor is 40% SOC.
  - Actual SOC is consistently higher than predicted.
  - These figures were used only to sanity-check the magnitudes in Figure 7 (a minimum of about 55% sits well inside that range). They were not digitised.
- **Herman, J. & Marshall, "Operation of Lithium-Ion Batteries in the Extreme Environments of Mars", CREB seminar, 10 Dec 2021.** https://creb.umd.edu/sites/creb.umd.edu/files/HermanMarshall-10DEC2021-CREB.pdf
  - Slide 13 has a measured MER-B (Opportunity) SOC trace on Sol 5111.
  - It was not used, because it shows a solar rover in a dust storm and does not apply to MMRTG-powered Curiosity or Perseverance.
- **Salinas, Kulkarni, Orchard, "Battery State-of-Health Aware Path Planning for a Mars Rover", PHM 2023, NTRS 20230016001.** https://ntrs.nasa.gov/api/citations/20230016001/downloads/Salinas_Kulkarni_Orchard_Final.pdf
  - Checked and rejected: its SOC figures (Figures 3 and 6) are simulations, not measurements.
