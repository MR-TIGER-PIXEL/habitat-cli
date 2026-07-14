import { readEnvironmentFile } from "../kepler";

const DEFAULT_BASE_URL = "http://localhost:8787";

export function resolveBackendApiBaseUrl(cwd: string): string {
  const value =
    process.env.HABITAT_API_BASE_URL
    ?? DEFAULT_BASE_URL;

  return value.replace(/\/+$/, "");
}
