import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadConfig,
  ConfigLoader,
  parseConfigContent,
  mergeWithDefaults,
  DEFAULT_CONFIG,
  CONFIG_FILE_NAME,
  ConfigError,
  type RawUnknitConfig,
} from './config.js';

describe('parseConfigContent', () => {
  it('parses empty content as empty config', () => {
    const raw = parseConfigContent('');
    expect(raw).toEqual({});
  });

  it('parses null content as empty config', () => {
    const raw = parseConfigContent('null');
    expect(raw).toEqual({});
  });

  it('parses internalPackages array', () => {
    const content = `
internalPackages:
  - "@myorg/utils"
  - "@myorg/core"
`;
    const raw = parseConfigContent(content);
    expect(raw.internalPackages).toEqual(['@myorg/utils', '@myorg/core']);
  });

  it('parses externalPackages array', () => {
    const content = `
externalPackages:
  - lodash
  - express
`;
    const raw = parseConfigContent(content);
    expect(raw.externalPackages).toEqual(['lodash', 'express']);
  });

  it('parses sourceRoot string', () => {
    const content = 'sourceRoot: src';
    const raw = parseConfigContent(content);
    expect(raw.sourceRoot).toBe('src');
  });

  it('parses outputRoot string', () => {
    const content = 'outputRoot: docs/unknit';
    const raw = parseConfigContent(content);
    expect(raw.outputRoot).toBe('docs/unknit');
  });

  it('parses includeSourceRefs boolean true', () => {
    const content = 'includeSourceRefs: true';
    const raw = parseConfigContent(content);
    expect(raw.includeSourceRefs).toBe(true);
  });

  it('parses includeSourceRefs boolean false', () => {
    const content = 'includeSourceRefs: false';
    const raw = parseConfigContent(content);
    expect(raw.includeSourceRefs).toBe(false);
  });

  it('parses complete config', () => {
    const content = `
internalPackages:
  - "@app/core"
externalPackages:
  - lodash
sourceRoot: src
outputRoot: docs
includeSourceRefs: false
`;
    const raw = parseConfigContent(content);
    expect(raw).toEqual({
      internalPackages: ['@app/core'],
      externalPackages: ['lodash'],
      sourceRoot: 'src',
      outputRoot: 'docs',
      includeSourceRefs: false,
    });
  });

  it('throws ConfigError for array at root', () => {
    const content = '- item1\n- item2';
    expect(() => parseConfigContent(content)).toThrow(ConfigError);
    expect(() => parseConfigContent(content)).toThrow('Config file must contain a YAML object');
  });

  it('throws ConfigError for non-array internalPackages', () => {
    const content = 'internalPackages: not-an-array';
    expect(() => parseConfigContent(content)).toThrow(ConfigError);
    expect(() => parseConfigContent(content)).toThrow('internalPackages must be an array');
  });

  it('throws ConfigError for internalPackages with non-string items', () => {
    const content = 'internalPackages:\n  - 123\n  - "valid"';
    expect(() => parseConfigContent(content)).toThrow(ConfigError);
    expect(() => parseConfigContent(content)).toThrow('internalPackages must contain only strings');
  });

  it('throws ConfigError for non-array externalPackages', () => {
    const content = 'externalPackages: not-an-array';
    expect(() => parseConfigContent(content)).toThrow(ConfigError);
    expect(() => parseConfigContent(content)).toThrow('externalPackages must be an array');
  });

  it('throws ConfigError for non-string sourceRoot', () => {
    const content = 'sourceRoot: 123';
    expect(() => parseConfigContent(content)).toThrow(ConfigError);
    expect(() => parseConfigContent(content)).toThrow('sourceRoot must be a string');
  });

  it('throws ConfigError for non-string outputRoot', () => {
    const content = 'outputRoot: ["array"]';
    expect(() => parseConfigContent(content)).toThrow(ConfigError);
    expect(() => parseConfigContent(content)).toThrow('outputRoot must be a string');
  });

  it('throws ConfigError for non-boolean includeSourceRefs', () => {
    const content = 'includeSourceRefs: "yes"';
    expect(() => parseConfigContent(content)).toThrow(ConfigError);
    expect(() => parseConfigContent(content)).toThrow('includeSourceRefs must be a boolean');
  });
});

