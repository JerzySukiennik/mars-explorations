// Export derived vehicle numbers from src/physics/vehicle.js in the same
// key/unit format as refs/data/p-vehicle.real.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as V from '../../src/physics/vehicle.js';

export function computeVehicleTable(config = V.CONFIGS[V.DEFAULT_CONFIG]) {
  const { booster, ship } = config;
  const sl = booster.engines[0].engine;
  const vac = ship.engines.find((g) => g.engine.exitDia > sl.exitDia).engine;
  const lift = V.stackLiftoff(config, 0, V.P_SL);
  return {
    stack_liftoff_mass_t: lift.mass / 1000,
    liftoff_thrust_MN: lift.thrust / 1e6,
    liftoff_TW: lift.tw,
    raptor_sl_isp_s: V.isp(sl, V.P_SL),
    rvac_isp_s: V.isp(vac, 0),
    raptor_sl_thrust_kN: V.thrust(sl, V.P_SL) / 1000,
    // ship vacuum delta-v capability with 100 t payload: all propellant
    // burned on the RVacs (SL Raptors off), rocket equation on the model's Isp
    ship_dv_vac_100t_payload_ms: V.stageVacuumDeltaV(ship, 100e3),
    booster_full_throttle_burn_time_s: V.burnTime(booster, 1),
    ship_prop_mass_t: ship.propMass / 1000,
    booster_prop_mass_t: booster.propMass / 1000,
  };
}

// Same quantisation as the reference table.
const DP = {
  stack_liftoff_mass_t: 0, liftoff_thrust_MN: 2, liftoff_TW: 3, raptor_sl_isp_s: 0,
  rvac_isp_s: 0, raptor_sl_thrust_kN: 1, ship_dv_vac_100t_payload_ms: 0,
  booster_full_throttle_burn_time_s: 1, ship_prop_mass_t: 0, booster_prop_mass_t: 0,
};
const round = (v, d) => Number(v.toFixed(d));

export function formattedTable(config) {
  const t = computeVehicleTable(config);
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, round(v, DP[k])]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const out = resolve(root, 'work/out/p-vehicle.ours.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(formattedTable(), null, 2));
  console.log(out);
}
