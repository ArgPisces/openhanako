/**
 * Startup pass that brings existing credential files up to the owner-only
 * storage contract.
 *
 * Writing new files with the right permissions only covers files written after
 * an upgrade. Anything already on disk keeps whatever permissions it was
 * created with, and a file that is never rewritten would keep them forever.
 * This runs on every startup rather than once, because permissions can also
 * drift afterwards: restoring from a backup, copying a data directory between
 * machines, or syncing it all reintroduce the original permissions long after
 * a one-shot migration would have finished.
 *
 * Running every time is safe because the pass is idempotent and silent when
 * there is nothing to correct. Every correction is logged, so this is a stated
 * contract about how the data directory is kept rather than an invisible fixup.
 *
 * Deleting this module means dropping its single call in the engine startup
 * sequence; nothing else depends on it.
 */
import fs from "fs";
import path from "path";

import { AppError } from "../shared/errors.ts";
import { errorBus } from "../shared/error-bus.ts";
import { ensureSecretDirModeSync, ensureSecretFileModeSync } from "../shared/secret-fs.ts";

/** Files directly under the data directory that hold credentials. */
export const TOP_LEVEL_SECRET_FILES = [
  "provider-catalog.json",
  "models.json",
  "added-models.yaml",
  "auth.json",
  "device-credentials.json",
  "devices.json",
  "pairing-sessions.json",
  "local-user-auth.json",
  "users.json",
  "web-sessions.json",
];

/**
 * Directory trees whose contents are credential material throughout.
 * "providers" holds each locally defined provider plugin, whose provider.json
 * carries that provider's key.
 */
export const SECRET_TREES = ["migration-backups", "providers"];

const AGENT_CONFIG_FILE = "config.yaml";
const MAX_TREE_DEPTH = 6;

interface HealOptions {
  hanakoHome: string;
  log?: (line: string) => void;
}

export interface CredentialHealResult {
  /** Paths relative to the data directory that were tightened this run. */
  healed: string[];
  /** Paths that could not be tightened; each one was reported. */
  failed: string[];
}

export function healCredentialFileModes({ hanakoHome, log = () => {} }: HealOptions): CredentialHealResult {
  const result: CredentialHealResult = { healed: [], failed: [] };
  // Refuse rather than quietly do nothing: without a data directory there is
  // no work to skip, only a caller passing the wrong thing, and silently
  // succeeding would hide that the files were never protected at all.
  if (!hanakoHome) throw new Error("credential file healer requires a data directory");

  const relative = (target: string) => path.relative(hanakoHome, target) || ".";

  const apply = (target: string, tighten: (p: string) => boolean) => {
    try {
      if (tighten(target)) {
        const rel = relative(target);
        result.healed.push(rel);
        log(`[credential-custody] tightened ${rel}`);
      }
    } catch (err: any) {
      const rel = relative(target);
      result.failed.push(rel);
      log(`[credential-custody] could not tighten ${rel}: ${err?.code || err?.message || "unknown error"}`);
      // Logged, never surfaced: a file whose mode could not be tightened is
      // worth a record, but the application still works and interrupting the
      // user over it would be out of proportion. Some filesystems (removable
      // media, network mounts) reject the change outright and would otherwise
      // complain on every single launch.
      errorBus.report(
        new AppError("FS_PERMISSION", { cause: err, context: { relativePath: rel } }),
        { route: "silent", dedupeKey: `credential-custody:${rel}` },
      );
    }
  };

  const healFile = (target: string) => apply(target, ensureSecretFileModeSync);
  const healDir = (target: string) => apply(target, ensureSecretDirModeSync);

  healDir(hanakoHome);

  for (const name of TOP_LEVEL_SECRET_FILES) {
    healFile(path.join(hanakoHome, name));
  }

  for (const agentDir of subdirectories(path.join(hanakoHome, "agents"))) {
    healFile(path.join(agentDir, AGENT_CONFIG_FILE));
  }

  for (const tree of SECRET_TREES) {
    healTree(path.join(hanakoHome, tree), 0, healDir, healFile);
  }

  // Migration checkpoints copy the agents directory wholesale, so the same
  // configuration files exist a second time inside each checkpoint.
  const checkpointRoot = path.join(hanakoHome, "checkpoints", "session-manifest");
  for (const checkpoint of subdirectories(checkpointRoot)) {
    for (const agentDir of subdirectories(path.join(checkpoint, "agents"))) {
      healFile(path.join(agentDir, AGENT_CONFIG_FILE));
    }
  }

  return result;
}

function healTree(
  root: string,
  depth: number,
  healDir: (target: string) => void,
  healFile: (target: string) => void,
): void {
  if (depth > MAX_TREE_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return; // absent or unreadable: nothing to correct here
  }
  healDir(root);
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) healTree(target, depth + 1, healDir, healFile);
    else if (entry.isFile()) healFile(target);
  }
}

function subdirectories(root: string): string[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch {
    return [];
  }
}
