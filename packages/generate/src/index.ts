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

/**
 * Metadata extracted from source code for LLM context
 */
export interface CodeMetadata {
  // Source file path
  filePath: string;
  // Programming language
  language: 'python' | 'typescript' | 'javascript';
  // Function boundaries extracted from source
  functions: FunctionBoundary[];
  // Import statements
  imports: ImportStatement[];
}

/**
 * Function boundary in source code
 */
export interface FunctionBoundary {
  name: string;
  startLine: number;
  endLine: number;
  params: string[];
  returnType?: string;
}

/**
 * Import statement from source code
 */
export interface ImportStatement {
  // Raw import text
  raw: string;
  // Module being imported
  module: string;
  // Whether this is an internal (workspace) import
  isInternal: boolean;
  // Line number in source
  line: number;
}

/**
 * Result of unknit generation
 */
export interface GenerationResult {
  success: boolean;
  // Generated unknit content (if successful)
  content?: string;
  // Output file path (if written)
  outputPath?: string;
  // Errors encountered during generation
  errors: GenerationError[];
}

/**
 * Error during generation
 */
export interface GenerationError {
  code: string;
  message: string;
  // Optional details for debugging
  details?: unknown;
}
