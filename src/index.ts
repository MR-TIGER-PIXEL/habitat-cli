#!/usr/bin/env bun

import { Command, CommanderError } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import packageJson from "../package.json";

type DoorStatus = "open" | "closed";
type SanitationStatus = "clean" | "dirty";
type SensorStatus = "active" | "inactive";

type Airlock = {
  name: string;
  pressureLevel: number;
  doorStatus: DoorStatus;
  sanitation: SanitationStatus;
  sensorNames: string[];
};

type Sensor = {
  name: string;
  type: string;
  reading: number;
  status: SensorStatus;
};

type Battery = {
  name: string;
  chargeAmount: number;
  isCharging: boolean;
  powerTarget: string | null;
};

const program = new Command();
const dataDirectory = path.join(import.meta.dir, "..", "data");
const airlocksFile = path.join(dataDirectory, "airlocks.json");
const sensorsFile = path.join(dataDirectory, "sensors.json");
const batteriesFile = path.join(dataDirectory, "batteries.json");
let bufferedErrorOutput = "";

function ensureDataFiles(): void {
  if (!existsSync(dataDirectory)) {
    mkdirSync(dataDirectory, { recursive: true });
  }

  if (!existsSync(airlocksFile)) {
    writeFileSync(airlocksFile, "[]\n");
  }

  if (!existsSync(sensorsFile)) {
    writeFileSync(sensorsFile, "[]\n");
  }

  if (!existsSync(batteriesFile)) {
    writeFileSync(batteriesFile, "[]\n");
  }
}

function readJsonFile<T>(file: string): T[] {
  ensureDataFiles();
  const contents = readFileSync(file, "utf8");
  const parsed = JSON.parse(contents) as T[];
  return Array.isArray(parsed) ? parsed : [];
}

function writeJsonFile<T>(file: string, items: T[]): void {
  ensureDataFiles();
  writeFileSync(file, `${JSON.stringify(items, null, 2)}\n`);
}

function readAirlocks(): Airlock[] {
  const airlocks = readJsonFile<
    Omit<Airlock, "sensorNames"> & Partial<Pick<Airlock, "sensorNames">>
  >(airlocksFile);

  return airlocks.map((airlock) => ({
    ...airlock,
    sensorNames: Array.isArray(airlock.sensorNames) ? airlock.sensorNames : [],
  }));
}

function writeAirlocks(airlocks: Airlock[]): void {
  writeJsonFile(airlocksFile, airlocks);
}

function readSensors(): Sensor[] {
  return readJsonFile<Sensor>(sensorsFile);
}

function writeSensors(sensors: Sensor[]): void {
  writeJsonFile(sensorsFile, sensors);
}

function readBatteries(): Battery[] {
  const batteries = readJsonFile<
    Omit<Battery, "powerTarget"> & Partial<Pick<Battery, "powerTarget">>
  >(batteriesFile);

  return batteries.map((battery) => ({
    ...battery,
    powerTarget: battery.powerTarget ?? null,
  }));
}

function writeBatteries(batteries: Battery[]): void {
  writeJsonFile(batteriesFile, batteries);
}

function findAirlock(airlocks: Airlock[], name: string): Airlock | undefined {
  return airlocks.find((airlock) => airlock.name === name);
}

function findSensor(sensors: Sensor[], name: string): Sensor | undefined {
  return sensors.find((sensor) => sensor.name === name);
}

function findBattery(batteries: Battery[], name: string): Battery | undefined {
  return batteries.find((battery) => battery.name === name);
}

function requireAirlock(name: string): { airlocks: Airlock[]; airlock: Airlock } {
  const airlocks = readAirlocks();
  const airlock = findAirlock(airlocks, name);

  if (!airlock) {
    console.error(`Airlock "${name}" not found.`);
    process.exit(1);
  }

  return { airlocks, airlock };
}

function requireSensor(name: string): { sensors: Sensor[]; sensor: Sensor } {
  const sensors = readSensors();
  const sensor = findSensor(sensors, name);

  if (!sensor) {
    console.error(`Sensor "${name}" not found.`);
    process.exit(1);
  }

  return { sensors, sensor };
}

