// Run a TypeScript tool script through Vite, so it imports the game's modules as the app does.
// Usage: node tools/run.mjs tools/measureDungeons.ts [args...]
import { createServer, createServerModuleRunner } from 'vite';

const [script, ...args] = process.argv.slice(2);
if (!script) { console.error('Usage: node tools/run.mjs <script.ts> [args...]'); process.exit(1); }
const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
try {
  const mod = await runner.import(`/${script}`);
  await mod.main?.(args);
} finally {
  await runner.close();
  await server.close();
}
