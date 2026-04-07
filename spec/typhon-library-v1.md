# Typhon Library API v1 Specification

Version: 1
Status: Stable

## Overview

A Typhon Library is a collection of CTF lab packages served as static files over HTTPS. No server-side logic is required. Any static file host works: GitHub Pages, Cloudflare Pages, S3, Netlify, or a plain nginx server.

The Typhon MCP server fetches labs from one or more libraries. The default library (`h4ck0rman`) ships baked in. Users can add custom libraries via the `add_library` MCP tool.

## Base URL

All endpoints are relative to a `BASE_URL`. The base URL must:
- Use HTTPS (HTTP allowed for localhost development only)
- Have no trailing slash
- Be publicly accessible (or accessible from the user's machine)

Example: `https://library.typhon.dev`

## Endpoints

### 1. GET /typhon-library.json -- Library Manifest

The entry point. Typhon fetches this first to validate that a URL is a real library.

**Response** (application/json):

```json
{
  "typhonLibraryVersion": "1",
  "name": "my-library",
  "displayName": "My CTF Library",
  "description": "A collection of web security challenges",
  "url": "https://library.example.com",
  "categories": ["sqli", "xss"],
  "labCount": 15,
  "updatedAt": "2026-04-07T00:00:00Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| typhonLibraryVersion | string | yes | Must be `"1"` for this spec version |
| name | string | yes | Unique identifier (lowercase, alphanumeric, hyphens). Used as cache key. |
| displayName | string | yes | Human-readable name shown to users |
| description | string | yes | One-line description |
| url | string | yes | Canonical base URL of this library |
| categories | string[] | yes | List of lab categories available |
| labCount | number | yes | Total number of labs |
| updatedAt | string | yes | ISO 8601 datetime of last catalog change |

### 2. GET /index.json -- Lab Catalog

Full catalog of all labs in this library. Used by `list_labs` to show available challenges.

**Response** (application/json): Array of lab summary objects.

```json
[
  {
    "id": "sqli-01-the-leak",
    "name": "The Leak",
    "category": "sqli",
    "subcategory": "basic",
    "difficulty": "apprentice",
    "description": "A product search with a classic SQL injection vulnerability.",
    "tags": ["WHERE clause", "string-based", "MySQL"],
    "dbEngine": "mysql",
    "author": "h4ck0rman",
    "version": "1.0.0"
  }
]
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | yes | Must match regex `^[a-z]+-\d{2}-[a-z0-9-]+$` |
| name | string | yes | Human-readable lab name |
| category | string | yes | Top-level category |
| subcategory | string | yes | Specific technique |
| difficulty | string | yes | One of: `apprentice`, `practitioner`, `expert` |
| description | string | yes | Short description (1-2 sentences) |
| tags | string[] | yes | Searchable tags |
| dbEngine | string | yes | Database used: `mysql`, `postgresql`, `sqlite`, `mssql` |
| author | string | yes | Challenge author |
| version | string | yes | Semver version of this lab |

This endpoint must NOT include flag values, briefings, or hints. Those are in the lab-specific files.

### 3. GET /labs/{lab-id}/lab.json -- Lab Metadata

Full metadata for a single lab, including the flag definition. This file is consumed by the Typhon MCP server only -- it is never shown to users directly.

**Response** (application/json):

```json
{
  "id": "sqli-01-the-leak",
  "name": "The Leak",
  "category": "sqli",
  "subcategory": "basic",
  "difficulty": "apprentice",
  "description": "A product search page with a SQL injection vulnerability in the WHERE clause.",
  "briefing": "You are a security researcher hired to audit ShopEasy's product catalog...",
  "objective": "Extract the admin password from the users table using SQL injection.",
  "tags": ["WHERE clause", "string-based", "MySQL"],
  "dbEngine": "mysql",
  "appTheme": "e-commerce",
  "internalPort": 8080,
  "flag": {
    "type": "static",
    "value": "TYPHON{sql_injection_101}"
  },
  "healthCheck": {
    "path": "/",
    "expectedStatus": 200
  },
  "youtubeUrl": null,
  "estimatedMinutes": 15,
  "prerequisites": [],
  "author": "h4ck0rman",
  "version": "1.0.0"
}
```

**Flag field variants**:

Static flag (hardcoded):
```json
{ "type": "static", "value": "TYPHON{...}" }
```

Dynamic flag (generated per session):
```json
{ "type": "dynamic", "derivation": "container-env" }
```

Dynamic derivation values: `container-env`, `file-read`, `db-query`.

Static flags must start with `TYPHON{` and end with `}`.

### 4. GET /labs/{lab-id}/hints.json -- Hints

Tiered hints for a lab, ordered from vague to specific.

**Response** (application/json):

```json
{
  "labId": "sqli-01-the-leak",
  "hints": [
    { "level": 1, "title": "Nudge", "content": "Look at how the search works." },
    { "level": 2, "title": "Direction", "content": "The search query is built by string concatenation." },
    { "level": 3, "title": "Approach", "content": "Try a single quote in the search field." },
    { "level": 4, "title": "Near-solution", "content": "Use UNION SELECT to extract data from another table." },
    { "level": 5, "title": "Solution", "content": "Input: ' UNION SELECT username, password FROM users--" }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| labId | string | yes | Must match the lab ID |
| hints | array | yes | At least 1 hint |
| hints[].level | number | yes | 1-5 (1 = vague, 5 = near-solution) |
| hints[].title | string | yes | Hint tier name |
| hints[].content | string | yes | Hint text |

### 5. GET /labs/{lab-id}/package.tar.gz -- Lab Package

A gzipped tar archive containing everything needed to run the lab locally via Docker.

**Required contents**:

```
docker-compose.yml    (required)
Dockerfile            (optional, if building a custom image)
app/                  (application source code)
db/                   (optional, database init scripts)
```

The `docker-compose.yml` must use these environment variables:

| Variable | Description |
|----------|-------------|
| `TYPHON_PORT` | Host port to bind (injected by Typhon MCP) |
| `TYPHON_LAB_ID` | Lab identifier |
| `TYPHON_FLAG` | Flag value (static or generated) |
| `TYPHON_MEMORY` | Memory limit (e.g. `512m`) |
| `TYPHON_CPUS` | CPU limit (e.g. `1.0`) |

**Example docker-compose.yml**:

```yaml
services:
  web:
    build: .
    ports:
      - "${TYPHON_PORT:-8080}:80"
    environment:
      - FLAG=${TYPHON_FLAG}
      - LAB_ID=${TYPHON_LAB_ID}
    mem_limit: ${TYPHON_MEMORY:-512m}
    cpus: ${TYPHON_CPUS:-1.0}
    pids_limit: 256
```

The package must NOT include:
- shared/ assets (the MCP server injects these at build time)
- Solution files or writeups
- The flag value in any user-visible file (only in docker-compose.yml env vars or init scripts)

## Error Handling

Standard HTTP status codes. No custom error body format required.

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 404 | Lab or resource not found |
| 5xx | Server error (Typhon will retry once, then report failure) |

The Typhon MCP client checks `response.ok` and uses the status code for error reporting.

## Caching

The Typhon MCP server caches catalogs locally at `~/.typhon/cache/`:

- Catalog (`index.json`): re-fetched if older than 1 hour
- Lab packages: re-downloaded only if version changes
- Users can force refresh via the `refresh_catalog` tool

Libraries should set appropriate `Cache-Control` headers but Typhon does not rely on them.

## Versioning

The `typhonLibraryVersion` field in the manifest is an integer string. The current version is `"1"`.

If a client sees a version higher than what it supports, it should warn the user that a newer Typhon MCP version may be needed to fully use this library.

Breaking changes to this spec will increment the version number. Non-breaking additions (new optional fields) do not require a version bump.

## Hosting a Library

### Quick start

1. Create the directory structure:

```
site/
├── typhon-library.json
├── index.json
└── labs/
    ├── sqli-01-the-leak/
    │   ├── lab.json
    │   ├── hints.json
    │   └── package.tar.gz
    └── sqli-02-gatekeeper/
        ├── lab.json
        ├── hints.json
        └── package.tar.gz
```

2. Build `package.tar.gz` for each lab:

```bash
cd labs/sqli-01-the-leak/src
tar czf ../package.tar.gz .
```

3. Generate `index.json` from all `lab.json` files (strip flags, briefings, objectives -- keep only summary fields).

4. Deploy to any static file host.

5. Users add it via the Typhon MCP `add_library` tool, which validates the manifest automatically.

### GitHub Pages example

Push the `site/` directory to a `gh-pages` branch. Set up a custom domain or use `https://username.github.io/repo-name` as the base URL.

### Validation

Before publishing, verify:
- All lab IDs match the regex `^[a-z]+-\d{2}-[a-z0-9-]+$`
- All `lab.json` files parse against the Typhon `LabMetadataSchema`
- All `hints.json` files parse against the Typhon `HintsFileSchema`
- All `package.tar.gz` files contain a `docker-compose.yml`
- `labCount` in the manifest matches the actual number of labs in `index.json`
- Static flags follow the `TYPHON{...}` format