function requireBattery(name: string): { batteries: Battery[]; battery: Battery } {
  const batteries = readBatteries();
  const battery = findBattery(batteries, name);

  if (!battery) {
    console.error(`Battery "${name}" not found.`);
    process.exit(1);
  }

  return { batteries, battery };
}

function parseNumber(value: string, label: string, code: string): number {
  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    throw new CommanderError(1, code, `Invalid ${label} "${value}". Use a number.`);
  }

  return parsed;
}

function parsePressureLevel(value: string): number {
  return parseNumber(value, "pressure level", "habitat.invalidPressureLevel");
}

function parseReading(value: string): number {
  return parseNumber(value, "reading", "habitat.invalidReading");
}

function parseChargeAmount(value: string): number {
  return parseNumber(value, "charge amount", "habitat.invalidChargeAmount");
}

function parseDoorStatus(value: string): DoorStatus {
  if (value !== "open" && value !== "closed") {
    throw new CommanderError(
      1,
      "habitat.invalidDoorStatus",
      `Invalid door status "${value}". Use "open" or "closed".`,
    );
  }

  return value;
}

function parseSanitation(value: string): SanitationStatus {
  if (value !== "clean" && value !== "dirty") {
    throw new CommanderError(
      1,
      "habitat.invalidSanitation",
      `Invalid sanitation "${value}". Use "clean" or "dirty".`,
    );
  }

  return value;
}

function parseSensorStatus(value: string): SensorStatus {
  if (value !== "active" && value !== "inactive") {
    throw new CommanderError(
      1,
      "habitat.invalidSensorStatus",
      `Invalid sensor status "${value}". Use "active" or "inactive".`,
    );
  }

  return value;
}

function parseBoolean(value: string): boolean {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new CommanderError(
    1,
    "habitat.invalidBoolean",
    `Invalid boolean "${value}". Use "true" or "false".`,
  );
}

function printAirlock(airlock: Airlock, sensors: Sensor[]): void {
  console.log(`name: ${airlock.name}`);
  console.log(`pressureLevel: ${airlock.pressureLevel}`);
  console.log(`doorStatus: ${airlock.doorStatus}`);
  console.log(`sanitation: ${airlock.sanitation}`);

  if (airlock.sensorNames.length === 0) {
    console.log("sensors: (none)");
    return;
  }

  console.log("sensors:");

  for (const sensorName of airlock.sensorNames) {
    const sensor = findSensor(sensors, sensorName);

    if (!sensor) {
      console.log(`- ${sensorName} (missing sensor record)`);
      continue;
    }

    console.log(
      `- ${sensor.name} | type=${sensor.type} | reading=${sensor.reading} | status=${sensor.status}`,
    );
  }
}

function printSensor(sensor: Sensor): void {
  console.log(`name: ${sensor.name}`);
  console.log(`type: ${sensor.type}`);
  console.log(`reading: ${sensor.reading}`);
  console.log(`status: ${sensor.status}`);
}

function printBattery(battery: Battery): void {
  console.log(`name: ${battery.name}`);
  console.log(`chargeAmount: ${battery.chargeAmount}`);
  console.log(`isCharging: ${battery.isCharging}`);
  console.log(`powerTarget: ${battery.powerTarget ?? "(none)"}`);
}

function dedent(text: string): string {
  return text.trim().replace(/^ {2}/gm, "");
}

function configureCommand(command: Command): Command {
  return command
    .showSuggestionAfterError(false)
    .configureOutput({
      writeErr: (str) => {
        bufferedErrorOutput += str;
      },
    })
    .exitOverride();
}

const airlockCommand = configureCommand(
  program
    .command("airlock")
    .description("Manage airlocks, including door state, sanitation, and sensors."),
);
const sensorCommand = configureCommand(
  program.command("sensor").description("Manage sensors and their readings."),
);
const batteryCommand = configureCommand(
  program
    .command("battery")
    .description("Manage batteries, charging state, and power targets."),
);

