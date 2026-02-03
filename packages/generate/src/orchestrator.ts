// Generation orchestrator for unknit
// End-to-end generator that creates unknit files from source code

import { readFile, writeFile, access } from 'node:fs/promises';
import { join, dirname, basename, extname, relative } from 'node:path';
import { parseFunctionsWithRecovery, validateNodes } from '@unknit/core';
import { loadConfig, mergeWithDefaults, type UnknitConfig } from './config.js';
import { detectPackages, mergePackages } from './package-detector.js';
import { readPythonSource } from './python-reader.js';
import { readTypeScriptSource } from './typescript-reader.js';
import { LLMClient, type LLMClientOptions } from './llm-client.js';
import type { PromptBuilderOptions } from './prompt-builder.js';
import type { CodeMetadata, GenerationResult, GenerationError } from './types.js';

// Re-export types for convenience
export type { CodeMetadata, GenerationResult, GenerationError };

/**
 * Options for the generation orchestrator
 */
export interface OrchestratorOptions extends LLMClientOptions, PromptBuilderOptions {
  /** Project root directory (for config loading) */
  projectRoot?: string;
  /** Explicitly provided config (skips loading from file) */
  config?: UnknitConfig;
  /** Whether to write output file (default: true) */
  writeOutput?: boolean;
  /** Custom output path (overrides default path calculation) */
  outputPath?: string;
  /** Whether to validate generated unknit (default: true) */
  validate?: boolean;
  /** Base path for source file validation (defaults to source file directory) */
  validationBasePath?: string;
}

/**
 * Supported source file extensions
 */
const PYTHON_EXTENSIONS = ['.py'];
const TYPESCRIPT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Check if a file path has a Python extension
 */
function isPythonFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return PYTHON_EXTENSIONS.includes(ext);
}

/**
 * Check if a file path has a TypeScript/JavaScript extension
 */
function isTypeScriptFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return TYPESCRIPT_EXTENSIONS.includes(ext);
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
 * Calculate the output path for a .unknit file
 */
export function getOutputPath(
  sourceFilePath: string,
  config: UnknitConfig,
  projectRoot?: string
): string {
  const dir = dirname(sourceFilePath);
  const baseName = basename(sourceFilePath, extname(sourceFilePath));

  // If outputRoot is different from sourceRoot, calculate relative path
  if (projectRoot && config.outputRoot !== config.sourceRoot) {
    const sourceDir = join(projectRoot, config.sourceRoot);
    const outputDir = join(projectRoot, config.outputRoot);

    // Get relative path from sourceRoot to source file directory
    const relPath = relative(sourceDir, dir);

    // Only use outputRoot if the source file is under sourceRoot
    if (!relPath.startsWith('..')) {
      return join(outputDir, relPath, `${baseName}.unknit`);
    }
  }

  // Default: put .unknit alongside source file
  return join(dir, `${baseName}.unknit`);
}

/**
 * Load configuration with auto-detection of packages
 */
async function loadConfigWithPackageDetection(projectRoot: string): Promise<UnknitConfig> {
  // Load base config from file
  const configResult = await loadConfig(projectRoot);
  const baseConfig = configResult.config;

  // Detect packages from project manifests
  const detection = await detectPackages(projectRoot);

  // Merge detected packages with configured ones
  const merged = mergePackages(detection.detectedPackages, baseConfig.internalPackages);

  // Return full config with merged internal packages
  return {
    ...baseConfig,
    internalPackages: merged.internalPackages,
  };
}

/**
 * Read source file and extract metadata based on file type
 */
async function readSourceMetadata(
  filePath: string,
  config: UnknitConfig
): Promise<CodeMetadata> {
  const readerOptions = {
    internalPackages: config.internalPackages,
    externalPackages: config.externalPackages,
  };

  if (isPythonFile(filePath)) {
    return readPythonSource(filePath, readerOptions);
  }

  if (isTypeScriptFile(filePath)) {
    return readTypeScriptSource(filePath, readerOptions);
  }

  // For unsupported file types, return basic metadata
  return {
    filePath,
    language: 'javascript',
    functions: [],
    imports: [],
  };
}

/**
 * Generate unknit file from source code.
 *
 * This is the main orchestration function that:
 * 1. Loads project configuration
 * 2. Reads source file and extracts metadata
 * 3. Calls LLM to generate unknit content
 * 4. Parses and validates the generated unknit
 * 5. Writes the .unknit file alongside the source
 *
 * @param sourceFilePath - Path to the source file to process
 * @param options - Orchestrator options
 * @returns GenerationResult with success status and any errors
 */
