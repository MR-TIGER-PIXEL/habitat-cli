import { readEnvironmentFile } from "../kepler";

const DEFAULT_BASE_URL = "http://localhost:8787";

export function resolveBackendApiBaseUrl(cwd: string): string {
  const shellValue = process.env.HABITAT_API_BASE_URL;
  const envFileValue = readEnvironmentFile(cwd).HABITAT_API_BASE_URL;
  const value =
    shellValue === undefined
      ? DEFAULT_BASE_URL
      : shellValue === envFileValue
        ? DEFAULT_BASE_URL
        : shellValue;

  return value.replace(/\/+$/, "");
}