airlockCommand
  .command("create")
  .description("Create an airlock.")
  .requiredOption("--name <name>", "Airlock name")
  .requiredOption(
    "--pressure-level <pressureLevel>",
    "Airlock pressure level",
    parsePressureLevel,
  )
  .option(
    "--door-status <doorStatus>",
    'Door status ("open" or "closed")',
    parseDoorStatus,
    "closed",
  )
  .option(
    "--sanitation <sanitation>",
    'Sanitation status ("clean" or "dirty")',
    parseSanitation,
    "dirty",
  )
  .action((options) => {
    const airlocks = readAirlocks();

    if (findAirlock(airlocks, options.name)) {
      console.error(`Airlock "${options.name}" already exists.`);
      process.exit(1);
    }

    const airlock: Airlock = {
      name: options.name,
      pressureLevel: options.pressureLevel,
      doorStatus: options.doorStatus,
      sanitation: options.sanitation,
      sensorNames: [],
    };

    airlocks.push(airlock);
    writeAirlocks(airlocks);
    console.log(`Created airlock "${airlock.name}".`);
  });

airlockCommand
  .command("list")
  .description("List airlocks.")
  .action(() => {
    const airlocks = readAirlocks();

    if (airlocks.length === 0) {
      console.log("No airlocks found.");
      return;
    }

    for (const airlock of airlocks) {
      console.log(
        `${airlock.name} | pressure=${airlock.pressureLevel} | door=${airlock.doorStatus} | sanitation=${airlock.sanitation} | sensors=${airlock.sensorNames.length}`,
      );
    }
  });

airlockCommand
  .command("show")
  .description("Show one airlock.")
  .argument("<name>", "Airlock name")
  .action((name: string) => {
    const { airlock } = requireAirlock(name);
    printAirlock(airlock, readSensors());
  });

airlockCommand
  .command("update")
  .description("Update an airlock.")
  .argument("<name>", "Airlock name")
  .option(
    "--pressure-level <pressureLevel>",
    "Updated pressure level",
    parsePressureLevel,
  )
  .option(
    "--door-status <doorStatus>",
    'Updated door status ("open" or "closed")',
    parseDoorStatus,
  )
  .option(
    "--sanitation <sanitation>",
    'Updated sanitation status ("clean" or "dirty")',
    parseSanitation,
  )
  .action((name: string, options) => {
    const { airlocks, airlock } = requireAirlock(name);
    const hasUpdates =
      options.pressureLevel !== undefined ||
      options.doorStatus !== undefined ||
      options.sanitation !== undefined;

    if (!hasUpdates) {
      console.error("Nothing to update. Provide at least one option.");
      process.exit(1);
    }

    if (options.pressureLevel !== undefined) {
      airlock.pressureLevel = options.pressureLevel;
    }

    if (options.doorStatus !== undefined) {
      airlock.doorStatus = options.doorStatus;
    }

    if (options.sanitation !== undefined) {
      airlock.sanitation = options.sanitation;
    }

    writeAirlocks(airlocks);
    console.log(`Updated airlock "${airlock.name}".`);
  });

airlockCommand
  .command("delete")
  .description("Delete an airlock.")
  .argument("<name>", "Airlock name")
  .action((name: string) => {
    const airlocks = readAirlocks();
    const nextAirlocks = airlocks.filter((airlock) => airlock.name !== name);

    if (nextAirlocks.length === airlocks.length) {
      console.error(`Airlock "${name}" not found.`);
      process.exit(1);
    }

    writeAirlocks(nextAirlocks);
    console.log(`Deleted airlock "${name}".`);
  });

airlockCommand
  .command("open")
  .description("Open an airlock.")
  .argument("<name>", "Airlock name")
  .action((name: string) => {
    const { airlocks, airlock } = requireAirlock(name);
    airlock.doorStatus = "open";
    writeAirlocks(airlocks);
    console.log(`Opened airlock "${airlock.name}".`);
  });

airlockCommand
  .command("close")
  .description("Close an airlock.")
  .argument("<name>", "Airlock name")
  .action((name: string) => {
    const { airlocks, airlock } = requireAirlock(name);
    airlock.doorStatus = "closed";
    writeAirlocks(airlocks);
    console.log(`Closed airlock "${airlock.name}".`);
  });

