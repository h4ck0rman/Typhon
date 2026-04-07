#!/usr/bin/env node

/**
 * Tests the full library flow: add_library -> list_labs -> get_lab_info ->
 * get_hint -> check_flag -> remove_library, using a mock static file server.
 */

import { spawn, execSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "..", "dist", "index.js");
const mockDir = join(__dirname, "mock-library");
const typhonHome = join(homedir(), ".typhon");

const MOCK_PORT = 19876;
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

// Simple static file server for the mock library
function startMockServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const filePath = join(mockDir, req.url === "/" ? "index.html" : req.url);
      try {
        const data = await readFile(filePath);
        const ext = extname(filePath);
        const mime =
          ext === ".json"
            ? "application/json"
            : ext === ".gz"
              ? "application/gzip"
              : "text/plain";
        res.writeHead(200, { "Content-Type": mime });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(MOCK_PORT, () => resolve(server));
  });
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
  }

  _drain() {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        }
      } catch {}
    }
  }

  send(method, params = {}) {
    const id = ++requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout: ${method} (id=${id})`));
      }, 15000);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      this.proc.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  }

  notify(method, params = {}) {
    this.proc.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n",
    );
  }

  async initialize() {
    const res = await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "typhon-lib-test", version: "1.0.0" },
    });
    this.notify("notifications/initialized");
    return res;
  }

  async callTool(name, args = {}) {
    return this.send("tools/call", { name, arguments: args });
  }

  close() {
    this.proc.stdin.end();
    this.proc.kill();
  }
}

async function cleanState() {
  await rm(join(typhonHome, "config.json"), { force: true }).catch(() => {});
  await rm(join(typhonHome, "progress.json"), { force: true }).catch(() => {});
  await rm(join(typhonHome, "feedback.json"), { force: true }).catch(() => {});
  await rm(join(typhonHome, "cache"), { recursive: true, force: true }).catch(() => {});
}

async function main() {
  console.log("=== Typhon Library Integration Tests ===\n");

  await cleanState();

  const httpServer = await startMockServer();
  console.log(`Mock library server running on port ${MOCK_PORT}\n`);

  const client = new McpTestClient();

  try {
    await client.initialize();
    console.log("1. Add mock library");
    const addRes = await client.callTool("add_library", {
      url: `http://localhost:${MOCK_PORT}`,
    });
    const addText = addRes.result.content[0].text;
    assert(addText.includes("Test Library"), "add_library returns library name");
    assert(addText.includes("1 lab"), "add_library shows lab count");
    assert(!addRes.result.isError, "add_library did not error");

    // Verify config was updated
    const config = JSON.parse(
      await readFile(join(typhonHome, "config.json"), "utf-8"),
    );
    assert(config.libraries.length === 2, "Config now has 2 libraries");
    assert(
      config.libraries[1].name === "test-lib",
      "Second library is test-lib",
    );

    // --- list_labs ---
    console.log("\n2. List labs (should include test lab)");
    const listRes = await client.callTool("list_labs");
    const listText = listRes.result.content[0].text;
    assert(listText.includes("sqli-01-test-lab"), "list_labs shows test lab");
    assert(listText.includes("Test Lab"), "list_labs shows lab name");
    assert(listText.includes("1 lab"), "list_labs shows count");

    // --- list_labs with category filter ---
    console.log("\n3. List labs filtered by category");
    const filteredRes = await client.callTool("list_labs", {
      category: "sqli",
    });
    assert(
      filteredRes.result.content[0].text.includes("sqli-01-test-lab"),
      "Category filter works",
    );

    // --- list_labs with wrong filter ---
    console.log("\n4. List labs filtered by wrong category");
    const emptyRes = await client.callTool("list_labs", {
      category: "crypto",
    });
    assert(
      emptyRes.result.content[0].text.includes("No labs"),
      "Wrong category returns empty",
    );

    // --- get_lab_info ---
    console.log("\n5. Get lab info");
    const infoRes = await client.callTool("get_lab_info", {
      labId: "sqli-01-test-lab",
    });
    const infoText = infoRes.result.content[0].text;
    assert(infoText.includes("Test Lab"), "get_lab_info shows name");
    assert(infoText.includes("sqli/basic"), "get_lab_info shows category");
    assert(infoText.includes("apprentice"), "get_lab_info shows difficulty");
    assert(infoText.includes("sqlite"), "get_lab_info shows dbEngine");
    assert(infoText.includes("test-app"), "get_lab_info shows appTheme");
    assert(infoText.includes("Briefing"), "get_lab_info shows briefing");
    assert(infoText.includes("Objective"), "get_lab_info shows objective");
    // CRITICAL: flag must not be exposed
    assert(!infoText.includes("TYPHON{"), "Flag NOT exposed in get_lab_info");
    assert(!infoText.includes("test_flag_123"), "Flag value NOT leaked");

    // --- get_hint (level 1) ---
    console.log("\n6. Get hint (auto level 1)");
    const hint1Res = await client.callTool("get_hint", {
      labId: "sqli-01-test-lab",
    });
    const hint1Text = hint1Res.result.content[0].text;
    assert(hint1Text.includes("1/3"), "Hint shows level 1 of 3");
    assert(hint1Text.includes("Nudge"), "Hint 1 title is Nudge");
    assert(hint1Text.includes("search input"), "Hint 1 content present");

    // --- get_hint (auto-increment to level 2) ---
    console.log("\n7. Get hint (auto level 2)");
    const hint2Res = await client.callTool("get_hint", {
      labId: "sqli-01-test-lab",
    });
    const hint2Text = hint2Res.result.content[0].text;
    assert(hint2Text.includes("2/3"), "Hint shows level 2 of 3");
    assert(hint2Text.includes("Direction"), "Hint 2 title is Direction");

    // --- get_hint (explicit level 3) ---
    console.log("\n8. Get hint (explicit level 3)");
    const hint3Res = await client.callTool("get_hint", {
      labId: "sqli-01-test-lab",
      level: 3,
    });
    assert(hint3Res.result.content[0].text.includes("3/3"), "Hint level 3");

    // --- get_hint (beyond max) ---
    console.log("\n9. Get hint (beyond max)");
    const hint4Res = await client.callTool("get_hint", {
      labId: "sqli-01-test-lab",
    });
    assert(
      hint4Res.result.content[0].text.includes("No more hints") ||
      hint4Res.result.content[0].text.includes("not found"),
      "No more hints beyond level 3",
    );

    // Verify progress was tracked
    const progress = JSON.parse(
      await readFile(join(typhonHome, "progress.json"), "utf-8"),
    );
    const labProgress = progress.labs["sqli-01-test-lab"];
    assert(labProgress !== undefined, "Progress entry created");
    assert(labProgress.maxHintLevel === 3, "maxHintLevel is 3");

    // --- check_flag (wrong) ---
    console.log("\n10. Check flag (wrong)");
    const wrongRes = await client.callTool("check_flag", {
      labId: "sqli-01-test-lab",
      flag: "TYPHON{wrong}",
    });
    assert(
      wrongRes.result.content[0].text.includes("Incorrect"),
      "Wrong flag returns incorrect",
    );

    // --- check_flag (correct) ---
    console.log("\n11. Check flag (correct)");
    const correctRes = await client.callTool("check_flag", {
      labId: "sqli-01-test-lab",
      flag: "TYPHON{test_flag_123}",
    });
    const correctText = correctRes.result.content[0].text;
    assert(correctText.includes("correct"), "Correct flag accepted");
    assert(correctText.includes("COMPLETED"), "Completion reported");

    // Verify progress updated
    const progress2 = JSON.parse(
      await readFile(join(typhonHome, "progress.json"), "utf-8"),
    );
    const labProg2 = progress2.labs["sqli-01-test-lab"];
    assert(labProg2.completed === true, "Lab marked as completed");
    assert(labProg2.completedAt !== null, "completedAt timestamp set");
    assert(labProg2.attempts >= 2, "Attempts tracked (at least 2)");

    // --- list_labs shows completion ---
    console.log("\n12. List labs shows completion");
    const list2Res = await client.callTool("list_labs");
    assert(
      list2Res.result.content[0].text.includes("[DONE]"),
      "list_labs shows [DONE] for completed lab",
    );

    // --- remove test library ---
    console.log("\n13. Remove test library");
    const rmRes = await client.callTool("remove_library", {
      name: "test-lib",
    });
    assert(
      rmRes.result.content[0].text.includes("Removed"),
      "Library removed successfully",
    );

    // Verify it's gone
    const config2 = JSON.parse(
      await readFile(join(typhonHome, "config.json"), "utf-8"),
    );
    assert(config2.libraries.length === 1, "Back to 1 library");
    assert(
      config2.libraries[0].name === "h4ck0rman",
      "Only default remains",
    );

    // --- add_library duplicate ---
    console.log("\n14. Add library duplicate check");
    // Re-add it first
    await client.callTool("add_library", {
      url: `http://localhost:${MOCK_PORT}`,
    });
    const dupRes = await client.callTool("add_library", {
      url: `http://localhost:${MOCK_PORT}`,
    });
    assert(
      dupRes.result.isError === true ||
      dupRes.result.content[0].text.includes("already exists") ||
      dupRes.result.content[0].text.includes("Failed"),
      "Duplicate library rejected",
    );

    // Clean up
    await client.callTool("remove_library", { name: "test-lib" });

    // --- Summary ---
    console.log("\n" + "=".repeat(50));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log("=".repeat(50));
  } catch (err) {
    console.error("\nTest error:", err.message);
    failed++;
  } finally {
    client.close();
    httpServer.close();
    await cleanState();
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();
