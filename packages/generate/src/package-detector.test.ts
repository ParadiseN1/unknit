// Tests for package auto-detection
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectPythonPackages,
  detectJsPackages,
  detectPackages,
  mergePackages,
  loadConfigWithAutoDetection,
  PackageDetector,
} from './package-detector.js';
import type { UnknitConfig } from './config.js';

describe('package-detector', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), 'unknit-package-detector-test-' + Date.now());
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // Helper to create a subdirectory
  async function createSubdir(name: string): Promise<string> {
    const dir = join(testDir, name);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  describe('detectPythonPackages', () => {
    it('returns empty when no pyproject.toml exists', async () => {
      const dir = await createSubdir('no-pyproject');
      const result = await detectPythonPackages(dir);

      expect(result.detected).toBe(false);
      expect(result.detectedPackages).toEqual([]);
      expect(result.source).toBeUndefined();
    });

    it('detects package name from [project] section', async () => {
      const dir = await createSubdir('project-section');
      await writeFile(
        join(dir, 'pyproject.toml'),
        `
[project]
name = "my-python-package"
version = "1.0.0"
`
      );

      const result = await detectPythonPackages(dir);

      expect(result.detected).toBe(true);
      expect(result.detectedPackages).toContain('my-python-package');
      expect(result.source).toBe('pyproject.toml');
    });

    it('detects package name from [tool.poetry] section', async () => {
      const dir = await createSubdir('poetry-section');
      await writeFile(
        join(dir, 'pyproject.toml'),
        `
[tool.poetry]
name = "poetry-package"
version = "2.0.0"
`
      );

      const result = await detectPythonPackages(dir);

      expect(result.detected).toBe(true);
      expect(result.detectedPackages).toContain('poetry-package');
      expect(result.source).toBe('pyproject.toml');
    });

    it('detects packages from explicit packages list', async () => {
      const dir = await createSubdir('explicit-packages');
      await writeFile(
        join(dir, 'pyproject.toml'),
        `
[tool.setuptools]
packages = ["pkg1", "pkg2", "pkg3"]
`
      );

      const result = await detectPythonPackages(dir);

      expect(result.detected).toBe(true);
      expect(result.detectedPackages).toContain('pkg1');
      expect(result.detectedPackages).toContain('pkg2');
      expect(result.detectedPackages).toContain('pkg3');
    });

    it('detects package from project name with src layout', async () => {
      const dir = await createSubdir('src-layout');
      await mkdir(join(dir, 'src', 'my_package'), { recursive: true });
      await writeFile(
        join(dir, 'pyproject.toml'),
        `
[project]
name = "my-package"
`
      );

      const result = await detectPythonPackages(dir);

      expect(result.detected).toBe(true);
      expect(result.detectedPackages).toContain('my-package');
      expect(result.detectedPackages).toContain('my_package');
    });

    it('handles both project and poetry sections', async () => {
      const dir = await createSubdir('both-sections');
      await writeFile(
        join(dir, 'pyproject.toml'),
        `
[project]
name = "main-package"

[tool.poetry]
name = "poetry-name"
`
      );

      const result = await detectPythonPackages(dir);

      expect(result.detected).toBe(true);
      expect(result.detectedPackages).toContain('main-package');
      expect(result.detectedPackages).toContain('poetry-name');
    });

    it('handles malformed pyproject.toml gracefully', async () => {
      const dir = await createSubdir('malformed-pyproject');
      await writeFile(join(dir, 'pyproject.toml'), 'this is not valid toml {{{}}}');

      const result = await detectPythonPackages(dir);

      expect(result.detected).toBe(false);
      expect(result.detectedPackages).toEqual([]);
    });
  });

  describe('detectJsPackages', () => {
    it('returns empty when no package.json exists', async () => {
      const dir = await createSubdir('no-packagejson');
      const result = await detectJsPackages(dir);

      expect(result.detected).toBe(false);
      expect(result.detectedPackages).toEqual([]);
    });

    it('detects root package name from package.json', async () => {
      const dir = await createSubdir('root-package');
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({
          name: '@myorg/root-package',
          version: '1.0.0',
        })
      );

      const result = await detectJsPackages(dir);

      expect(result.detected).toBe(true);
      expect(result.detectedPackages).toContain('@myorg/root-package');
      expect(result.source).toBe('package.json');
    });

    it('detects workspace packages from npm/yarn workspaces array', async () => {
      const dir = await createSubdir('npm-workspaces');
      await mkdir(join(dir, 'packages', 'core'), { recursive: true });
      await mkdir(join(dir, 'packages', 'cli'), { recursive: true });

      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'root',
          workspaces: ['packages/*'],
        })
      );

      await writeFile(
        join(dir, 'packages', 'core', 'package.json'),
        JSON.stringify({ name: '@myorg/core', version: '1.0.0' })
      );

      await writeFile(
        join(dir, 'packages', 'cli', 'package.json'),
        JSON.stringify({ name: '@myorg/cli', version: '1.0.0' })
      );

      const result = await detectJsPackages(dir);

      expect(result.detected).toBe(true);
      expect(result.detectedPackages).toContain('@myorg/core');
      expect(result.detectedPackages).toContain('@myorg/cli');
      expect(result.detectedPackages).toContain('root');
      expect(result.source).toBe('package.json');
    });

    it('detects workspace packages from yarn workspaces object', async () => {
      const dir = await createSubdir('yarn-workspaces');
      await mkdir(join(dir, 'packages', 'utils'), { recursive: true });

      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'yarn-root',
          workspaces: {
            packages: ['packages/*'],
          },
        })
      );

      await writeFile(
        join(dir, 'packages', 'utils', 'package.json'),
        JSON.stringify({ name: '@myorg/utils', version: '1.0.0' })
      );

      const result = await detectJsPackages(dir);

      expect(result.detected).toBe(true);
      expect(result.detectedPackages).toContain('@myorg/utils');
      expect(result.source).toBe('package.json');
    });

    it('detects packages from pnpm-workspace.yaml', async () => {
      const dir = await createSubdir('pnpm-workspaces');
      await mkdir(join(dir, 'packages', 'shared'), { recursive: true });

      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'pnpm-root', version: '1.0.0' })
      );

      await writeFile(
        join(dir, 'pnpm-workspace.yaml'),
        `packages:
  - "packages/*"
`
      );

      await writeFile(
        join(dir, 'packages', 'shared', 'package.json'),
        JSON.stringify({ name: '@myorg/shared', version: '1.0.0' })
      );

      const result = await detectJsPackages(dir);

      expect(result.detected).toBe(true);
      expect(result.detectedPackages).toContain('@myorg/shared');
      expect(result.detectedPackages).toContain('pnpm-root');
    });

    it('handles direct path workspaces', async () => {
      const dir = await createSubdir('direct-path-workspaces');
      await mkdir(join(dir, 'apps', 'web'), { recursive: true });

      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'direct-root',
          workspaces: ['apps/web'],
        })
      );

      await writeFile(
        join(dir, 'apps', 'web', 'package.json'),
        JSON.stringify({ name: '@myorg/web', version: '1.0.0' })
      );

      const result = await detectJsPackages(dir);

      expect(result.detected).toBe(true);
      expect(result.detectedPackages).toContain('@myorg/web');
    });

    it('handles malformed package.json gracefully', async () => {
      const dir = await createSubdir('malformed-packagejson');
      await writeFile(join(dir, 'package.json'), 'not valid json {{{');

      const result = await detectJsPackages(dir);

      expect(result.detected).toBe(false);
      expect(result.detectedPackages).toEqual([]);
    });

    it('handles missing workspace subdirectory', async () => {
      const dir = await createSubdir('missing-workspace-dir');
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'root',
          workspaces: ['packages/*'],
        })
      );
      // Note: packages/ directory does not exist

      const result = await detectJsPackages(dir);

      expect(result.detected).toBe(true);
      expect(result.detectedPackages).toContain('root');
    });

    it('merges package.json and pnpm-workspace.yaml results', async () => {
      const dir = await createSubdir('merged-workspaces');
      await mkdir(join(dir, 'packages', 'a'), { recursive: true });
      await mkdir(join(dir, 'libs', 'b'), { recursive: true });

      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'merged-root',
          workspaces: ['packages/*'],
        })
      );

      await writeFile(
        join(dir, 'pnpm-workspace.yaml'),
        `packages:
  - "libs/*"
`
      );

      await writeFile(
        join(dir, 'packages', 'a', 'package.json'),
        JSON.stringify({ name: '@myorg/a', version: '1.0.0' })
      );

      await writeFile(
        join(dir, 'libs', 'b', 'package.json'),
        JSON.stringify({ name: '@myorg/b', version: '1.0.0' })
      );

      const result = await detectJsPackages(dir);

      expect(result.detected).toBe(true);
      expect(result.detectedPackages).toContain('@myorg/a');
      expect(result.detectedPackages).toContain('@myorg/b');
      expect(result.detectedPackages).toContain('merged-root');
    });
  });

  describe('detectPackages', () => {
    it('prefers Python if pyproject.toml exists', async () => {
      const dir = await createSubdir('prefer-python');
      await writeFile(
        join(dir, 'pyproject.toml'),
        `
[project]
name = "python-project"
`
      );
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'js-project', version: '1.0.0' })
      );

      const result = await detectPackages(dir);

      expect(result.detected).toBe(true);
      expect(result.source).toBe('pyproject.toml');
      expect(result.detectedPackages).toContain('python-project');
    });

    it('falls back to JS if no Python project', async () => {
      const dir = await createSubdir('fallback-js');
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'js-fallback', version: '1.0.0' })
      );

      const result = await detectPackages(dir);

      expect(result.detected).toBe(true);
      expect(result.source).toBe('package.json');
      expect(result.detectedPackages).toContain('js-fallback');
    });

    it('returns empty if no project manifests exist', async () => {
      const dir = await createSubdir('no-manifests');

      const result = await detectPackages(dir);

      expect(result.detected).toBe(false);
      expect(result.detectedPackages).toEqual([]);
    });
  });

  describe('mergePackages', () => {
    it('merges detected and configured packages', () => {
      const result = mergePackages(['detected-a', 'detected-b'], ['configured-a', 'configured-b']);

      expect(result.internalPackages).toEqual([
        'configured-a',
        'configured-b',
        'detected-a',
        'detected-b',
      ]);
      expect(result.detectedPackages).toEqual(['detected-a', 'detected-b']);
      expect(result.configuredPackages).toEqual(['configured-a', 'configured-b']);
    });

    it('configured packages appear first (higher priority)', () => {
      const result = mergePackages(['pkg-a'], ['pkg-b']);

      expect(result.internalPackages[0]).toBe('pkg-b');
      expect(result.internalPackages[1]).toBe('pkg-a');
    });

    it('deduplicates packages', () => {
      const result = mergePackages(['shared-pkg', 'detected-only'], ['shared-pkg', 'config-only']);

      expect(result.internalPackages).toEqual(['shared-pkg', 'config-only', 'detected-only']);
    });

    it('handles empty detected packages', () => {
      const result = mergePackages([], ['config-only']);

      expect(result.internalPackages).toEqual(['config-only']);
    });

    it('handles empty configured packages', () => {
      const result = mergePackages(['detected-only'], []);

      expect(result.internalPackages).toEqual(['detected-only']);
    });

    it('handles both empty arrays', () => {
      const result = mergePackages([], []);

      expect(result.internalPackages).toEqual([]);
    });
  });

  describe('loadConfigWithAutoDetection', () => {
    it('merges auto-detected packages with config', async () => {
      const dir = await createSubdir('load-with-autodetect');
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'auto-detected-pkg', version: '1.0.0' })
      );

      const config: UnknitConfig = {
        internalPackages: ['manually-configured'],
        externalPackages: [],
        sourceRoot: '.',
        outputRoot: '.',
        includeSourceRefs: true,
      };

      const result = await loadConfigWithAutoDetection(dir, config);

      expect(result.internalPackages).toContain('manually-configured');
      expect(result.internalPackages).toContain('auto-detected-pkg');
      expect(result.configuredPackages).toEqual(['manually-configured']);
      expect(result.detectedPackages).toContain('auto-detected-pkg');
    });

    it('works when no packages are detected', async () => {
      const dir = await createSubdir('no-detection');

      const config: UnknitConfig = {
        internalPackages: ['only-configured'],
        externalPackages: [],
        sourceRoot: '.',
        outputRoot: '.',
        includeSourceRefs: true,
      };

      const result = await loadConfigWithAutoDetection(dir, config);

      expect(result.internalPackages).toEqual(['only-configured']);
    });
  });

  describe('PackageDetector class', () => {
    it('provides detect method', async () => {
      const dir = await createSubdir('detector-class');
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'detector-test', version: '1.0.0' })
      );

      const detector = new PackageDetector(dir);
      const result = await detector.detect();

      expect(result.detected).toBe(true);
      expect(result.detectedPackages).toContain('detector-test');
    });

    it('provides detectPython method', async () => {
      const dir = await createSubdir('detector-python');
      await writeFile(
        join(dir, 'pyproject.toml'),
        `
[project]
name = "python-detector-test"
`
      );

      const detector = new PackageDetector(dir);
      const result = await detector.detectPython();

      expect(result.detected).toBe(true);
      expect(result.detectedPackages).toContain('python-detector-test');
    });

    it('provides detectJs method', async () => {
      const dir = await createSubdir('detector-js');
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'js-detector-test', version: '1.0.0' })
      );

      const detector = new PackageDetector(dir);
      const result = await detector.detectJs();

      expect(result.detected).toBe(true);
      expect(result.detectedPackages).toContain('js-detector-test');
    });

    it('provides mergeWithConfig method', async () => {
      const dir = await createSubdir('detector-merge');
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: 'merge-detector-test', version: '1.0.0' })
      );

      const detector = new PackageDetector(dir);
      const config: UnknitConfig = {
        internalPackages: ['configured-pkg'],
        externalPackages: [],
        sourceRoot: '.',
        outputRoot: '.',
        includeSourceRefs: true,
      };

      const result = await detector.mergeWithConfig(config);

      expect(result.internalPackages).toContain('configured-pkg');
      expect(result.internalPackages).toContain('merge-detector-test');
    });
  });
});
