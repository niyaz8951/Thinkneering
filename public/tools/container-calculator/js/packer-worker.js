/* Packing worker.
 *
 * The packing search is a long synchronous loop. Run on the main thread it
 * freezes the tab — no repaint, so no progress bar can draw and no button can
 * be clicked, however often it is told to update. Moving it here is what makes
 * a progress bar possible at all, and it is also what makes Cancel possible:
 * the main thread can terminate this worker mid-search, which it could never
 * do to a loop running inside itself.
 *
 * Messages in:  { items, vehicle, options, presetCount }
 * Messages out: { type: 'progress', fraction, phase }
 *               { type: 'done', plan, fleet, ms }
 *               { type: 'error', message }
 */
import { packItems, compareFleet, strategyCount, VEHICLE_PRESETS } from './packer.js';

/* Progress is throttled to ~20 messages a second. The packer ticks far more
   often than that; posting every tick would flood the main thread with
   messages it cannot render and would itself become the bottleneck. */
let lastPost = 0;
function post(fraction, phase) {
  const now = Date.now();
  if (now - lastPost < 50 && fraction < 1) return;
  lastPost = now;
  self.postMessage({ type: 'progress', fraction: Math.min(1, Math.max(0, fraction)), phase });
}

self.onmessage = (e) => {
  const { items, vehicle, options } = e.data;
  const started = Date.now();

  try {
    /* Weight the two phases by how many packing passes each will actually
       run, so the bar moves at a roughly constant rate instead of racing to
       30% and then crawling. The fleet comparison runs every preset, so it is
       usually the larger share. */
    const packRuns = strategyCount(items, options.budget);
    const fleetRuns = VEHICLE_PRESETS.length * strategyCount(items, 'fast');
    const total = packRuns + fleetRuns;
    const packShare = packRuns / total;

    const plan = packItems(items, vehicle, {
      ...options,
      onProgress: (f) => post(f * packShare, 'Packing the chosen vehicle'),
    });

    const fleet = compareFleet(items, {
      ...options,
      onProgress: (f) => post(packShare + f * (1 - packShare), 'Comparing every vehicle'),
    });

    post(1, 'Finishing');
    self.postMessage({ type: 'done', plan, fleet, ms: Date.now() - started });
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
