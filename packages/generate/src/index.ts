// @unknit/generate - LLM-based unknit file generation

export const VERSION = '0.0.1';

// Placeholder exports for future implementations

/**
 * Configuration for unknit project
 * Will be loaded from .unknit.yaml
 */
export interface UnknitConfig {
  // Internal packages - imports from these are marked as internal
  internalPackages?: string[];
  // External packages - explicitly mark as external (overrides auto-detection)
  externalPackages?: string[];
}

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
