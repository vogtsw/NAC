/**
 * SWE-bench Dataset Loader — downloads and parses SWE-bench_Lite from HuggingFace.
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { SWEBenchInstance } from "./types";

const CACHE_DIR = "D:\\test\\swebench-cache";
const PYTHON = "C:\\Users\\94725\\AppData\\Local\\Programs\\Python\\Python311\\python.exe";

export function downloadDataset(): SWEBenchInstance[] {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

  const cacheFile = join(CACHE_DIR, "swebench_lite.json");

  if (existsSync(cacheFile)) {
    console.log(`Loading cached dataset: ${cacheFile}`);
    return JSON.parse(readFileSync(cacheFile, "utf-8"));
  }

  console.log("Downloading SWE-bench_Lite from HuggingFace mirror...");
  const script = `
import json, os
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"
from datasets import load_dataset
ds = load_dataset("princeton-nlp/SWE-bench_Lite", split="test")
instances = []
for inst in ds:
    instances.append({
        "repo": inst["repo"],
        "instance_id": inst["instance_id"],
        "base_commit": inst["base_commit"],
        "patch": inst["patch"],
        "test_patch": inst["test_patch"],
        "problem_statement": inst["problem_statement"],
        "hints_text": inst["hints_text"] or "",
        "created_at": inst["created_at"],
        "version": inst["version"],
        "FAIL_TO_PASS": inst["FAIL_TO_PASS"],
        "PASS_TO_PASS": inst["PASS_TO_PASS"],
        "environment_setup_commit": inst["environment_setup_commit"],
    })
with open("${cacheFile.replace(/\\/g, "\\\\")}", "w", encoding="utf-8") as f:
    json.dump(instances, f, indent=2)
print(f"Saved {len(instances)} instances")
`;

  const tmpScript = join(CACHE_DIR, "download.py");
  writeFileSync(tmpScript, script, "utf-8");
  execSync(`"${PYTHON}" "${tmpScript}"`, { cwd: CACHE_DIR, encoding: "utf-8", timeout: 120000, stdio: "inherit" });

  return JSON.parse(readFileSync(cacheFile, "utf-8"));
}

export function getInstances(
  dataset: SWEBenchInstance[],
  filter?: { repo?: string; limit?: number; instanceIds?: string[] },
): SWEBenchInstance[] {
  let filtered = dataset;

  if (filter?.repo) {
    filtered = filtered.filter(i => i.repo === filter!.repo);
  }
  if (filter?.instanceIds) {
    filtered = filtered.filter(i => filter!.instanceIds!.includes(i.instance_id));
  }
  if (filter?.limit) {
    filtered = filtered.slice(0, filter!.limit);
  }

  return filtered;
}

export function instanceSummary(inst: SWEBenchInstance): string {
  const ftp = JSON.parse(inst.FAIL_TO_PASS) as string[];
  const ptp = JSON.parse(inst.PASS_TO_PASS) as string[];
  return [
    `ID: ${inst.instance_id}`,
    `Repo: ${inst.repo}`,
    `Commit: ${inst.base_commit.slice(0, 8)}`,
    `Problem: ${inst.problem_statement.split("\n")[0].slice(0, 120)}`,
    `F→P: ${ftp.length}  P→P: ${ptp.length}`,
    `Patch lines: ${inst.patch.split("\n").length}`,
  ].join("\n");
}