airlockCommand
  .command("sanitize")
  .description("Sanitize an airlock.")
  .argument("<name>", "Airlock name")
  .action((name: string) => {
    const { airlocks, airlock } = requireAirlock(name);
    airlock.sanitation = "clean";
    writeAirlocks(airlocks);
    console.log(`Sanitized airlock "${airlock.name}".`);
  });

airlockCommand
  .command("add-sensor")
  .description("Connect a sensor to an airlock.")
  .argument("<airlockName>", "Airlock name")
  .argument("<sensorName>", "Sensor name")
  .action((airlockName: string, sensorName: string) => {
    const { airlocks, airlock } = requireAirlock(airlockName);
    const { sensor } = requireSensor(sensorName);

    if (airlock.sensorNames.includes(sensor.name)) {
      console.error(
        `Sensor "${sensor.name}" is already connected to airlock "${airlock.name}".`,
      );
      process.exit(1);
    }

    airlock.sensorNames.push(sensor.name);
    writeAirlocks(airlocks);
    console.log(`Added sensor "${sensor.name}" to airlock "${airlock.name}".`);
  });

sensorCommand
  .command("create")
  .description("Create a sensor.")
  .requiredOption("--name <name>", "Sensor name")
  .requiredOption("--type <type>", "Sensor type")
  .requiredOption("--reading <reading>", "Sensor reading", parseReading)
  .option(
    "--status <status>",
    'Sensor status ("active" or "inactive")',
    parseSensorStatus,
    "active",
  )
  .action((options) => {
    const sensors = readSensors();

    if (findSensor(sensors, options.name)) {
      console.error(`Sensor "${options.name}" already exists.`);
      process.exit(1);
    }

    const sensor: Sensor = {
      name: options.name,
      type: options.type,
      reading: options.reading,
      status: options.status,
    };

    sensors.push(sensor);
    writeSensors(sensors);
    console.log(`Created sensor "${sensor.name}".`);
  });

sensorCommand
  .command("list")
  .description("List sensors.")
  .action(() => {
    const sensors = readSensors();

    if (sensors.length === 0) {
      console.log("No sensors found.");
      return;
    }

    for (const sensor of sensors) {
      console.log(
        `${sensor.name} | type=${sensor.type} | reading=${sensor.reading} | status=${sensor.status}`,
      );
    }
  });

sensorCommand
  .command("show")
  .description("Show one sensor.")
  .argument("<name>", "Sensor name")
  .action((name: string) => {
    const { sensor } = requireSensor(name);
    printSensor(sensor);
  });

sensorCommand
  .command("update")
  .description("Update a sensor.")
  .argument("<name>", "Sensor name")
  .option("--type <type>", "Updated sensor type")
  .option("--reading <reading>", "Updated sensor reading", parseReading)
  .option(
    "--status <status>",
    'Updated sensor status ("active" or "inactive")',
    parseSensorStatus,
  )
  .action((name: string, options) => {
    const { sensors, sensor } = requireSensor(name);
    const hasUpdates =
      options.type !== undefined ||
      options.reading !== undefined ||
      options.status !== undefined;

    if (!hasUpdates) {
      console.error("Nothing to update. Provide at least one option.");
      process.exit(1);
    }

    if (options.type !== undefined) {
      sensor.type = options.type;
    }

    if (options.reading !== undefined) {
      sensor.reading = options.reading;
    }

    if (options.status !== undefined) {
      sensor.status = options.status;
    }

    writeSensors(sensors);
    console.log(`Updated sensor "${sensor.name}".`);
  });

sensorCommand
  .command("delete")
  .description("Delete a sensor.")
  .argument("<name>", "Sensor name")
  .action((name: string) => {
    const sensors = readSensors();
    const nextSensors = sensors.filter((sensor) => sensor.name !== name);

    if (nextSensors.length === sensors.length) {
      console.error(`Sensor "${name}" not found.`);
      process.exit(1);
    }

    const airlocks = readAirlocks();

    for (const airlock of airlocks) {
      airlock.sensorNames = airlock.sensorNames.filter(
        (sensorName) => sensorName !== name,
      );
    }

    writeSensors(nextSensors);
    writeAirlocks(airlocks);
    console.log(`Deleted sensor "${name}".`);
  });

