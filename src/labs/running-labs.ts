import type { RunningLab } from "../types.js";

const runningLabs = new Map<string, RunningLab>();

export function registerLab(lab: RunningLab): void {
  runningLabs.set(lab.labId, lab);
}

export function unregisterLab(labId: string): void {
  runningLabs.delete(labId);
}

export function getRunningLab(labId: string): RunningLab | undefined {
  return runningLabs.get(labId);
}

export function getAllRunningLabs(): RunningLab[] {
  return Array.from(runningLabs.values());
}

export function isRunning(labId: string): boolean {
  return runningLabs.has(labId);
}
