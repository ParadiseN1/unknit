// Tests for generation orchestrator
// Note: Tests that require mocking the LLM client are minimal due to ESM mocking complexity.
// The orchestrator is tested through its exported functions that don't require LLM calls.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { UnknitConfig } from './config.js';
import {
  getOutputPath,
  generate,
  GenerationOrchestrator,
} from './orchestrator.js';

// Test fixtures directory
let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'unknit-orchestrator-test-'));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('getOutputPath', () => {
  const defaultConfig: UnknitConfig = {
    internalPackages: [],
    externalPackages: [],
    sourceRoot: '.',
    outputRoot: '.',
    includeSourceRefs: true,
  };

  it('should generate .unknit path alongside source file', () => {
    const result = getOutputPath('/project/src/utils.py', defaultConfig);
    expect(result).toBe('/project/src/utils.unknit');
  });

  it('should handle TypeScript files', () => {
    const result = getOutputPath('/project/src/index.ts', defaultConfig);
    expect(result).toBe('/project/src/index.unknit');
  });

  it('should handle TSX files', () => {
    const result = getOutputPath('/project/src/Component.tsx', defaultConfig);
    expect(result).toBe('/project/src/Component.unknit');
  });

  it('should handle JavaScript files', () => {
    const result = getOutputPath('/project/src/utils.js', defaultConfig);
    expect(result).toBe('/project/src/utils.unknit');
  });

  it('should handle JSX files', () => {
    const result = getOutputPath('/project/src/Component.jsx', defaultConfig);
    expect(result).toBe('/project/src/Component.unknit');
  });

  it('should use outputRoot when different from sourceRoot', () => {
    const config: UnknitConfig = {
      ...defaultConfig,
      sourceRoot: 'src',
      outputRoot: 'unknit',
    };
    const result = getOutputPath('/project/src/utils.py', config, '/project');
    expect(result).toBe('/project/unknit/utils.unknit');
  });

  it('should preserve subdirectory structure when using different outputRoot', () => {
    const config: UnknitConfig = {
      ...defaultConfig,
      sourceRoot: 'src',
      outputRoot: 'unknit',
    };
    const result = getOutputPath('/project/src/utils/helpers.py', config, '/project');
    expect(result).toBe('/project/unknit/utils/helpers.unknit');
  });

  it('should fallback to source directory when file not under sourceRoot', () => {
    const config: UnknitConfig = {
      ...defaultConfig,
      sourceRoot: 'src',
      outputRoot: 'unknit',
    };
    const result = getOutputPath('/project/lib/utils.py', config, '/project');
    expect(result).toBe('/project/lib/utils.unknit');
  });

  it('should work without projectRoot', () => {
    const config: UnknitConfig = {
      ...defaultConfig,
      sourceRoot: 'src',
      outputRoot: 'unknit',
    };
    const result = getOutputPath('/project/src/utils.py', config);
    expect(result).toBe('/project/src/utils.unknit');
  });
});

describe('generate', () => {
  describe('file validation', () => {
    it('should fail when source file does not exist', async () => {
      const result = await generate('/nonexistent/file.py');

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe('SOURCE_NOT_FOUND');
    });

    it('should fail for unsupported file types', async () => {
      const filePath = join(tempDir, 'test.rb');
      await writeFile(filePath, '# Ruby code');

      const result = await generate(filePath);

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe('UNSUPPORTED_FILE_TYPE');
      expect(result.errors[0]?.message).toContain('.rb');
    });

    it('should fail for unsupported .go files', async () => {
      const filePath = join(tempDir, 'main.go');
      await writeFile(filePath, 'package main');

      const result = await generate(filePath);

      expect(result.success).toBe(false);
      expect(result.errors[0]?.code).toBe('UNSUPPORTED_FILE_TYPE');
    });
  });
});

describe('GenerationOrchestrator', () => {
  describe('constructor', () => {
    it('should create orchestrator with default options', () => {
      const orchestrator = new GenerationOrchestrator();
      expect(orchestrator.getConfig()).toBeUndefined();
    });

    it('should accept initial config', () => {
      const config: UnknitConfig = {
        internalPackages: ['mypackage'],
        externalPackages: [],
        sourceRoot: 'src',
        outputRoot: 'unknit',
        includeSourceRefs: true,
      };

      const orchestrator = new GenerationOrchestrator({ config });
      expect(orchestrator.getConfig()).toEqual(config);
    });
  });

  describe('loadConfig', () => {
    it('should load config from project root', async () => {
      const projectRoot = join(tempDir, 'orchestrator-config');
      await mkdir(projectRoot, { recursive: true });
      await writeFile(join(projectRoot, '.unknit.yaml'), `
internalPackages:
  - myapp
  - mylib
`);

      const orchestrator = new GenerationOrchestrator();
      const config = await orchestrator.loadConfig(projectRoot);

      expect(config.internalPackages).toContain('myapp');
      expect(config.internalPackages).toContain('mylib');
      expect(orchestrator.getConfig()).toEqual(config);
    });

    it('should throw when project root not specified', async () => {
      const orchestrator = new GenerationOrchestrator();

      await expect(orchestrator.loadConfig()).rejects.toThrow('Project root not specified');
    });

    it('should use projectRoot from options', async () => {
      const projectRoot = join(tempDir, 'orchestrator-options');
      await mkdir(projectRoot, { recursive: true });
      await writeFile(join(projectRoot, '.unknit.yaml'), 'internalPackages: []');

      const orchestrator = new GenerationOrchestrator({ projectRoot });
      const config = await orchestrator.loadConfig();

      expect(config).toBeDefined();
    });
  });

  describe('isSupported', () => {
    it('should return true for Python files', () => {
      const orchestrator = new GenerationOrchestrator();
      expect(orchestrator.isSupported('file.py')).toBe(true);
    });

    it('should return true for TypeScript files', () => {
      const orchestrator = new GenerationOrchestrator();
      expect(orchestrator.isSupported('file.ts')).toBe(true);
      expect(orchestrator.isSupported('file.tsx')).toBe(true);
    });

    it('should return true for JavaScript files', () => {
      const orchestrator = new GenerationOrchestrator();
      expect(orchestrator.isSupported('file.js')).toBe(true);
      expect(orchestrator.isSupported('file.jsx')).toBe(true);
    });

    it('should return false for unsupported files', () => {
      const orchestrator = new GenerationOrchestrator();
      expect(orchestrator.isSupported('file.rb')).toBe(false);
      expect(orchestrator.isSupported('file.go')).toBe(false);
      expect(orchestrator.isSupported('file.rs')).toBe(false);
    });
  });

  describe('getOutputPath', () => {
    it('should calculate output path', () => {
      const config: UnknitConfig = {
        internalPackages: [],
        externalPackages: [],
        sourceRoot: '.',
        outputRoot: '.',
        includeSourceRefs: true,
      };

      const orchestrator = new GenerationOrchestrator({ config });
      const path = orchestrator.getOutputPath('/project/src/app.py');

      expect(path).toBe('/project/src/app.unknit');
    });

    it('should use config outputRoot', () => {
      const config: UnknitConfig = {
        internalPackages: [],
        externalPackages: [],
        sourceRoot: 'src',
        outputRoot: 'unknit',
        includeSourceRefs: true,
      };

      const orchestrator = new GenerationOrchestrator({
        config,
        projectRoot: '/project',
      });
      const path = orchestrator.getOutputPath('/project/src/app.py');

      expect(path).toBe('/project/unknit/app.unknit');
    });
  });
});
