import type { LocalHabitatModule, StarterHuman } from "../kepler";
import commandModuleLight from "./assets/modules/ChatGPT Image Jul 16, 2026, 10_17_11 AM.png";
import commandModuleDark from "./assets/modules/ChatGPT Image Jul 16, 2026, 10_17_13 AM.png";
import lifeSupportLight from "./assets/modules/ChatGPT Image Jul 16, 2026, 10_17_14 AM.png";
import lifeSupportDark from "./assets/modules/ChatGPT Image Jul 16, 2026, 10_17_15 AM.png";
import basicBatteryLight from "./assets/modules/ChatGPT Image Jul 16, 2026, 10_17_16 AM.png";
import basicBatteryDark from "./assets/modules/ChatGPT Image Jul 16, 2026, 10_17_17 AM.png";
import supplyCacheLight from "./assets/modules/ChatGPT Image Jul 16, 2026, 10_17_18 AM.png";
import workshopFabricatorLight from "./assets/modules/ChatGPT Image Jul 16, 2026, 10_17_19 AM (1).png";
import supplyCacheDark from "./assets/modules/ChatGPT Image Jul 16, 2026, 10_17_19 AM.png";
import workshopFabricatorDark from "./assets/modules/ChatGPT Image Jul 16, 2026, 10_17_20 AM.png";
import basicSuitportLight from "./assets/modules/ChatGPT Image Jul 16, 2026, 10_17_21 AM.png";
import basicSuitportDark from "./assets/modules/ChatGPT Image Jul 16, 2026, 10_17_22 AM.png";
import humanMale from "./assets/humans/ChatGPT Image Jul 16, 2026, 10_17_23 AM.png";
import humanFemale from "./assets/humans/ChatGPT Image Jul 16, 2026, 10_17_29 AM.png";
import humanGeneric from "./assets/humans/ChatGPT Image Jul 16, 2026, 10_17_31 AM.png";

export type ThemeMode = "light" | "dark";
export type HumanAvatarVariant = "generic" | "female" | "male";

type Artwork = {
  src: string;
  fileName: string;
};

const moduleArtworkByBlueprint: Record<string, Record<ThemeMode, Artwork>> = {
  "command-module": {
    light: {
      src: commandModuleLight,
      fileName: "ChatGPT Image Jul 16, 2026, 10_17_11 AM.png",
    },
    dark: {
      src: commandModuleDark,
      fileName: "ChatGPT Image Jul 16, 2026, 10_17_13 AM.png",
    },
  },
  "life-support": {
    light: {
      src: lifeSupportLight,
      fileName: "ChatGPT Image Jul 16, 2026, 10_17_14 AM.png",
    },
    dark: {
      src: lifeSupportDark,
      fileName: "ChatGPT Image Jul 16, 2026, 10_17_15 AM.png",
    },
  },
  "basic-battery": {
    light: {
      src: basicBatteryLight,
      fileName: "ChatGPT Image Jul 16, 2026, 10_17_16 AM.png",
    },
    dark: {
      src: basicBatteryDark,
      fileName: "ChatGPT Image Jul 16, 2026, 10_17_17 AM.png",
    },
  },
  "supply-cache": {
    light: {
      src: supplyCacheLight,
      fileName: "ChatGPT Image Jul 16, 2026, 10_17_18 AM.png",
    },
    dark: {
      src: supplyCacheDark,
      fileName: "ChatGPT Image Jul 16, 2026, 10_17_19 AM.png",
    },
  },
  "workshop-fabricator": {
    light: {
      src: workshopFabricatorLight,
      fileName: "ChatGPT Image Jul 16, 2026, 10_17_19 AM (1).png",
    },
    dark: {
      src: workshopFabricatorDark,
      fileName: "ChatGPT Image Jul 16, 2026, 10_17_20 AM.png",
    },
  },
  "basic-suitport": {
    light: {
      src: basicSuitportLight,
      fileName: "ChatGPT Image Jul 16, 2026, 10_17_21 AM.png",
    },
    dark: {
      src: basicSuitportDark,
      fileName: "ChatGPT Image Jul 16, 2026, 10_17_22 AM.png",
    },
  },
};

const humanAvatarArtwork: Record<HumanAvatarVariant, Artwork> = {
  generic: {
    src: humanGeneric,
    fileName: "ChatGPT Image Jul 16, 2026, 10_17_31 AM.png",
  },
  female: {
    src: humanFemale,
    fileName: "ChatGPT Image Jul 16, 2026, 10_17_29 AM.png",
  },
  male: {
    src: humanMale,
    fileName: "ChatGPT Image Jul 16, 2026, 10_17_23 AM.png",
  },
};

export const humanAvatarOverrides: Record<string, HumanAvatarVariant> = {
  "human-1": "female",
  "human-2": "male",
};

export function getModuleArtwork(blueprintId: string, mode: ThemeMode): Artwork | null {
  return moduleArtworkByBlueprint[blueprintId]?.[mode] ?? null;
}

export function getHumanAvatarVariant(humanId: string): HumanAvatarVariant {
  return humanAvatarOverrides[humanId] ?? "generic";
}

export function getHumanAvatarArtwork(humanId: string): Artwork {
  return humanAvatarArtwork[getHumanAvatarVariant(humanId)];
}

export function getHumanLocationLabel(human: StarterHuman, modules: LocalHabitatModule[]): string {
  return modules.find((module) => module.id === human.locationModuleId)?.displayName ?? human.locationModuleId;
}
