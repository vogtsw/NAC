/**
 * SWE-bench Sandbox — manages Python repo clones, venvs, and test execution.
 * Docker-free: uses local git + venv + subprocess.
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { SandboxInfo, SWEBenchInstance } from "./types";

const SANDBOX_ROOT = "D:\\test\\swebench-sandbox";
const PYTHON_BASE = "C:\\Users\\94725\\AppData\\Local\\Programs\\Python\\Python311\\python.exe";

// Per-repo install commands
const REPO_SETUP: Record<string, { packages: string[]; install: string; testCmd: string }> = {
  "pallets/flask": {
    packages: ["pytest", "Werkzeug>=2.0,<3.0"],
    install: "python -m pip install -e .",
    testCmd: "python -m pytest {test} -v --no-header --rootdir={root}",
  },
  "psf/requests": {
    packages: ["pytest", "urllib3<2", "chardet<5", "idna<4"],
    install: "python -m pip install -e .",
    testCmd: "python -m pytest {test} -v --no-header --rootdir={root}",
  },
};

export function getSandbox(inst: SWEBenchInstance): SandboxInfo {
  const slug = inst.instance_id.replace(/__/, "_");
  const repoPath = join(SANDBOX_ROOT, slug);
  const venvPath = join(repoPath, "venv");
  const pythonBin = join(venvPath, "Scripts", "python.exe");
  const pipBin = join(venvPath, "Scripts", "pip.exe");
  const setup = REPO_SETUP[inst.repo] || { packages: ["pytest"], install: "python -m pip install -e .", testCmd: "python -m pytest {test} -v --no-header" };
  return { repoPath, venvPath, pythonBin, pipBin, testCmd: setup.testCmd };
}

function sh(cmd: string, cwd: string, timeout = 60000): { ok: boolean; stdout: string; stderr: string } {
  try {
    const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf-8", timeout, env: { ...process.env } });
    return { ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "" };
  } catch (e: any) {
    return { ok: false, stdout: "", stderr: e.message };
  }
}

export async function setupSandbox(inst: SWEBenchInstance): Promise<SandboxInfo> {
  const info = getSandbox(inst);
  const { repoPath, venvPath, pythonBin, pipBin } = info;
  const setup = REPO_SETUP[inst.repo] || REPO_SETUP["pallets/flask"];

  // Create root
  if (!existsSync(SANDBOX_ROOT)) mkdirSync(SANDBOX_ROOT, { recursive: true });

  // Clone repo if needed
  if (!existsSync(join(repoPath, ".git"))) {
    const [owner, name] = inst.repo.split("/");
    const cloneUrl = `https://gitclone.com/github.com/${inst.repo}.git`;
    console.log(`  Cloning ${inst.repo} → ${repoPath}...`);
    const r = sh(`git clone ${cloneUrl} "${repoPath}"`, SANDBOX_ROOT, 120000);
    if (!r.ok && !existsSync(join(repoPath, ".git"))) {
      throw new Error(`Clone failed: ${r.stderr}`);
    }
  }

  // Checkout base commit
  console.log(`  Checkout ${inst.base_commit.slice(0, 8)}...`);
  sh("git fetch --all 2>/dev/null; git checkout --force " + inst.base_commit, repoPath);

  // Apply test patch (so failing tests exist)
  if (inst.test_patch) {
    const patchFile = join(repoPath, "test_patch.diff");
    writeFileSync(patchFile, inst.test_patch, "utf-8");
    const r = sh("git apply --verbose " + patchFile, repoPath);
    if (!r.ok) {
      // Try with --reject for partial application
      sh("git apply --reject --verbose " + patchFile, repoPath);
    }
  }

  // Create venv
  if (!existsSync(pythonBin)) {
    console.log(`  Creating venv...`);
    const r = sh(`"${PYTHON_BASE}" -m venv venv`, repoPath, 60000);
    if (!r.ok) throw new Error(`venv failed: ${r.stderr}`);
  }

  // Install packages
  console.log(`  Installing packages...`);
  for (const pkg of setup.packages) {
    sh(`"${pipBin}" install ${pkg} --quiet`, repoPath, 60000);
  }
  sh(`"${pythonBin}" -m pip install -e . --quiet`, repoPath, 60000);

  return info;
}

export function runPythonTests(
  info: SandboxInfo,
  testIds: string[],
): { passed: number; failed: number; error: number; output: string; details: Record<string, string> } {
  const details: Record<string, string> = {};
  let totalPassed = 0, totalFailed = 0, totalError = 0;
  let allOutput = "";

  for (const testId of testIds) {
    const cmd = info.testCmd
      .replace("{test}", testId)
      .replace("{root}", info.repoPath);
    const r = sh(cmd, info.repoPath, 120000);
    const combined = r.stdout + r.stderr;

    // Parse pytest output
    const passed = (combined.match(/(\d+) passed/) || [,"0"])[1];
    const failed = (combined.match(/(\d+) failed/) || [,"0"])[1];
    const errors = (combined.match(/(\d+) error/) || [,"0"])[1];

    totalPassed += parseInt(passed);
    totalFailed += parseInt(failed);
    totalError += parseInt(errors);
    allOutput += `\n--- ${testId} ---\n${combined}`;
    details[testId] = combined;
  }

  return { passed: totalPassed, failed: totalFailed, error: totalError, output: allOutput, details };
}

export function readFile(repoPath: string, relativePath: string): string {
  const p = join(repoPath, relativePath);
  if (!existsSync(p)) return `[NOT FOUND: ${relativePath}]`;
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return `[ERROR reading: ${relativePath}]`;
  }
}

export function writeFile(repoPath: string, relativePath: string, content: string): string {
  const p = join(repoPath, relativePath);
  try {
    writeFileSync(p, content, "utf-8");
    return `OK: wrote ${content.length}B to ${relativePath}`;
  } catch (e: any) {
    return `ERROR: ${e.message}`;
  }
}

export function createPatch(repoPath: string): string {
  const r = sh("git diff --no-color", repoPath);
  return r.stdout;
}

export function applyPatch(repoPath: string, patch: string): boolean {
  const patchFile = join(repoPath, "agent_patch.diff");
  writeFileSync(patchFile, patch, "utf-8");
  const r = sh("git apply --verbose " + patchFile, repoPath);
  return r.ok;
}

export function fileTree(repoPath: string, maxFiles = 50): string {
  const r = sh("find . -type f -name '*.py' | head -" + maxFiles, repoPath);
  return r.stdout || "(empty)";
}
