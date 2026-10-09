import { createApp } from "./app";
import { loadConfig } from "./env";

const config = loadConfig();
const app = createApp({ config });

const server = app.listen(config.port, () => {
  console.log(`[mcp] Gizmo MCP server listening on :${config.port} (API: ${config.apiBaseUrl})`);
});

const shutdown = (signal: string) => {
  console.log(`[mcp] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
