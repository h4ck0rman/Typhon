# Typhon TODO

## Security Test Suite

Write dedicated tests for all OWASP-hardened security features. None of these have test coverage today.

### SSRF Protection (`src/library/client.ts`)
- Private IP detection: verify all RFC 1918, RFC 6598, loopback, link-local, IPv6 ULA ranges are blocked
- Numeric IP bypass resistance: decimal, hex, octal, IPv6-mapped IPv4
- HTTPS enforcement: reject `http://` for non-localhost URLs
- DNS resolution failure handling
- Redirect blocking (`redirect: "error"`)

### Compose Validator (`src/docker/compose-validator.ts`)
- Each blocked pattern: privileged, cap_add, network_mode host, pid/ipc host, security_opt, devices, cgroup_parent, sysctls, runtime
- Host volume mount detection: absolute paths blocked, relative paths allowed, named volumes allowed
- YAML boolean variants: true, yes, on (quoted and unquoted)
- Resource limit warning generation when TYPHON_* vars not referenced
- Size limit enforcement (>100KB)
- Required patterns (services: key)

### Zip-Slip Protection (`src/library/client.ts`)
- Pre-extraction: tar entries with `..` components rejected
- Pre-extraction: tar entries with absolute paths rejected
- Post-extraction: symlink escape detection via realpath
- Temp directory isolation: failed extraction cleaned up, final dir untouched
- Atomic move on success

### Package Integrity (`src/library/client.ts`)
- SHA-256 checksum match passes
- SHA-256 checksum mismatch rejects package
- Missing checksums.json gracefully skipped (backwards compatible)

### Rate Limiting (`src/state/rate-limit.ts`)
- Sliding window: requests within limit allowed
- Sliding window: requests exceeding limit rejected
- Window expiry: old timestamps pruned, new requests allowed after cooldown
- Per-key isolation (different lab IDs have independent limits)
- check_flag integration: returns error after 10 attempts/minute
- submit_feedback integration: returns error after 5 submissions/minute
- submit_feedback: 1000 entry cap enforced

### Audit Log (`src/state/audit.ts`)
- Hash chain: each entry's `prev` matches previous entry's `hash`
- Sequence numbers: monotonically increasing
- Tamper detection: modifying a middle entry breaks the chain
- File permissions: created with 0o600
- Fire-and-forget: audit failures never throw

### File Locking (`src/state/file-lock.ts`)
- Concurrent writes to same file are serialized (no data loss)
- Different files can be locked independently
- Lock released on function error (no deadlock)

### State File Validation (`src/state/schemas.ts`)
- Invalid config.json falls back to defaults
- Invalid progress.json falls back to empty store
- Invalid feedback.json falls back to empty store
- Corrupt JSON (non-parseable) falls back to defaults
- Config save rejects invalid data

### Health Check Path (`src/labs/schema.ts`)
- Valid paths: `/`, `/health`, `/api/v1/status`
- Rejected paths: `//evil.com`, `/../etc`, paths with query strings, empty string

### Docker Integration (requires Docker)
- composeUp/composeDown lifecycle
- Port allocation and release with real containers
- Health check polling against a real endpoint
- Port map rebuild from Docker state on startup
- Concurrent lab limit enforcement end-to-end
