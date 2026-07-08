import { CliError } from "../kepler";

export function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new CliError(`Invalid tick count "${value}". Use a positive integer.`);
  }

  return parsed;
}
