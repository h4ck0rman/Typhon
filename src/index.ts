#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { ensureTyphonHome } from "./state/config.js";
import { rebuildPortMap } from "./labs/port-manager.js";

async function main(): Promise<void> {
  await ensureTyphonHome();
  await rebuildPortMap();

  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Typhon failed to start:", error);
  process.exit(1);
});
