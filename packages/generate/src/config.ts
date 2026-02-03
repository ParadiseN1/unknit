// Project configuration loader for unknit
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * Configuration for unknit project.
 * Loaded from .unknit.yaml in the project root.
 */
export interface UnknitConfig {
  /** Internal packages - imports from these are marked as internal */
  internalPackages: string[];
  /** External packages - explicitly mark as external (overrides auto-detection) */
  externalPackages: string[];
  /** Root directory for source files (relative to project root) */
  sourceRoot: string;
  /** Output directory for generated .unknit files (relative to project root) */
  outputRoot: string;
  /** Whether to include source references in generated unknit files */
  includeSourceRefs: boolean;
}

/**
 * Raw configuration from .unknit.yaml file.
 * All fields are optional since file may have partial config.
 */
export interface RawUnknitConfig {
  internalPackages?: string[];
  externalPackages?: string[];
  sourceRoot?: string;
  outputRoot?: string;
  includeSourceRefs?: boolean;
}

/**
 * Default configuration values when no config file exists
 * or when fields are missing from the config file.
 */
export const DEFAULT_CONFIG: UnknitConfig = {
  internalPackages: [],
  externalPackages: [],
  sourceRoot: '.',
  outputRoot: '.',
  includeSourceRefs: true,
};

/**
 * Result of loading configuration
 */
export interface ConfigLoadResult {
  /** The loaded configuration (with defaults applied) */
  config: UnknitConfig;
  /** Path to the config file (if found) */
  configPath?: string;
  /** Whether the config file was found and loaded */
  loaded: boolean;
}

/**
 * Configuration file name
 */
export const CONFIG_FILE_NAME = '.unknit.yaml';

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
 * Merge raw config with defaults to produce complete config
 */
export function mergeWithDefaults(raw: RawUnknitConfig): UnknitConfig {
  return {
    internalPackages: raw.internalPackages ?? DEFAULT_CONFIG.internalPackages,
    externalPackages: raw.externalPackages ?? DEFAULT_CONFIG.externalPackages,
    sourceRoot: raw.sourceRoot ?? DEFAULT_CONFIG.sourceRoot,
    outputRoot: raw.outputRoot ?? DEFAULT_CONFIG.outputRoot,
    includeSourceRefs: raw.includeSourceRefs ?? DEFAULT_CONFIG.includeSourceRefs,
  };
}

/**
 * Parse YAML content into raw config
 */
export function parseConfigContent(content: string): RawUnknitConfig {
  const parsed = parseYaml(content) as unknown;

  // Handle empty file or null
  if (parsed === null || parsed === undefined) {
    return {};
  }

  // Validate that parsed content is an object
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError('Config file must contain a YAML object');
  }

  const obj = parsed as Record<string, unknown>;
  const raw: RawUnknitConfig = {};

  // Validate and extract internalPackages
  if ('internalPackages' in obj) {
    if (!Array.isArray(obj.internalPackages)) {
      throw new ConfigError('internalPackages must be an array');
    }
    if (!obj.internalPackages.every((p): p is string => typeof p === 'string')) {
      throw new ConfigError('internalPackages must contain only strings');
    }
    raw.internalPackages = obj.internalPackages;
  }

  // Validate and extract externalPackages
  if ('externalPackages' in obj) {
    if (!Array.isArray(obj.externalPackages)) {
      throw new ConfigError('externalPackages must be an array');
    }
    if (!obj.externalPackages.every((p): p is string => typeof p === 'string')) {
      throw new ConfigError('externalPackages must contain only strings');
    }
    raw.externalPackages = obj.externalPackages;
  }

  // Validate and extract sourceRoot
  if ('sourceRoot' in obj) {
    if (typeof obj.sourceRoot !== 'string') {
      throw new ConfigError('sourceRoot must be a string');
    }
    raw.sourceRoot = obj.sourceRoot;
  }

  // Validate and extract outputRoot
  if ('outputRoot' in obj) {
    if (typeof obj.outputRoot !== 'string') {
      throw new ConfigError('outputRoot must be a string');
    }
    raw.outputRoot = obj.outputRoot;
  }

  // Validate and extract includeSourceRefs
  if ('includeSourceRefs' in obj) {
    if (typeof obj.includeSourceRefs !== 'boolean') {
      throw new ConfigError('includeSourceRefs must be a boolean');
    }
    raw.includeSourceRefs = obj.includeSourceRefs;
  }

  return raw;
}

/**
 * Error thrown when configuration loading fails
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Load project configuration from .unknit.yaml file.
 *
 * @param projectRoot - Root directory to search for .unknit.yaml
 * @returns ConfigLoadResult with config and metadata
 */
export async function loadConfig(projectRoot: string): Promise<ConfigLoadResult> {
  const configPath = join(projectRoot, CONFIG_FILE_NAME);

  // Check if config file exists
  const exists = await fileExists(configPath);
  if (!exists) {
    return {
      config: { ...DEFAULT_CONFIG },
      configPath: undefined,
      loaded: false,
    };
  }

  // Read and parse config file
  const content = await readFile(configPath, 'utf-8');
  const raw = parseConfigContent(content);
  const config = mergeWithDefaults(raw);

  return {
    config,
    configPath,
    loaded: true,
  };
}

/**
 * ConfigLoader class for object-oriented access to configuration loading.
 */
export class ConfigLoader {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Load configuration from .unknit.yaml in the project root
   */
  async load(): Promise<ConfigLoadResult> {
    return loadConfig(this.projectRoot);
  }

  /**
   * Get the expected config file path
   */
  getConfigPath(): string {
    return join(this.projectRoot, CONFIG_FILE_NAME);
  }

  /**
   * Check if config file exists
   */
  async exists(): Promise<boolean> {
    return fileExists(this.getConfigPath());
  }
}
