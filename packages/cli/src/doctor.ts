/**
 * Platform capability detection (FR-018, PRD 9.3, 14.1).
 *
 * P0 supports macOS and Linux. The report states exactly which trust
 * modes the platform can and cannot provide: trusted-host is the only
 * shell mode at P0 and offers no containment; sandboxed local requires a
 * container backend (P1); remote sandbox is future work. No false
 * sandbox claims, ever.
 */

import { execFileSync } from "node:child_process";
import { platform, release } from "node:os";

export interface CapabilityReport {
  os: { platform: string; release: string; supported: boolean };
  node: { version: string; supported: boolean };
  binaries: { name: string; available: boolean; version?: string }[];
  trustModes: { mode: string; available: boolean; guarantee: string }[];
  ok: boolean;
  warnings: string[];
}

function probeBinary(name: string, args: string[]): { available: boolean; version?: string } {
  try {
    const out = execFileSync(name, args, { timeout: 5000, stdio: ["ignore", "pipe", "pipe"] })
      .toString()
      .trim()
      .split("\n")[0];
    return out !== undefined ? { available: true, version: out } : { available: true };
  } catch {
    return { available: false };
  }
}

export function detectCapabilities(): CapabilityReport {
  const osPlatform = platform();
  const supportedOs = osPlatform === "darwin" || osPlatform === "linux";
  const nodeMajor = parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  const supportedNode = nodeMajor >= 20;

  const binaries = [
    probeBinary("git", ["--version"]),
    probeBinary("bash", ["--version"]),
    probeBinary("docker", ["--version"])
  ].map((probe, i) => ({ name: ["git", "bash", "docker"][i] as string, ...probe }));

  const docker = binaries.find((b) => b.name === "docker");
  const warnings: string[] = [];
  if (!supportedOs) {
    warnings.push(
      `Unsupported platform "${osPlatform}" at P0: macOS and Linux only. Filesystem and Git tools may work; shell execution is unsupported (PRD 14, FR-018).`
    );
  }
  if (!supportedNode) {
    warnings.push(`Node.js ${process.versions.node} is below the supported LTS floor (>=20).`);
  }
  if (docker?.available !== true) {
    warnings.push(
      "docker not found: the sandboxed-local trust mode (container backend, P1) is unavailable."
    );
  }

  const bashBin = binaries.find((b) => b.name === "bash");
  const trustModes = [
    {
      mode: "trusted-host",
      available: supportedOs && bashBin?.available === true,
      guarantee:
        "Commands run with host privileges and NO containment. Explicit opt-in, approval-gated by default. Not a sandbox (PRD 9.3)."
    },
    {
      mode: "restricted-local",
      available: supportedOs,
      guarantee:
        "Runtime-mediated tools only (filesystem, git, HTTP): policy and workspace confinement enforced by the runtime. Does NOT apply to shell execution (PRD 9.3)."
    },
    {
      mode: "sandboxed-local",
      available: false,
      guarantee: "Container backend is P1 roadmap; not available in this build (PRD 14.2)."
    },
    {
      mode: "remote-sandbox",
      available: false,
      guarantee: "Future work; not available in this build (PRD 14.4)."
    }
  ];

  return {
    os: { platform: osPlatform, release: release(), supported: supportedOs },
    node: { version: process.versions.node, supported: supportedNode },
    binaries,
    trustModes,
    ok: supportedOs && supportedNode,
    warnings
  };
}

export function renderReport(report: CapabilityReport): string {
  const yesno = (b: boolean) => (b ? "yes" : "no");
  const lines = [
    "Agentic Tools platform report",
    `  OS:    ${report.os.platform} ${report.os.release} (supported: ${yesno(report.os.supported)})`,
    `  Node:  ${report.node.version} (supported: ${yesno(report.node.supported)})`,
    "  Binaries:",
    ...report.binaries.map(
      (b) => `    ${b.name.padEnd(8)} ${b.available ? (b.version ?? "available") : "not found"}`
    ),
    "  Trust modes:",
    ...report.trustModes.map(
      (m) => `    ${m.mode.padEnd(18)} available: ${yesno(m.available)}\n      ${m.guarantee}`
    )
  ];
  if (report.warnings.length > 0) {
    lines.push("  Warnings:", ...report.warnings.map((w) => `    - ${w}`));
  }
  return lines.join("\n");
}
