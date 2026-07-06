#!/usr/bin/env bun

import { Command } from "commander";
import packageJson from "../package.json";
import {
  CliError,
  getRegistrationStatus,
  registerHabitat,
  resolveConfig,
  unregisterHabitat,
} from "./kepler";

const program = new Command();

program
  .name("habitat")
  .description("Register a habitat with Kepler, inspect registration status, and unregister it.")
  .version(packageJson.version)
  .showHelpAfterError("(run `habitat --help` for command usage)")
  .addHelpText(
    "after",
    `
Examples:
  habitat register --name "Starlight Forge"
  habitat status
  habitat unregister
`,
  );

program
  .command("register")
  .description("Register this CLI workspace as a habitat in Kepler.")
  .requiredOption("--name <name>", "Habitat display name")
  .action(async (options: { name: string }) => {
    const config = resolveConfig(process.cwd());
    const result = await registerHabitat(config, options.name);

    console.log(`Registered habitat "${result.registration.displayName}".`);
    console.log(`habitatId: ${result.registration.habitatId}`);
    console.log(`habitatUuid: ${result.registration.habitatUuid}`);
    console.log(`saved: .habitat/registration.json`);
  });

program
  .command("status")
  .description("Show the locally saved registration and current remote habitat status.")
  .action(async () => {
    const config = resolveConfig(process.cwd());
    const result = await getRegistrationStatus(config);

    console.log(`displayName: ${result.registration.displayName}`);
    console.log(`habitatId: ${result.registration.habitatId}`);
    console.log(`habitatUuid: ${result.registration.habitatUuid}`);
    console.log(`baseUrl: ${result.registration.baseUrl}`);
    console.log(`habitatSlug: ${result.habitat.habitatSlug}`);
    console.log(`status: ${result.habitat.status}`);
    console.log(`catalogVersion: ${result.habitat.catalogVersion}`);
    console.log(`lastSeenAt: ${result.habitat.lastSeenAt ?? "(never)"}`);
  });

program
  .command("unregister")
  .description("Delete the remote habitat registration and remove the saved local registration.")
  .action(async () => {
    const config = resolveConfig(process.cwd());
    const registration = await unregisterHabitat(config);

    console.log(`Unregistered habitat "${registration.displayName}".`);
    console.log(`removed: .habitat/registration.json`);
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exitCode = error instanceof CliError ? 1 : 1;
    console.error(message);
    process.exit(exitCode);
  }
}

await main();