export async function generate(
  sourceFilePath: string,
  options: OrchestratorOptions = {}
): Promise<GenerationResult> {
  const errors: GenerationError[] = [];

  // 1. Validate source file exists
  if (!(await fileExists(sourceFilePath))) {
    return {
      success: false,
      errors: [{
        code: 'SOURCE_NOT_FOUND',
        message: `Source file not found: ${sourceFilePath}`,
      }],
    };
  }

  // 2. Validate source file type
  if (!isPythonFile(sourceFilePath) && !isTypeScriptFile(sourceFilePath)) {
    return {
      success: false,
      errors: [{
        code: 'UNSUPPORTED_FILE_TYPE',
        message: `Unsupported file type: ${extname(sourceFilePath)}. Supported: ${[...PYTHON_EXTENSIONS, ...TYPESCRIPT_EXTENSIONS].join(', ')}`,
      }],
    };
  }

  // 3. Load configuration
  const projectRoot = options.projectRoot ?? dirname(sourceFilePath);
  let config: UnknitConfig;

  if (options.config) {
    config = options.config;
  } else {
    try {
      config = await loadConfigWithPackageDetection(projectRoot);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown config error';
      return {
        success: false,
        errors: [{
          code: 'CONFIG_ERROR',
          message: `Failed to load configuration: ${message}`,
          details: err,
        }],
      };
    }
  }

  // 4. Read source file and extract metadata
  let sourceCode: string;
  let metadata: CodeMetadata;

  try {
    sourceCode = await readFile(sourceFilePath, 'utf-8');
    metadata = await readSourceMetadata(sourceFilePath, config);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown read error';
    return {
      success: false,
      errors: [{
        code: 'READ_ERROR',
        message: `Failed to read source file: ${message}`,
        details: err,
      }],
    };
  }

  // 5. Call LLM to generate unknit content
  const llmClient = new LLMClient({
    projectId: options.projectId,
    location: options.location,
    model: options.model,
    maxTokens: options.maxTokens,
    maxRetries: options.maxRetries,
    timeout: options.timeout,
  });

  const promptOptions: PromptBuilderOptions = {
    includeSourceRefs: options.includeSourceRefs ?? config.includeSourceRefs,
    additionalContext: options.additionalContext,
  };

  const llmResult = await llmClient.generate(sourceCode, metadata, promptOptions);

  if (!llmResult.success || !llmResult.content) {
    return {
      success: false,
      errors: [{
        code: llmResult.error?.code ?? 'LLM_ERROR',
        message: llmResult.error?.message ?? 'LLM generation failed',
        details: llmResult.error,
      }],
    };
  }

  const generatedContent = llmResult.content;

  // 6. Parse and validate the generated unknit
  const shouldValidate = options.validate !== false;

  if (shouldValidate) {
    try {
      const parseResult = parseFunctionsWithRecovery(generatedContent);

      if (!parseResult.success || parseResult.errors.length > 0) {
        for (const parseError of parseResult.errors) {
          errors.push({
            code: 'PARSE_ERROR',
            message: `Parse error at line ${parseError.line}: ${parseError.message}`,
            details: parseError,
          });
        }
      }

      // Validate source references if parsing was successful
      if (parseResult.nodes.length > 0) {
        const validationBasePath = options.validationBasePath ?? dirname(sourceFilePath);
        const validationResult = await validateNodes(parseResult.nodes, {
          basePath: validationBasePath,
        });

        for (const diagnostic of validationResult.diagnostics) {
          if (diagnostic.severity === 'error') {
            errors.push({
              code: 'VALIDATION_ERROR',
              message: diagnostic.message,
              details: diagnostic,
            });
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown parse error';
      errors.push({
        code: 'PARSE_ERROR',
        message: `Failed to parse generated unknit: ${message}`,
        details: err,
      });
    }
  }

  // 7. Calculate output path
  const outputPath = options.outputPath ?? getOutputPath(sourceFilePath, config, projectRoot);

  // 8. Write output file
  const shouldWrite = options.writeOutput !== false;

  if (shouldWrite) {
    try {
      await writeFile(outputPath, generatedContent, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown write error';
      errors.push({
        code: 'WRITE_ERROR',
        message: `Failed to write output file: ${message}`,
        details: err,
      });

      return {
        success: false,
        content: generatedContent,
        errors,
      };
    }
  }

  // Return result
  return {
    success: errors.length === 0,
    content: generatedContent,
    outputPath: shouldWrite ? outputPath : undefined,
    errors,
  };
}

/**
 * Generation orchestrator class for object-oriented access.
 */
export class GenerationOrchestrator {
  private options: OrchestratorOptions;
  private config?: UnknitConfig;

  constructor(options: OrchestratorOptions = {}) {
    this.options = options;
    if (options.config) {
      this.config = options.config;
    }
  }

  /**
   * Load or reload project configuration
   */
  async loadConfig(projectRoot?: string): Promise<UnknitConfig> {
    const root = projectRoot ?? this.options.projectRoot;
    if (!root) {
      throw new Error('Project root not specified');
    }

    this.config = await loadConfigWithPackageDetection(root);
    return this.config;
  }

  /**
   * Get the current configuration
   */
  getConfig(): UnknitConfig | undefined {
    return this.config;
  }

  /**
   * Generate unknit file from source code
   */
  async generate(
    sourceFilePath: string,
    overrideOptions: Partial<OrchestratorOptions> = {}
  ): Promise<GenerationResult> {
    const mergedOptions: OrchestratorOptions = {
      ...this.options,
      ...overrideOptions,
      config: overrideOptions.config ?? this.config ?? this.options.config,
    };

    return generate(sourceFilePath, mergedOptions);
  }

  /**
   * Generate unknit files for multiple source files
   */
  async generateBatch(
    sourceFilePaths: string[],
    overrideOptions: Partial<OrchestratorOptions> = {}
  ): Promise<Map<string, GenerationResult>> {
    const results = new Map<string, GenerationResult>();

    for (const filePath of sourceFilePaths) {
      const result = await this.generate(filePath, overrideOptions);
      results.set(filePath, result);
    }

    return results;
  }

  /**
   * Check if a file is a supported source file
   */
  isSupported(filePath: string): boolean {
    return isPythonFile(filePath) || isTypeScriptFile(filePath);
  }

  /**
   * Get the output path for a source file
   */
  getOutputPath(sourceFilePath: string, projectRoot?: string): string {
    const config = this.config ?? this.options.config ?? mergeWithDefaults({});
    const root = projectRoot ?? this.options.projectRoot;
    return getOutputPath(sourceFilePath, config, root);
  }
}
