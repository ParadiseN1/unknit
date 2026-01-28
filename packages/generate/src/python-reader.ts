// Python source code reader for unknit
// Extracts function boundaries and import statements from Python source files

import { readFile } from 'node:fs/promises';
import type { CodeMetadata, FunctionBoundary, ImportStatement } from './types.js';
import type { UnknitConfig } from './config.js';

// Re-export types for convenience
export type { FunctionBoundary, ImportStatement };

/**
 * Options for reading Python source files
 */
export interface PythonReaderOptions {
  /** Internal packages for import classification */
  internalPackages: string[];
  /** External packages (overrides internal) */
  externalPackages: string[];
}

/**
 * Read and parse a Python source file, extracting metadata for LLM context.
 *
 * @param filePath - Path to the Python source file
 * @param options - Reader options with package classification config
 * @returns CodeMetadata with functions and imports
 */
export async function readPythonSource(
  filePath: string,
  options: PythonReaderOptions
): Promise<CodeMetadata> {
  const content = await readFile(filePath, 'utf-8');
  return parsePythonSource(filePath, content, options);
}

/**
 * Parse Python source content and extract metadata.
 * This is exposed separately for testing without file I/O.
 *
 * @param filePath - Path to the source file (for metadata)
 * @param content - Python source code content
 * @param options - Reader options with package classification config
 * @returns CodeMetadata with functions and imports
 */
export function parsePythonSource(
  filePath: string,
  content: string,
  options: PythonReaderOptions
): CodeMetadata {
  const lines = content.split('\n');
  const functions = extractFunctionBoundaries(lines);
  const imports = extractImportStatements(lines, options);

  return {
    filePath,
    language: 'python',
    functions,
    imports,
  };
}

/**
 * Extract function boundaries from Python source lines.
 * Finds def statements and calculates their end lines based on indentation.
 *
 * @param lines - Array of source code lines
 * @returns Array of FunctionBoundary objects
 */
export function extractFunctionBoundaries(lines: string[]): FunctionBoundary[] {
  const functions: FunctionBoundary[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const defMatch = matchFunctionDefinition(line);

    if (defMatch) {
      const startLine = i + 1; // 1-indexed
      const baseIndent = getIndentation(line);

      // Find the end of the function by tracking indentation
      let endLine = startLine;

      // Look for the function body and subsequent lines
      for (let j = i + 1; j < lines.length; j++) {
        const bodyLine = lines[j] ?? '';

        // Skip empty lines and comments when looking for body end
        if (isBlankOrComment(bodyLine)) {
          // Empty lines inside function body are okay
          continue;
        }

        const bodyIndent = getIndentation(bodyLine);

        // Function ends when we find a line with same or less indentation
        // that isn't blank/comment
        if (bodyIndent <= baseIndent) {
          break;
        }

        // This line is part of the function body
        endLine = j + 1; // 1-indexed
      }

      functions.push({
        name: defMatch.name,
        startLine,
        endLine,
        params: defMatch.params,
        returnType: defMatch.returnType,
      });
    }
  }

  return functions;
}

/**
 * Match a Python function definition line.
 *
 * Handles:
 * - def name():
 * - def name(param1, param2):
 * - def name(param1: type, param2: type) -> ReturnType:
 * - async def name():
 *
 * @param line - Source code line to match
 * @returns Matched function info or null
 */