describe('mergeWithDefaults', () => {
  it('returns all defaults for empty raw config', () => {
    const raw: RawUnknitConfig = {};
    const config = mergeWithDefaults(raw);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('uses provided internalPackages over default', () => {
    const raw: RawUnknitConfig = { internalPackages: ['@my/pkg'] };
    const config = mergeWithDefaults(raw);
    expect(config.internalPackages).toEqual(['@my/pkg']);
    expect(config.externalPackages).toEqual([]);
  });

  it('uses provided externalPackages over default', () => {
    const raw: RawUnknitConfig = { externalPackages: ['lodash'] };
    const config = mergeWithDefaults(raw);
    expect(config.externalPackages).toEqual(['lodash']);
  });

  it('uses provided sourceRoot over default', () => {
    const raw: RawUnknitConfig = { sourceRoot: 'lib' };
    const config = mergeWithDefaults(raw);
    expect(config.sourceRoot).toBe('lib');
  });

  it('uses provided outputRoot over default', () => {
    const raw: RawUnknitConfig = { outputRoot: 'output' };
    const config = mergeWithDefaults(raw);
    expect(config.outputRoot).toBe('output');
  });

  it('uses provided includeSourceRefs over default', () => {
    const raw: RawUnknitConfig = { includeSourceRefs: false };
    const config = mergeWithDefaults(raw);
    expect(config.includeSourceRefs).toBe(false);
  });

  it('merges partial config with defaults', () => {
    const raw: RawUnknitConfig = {
      internalPackages: ['@app/core'],
      sourceRoot: 'src',
    };
    const config = mergeWithDefaults(raw);
    expect(config).toEqual({
      internalPackages: ['@app/core'],
      externalPackages: [],
      sourceRoot: 'src',
      outputRoot: '.',
      includeSourceRefs: true,
    });
  });
});

describe('DEFAULT_CONFIG', () => {
  it('has empty internalPackages array', () => {
    expect(DEFAULT_CONFIG.internalPackages).toEqual([]);
  });

  it('has empty externalPackages array', () => {
    expect(DEFAULT_CONFIG.externalPackages).toEqual([]);
  });

  it('has "." as sourceRoot', () => {
    expect(DEFAULT_CONFIG.sourceRoot).toBe('.');
  });

  it('has "." as outputRoot', () => {
    expect(DEFAULT_CONFIG.outputRoot).toBe('.');
  });

  it('has true for includeSourceRefs', () => {
    expect(DEFAULT_CONFIG.includeSourceRefs).toBe(true);
  });
});

describe('CONFIG_FILE_NAME', () => {
  it('is .unknit.yaml', () => {
    expect(CONFIG_FILE_NAME).toBe('.unknit.yaml');
  });
});

describe('loadConfig', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `unknit-config-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns defaults when config file does not exist', async () => {
    const emptyDir = join(testDir, 'empty');
    await mkdir(emptyDir, { recursive: true });

    const result = await loadConfig(emptyDir);
    expect(result.loaded).toBe(false);
    expect(result.configPath).toBeUndefined();
    expect(result.config).toEqual(DEFAULT_CONFIG);
  });

  it('loads config from .unknit.yaml file', async () => {
    const projectDir = join(testDir, 'with-config');
    await mkdir(projectDir, { recursive: true });

    const configContent = `
internalPackages:
  - "@myapp/core"
  - "@myapp/utils"
sourceRoot: src
`;
    await writeFile(join(projectDir, '.unknit.yaml'), configContent);

    const result = await loadConfig(projectDir);
    expect(result.loaded).toBe(true);
    expect(result.configPath).toBe(join(projectDir, '.unknit.yaml'));
    expect(result.config.internalPackages).toEqual(['@myapp/core', '@myapp/utils']);
    expect(result.config.sourceRoot).toBe('src');
    expect(result.config.externalPackages).toEqual([]); // default
  });

  it('loads empty config file with defaults', async () => {
    const projectDir = join(testDir, 'empty-config');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, '.unknit.yaml'), '');

    const result = await loadConfig(projectDir);
    expect(result.loaded).toBe(true);
    expect(result.config).toEqual(DEFAULT_CONFIG);
  });

  it('loads complete config file', async () => {
    const projectDir = join(testDir, 'complete-config');
    await mkdir(projectDir, { recursive: true });

    const configContent = `
internalPackages:
  - "@app/core"
externalPackages:
  - lodash
  - express
sourceRoot: packages
outputRoot: docs/api
includeSourceRefs: false
`;
    await writeFile(join(projectDir, '.unknit.yaml'), configContent);

    const result = await loadConfig(projectDir);
    expect(result.loaded).toBe(true);
    expect(result.config).toEqual({
      internalPackages: ['@app/core'],
      externalPackages: ['lodash', 'express'],
      sourceRoot: 'packages',
      outputRoot: 'docs/api',
      includeSourceRefs: false,
    });
  });
});

describe('ConfigLoader', () => {
  let testDir: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `unknit-loader-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('getConfigPath returns expected path', () => {
    const loader = new ConfigLoader('/my/project');
    expect(loader.getConfigPath()).toBe('/my/project/.unknit.yaml');
  });

  it('exists returns false when config does not exist', async () => {
    const emptyDir = join(testDir, 'no-config');
    await mkdir(emptyDir, { recursive: true });

    const loader = new ConfigLoader(emptyDir);
    expect(await loader.exists()).toBe(false);
  });

  it('exists returns true when config exists', async () => {
    const projectDir = join(testDir, 'has-config');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, '.unknit.yaml'), 'sourceRoot: src');

    const loader = new ConfigLoader(projectDir);
    expect(await loader.exists()).toBe(true);
  });

  it('load returns defaults when config does not exist', async () => {
    const emptyDir = join(testDir, 'loader-empty');
    await mkdir(emptyDir, { recursive: true });

    const loader = new ConfigLoader(emptyDir);
    const result = await loader.load();
    expect(result.loaded).toBe(false);
    expect(result.config).toEqual(DEFAULT_CONFIG);
  });

  it('load returns parsed config when file exists', async () => {
    const projectDir = join(testDir, 'loader-config');
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, '.unknit.yaml'),
      'internalPackages:\n  - "@my/pkg"'
    );

    const loader = new ConfigLoader(projectDir);
    const result = await loader.load();
    expect(result.loaded).toBe(true);
    expect(result.config.internalPackages).toEqual(['@my/pkg']);
  });
});

describe('ConfigError', () => {
  it('has correct name', () => {
    const error = new ConfigError('test message');
    expect(error.name).toBe('ConfigError');
  });

  it('has correct message', () => {
    const error = new ConfigError('test message');
    expect(error.message).toBe('test message');
  });

  it('is instanceof Error', () => {
    const error = new ConfigError('test');
    expect(error).toBeInstanceOf(Error);
  });
});
