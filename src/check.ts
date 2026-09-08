import { buildScene } from './core/build.js';
import { validate, formatReport } from './core/validate.js';
import { loadScene } from './core/store.js';
import { activeStyle } from './styles/index.js';

const { profile, tiers } = activeStyle();

for (const name of process.argv.slice(2)) {
  const scene = loadScene(name);
  console.log(`=== ${name} ===`);
  console.log(
    formatReport(
      validate(buildScene(scene), {
        kind: scene.kind,
        // The same thresholds generation applies. Passing fewer options made
        // `npm run check` call a model clean that generation had flagged, which
        // is the one thing this command must never do.
        detailCount: scene.details.length,
        detailMin: scene.kind === 'item' ? undefined : 10,
        scene,
        profile,
        tiers,
      }),
    ),
  );
  console.log();
}