batteryCommand
  .command("create")
  .description("Create a battery.")
  .requiredOption("--name <name>", "Battery name")
  .requiredOption(
    "--charge-amount <chargeAmount>",
    "Battery charge amount",
    parseChargeAmount,
  )
  .option(
    "--is-charging <isCharging>",
    'Charging state ("true" or "false")',
    parseBoolean,
    false,
  )
  .option("--power-target <powerTarget>", "Battery power target")
  .action((options) => {
    const batteries = readBatteries();

    if (findBattery(batteries, options.name)) {
      console.error(`Battery "${options.name}" already exists.`);
      process.exit(1);
    }

    const battery: Battery = {
      name: options.name,
      chargeAmount: options.chargeAmount,
      isCharging: options.isCharging,
      powerTarget: options.powerTarget ?? null,
    };

    batteries.push(battery);
    writeBatteries(batteries);
    console.log(`Created battery "${battery.name}".`);
  });

batteryCommand
  .command("list")
  .description("List batteries.")
  .action(() => {
    const batteries = readBatteries();

    if (batteries.length === 0) {
      console.log("No batteries found.");
      return;
    }

    for (const battery of batteries) {
      console.log(
        `${battery.name} | charge=${battery.chargeAmount} | charging=${battery.isCharging} | powerTarget=${battery.powerTarget ?? "(none)"}`,
      );
    }
  });

batteryCommand
  .command("show")
  .description("Show one battery.")
  .argument("<name>", "Battery name")
  .action((name: string) => {
    const { battery } = requireBattery(name);
    printBattery(battery);
  });

batteryCommand
  .command("update")
  .description("Update a battery.")
  .argument("<name>", "Battery name")
  .option(
    "--charge-amount <chargeAmount>",
    "Updated charge amount",
    parseChargeAmount,
  )
  .option(
    "--is-charging <isCharging>",
    'Updated charging state ("true" or "false")',
    parseBoolean,
  )
  .option("--power-target <powerTarget>", "Updated power target")
  .action((name: string, options) => {
    const { batteries, battery } = requireBattery(name);
    const hasUpdates =
      options.chargeAmount !== undefined ||
      options.isCharging !== undefined ||
      options.powerTarget !== undefined;

    if (!hasUpdates) {
      console.error("Nothing to update. Provide at least one option.");
      process.exit(1);
    }

    if (options.chargeAmount !== undefined) {
      battery.chargeAmount = options.chargeAmount;
    }

    if (options.isCharging !== undefined) {
      battery.isCharging = options.isCharging;
    }

    if (options.powerTarget !== undefined) {
      battery.powerTarget = options.powerTarget;
    }

    writeBatteries(batteries);
    console.log(`Updated battery "${battery.name}".`);
  });

batteryCommand
  .command("delete")
  .description("Delete a battery.")
  .argument("<name>", "Battery name")
  .action((name: string) => {
    const batteries = readBatteries();
    const nextBatteries = batteries.filter((battery) => battery.name !== name);

    if (nextBatteries.length === batteries.length) {
      console.error(`Battery "${name}" not found.`);
      process.exit(1);
    }

    writeBatteries(nextBatteries);
    console.log(`Deleted battery "${name}".`);
  });

batteryCommand
  .command("start-charging")
  .description("Start charging a battery.")
  .argument("<name>", "Battery name")
  .action((name: string) => {
    const { batteries, battery } = requireBattery(name);
    battery.isCharging = true;
    writeBatteries(batteries);
    console.log(`Started charging battery "${battery.name}".`);
  });

batteryCommand
  .command("stop-charging")
  .description("Stop charging a battery.")
  .argument("<name>", "Battery name")
  .action((name: string) => {
    const { batteries, battery } = requireBattery(name);
    battery.isCharging = false;
    writeBatteries(batteries);
    console.log(`Stopped charging battery "${battery.name}".`);
  });

