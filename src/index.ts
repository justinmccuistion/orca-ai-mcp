#!/usr/bin/env node

import { OrcaAIMCPProxy } from './OrcaAIMCPProxy';

async function main() {
  const server = new OrcaAIMCPProxy();
  await server.run();
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
  });
}
