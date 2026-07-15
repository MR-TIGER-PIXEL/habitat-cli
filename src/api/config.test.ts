import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "bun:test";
import { resolveBackendApiBaseUrl } from "./config";

const originalHabitatApiBaseUrl = process.env.HABITAT_API_BASE_URL;

afterEach(() => {
  if (originalHabitatApiBaseUrl === undefined) {
    delete process.env.HABITAT_API_BASE_URL;
  } else {
    process.env.HABITAT_API_BASE_URL = originalHabitatApiBaseUrl;
  }
});

test("resolveBackendApiBaseUrl defaults to the local Habitat API even when .env contains HABITAT_API_BASE_URL", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-api-config-"));

  try {
    writeFileSync(
      path.join(cwd, ".env"),
      "HABITAT_API_BASE_URL=http://100.104.87.118:8787\n",
    );

    delete process.env.HABITAT_API_BASE_URL;

    expect(resolveBackendApiBaseUrl(cwd)).toBe("http://localhost:8787");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("resolveBackendApiBaseUrl ignores Bun auto-loaded .env values for HABITAT_API_BASE_URL", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-api-config-"));

  try {
    const envValue = "http://100.104.87.118:8787";
    writeFileSync(
      path.join(cwd, ".env"),
      `HABITAT_API_BASE_URL=${envValue}\n`,
    );

    process.env.HABITAT_API_BASE_URL = envValue;

    expect(resolveBackendApiBaseUrl(cwd)).toBe("http://localhost:8787");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("resolveBackendApiBaseUrl still allows an explicit shell override", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "habitat-api-config-"));

  try {
    process.env.HABITAT_API_BASE_URL = "http://192.168.1.8:8787/";
    expect(resolveBackendApiBaseUrl(cwd)).toBe("http://192.168.1.8:8787");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
