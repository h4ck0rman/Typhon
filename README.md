# Typhon

Free, open-source CTF labs delivered through MCP. Talk to your LLM, ask for a challenge, and a live vulnerable environment spins up on your machine. No accounts. No cloud. Just hacking.

## Prerequisites

### 1. Install Node.js (v18 or higher)

**macOS (Homebrew):**
```bash
brew install node
```

**macOS/Linux (nvm -- recommended):**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```
Close and reopen your terminal, then:
```bash
nvm install 20
nvm use 20
```

**Windows:**

Download the installer from https://nodejs.org (LTS version). Run it and follow the prompts. Restart your terminal after installation.

**Verify:**
```bash
node --version   # Should print v18.x.x or higher
npm --version    # Should print 10.x.x or higher
```

### 2. Install Docker

Docker is required to run the CTF lab containers.

**macOS:**
```bash
brew install --cask docker
```
Then open Docker Desktop from Applications and wait for the whale icon to appear in your menu bar.

**Linux:**
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```
Log out and back in for the group change to take effect.

**Windows:**

Download Docker Desktop from https://www.docker.com/products/docker-desktop and run the installer. Enable WSL 2 backend when prompted. Restart your machine.

**Verify:**
```bash
docker --version          # Should print Docker version 24.x or higher
docker compose version    # Should print Docker Compose version v2.x
docker run hello-world    # Should pull and run the test container
```

If `docker run hello-world` fails, make sure Docker Desktop is running (macOS/Windows) or that the Docker daemon is started (`sudo systemctl start docker` on Linux).

### 3. Install an MCP-compatible client

Typhon works with any client that supports the Model Context Protocol:

- **Claude Code** (CLI): https://docs.anthropic.com/en/docs/claude-code
- **Claude Code** (VS Code extension): Search "Claude Code" in the VS Code marketplace
- **Cursor**: https://cursor.com
- **Windsurf**: https://windsurf.com

## Setup

### Option A: Add to your MCP client (recommended)

Add Typhon to your client's MCP configuration. This runs it directly via npx -- no global install needed.

**Claude Code:**

Run this from your terminal:
```bash
claude mcp add typhon -- npx -y typhon
```

Or manually add to your MCP config file (`~/.claude.json` or project-level `.mcp.json`):
```json
{
  "mcpServers": {
    "typhon": {
      "command": "npx",
      "args": ["-y", "typhon"]
    }
  }
}
```

**Cursor / Windsurf:**

Add the same JSON block to your editor's MCP settings. Check your editor's docs for the config file location.

### Option B: Clone and run from source

```bash
git clone https://github.com/h4ck0rman/Typhon.git
cd Typhon
npm install
npm run build
```

Then add to your MCP config, pointing to the local build:
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

### Verify the connection

Restart your MCP client. You should see Typhon's tools available:

- `setup` -- check your environment
- `list_labs` -- browse available labs
- `start_lab` -- launch a lab
- `check_flag` -- submit your answer
- `get_hint` -- get help when stuck
- `stop_lab` -- tear down a lab
- `lab_status` -- see running labs
- `submit_feedback` -- leave feedback

Try asking your LLM: _"Run the Typhon setup tool to check my environment."_

## Usage

Once connected, just talk to your LLM:

```
"Show me the available SQL injection labs"
"Start the beginner WHERE clause injection lab"
"Give me a hint"
"I found the flag: TYPHON{...}"
"Stop the lab"
```

The LLM handles everything -- spinning up containers, delivering briefings, validating flags, and tearing down environments. You focus on hacking.

## Troubleshooting

**MCP server not connecting:**
- Make sure you restarted your MCP client after adding the config
- Check that `node --version` returns v18+
- Try running manually: `npx typhon` or `node dist/index.js` -- look for errors in stderr

**Docker issues:**
- Make sure Docker Desktop is running (check for the whale icon)
- Run `docker ps` to verify Docker is accessible
- On Linux, make sure your user is in the `docker` group: `groups $USER`
- Run the `setup` tool through your LLM -- it will diagnose common Docker issues

**Labs not starting:**
- Check available disk space: `df -h` (Docker images need ~500MB-2GB)
- Check if the port range 13370-13399 is available: `lsof -i :13370`
- Run `docker system prune` to clean up old containers/images

## License

MIT
