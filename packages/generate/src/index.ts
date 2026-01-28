// @unknit/generate - LLM-based unknit file generation

export const VERSION = '0.0.1';

// Configuration loader exports
export {
  type UnknitConfig,
  type RawUnknitConfig,
  type ConfigLoadResult,
  DEFAULT_CONFIG,
  CONFIG_FILE_NAME,
  ConfigError,
  ConfigLoader,
  loadConfig,
  parseConfigContent,
  mergeWithDefaults,
} from './config.js';

// Package auto-detection exports
export {
  type PackageDetectionResult,
  type MergedPackagesResult,
  PackageDetector,
  detectPackages,
  detectPythonPackages,
  detectJsPackages,
  mergePackages,
  loadConfigWithAutoDetection,
} from './package-detector.js';

// Python source reader exports
export {
  type PythonReaderOptions,
  PythonReader,
  readPythonSource,
  parsePythonSource,
  extractFunctionBoundaries as extractPythonFunctionBoundaries,
  extractImportStatements as extractPythonImportStatements,
  matchFunctionDefinition,
  parseParameters as parsePythonParameters,
  getIndentation,
  isBlankOrComment,
  parseImportLine as parsePythonImportLine,
  classifyImport as classifyPythonImport,
  createPythonReaderOptions,
} from './python-reader.js';

// TypeScript/JavaScript source reader exports
export {
  type TypeScriptReaderOptions,
  TypeScriptReader,
  readTypeScriptSource,
  parseTypeScriptSource,
  extractFunctionBoundaries as extractTypeScriptFunctionBoundaries,
  extractImportStatements as extractTypeScriptImportStatements,
  matchFunctionStart,
  matchFunctionDeclaration,
  matchArrowFunction,
  matchClassMethod,
  findFunctionEnd,
  countBraces,
  parseParameters as parseTypeScriptParameters,
  parseImportLine as parseTypeScriptImportLine,
  classifyImport as classifyTypeScriptImport,
  createTypeScriptReaderOptions,
  getLanguageFromPath,
} from './typescript-reader.js';

// LLM prompt builder exports
export {
  type PromptBuilderOptions,
  type BuiltPrompts,
  UNKNIT_SPEC_CONDENSED,
  GENERATION_RULES,
  FEW_SHOT_EXAMPLES,
  SOURCE_REF_INSTRUCTIONS,
  PromptBuilder,
  buildSystemPrompt,
  buildUserPrompt,
  buildPrompts,
  formatFunctionBoundaries,
  formatImportStatements,
} from './prompt-builder.js';

// LLM client exports
export {
  type LLMClientOptions,
  type LLMGenerationResult,
  type LLMGenerationError,
  LLMClient,
  generateUnknit,
} from './llm-client.js';

// Generation orchestrator exports
export {
  type OrchestratorOptions,
  GenerationOrchestrator,
  generate,
  getOutputPath,
} from './orchestrator.js';

// Shared type exports
export type {
  FunctionBoundary,
  ImportStatement,
  CodeMetadata,
  GenerationResult,
  GenerationError,
} from './types.js';