batteryCommand
  .command("assign-target")
  .description("Assign a battery to provide power to a target.")
  .argument("<name>", "Battery name")
  .argument("<powerTarget>", "Power target")
  .action((name: string, powerTarget: string) => {
    const { batteries, battery } = requireBattery(name);
    battery.powerTarget = powerTarget;
    writeBatteries(batteries);
    console.log(
      `Assigned battery "${battery.name}" to provide power to "${battery.powerTarget}".`,
    );
  });

configureCommand(
  program
    .name("habitat")
    .description("A minimal habitat command-line app for managing habitat resources.")
    .version(packageJson.version)
    .allowExcessArguments(true),
);

program.addHelpText(
  "after",
  dedent(`
    Command Groups:
      airlock   Create, inspect, and operate habitat airlocks
      sensor    Create and manage sensors attached to airlocks
      battery   Create and manage batteries and power targets

    Examples:
      habitat airlock list
      habitat airlock show alpha
      habitat sensor create --name temp-1 --type temperature --reading 21.5 --status active
      habitat battery assign-target core-pack habitat-grid

    Tip:
      Run habitat <group> --help to see commands, arguments, options, and examples for a group.
  `),
);

airlockCommand.addHelpText(
  "after",
  dedent(`
    Arguments:
      <name>         Airlock name
      <airlockName>  Existing airlock name
      <sensorName>   Existing sensor name

    Common Options:
      --pressure-level <pressureLevel>  Numeric pressure level
      --door-status <doorStatus>        open | closed
      --sanitation <sanitation>         clean | dirty

    Examples:
      habitat airlock create --name alpha --pressure-level 42 --door-status closed --sanitation dirty
      habitat airlock list
      habitat airlock show alpha
      habitat airlock update alpha --pressure-level 55 --sanitation clean
      habitat airlock open alpha
      habitat airlock add-sensor alpha temp-1
  `),
);

sensorCommand.addHelpText(
  "after",
  dedent(`
    Arguments:
      <name>  Sensor name

    Common Options:
      --type <type>        Sensor type, such as temperature or pressure
      --reading <reading>  Numeric sensor reading
      --status <status>    active | inactive

    Examples:
      habitat sensor create --name temp-1 --type temperature --reading 21.5 --status active
      habitat sensor list
      habitat sensor show temp-1
      habitat sensor update temp-1 --reading 22.1 --status active
      habitat sensor delete temp-1
  `),
);

batteryCommand.addHelpText(
  "after",
  dedent(`
    Arguments:
      <name>         Battery name
      <powerTarget>  Target powered by the battery

    Common Options:
      --charge-amount <chargeAmount>  Numeric charge amount
      --is-charging <isCharging>      true | false
      --power-target <powerTarget>    Target name such as alpha or habitat-grid

    Examples:
      habitat battery create --name core-pack --charge-amount 75 --is-charging false --power-target alpha
      habitat battery list
      habitat battery show core-pack
      habitat battery update core-pack --charge-amount 82 --is-charging true --power-target life-support
      habitat battery start-charging core-pack
      habitat battery assign-target core-pack habitat-grid
  `),
);

try {
  program.parse();
} catch (error) {
  if (error instanceof CommanderError) {
    if (
      error.code === "commander.helpDisplayed" ||
      error.code === "commander.version"
    ) {
      process.exit(0);
    }

    if (error.code === "commander.unknownCommand") {
      const match = error.message.match(/unknown command '(.+)'/);
      const unknownCommand = match?.[1] ?? "unknown";
      console.error(
        `Unknown command "${unknownCommand}". Run habitat --help to see available commands.`,
      );
      process.exit(error.exitCode);
    }

    const message = error.message.trim();

    if (message.length > 0) {
      console.error(message);
    } else if (bufferedErrorOutput.trim().length > 0) {
      console.error(bufferedErrorOutput.trim());
    }

    process.exit(error.exitCode);
  }

  throw error;
}
