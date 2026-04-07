import { homedir } from "node:os";
import { join } from "node:path";

export const TYPHON_HOME = join(homedir(), ".typhon");
export const CONFIG_PATH = join(TYPHON_HOME, "config.json");
export const PROGRESS_PATH = join(TYPHON_HOME, "progress.json");
export const FEEDBACK_PATH = join(TYPHON_HOME, "feedback.json");
export const CACHE_DIR = join(TYPHON_HOME, "cache");

export const CATALOG_CACHE_TTL_MS = 3_600_000; // 1 hour
export const HEALTH_POLL_INTERVAL_MS = 500;
export const HEALTH_TIMEOUT_MS = 30_000;

export const DEFAULT_LIBRARY_NAME = "h4ck0rman";
export const DEFAULT_LIBRARY_URL = "https://typhon-library.h4ck0rman.dev";

export const COMPOSE_PROJECT_PREFIX = "typhon-";
export const DOCKER_LABEL_PREFIX = "dev.typhon";
