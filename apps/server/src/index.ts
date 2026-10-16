import { createPetitBacServer } from './app';
import { loadConfig } from './config';
import { createIdentify } from './profiles';
import { fileResultSink } from './results';

const config = loadConfig();
const server = createPetitBacServer({
  corsOrigins: config.corsOrigins,
  ...(config.staticDir ? { staticDir: config.staticDir } : {}),
  ...(config.resultsFile ? { results: fileResultSink(config.resultsFile) } : {}),
  identify: createIdentify(config.profilesUrl),
});
const port = await server.listen(config.port);
console.log(
  `[petitbac] server listening on :${port} (CORS: ${config.corsOrigins.join(', ')}` +
    `${config.staticDir ? `, serving ${config.staticDir}` : ''}` +
    `${config.resultsFile ? `, results → ${config.resultsFile}` : ''})`,
);

const shutdown = (signal: string) => {
  console.log(`[petitbac] ${signal} received, shutting down`);
  server.close().then(
    () => process.exit(0),
    () => process.exit(1),
  );
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
