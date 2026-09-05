import { defineConfig, type Plugin } from 'vite';
import { buildScene } from './src/core/build.js';
import { OUT_DIR } from './src/core/store.js';
import { writeVox } from './src/io/vox.js';
import { generate, revise, type Engine } from './src/generate/agent.js';
import { revertScene } from './src/core/store.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Serves the generate endpoint alongside the viewer so one `npm run viewer`
 * gives the whole loop: type a prompt in the browser, the local Claude Code or
 * Codex CLI produces the scene, the viewer picks it up on its next poll.
 */
function generateApi(): Plugin {
  return {
    name: 'voxel-generate-api',
    configureServer(server) {
      server.middlewares.use('/api/generate', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);

        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };

        try {
          const { prompt, engine } = JSON.parse(Buffer.concat(chunks).toString() || '{}') as {
            prompt?: string;
            engine?: Engine;
          };
          if (!prompt?.trim()) return send(400, { error: 'prompt is required' });

          const result = await generate(prompt, { engine: engine ?? 'claude' });
          const build = buildScene(result.scene);
          writeFileSync(
            join(OUT_DIR, `${result.scene.name}.vox`),
            writeVox(build.grid, build.palette),
          );

          send(200, {
            name: result.scene.name,
            elapsedMs: result.elapsedMs,
            engine: result.engine,
            attempts: result.attempts,
            repaired: result.attempts > 1 ? result.repairedProblems : [],
            parts: result.scene.parts.map((p) => p.id),
            usage: result.usage,
            applied: result.applied,
            warnings: result.report.checks
              .filter((c) => c.severity !== 'pass')
              .map((c) => `${c.id}: ${c.message}`),
          });
        } catch (e) {
          send(500, { error: e instanceof Error ? e.message : String(e) });
        }
      });

      server.middlewares.use('/api/revise', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);

        const send = (code: number, body: unknown) => {
          res.statusCode = code;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };

        try {
          const { scene, instruction, engine, undo } = JSON.parse(
            Buffer.concat(chunks).toString() || '{}',
          ) as { scene?: string; instruction?: string; engine?: Engine; undo?: boolean };
          if (!scene) return send(400, { error: 'scene is required' });

          if (undo) {
            const reverted = revertScene(scene);
            const build = buildScene(reverted);
            writeFileSync(
              join(OUT_DIR, `${reverted.name}.vox`),
              writeVox(build.grid, build.palette),
            );
            return send(200, { name: reverted.name, reverted: true });
          }

          if (!instruction?.trim()) return send(400, { error: 'instruction is required' });
          const result = await revise(scene, instruction, { engine: engine ?? 'claude' });
          const build = buildScene(result.scene);
          writeFileSync(
            join(OUT_DIR, `${result.scene.name}.vox`),
            writeVox(build.grid, build.palette),
          );

          send(200, {
            name: result.scene.name,
            elapsedMs: result.elapsedMs,
            attempts: result.attempts,
            repaired: result.attempts > 1 ? result.repairedProblems : [],
            parts: result.scene.parts.map((p) => p.id),
            usage: result.usage,
            applied: result.applied,
            warnings: result.report.checks
              .filter((c) => c.severity !== 'pass')
              .map((c) => `${c.id}: ${c.message}`),
          });
        } catch (e) {
          send(500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [generateApi()],
  server: { port: 5173 },
});
