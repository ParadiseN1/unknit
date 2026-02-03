// Package auto-detection for unknit
// Detects internal packages from project manifests (pyproject.toml, package.json)

import { readFile, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { UnknitConfig } from './config.js';

/**
 * Result of package auto-detection
 */
export interface PackageDetectionResult {
  /** Auto-detected internal packages */
  detectedPackages: string[];
  /** Source of detection (pyproject.toml, package.json, pnpm-workspace.yaml) */
  source?: string;
  /** Whether detection was successful */
  detected: boolean;
}

/**
 * Combined result with merged packages
 */
export interface MergedPackagesResult {
  /** Final merged list of internal packages */
  internalPackages: string[];
  /** Auto-detected packages */
  detectedPackages: string[];
  /** Manually configured packages */
  configuredPackages: string[];
}

/**
 * Check if a file exists at the given path
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect Python internal packages from pyproject.toml
 *
 * Looks for:
 * - [project] name
 * - [tool.poetry] name
 * - [tool.setuptools.packages.find] where
 * - Directory-based package detection from src/ or package name directory
 */
export async function detectPythonPackages(projectRoot: string): Promise<PackageDetectionResult> {
  const pyprojectPath = join(projectRoot, 'pyproject.toml');

  if (!(await fileExists(pyprojectPath))) {
    return { detectedPackages: [], detected: false };
  }

  try {
    const content = await readFile(pyprojectPath, 'utf-8');
    const packages: string[] = [];

    // Parse TOML manually (simple extraction without full parser)
    // Look for [project] name = "..."
    const projectNameMatch = content.match(/\[project\]\s*[\s\S]*?name\s*=\s*["']([^"']+)["']/);
    if (projectNameMatch?.[1]) {
      packages.push(projectNameMatch[1]);
    }

    // Look for [tool.poetry] name = "..."
    const poetryNameMatch = content.match(/\[tool\.poetry\]\s*[\s\S]*?name\s*=\s*["']([^"']+)["']/);
    if (poetryNameMatch?.[1] && !packages.includes(poetryNameMatch[1])) {
      packages.push(poetryNameMatch[1]);
    }

    // Look for packages in [tool.setuptools.packages.find] where = ["src"]
    // or explicit packages = ["pkg1", "pkg2"]
    const packagesMatch = content.match(/packages\s*=\s*\[([^\]]+)\]/);
    if (packagesMatch?.[1]) {
      const pkgList = packagesMatch[1]
        .split(',')
        .map((p) => p.trim().replace(/["']/g, ''))
        .filter((p) => p.length > 0 && !packages.includes(p));
      packages.push(...pkgList);
    }

    // If we have a project name, also check for src/{name} directory
    if (packages.length > 0) {
      const pkgName = packages[0];
      if (pkgName) {
        const srcPkgPath = join(projectRoot, 'src', pkgName.replace(/-/g, '_'));
        if (await fileExists(srcPkgPath)) {
          const pythonizedName = pkgName.replace(/-/g, '_');
          if (!packages.includes(pythonizedName)) {
            packages.push(pythonizedName);
          }
        }
      }
    }

    return {
      detectedPackages: packages,
      source: 'pyproject.toml',
      detected: packages.length > 0,
    };
  } catch {
    return { detectedPackages: [], detected: false };
  }
}

/**
 * Detect JS/TS internal packages from package.json workspaces
 *
 * Supports:
 * - npm/yarn workspaces: { "workspaces": ["packages/*"] }
 * - pnpm workspaces: pnpm-workspace.yaml with packages: ["packages/*"]
 */
export async function detectJsPackages(projectRoot: string): Promise<PackageDetectionResult> {
  const packages: string[] = [];
  let source: string | undefined;

  // Try package.json workspaces first
  const packageJsonPath = join(projectRoot, 'package.json');
  if (await fileExists(packageJsonPath)) {
    try {
      const content = await readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content) as Record<string, unknown>;

      // Get workspace patterns
      let workspacePatterns: string[] = [];

      // npm/yarn format: "workspaces": ["packages/*"]
      if (Array.isArray(pkg.workspaces)) {
        workspacePatterns = pkg.workspaces.filter((w): w is string => typeof w === 'string');
        source = 'package.json';
      }
      // yarn format: "workspaces": { "packages": ["packages/*"] }
      else if (
        pkg.workspaces &&
        typeof pkg.workspaces === 'object' &&
        'packages' in pkg.workspaces
      ) {
        const ws = pkg.workspaces as Record<string, unknown>;
        if (Array.isArray(ws.packages)) {
          workspacePatterns = ws.packages.filter((w): w is string => typeof w === 'string');
          source = 'package.json';
        }
      }

      // Resolve workspace patterns to package names
      if (workspacePatterns.length > 0) {
        const detectedPkgs = await resolveWorkspacePackages(projectRoot, workspacePatterns);
        packages.push(...detectedPkgs);
      }

      // Also include the root package name if it exists
      if (typeof pkg.name === 'string' && pkg.name.length > 0) {
        if (!packages.includes(pkg.name)) {
          packages.push(pkg.name);
        }
        // Set source if we detected a package name
        if (!source) {
          source = 'package.json';
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Try pnpm-workspace.yaml
  const pnpmWorkspacePath = join(projectRoot, 'pnpm-workspace.yaml');
  if (await fileExists(pnpmWorkspacePath)) {
    try {
      const content = await readFile(pnpmWorkspacePath, 'utf-8');
      const workspace = parseYaml(content) as Record<string, unknown>;

      if (Array.isArray(workspace.packages)) {
        const patterns = workspace.packages.filter((p): p is string => typeof p === 'string');
        const detectedPkgs = await resolveWorkspacePackages(projectRoot, patterns);

        for (const pkg of detectedPkgs) {
          if (!packages.includes(pkg)) {
            packages.push(pkg);
          }
        }

        if (!source) {
          source = 'pnpm-workspace.yaml';
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  return {
    detectedPackages: packages,
    source,
    detected: packages.length > 0,
  };
}

/**
 * Resolve workspace glob patterns to actual package names
 * by reading package.json from each matching directory
 */
async function resolveWorkspacePackages(
  projectRoot: string,
  patterns: string[]
): Promise<string[]> {
  const packages: string[] = [];

  for (const pattern of patterns) {
    // Handle simple glob patterns like "packages/*"
    if (pattern.endsWith('/*')) {
      const baseDir = pattern.slice(0, -2);
      const fullPath = join(projectRoot, baseDir);

      if (await fileExists(fullPath)) {
        try {
          const entries = await readdir(fullPath, { withFileTypes: true });

          for (const entry of entries) {
            if (entry.isDirectory()) {
              const pkgJsonPath = join(fullPath, entry.name, 'package.json');
              if (await fileExists(pkgJsonPath)) {
                try {
                  const content = await readFile(pkgJsonPath, 'utf-8');
                  const pkg = JSON.parse(content) as Record<string, unknown>;
                  if (typeof pkg.name === 'string' && pkg.name.length > 0) {
                    packages.push(pkg.name);
                  }
                } catch {
                  // Ignore parse errors for individual packages
                }
              }
            }
          }
        } catch {
          // Ignore directory read errors
        }
      }
    }
    // Handle direct paths like "packages/core"
    else if (!pattern.includes('*')) {
      const pkgJsonPath = join(projectRoot, pattern, 'package.json');
      if (await fileExists(pkgJsonPath)) {
        try {
          const content = await readFile(pkgJsonPath, 'utf-8');
          const pkg = JSON.parse(content) as Record<string, unknown>;
          if (typeof pkg.name === 'string' && pkg.name.length > 0) {
            packages.push(pkg.name);
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
    // Handle ** patterns - just use the directory name as package hint
    else if (pattern.includes('**')) {
      const baseDir = pattern.split('**')[0]?.replace(/\/$/, '') ?? '';
      if (baseDir) {
        const fullPath = join(projectRoot, baseDir);
        if (await fileExists(fullPath)) {
          // For ** patterns, we'd need recursive walking
          // For simplicity, just read immediate subdirectories
          try {
            const entries = await readdir(fullPath, { withFileTypes: true });
            for (const entry of entries) {
              if (entry.isDirectory()) {
                const pkgJsonPath = join(fullPath, entry.name, 'package.json');
                if (await fileExists(pkgJsonPath)) {
                  try {
                    const content = await readFile(pkgJsonPath, 'utf-8');
                    const pkg = JSON.parse(content) as Record<string, unknown>;
                    if (typeof pkg.name === 'string' && pkg.name.length > 0) {
                      packages.push(pkg.name);
                    }
                  } catch {
                    // Ignore parse errors
                  }
                }
              }
            }
          } catch {
            // Ignore directory read errors
          }
        }
      }
    }
  }

  return packages;
}

/**
 * Detect internal packages from project manifests.
 * Tries Python (pyproject.toml) and JS/TS (package.json, pnpm-workspace.yaml).
 */
export async function detectPackages(projectRoot: string): Promise<PackageDetectionResult> {
  // Try Python first
  const pythonResult = await detectPythonPackages(projectRoot);
  if (pythonResult.detected) {
    return pythonResult;
  }

  // Try JS/TS
  const jsResult = await detectJsPackages(projectRoot);
  if (jsResult.detected) {
    return jsResult;
  }

  return { detectedPackages: [], detected: false };
}

/**
 * Merge auto-detected packages with manually configured packages.
 * Manual configuration takes precedence (appears first).
 */
export function mergePackages(
  detectedPackages: string[],
  configuredPackages: string[]
): MergedPackagesResult {
  // Create a set of all unique packages, with configured ones first
  const seen = new Set<string>();
  const merged: string[] = [];

  // Add configured packages first (higher priority)
  for (const pkg of configuredPackages) {
    if (!seen.has(pkg)) {
      seen.add(pkg);
      merged.push(pkg);
    }
  }

  // Add detected packages that aren't already configured
  for (const pkg of detectedPackages) {
    if (!seen.has(pkg)) {
      seen.add(pkg);
      merged.push(pkg);
    }
  }

  return {
    internalPackages: merged,
    detectedPackages,
    configuredPackages,
  };
}

/**
 * Load config and merge with auto-detected packages
 */
export async function loadConfigWithAutoDetection(
  projectRoot: string,
  config: UnknitConfig
): Promise<MergedPackagesResult> {
  const detection = await detectPackages(projectRoot);

  return mergePackages(detection.detectedPackages, config.internalPackages);
}

/**
 * PackageDetector class for object-oriented access to package detection.
 */
export class PackageDetector {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Detect internal packages from project manifests
   */
  async detect(): Promise<PackageDetectionResult> {
    return detectPackages(this.projectRoot);
  }

  /**
   * Detect Python packages from pyproject.toml
   */
  async detectPython(): Promise<PackageDetectionResult> {
    return detectPythonPackages(this.projectRoot);
  }

  /**
   * Detect JS/TS packages from package.json workspaces
   */
  async detectJs(): Promise<PackageDetectionResult> {
    return detectJsPackages(this.projectRoot);
  }

  /**
   * Merge detected packages with config
   */
  async mergeWithConfig(config: UnknitConfig): Promise<MergedPackagesResult> {
    return loadConfigWithAutoDetection(this.projectRoot, config);
  }
}