export function matchFunctionDefinition(
  line: string
): { name: string; params: string[]; returnType?: string } | null {
  // Match async def or def followed by function name and parameters
  const defRegex = /^(\s*)(async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*:/;
  const match = line.match(defRegex);

  if (!match) {
    return null;
  }

  const name = match[3] ?? '';
  const paramsRaw = match[4] ?? '';
  const returnType = match[5]?.trim();

  // Parse parameters
  const params = parseParameters(paramsRaw);

  return {
    name,
    params,
    returnType: returnType || undefined,
  };
}

/**
 * Parse Python function parameter string into array of parameter names.
 *
 * Handles:
 * - Simple params: "a, b, c"
 * - Typed params: "a: int, b: str"
 * - Default values: "a=1, b='hello'"
 * - *args and **kwargs
 * - Self/cls for methods
 *
 * @param paramsRaw - Raw parameter string from function definition
 * @returns Array of parameter names
 */
export function parseParameters(paramsRaw: string): string[] {
  if (!paramsRaw.trim()) {
    return [];
  }

  const params: string[] = [];
  let current = '';
  let depth = 0; // Track nested brackets for type annotations

  for (const char of paramsRaw) {
    if (char === '(' || char === '[' || char === '{') {
      depth++;
      current += char;
    } else if (char === ')' || char === ']' || char === '}') {
      depth--;
      current += char;
    } else if (char === ',' && depth === 0) {
      // End of parameter
      const param = extractParamName(current);
      if (param) {
        params.push(param);
      }
      current = '';
    } else {
      current += char;
    }
  }

  // Don't forget the last parameter
  if (current.trim()) {
    const param = extractParamName(current);
    if (param) {
      params.push(param);
    }
  }

  return params;
}

/**
 * Extract the parameter name from a parameter definition.
 * Strips type annotations and default values.
 *
 * @param paramDef - Parameter definition string (e.g., "x: int = 0")
 * @returns Parameter name (e.g., "x")
 */
function extractParamName(paramDef: string): string | null {
  const trimmed = paramDef.trim();
  if (!trimmed) {
    return null;
  }

  // Handle *args and **kwargs
  if (trimmed.startsWith('**')) {
    return '**' + (trimmed.slice(2).split(':')[0]?.split('=')[0]?.trim() ?? '');
  }
  if (trimmed.startsWith('*')) {
    const rest = trimmed.slice(1).trim();
    // Standalone * for keyword-only separator
    if (!rest) {
      return null;
    }
    return '*' + (rest.split(':')[0]?.split('=')[0]?.trim() ?? '');
  }

  // Regular parameter - extract name before : or =
  const colonIdx = trimmed.indexOf(':');
  const eqIdx = trimmed.indexOf('=');

  let name: string;
  if (colonIdx >= 0 && (eqIdx < 0 || colonIdx < eqIdx)) {
    name = trimmed.slice(0, colonIdx).trim();
  } else if (eqIdx >= 0) {
    name = trimmed.slice(0, eqIdx).trim();
  } else {
    name = trimmed;
  }

  return name || null;
}

/**
 * Get the indentation level (number of leading spaces/tabs) of a line.
 * Tabs are counted as 4 spaces.
 *
 * @param line - Source code line
 * @returns Indentation level
 */
export function getIndentation(line: string): number {
  let indent = 0;
  for (const char of line) {
    if (char === ' ') {
      indent++;
    } else if (char === '\t') {
      indent += 4;
    } else {
      break;
    }
  }
  return indent;
}

/**
 * Check if a line is blank or a comment.
 *
 * @param line - Source code line
 * @returns True if line is blank or a comment
 */
export function isBlankOrComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('#');
}

/**
 * Extract import statements from Python source lines.
 *
 * Handles:
 * - import module
 * - import module as alias
 * - from module import name
 * - from module import name as alias
 * - from . import relative
 * - from ..module import name
 *
 * @param lines - Array of source code lines
 * @param options - Reader options for import classification
 * @returns Array of ImportStatement objects
 */
export function extractImportStatements(
  lines: string[],
  options: PythonReaderOptions
): ImportStatement[] {
  const imports: ImportStatement[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const importInfo = parseImportLine(line);

    if (importInfo) {
      for (const module of importInfo.modules) {
        imports.push({
          raw: line.trim(),
          module,
          isInternal: classifyImport(module, options),
          line: i + 1, // 1-indexed
        });
      }
    }
  }

  return imports;
}

/**
 * Result of parsing an import line
 */
interface ImportParseResult {
  modules: string[];
}

