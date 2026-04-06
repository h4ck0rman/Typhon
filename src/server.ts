import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  const pkgPath = join(__dirname, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  return pkg.version;
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "typhon", version: getVersion() },
    {
      instructions: [
        "Typhon is a local CTF lab server for learning SQL injection and web security.",
        "",
        "Available commands:",
        "- setup: Check that Docker and dependencies are ready",
        "- list_labs: Browse available labs (filter by difficulty, category, tags)",
        "- get_lab_info: Get details about a specific lab",
        "- start_lab: Launch a lab (spins up a Docker container locally)",
        "- stop_lab: Tear down a running lab",
        "- check_flag: Submit a flag for validation",
        "- get_hint: Get a hint (tiered from nudge to solution)",
        "- lab_status: See all running labs",
        "- submit_feedback: Leave feedback on a lab",
        "",
        "Typical flow: setup -> list_labs -> start_lab -> hack -> check_flag -> stop_lab",
      ].join("\n"),
    }
  );

  registerAllTools(server);

  return server;
}

function registerAllTools(_server: McpServer): void {
  // Phase 2 will register each tool here:
  // registerSetup(server);
  // registerListLabs(server);
  // registerGetLabInfo(server);
  // registerStartLab(server);
  // registerStopLab(server);
  // registerCheckFlag(server);
  // registerGetHint(server);
  // registerLabStatus(server);
  // registerSubmitFeedback(server);
}
