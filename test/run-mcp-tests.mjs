#!/usr/bin/env node

/**
 * End-to-end MCP protocol test for all Typhon tools.
 * Spawns the server as a child process and sends JSON-RPC messages via stdin/stdout.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "..", "dist", "index.js");
const typhonHome = join(homedir(), ".typhon");

let passed = 0;
let failed = 0;
let requestId = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${label}`);
    failed++;
  }
}

class McpTestClient {
  constructor() {
    this.proc = spawn("node", [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.buffer = "";
    this.pending = new Map();
    this.proc.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      this._drain();
    });
    this.proc.stderr.on("data", (chunk) => {
      // Suppress stderr unless debugging
    });
  }

  _drain() {
    // MCP uses newline-delimited JSON
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop(); // keep incomplete line
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        }
      } catch {
        // ignore non-JSON lines
      }
    }
  }

  send(method, params = {}) {
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
      }, 15000);

      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });

      const payload = JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      });
      this.proc.stdin.write(payload + "\n");
    });
  }

  notify(method, params = {}) {
    const payload = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.proc.stdin.write(payload + "\n");
  }

  async initialize() {
    const res = await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "typhon-test", version: "1.0.0" },
    });
    this.notify("notifications/initialized");
    return res;
  }

  async callTool(name, args = {}) {
    return this.send("tools/call", { name, arguments: args });
  }

  async listTools() {
    return this.send("tools/list", {});
  }

  close() {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

async function cleanState() {
  // Clean up test state but keep the directory
  const files = ["config.json", "progress.json", "feedback.json"];
  for (const f of files) {
    await rm(join(typhonHome, f), { force: true }).catch(() => {});
  }
}

async function main() {
  console.log("=== Typhon MCP Server End-to-End Tests ===\n");

  await cleanState();

  const client = new McpTestClient();

  try {
    // --- Initialize ---
    console.log("1. Initialize handshake");
    const initRes = await client.initialize();
    assert(initRes.result !== undefined, "Got initialize result");
    assert(initRes.result.serverInfo.name === "typhon", "Server name is typhon");
    assert(initRes.result.serverInfo.version === "0.1.0", "Version is 0.1.0");
    assert(
      initRes.result.capabilities.tools !== undefined,
      "Tools capability advertised",
    );

    // --- List tools ---
    console.log("\n2. List tools");
    const toolsRes = await client.listTools();
    const tools = toolsRes.result.tools;
    assert(tools.length === 12, `12 tools registered (got ${tools.length})`);

    const toolNames = tools.map((t) => t.name).sort();
    const expected = [
      "add_library", "check_flag", "get_hint", "get_lab_info",
      "lab_status", "list_labs", "refresh_catalog", "remove_library",
      "setup", "start_lab", "stop_lab", "submit_feedback",
    ];
    assert(
      JSON.stringify(toolNames) === JSON.stringify(expected),
      "All 12 tool names match",
    );

    // Check annotations on specific tools
    const setupTool = tools.find((t) => t.name === "setup");
    assert(setupTool.annotations.readOnlyHint === true, "setup is readOnlyHint");
    const stopTool = tools.find((t) => t.name === "stop_lab");
    assert(stopTool.annotations.destructiveHint === true, "stop_lab is destructiveHint");

    // --- setup tool ---
    console.log("\n3. setup tool");
    const setupRes = await client.callTool("setup");
    const setupText = setupRes.result.content[0].text;
    assert(setupText.includes("Docker"), "setup mentions Docker");
    assert(setupText.includes("Typhon home:"), "setup shows home path");
    // Docker may or may not be running - just check it responds
    assert(typeof setupText === "string", "setup returns text");

    // --- lab_status (no labs running) ---
    console.log("\n4. lab_status (empty)");
    const statusRes = await client.callTool("lab_status");
    const statusText = statusRes.result.content[0].text;
    assert(
      statusText.includes("No labs are currently running"),
      "lab_status reports no running labs",
    );

    // --- list_labs (will try to fetch from default library, may fail) ---
    console.log("\n5. list_labs");
    const listRes = await client.callTool("list_labs");
    const listText = listRes.result.content[0].text;
    // Library may not be deployed yet, so either "No labs" or actual labs
    assert(typeof listText === "string", "list_labs returns text");
    console.log(`    (Response: ${listText.split("\n")[0]})`);

    // --- list_labs with filters ---
    console.log("\n6. list_labs with difficulty filter");
    const filteredRes = await client.callTool("list_labs", {
      difficulty: "expert",
    });
    assert(
      typeof filteredRes.result.content[0].text === "string",
      "list_labs with filter returns text",
    );

    // --- get_lab_info (lab not found) ---
    console.log("\n7. get_lab_info (nonexistent lab)");
    const infoRes = await client.callTool("get_lab_info", {
      labId: "sqli-99-does-not-exist",
    });
    const infoText = infoRes.result.content[0].text;
    assert(
      infoText.includes("not found"),
      "get_lab_info returns not found for missing lab",
    );

    // --- get_lab_info with invalid ID ---
    console.log("\n8. get_lab_info (invalid lab ID)");
    const badIdRes = await client.callTool("get_lab_info", {
      labId: "INVALID!!!",
    });
    assert(
      badIdRes.result.content[0].text.includes("Invalid lab ID") ||
      badIdRes.result.isError === true,
      "get_lab_info rejects invalid lab ID",
    );

    // --- stop_lab (not running) ---
    console.log("\n9. stop_lab (not running)");
    const stopRes = await client.callTool("stop_lab", {
      labId: "sqli-01-the-leak",
    });
    const stopText = stopRes.result.content[0].text;
    assert(
      stopText.includes("not running"),
      "stop_lab reports lab not running",
    );

    // --- check_flag (lab not found) ---
    console.log("\n10. check_flag (lab not found)");
    const flagRes = await client.callTool("check_flag", {
      labId: "sqli-99-does-not-exist",
      flag: "TYPHON{test}",
    });
    assert(
      flagRes.result.content[0].text.includes("not found") ||
      flagRes.result.content[0].text.includes("dynamic"),
      "check_flag handles missing lab",
    );

    // --- get_hint (lab not found) ---
    console.log("\n11. get_hint (lab not found)");
    const hintRes = await client.callTool("get_hint", {
      labId: "sqli-99-does-not-exist",
    });
    assert(
      hintRes.result.content[0].text.includes("not found"),
      "get_hint handles missing lab",
    );

    // --- submit_feedback ---
    console.log("\n12. submit_feedback");
    const fbRes = await client.callTool("submit_feedback", {
      rating: 5,
      comment: "Testing the MCP server",
    });
    assert(
      fbRes.result.content[0].text.includes("Thank you"),
      "submit_feedback returns thanks",
    );

    // Verify feedback was persisted
    const fbData = JSON.parse(
      await readFile(join(typhonHome, "feedback.json"), "utf-8"),
    );
    assert(fbData.entries.length === 1, "Feedback entry persisted to disk");
    assert(fbData.entries[0].rating === 5, "Feedback rating is 5");
    assert(
      fbData.entries[0].comment === "Testing the MCP server",
      "Feedback comment persisted",
    );

    // Submit feedback with labId
    console.log("\n13. submit_feedback (with labId)");
    const fb2Res = await client.callTool("submit_feedback", {
      labId: "sqli-01-the-leak",
      rating: 4,
      comment: "Great lab",
    });
    assert(
      fb2Res.result.content[0].text.includes("Thank you"),
      "submit_feedback with labId works",
    );
    const fb2Data = JSON.parse(
      await readFile(join(typhonHome, "feedback.json"), "utf-8"),
    );
    assert(fb2Data.entries.length === 2, "Second feedback entry persisted");

    // --- remove_library (default -- should fail) ---
    console.log("\n14. remove_library (default -- should be blocked)");
    const rmDefaultRes = await client.callTool("remove_library", {
      name: "h4ck0rman",
    });
    assert(
      rmDefaultRes.result.content[0].text.includes("Cannot remove") ||
      rmDefaultRes.result.isError === true,
      "Cannot remove default library",
    );

    // --- remove_library (nonexistent) ---
    console.log("\n15. remove_library (nonexistent)");
    const rmNoneRes = await client.callTool("remove_library", {
      name: "does-not-exist",
    });
    assert(
      rmNoneRes.result.content[0].text.includes("not found") ||
      rmNoneRes.result.isError === true,
      "Cannot remove nonexistent library",
    );

    // --- add_library (invalid URL) ---
    console.log("\n16. add_library (invalid URL -- should fail gracefully)");
    const addBadRes = await client.callTool("add_library", {
      url: "https://this-does-not-exist-typhon-test.invalid",
    });
    assert(
      addBadRes.result.isError === true ||
      addBadRes.result.content[0].text.includes("Failed"),
      "add_library fails gracefully for invalid URL",
    );

    // --- refresh_catalog ---
    console.log("\n17. refresh_catalog");
    const refreshRes = await client.callTool("refresh_catalog");
    const refreshText = refreshRes.result.content[0].text;
    assert(
      refreshText.includes("Refreshed") || refreshText.includes("library"),
      "refresh_catalog returns result",
    );
    console.log(`    (Response: ${refreshText})`);

    // --- Verify config.json was created with defaults ---
    console.log("\n18. Config persistence");
    const configData = JSON.parse(
      await readFile(join(typhonHome, "config.json"), "utf-8"),
    );
    assert(
      configData.libraries.length >= 1,
      "Config has at least 1 library",
    );
    assert(
      configData.libraries[0].name === "h4ck0rman",
      "Default library is h4ck0rman",
    );
    assert(
      configData.preferences.maxConcurrentLabs === 3,
      "Default maxConcurrentLabs is 3",
    );

    // --- start_lab with invalid ID ---
    console.log("\n19. start_lab (invalid lab ID)");
    const startBadRes = await client.callTool("start_lab", {
      labId: "INVALID",
    });
    assert(
      startBadRes.result.content[0].text.includes("Invalid lab ID") ||
      startBadRes.result.isError === true,
      "start_lab rejects invalid lab ID",
    );

    // --- start_lab (lab not found in catalog) ---
    console.log("\n20. start_lab (lab not in catalog)");
    const startMissingRes = await client.callTool("start_lab", {
      labId: "sqli-99-missing",
    });
    assert(
      startMissingRes.result.content[0].text.includes("not found") ||
      startMissingRes.result.isError === true,
      "start_lab reports lab not found",
    );

    // --- Summary ---
    console.log("\n" + "=".repeat(50));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log("=".repeat(50));
  } catch (err) {
    console.error("\nTest error:", err.message);
    failed++;
  } finally {
    client.close();
    await cleanState();
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