/**
 * Parse a single import line to extract module names.
 *
 * @param line - Source code line
 * @returns Import parse result or null if not an import
 */
export function parseImportLine(line: string): ImportParseResult | null {
  const trimmed = line.trim();

  // Skip comments and empty lines
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  // Handle "import module" and "import module as alias"
  const importMatch = trimmed.match(/^import\s+(.+)$/);
  if (importMatch) {
    const importsPart = importMatch[1] ?? '';
    const modules = parseImportModules(importsPart);
    return modules.length > 0 ? { modules } : null;
  }

  // Handle "from module import ..."
  const fromMatch = trimmed.match(/^from\s+([^\s]+)\s+import\s+/);
  if (fromMatch) {
    const module = fromMatch[1] ?? '';
    return module ? { modules: [module] } : null;
  }

  return null;
}

/**
 * Parse the modules part of an import statement.
 * Handles "import a, b, c" and "import a as x, b as y"
 *
 * @param importsPart - The part after "import "
 * @returns Array of module names
 */
function parseImportModules(importsPart: string): string[] {
  const modules: string[] = [];

  // Split by comma for multiple imports
  const parts = importsPart.split(',');

  for (const part of parts) {
    // Remove "as alias" part if present
    const asIdx = part.indexOf(' as ');
    const modulePart = asIdx >= 0 ? part.slice(0, asIdx) : part;
    const module = modulePart.trim();

    if (module) {
      modules.push(module);
    }
  }

  return modules;
}

/**
 * Classify an import as internal or external.
 *
 * An import is internal if:
 * - It starts with a relative import marker (.)
 * - It matches an internal package name
 * - It is a submodule of an internal package
 *
 * An import is external if:
 * - It matches an external package name (explicit override)
 * - It's a standard library or third-party package
 *
 * @param module - Module name from import statement
 * @param options - Reader options with package lists
 * @returns True if import is internal, false if external
 */
export function classifyImport(module: string, options: PythonReaderOptions): boolean {
  // Relative imports are always internal
  if (module.startsWith('.')) {
    return true;
  }

  // Check external packages first (explicit override)
  const baseModule = module.split('.')[0] ?? module;
  for (const pkg of options.externalPackages) {
    if (baseModule === pkg || module.startsWith(pkg + '.')) {
      return false;
    }
  }

  // Check internal packages
  for (const pkg of options.internalPackages) {
    if (baseModule === pkg || module.startsWith(pkg + '.')) {
      return true;
    }
  }

  // Default to external for unknown packages
  return false;
}

/**
 * Create reader options from UnknitConfig
 *
 * @param config - Unknit configuration
 * @returns PythonReaderOptions
 */
export function createPythonReaderOptions(config: UnknitConfig): PythonReaderOptions {
  return {
    internalPackages: config.internalPackages,
    externalPackages: config.externalPackages,
  };
}

/**
 * PythonReader class for object-oriented access to Python source reading.
 */
export class PythonReader {
  private options: PythonReaderOptions;

  constructor(options: PythonReaderOptions) {
    this.options = options;
  }

  /**
   * Create a PythonReader from UnknitConfig
   */
  static fromConfig(config: UnknitConfig): PythonReader {
    return new PythonReader(createPythonReaderOptions(config));
  }

  /**
   * Read a Python source file and extract metadata
   */
  async read(filePath: string): Promise<CodeMetadata> {
    return readPythonSource(filePath, this.options);
  }

  /**
   * Parse Python source content (for testing without file I/O)
   */
  parse(filePath: string, content: string): CodeMetadata {
    return parsePythonSource(filePath, content, this.options);
  }

  /**
   * Extract function boundaries from content
   */
  extractFunctions(content: string): FunctionBoundary[] {
    const lines = content.split('\n');
    return extractFunctionBoundaries(lines);
  }

  /**
   * Extract import statements from content
   */
  extractImports(content: string): ImportStatement[] {
    const lines = content.split('\n');
    return extractImportStatements(lines, this.options);
  }
}
