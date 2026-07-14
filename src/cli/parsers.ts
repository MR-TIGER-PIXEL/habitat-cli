import { CliError } from "../kepler";

export function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    throw new CliError(`Invalid tick count "${value}". Use a positive integer.`);
  }

  return parsed;
}

export function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`Invalid ${label} "${value}". Use a positive integer.`);
  }

  return parsed;
}

export function parseStrictInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || value.trim() === "") {
    throw new CliError(`Invalid ${label} "${value}". Use an integer.`);
  }

  return parsed;
}

export function parseIntegerInRange(
  value: string,
  label: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CliError(`Invalid ${label} "${value}". Use an integer from ${minimum} through ${maximum}.`);
  }

  return parsed;
}
