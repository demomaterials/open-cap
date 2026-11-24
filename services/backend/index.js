// cap-backend: configuration and inventory API (/api/*).
import { config } from '../common/config.js';
import { waitForDb } from '../common/db.js';
import { createApp, finalize, listenApp } from '../common/http.js';
import { log } from '../common/log.js';
import { bootstrapAdmin, seedCatalog } from './seed.js';
import { router as auth } from './routes/auth.js';
import { router as users } from './routes/users.js';
import { router as assets, typesRouter } from './routes/assets.js';
import { router as frameworks } from './routes/frameworks.js';
import { router as controls } from './routes/controls.js';
import { router as connectors, runsRouter } from './routes/connectors.js';
import { router as system } from './routes/system.js';

const app = createApp({ jsonLimit: '25mb' });
app.use('/api/auth', auth);
app.use('/api/users', users);
app.use('/api/asset-types', typesRouter);
app.use('/api/assets', assets);
app.use('/api/frameworks', frameworks);
app.use('/api/controls', controls);
app.use('/api/connectors', connectors);
app.use('/api/runs', runsRouter);
app.use('/api/system', system);
finalize(app);

async function main() {
  await waitForDb();
  await bootstrapAdmin();
  await seedCatalog();
  listenApp(app, config.port);
}

main().catch((err) => { log.error('fatal', { err }); process.exit(1); });
