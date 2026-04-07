# Typhon

Free, open-source CTF labs delivered through MCP. Talk to your LLM, ask for a challenge, and a live vulnerable environment spins up on your machine. No accounts. No cloud. Just hacking.

## Quick Start

```bash
claude mcp add typhon -- npx -y typhon
```

Restart Claude Code, then:

```
"Run the Typhon setup tool"
```

The `setup` tool checks your environment -- Docker, Compose, disk space -- and tells you exactly what to fix if anything is missing. Once setup passes:

```
"Show me the available labs"
"Start the beginner SQL injection lab"
"Give me a hint"
"I found the flag: TYPHON{...}"
"Stop the lab"
```

The LLM handles everything -- pulling images, spinning up containers, delivering briefings, validating flags, tearing down environments. You focus on hacking.

## How It Works

Typhon is an MCP server that turns your LLM into a CTF coach.

1. Typhon fetches a lab package from a library (default: [h4ck0rman's library](https://github.com/h4ck0rman/typhon-library))
2. Spins up a Docker container with a real vulnerable web app
3. Gives you a briefing, objective, and a localhost URL
4. You hack the app, find the flag, submit it
5. Typhon validates it and tracks your progress

All state lives locally in `~/.typhon/` -- progress, config, feedback. Nothing phones home.

## Tools

| Tool | What it does |
|------|-------------|
| `setup` | Diagnose your environment and show fix instructions |
| `list_labs` | Browse labs with filters (category, difficulty, tags) |
| `get_lab_info` | Full metadata, briefing, and objective for a lab |
| `start_lab` | Download, build, and launch a lab container |
| `stop_lab` | Tear down a running lab and release its port |
| `check_flag` | Submit a flag and validate it |
| `get_hint` | Get the next tiered hint (auto-increments) |
| `lab_status` | See all running labs with URLs and uptime |
| `submit_feedback` | Leave feedback on a lab or the platform |
| `add_library` | Add a third-party lab library |
| `remove_library` | Remove a library source |
| `refresh_catalog` | Force re-fetch all library catalogs |

## Lab Curriculum

20 original SQL injection labs across 4 difficulty tiers, covering MySQL, PostgreSQL, MSSQL, and SQLite. Each lab has a unique app theme and narrative briefing.

| Tier | Difficulty | Labs | Techniques |
|------|-----------|------|------------|
| 1 | Apprentice | 5 | WHERE clause, auth bypass, error-based, UNION (column count + data extraction) |
| 2 | Practitioner | 7 | Boolean blind, time blind, type coercion, stacked queries, ORDER BY, INSERT, second-order |
| 3 | Expert | 5 | Polyglot, routed injection, out-of-band (DNS/HTTP), file access, OS command execution |
| 4 | Expert | 3 | WAF bypass: nested comments, whitespace evasion, comma-free syntax |

## Architecture

Typhon is a **platform**, not a monolith. Three repos, one ecosystem:

| Repo | Purpose |
|------|---------|
| **[Typhon](https://github.com/h4ck0rman/Typhon)** (this repo) | MCP server -- the universal CTF runtime |
| **[typhon-library](https://github.com/h4ck0rman/typhon-library)** | h4ck0rman's curated lab library (static files) |
| **[Echidna](https://github.com/h4ck0rman/echidna)** | Challenge creation pipeline (private) |

The MCP server is library-agnostic. Anyone can host a Typhon-compatible library -- it's just static JSON and tar files over HTTPS. See [`spec/typhon-library-v1.md`](spec/typhon-library-v1.md) for the full specification.

### Tech Stack

- **TypeScript** -- ES modules, strict mode, ~3,100 lines across 34 source files
- **2 runtime dependencies** -- `@modelcontextprotocol/sdk` and `zod`
- **Docker Compose** -- lab orchestration via `execFile` (no Dockerode, `shell: false`)
- **stdio transport** -- standard MCP, works with Claude Code, Cursor, Windsurf, or any MCP client

### Source Layout

```
src/
  index.ts              Entry point
  server.ts             Tool registration
  types.ts              Shared types and constants
  constants.ts          Paths, defaults, timing
  tools/                12 MCP tool handlers
  library/              HTTP client, catalog cache, library registry
  docker/               Compose lifecycle, health checks, compose validator
  labs/                 Port manager, downloader, running lab state
  state/                Config, progress, feedback, audit log, file locks, rate limiting
spec/
  typhon-library-v1.md  Open library API specification
test/
  run-mcp-tests.mjs     34 MCP protocol tests
  run-library-tests.mjs 39 library integration tests
  mock-library/         Test fixtures
```

## Security

Hardened against OWASP Top 10. Three independent security audits were run against every source file.

- **SSRF protection** -- HTTPS enforced for non-localhost, numeric IP range checks (RFC 1918/6598/loopback/link-local/IPv6), redirect blocking
- **Command injection prevention** -- all Docker calls use `execFile` with `shell: false`
- **Input validation** -- Zod schemas on all MCP inputs, regex validation on lab IDs and library names at every path construction point
- **Compose file scanning** -- blocks privileged mode, host namespaces, host volume mounts, device passthrough, sysctls, and 10+ other dangerous directives
- **Zip-slip protection** -- pre-extraction tar scanning + post-extraction symlink verification in isolated temp directory
- **Package integrity** -- SHA-256 checksum verification against library-provided manifests
- **Timing-safe flag comparison** -- SHA-256 hash + `timingSafeEqual` (no timing or length oracle)
- **Rate limiting** -- sliding-window limits on flag checks (10/min) and feedback (5/min)
- **File permissions** -- `0o700` directories, `0o600` files throughout `~/.typhon/`
- **Hash-chained audit log** -- tamper-evident, sequenced, append-only log at `~/.typhon/audit.log`
- **State file integrity** -- Zod validation on load, async mutex file locking, atomic writes

## Custom Libraries

Anyone can create and host a Typhon-compatible library. It's just static files:

```
https://your-library.example.com/
  typhon-library.json    Library manifest
  index.json             Lab catalog
  checksums.json         SHA-256 package hashes (optional)
  labs/{lab-id}/
    lab.json             Lab metadata
    hints.json           Tiered hints
    package.tar.gz       Dockerfile + app code
```

Add it through your LLM:

```
"Add the library at https://your-library.example.com"
```

Full specification: [`spec/typhon-library-v1.md`](spec/typhon-library-v1.md)

## Running from Source

```bash
git clone https://github.com/h4ck0rman/Typhon.git
cd Typhon
npm install
npm run build
```

Point your MCP client at the local build:

```json
{
  "mcpServers": {
    "typhon": {
      "command": "node",
      "args": ["/absolute/path/to/Typhon/dist/index.js"]
    }
  }
}
```

## Development

```bash
npm run build        # Compile TypeScript
npm run lint         # ESLint
npm run dev          # Watch mode

# Tests (no Docker required)
node test/run-mcp-tests.mjs       # 34 MCP protocol tests
node test/run-library-tests.mjs   # 39 library integration tests
```

## Troubleshooting

Run the `setup` tool first -- it diagnoses most issues automatically.

If you can't connect to the MCP server at all, try running `npx typhon` directly and check stderr for errors.

For lab startup issues, check disk space (`df -h`), port availability (`lsof -i :13370`), and try `docker system prune` to free up resources.

## License

MIT
