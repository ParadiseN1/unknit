// TypeScript/JavaScript source code reader for unknit
// Extracts function boundaries and import statements from TS/JS source files

import { readFile } from 'node:fs/promises';
import type { CodeMetadata, FunctionBoundary, ImportStatement } from './types.js';
import type { UnknitConfig } from './config.js';

/**
 * Options for reading TypeScript/JavaScript source files
 */
export interface TypeScriptReaderOptions {
  /** Internal packages for import classification */
  internalPackages: string[];
  /** External packages (overrides internal) */
  externalPackages: string[];
}

/**
 * Read and parse a TypeScript/JavaScript source file, extracting metadata for LLM context.
 *
 * @param filePath - Path to the source file (.ts, .js, .tsx, .jsx)
 * @param options - Reader options with package classification config
 * @returns CodeMetadata with functions and imports
 */
export async function readTypeScriptSource(
  filePath: string,
  options: TypeScriptReaderOptions
): Promise<CodeMetadata> {
  const content = await readFile(filePath, 'utf-8');
  return parseTypeScriptSource(filePath, content, options);
}

/**
 * Parse TypeScript/JavaScript source content and extract metadata.
 * This is exposed separately for testing without file I/O.
 *
 * @param filePath - Path to the source file (for metadata)
 * @param content - Source code content
 * @param options - Reader options with package classification config
 * @returns CodeMetadata with functions and imports
 */
export function parseTypeScriptSource(
  filePath: string,
  content: string,
  options: TypeScriptReaderOptions
): CodeMetadata {
  const lines = content.split('\n');
  const functions = extractFunctionBoundaries(lines);
  const imports = extractImportStatements(lines, options);

  // Determine language from file extension
  const language = getLanguageFromPath(filePath);

  return {
    filePath,
    language,
    functions,
    imports,
  };
}

/**
 * Get the language type from file path extension.
 *
 * @param filePath - Path to source file
 * @returns 'typescript' or 'javascript'
 */
export function getLanguageFromPath(filePath: string): 'typescript' | 'javascript' {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'ts' || ext === 'tsx') {
    return 'typescript';
  }
  return 'javascript';
}

/**
 * Extract function boundaries from TypeScript/JavaScript source lines.
 * Finds function declarations, arrow functions, and methods.
 *
 * @param lines - Array of source code lines
 * @returns Array of FunctionBoundary objects
 */
export function extractFunctionBoundaries(lines: string[]): FunctionBoundary[] {
  const functions: FunctionBoundary[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const match = matchFunctionStart(line, i, lines);

    if (match) {
      const startLine = i + 1; // 1-indexed
      const endLine = findFunctionEnd(lines, i, match.openBraceOffset);

      functions.push({
        name: match.name,
        startLine,
        endLine,
        params: match.params,
        returnType: match.returnType,
      });

      // Move past this function
      i = endLine; // endLine is 1-indexed, so endLine - 1 + 1 = endLine as index
    } else {
      i++;
    }
  }

  return functions;
}

/**
 * Information about a matched function start
 */
interface FunctionMatch {
  name: string;
  params: string[];
  returnType?: string;
  /** Number of lines from current position where the opening brace is */
  openBraceOffset: number;
}

/**
 * Match various function declaration patterns in TypeScript/JavaScript.
 *
 * Handles:
 * - function declarations: function name(params) { ... }
 * - async function: async function name(params) { ... }
 * - arrow functions: const name = (params) => { ... }
 * - async arrow functions: const name = async (params) => { ... }
 * - methods: name(params) { ... }
 * - async methods: async name(params) { ... }
 * - class methods with modifiers: public async name(params) { ... }
 * - export function: export function name(params) { ... }
 * - export default function: export default function name(params) { ... }
 *
 * @param line - Current source code line
 * @param lineIndex - Current line index in array
 * @param lines - All source lines (for multiline detection)
 * @returns FunctionMatch info or null
 */
export function matchFunctionStart(
  line: string,
  lineIndex: number,
  lines: string[]
): FunctionMatch | null {
  const trimmed = line.trim();

  // Skip comments, empty lines, and imports
  if (
    trimmed === '' ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('import ') ||
    trimmed.startsWith('export type') ||
    trimmed.startsWith('export interface')
  ) {
    return null;
  }

  // Try each pattern in order of specificity
  let match: FunctionMatch | null = null;

  // Function declaration: [export] [default] [async] function name(...)
  match = matchFunctionDeclaration(line);
  if (match) return match;

  // Arrow function: const/let/var name = [async] (...) => ...
  match = matchArrowFunction(line, lineIndex, lines);
  if (match) return match;

  // Class method: [modifiers] [async] name(...) [: returnType] {
  match = matchClassMethod(line, lineIndex, lines);
  if (match) return match;

  return null;
}

/**
 * Match a function declaration.
 * Patterns: [export] [default] [async] function name(params) [: returnType] {
 */
export function matchFunctionDeclaration(line: string): FunctionMatch | null {
  // Regex: optional export, optional default, optional async, function keyword, name, params
  const funcRegex =
    /^(\s*)(export\s+)?(default\s+)?(async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{?/;
  const match = line.match(funcRegex);

  if (!match) {
    return null;
  }

  const name = match[5] ?? '';
  const paramsRaw = match[7] ?? '';
  const returnType = match[8]?.trim();

  // Check if the opening brace is on this line
  const hasBrace = line.includes('{');

  return {
    name,
    params: parseParameters(paramsRaw),
    returnType: returnType || undefined,
    openBraceOffset: hasBrace ? 0 : 1,
  };
}

/**
 * Match an arrow function assignment.
 * Patterns: const/let/var name = [async] (params) => { ... }
 *           const/let/var name = [async] param => { ... }
 *           export const name = [async] (params) => { ... }
 */
export function matchArrowFunction(
  line: string,
  lineIndex: number,
  lines: string[]
): FunctionMatch | null {
  // Basic arrow function pattern
  // const/let/var name = [async] (params) => or param =>
  const arrowRegex =
    /^(\s*)(export\s+)?(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(?::\s*[^=]+)?\s*=\s*(async\s+)?(?:\(([^)]*)\)|([a-zA-Z_$][a-zA-Z0-9_$]*))\s*(?::\s*([^=]+?))?\s*=>/;
  const match = line.match(arrowRegex);

  if (!match) {
    return null;
  }

  const name = match[4] ?? '';
  const paramsRaw = match[6] ?? match[7] ?? ''; // Either (params) or single param
  const returnTypeFromArrow = match[8]?.trim();

  // Check if the opening brace is on this line or next
  let openBraceOffset = 0;
  if (!line.includes('{')) {
    // Arrow function might not have a block body (expression body)
    // Check if there's a { somewhere
    const arrowIdx = line.indexOf('=>');
    const afterArrow = line.slice(arrowIdx + 2).trim();
    if (afterArrow.startsWith('{')) {
      openBraceOffset = 0;
    } else if (afterArrow === '' || afterArrow === '(') {
      // Might be on next line
      const nextLine = lines[lineIndex + 1] ?? '';
      if (nextLine.trim().startsWith('{') || nextLine.includes('{')) {
        openBraceOffset = 1;
      } else {
        // Expression body arrow function - still include it but find its end differently
        openBraceOffset = -1; // Signal that this is expression body
      }
    } else {
      // Expression body arrow function
      openBraceOffset = -1;
    }
  }

  return {
    name,
    params: parseParameters(paramsRaw),
    returnType: returnTypeFromArrow || undefined,
    openBraceOffset,
  };
}

/**
 * Match a class method.
 * Patterns: [public/private/protected] [static] [async] name(params) [: returnType] {
 *           [public/private/protected] [static] [async] get/set name() { ... }
 */
export function matchClassMethod(
  line: string,
  lineIndex: number,
  lines: string[]
): FunctionMatch | null {
  // Class method pattern with optional modifiers
  // Use non-capturing group for modifiers to avoid capture group issues
  // Modifiers: public, private, protected, static, readonly, abstract, override, async
  const methodRegex =
    /^(\s*)(?:(?:public|private|protected|static|readonly|abstract|override|async)\s+)*(get\s+|set\s+)?([a-zA-Z_$][a-zA-Z0-9_$]*)\s*(<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\s*\{?/;
  const match = line.match(methodRegex);

  if (!match) {
    return null;
  }

  const name = match[3] ?? '';
  const paramsRaw = match[5] ?? '';
  const returnType = match[6]?.trim();

  // Filter out common non-method patterns
  const keywords = [
    'if',
    'for',
    'while',
    'switch',
    'catch',
    'with',
    'return',
    'throw',
    'new',
    'typeof',
    'class',
    'interface',
    'type',
    'enum',
    'namespace',
    'import',
    'export',
    'from',
    'extends',
    'implements',
    'constructor',
  ];

  // Special case: 'constructor' is a valid method name
  if (name === 'constructor') {
    const hasBrace = line.includes('{');
    return {
      name: 'constructor',
      params: parseParameters(paramsRaw),
      returnType: undefined,
      openBraceOffset: hasBrace ? 0 : 1,
    };
  }

  // Skip keywords and certain patterns
  if (keywords.includes(name)) {
    return null;
  }

  // Make sure this looks like a method (has opening brace or followed by line with brace)
  const hasBrace = line.includes('{');

  if (!hasBrace) {
    const nextLine = lines[lineIndex + 1] ?? '';
    if (!nextLine.trim().startsWith('{') && !nextLine.includes('{')) {
      return null; // Not a method
    }
  }

  const openBraceOffset = hasBrace ? 0 : 1;

  // Skip if it looks like an object property or variable declaration
  const beforeMatch = line.slice(0, line.indexOf(name)).trim();
  if (beforeMatch.endsWith(':') || beforeMatch.endsWith(',') || beforeMatch.endsWith('=')) {
    return null;
  }

  return {
    name,
    params: parseParameters(paramsRaw),
    returnType: returnType || undefined,
    openBraceOffset,
  };
}

/**
 * Find the end line of a function by counting brace depth.
 *
 * @param lines - All source lines
 * @param startIndex - Start line index (0-indexed)
 * @param openBraceOffset - Lines until opening brace (-1 for expression body)
 * @returns End line number (1-indexed)
 */
export function findFunctionEnd(
  lines: string[],
  startIndex: number,
  openBraceOffset: number
): number {
  // For expression body arrow functions, find end by semicolon or next statement
  if (openBraceOffset === -1) {
    return findExpressionBodyEnd(lines, startIndex);
  }

  let depth = 0;
  let foundOpenBrace = false;
  const searchStart = startIndex + openBraceOffset;

  for (let i = searchStart; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Count braces, but ignore braces in strings and comments
    const { opens, closes } = countBraces(line);
    depth += opens - closes;

    if (opens > 0 && !foundOpenBrace) {
      foundOpenBrace = true;
    }

    // When we're back to depth 0 after finding the opening brace, we've found the end
    if (foundOpenBrace && depth === 0) {
      return i + 1; // 1-indexed
    }
  }

  // If we couldn't find the end, return the last line
  return lines.length;
}

/**
 * Find the end of an expression body arrow function.
 * These end at semicolon or when encountering a new statement.
 */
export function findExpressionBodyEnd(lines: string[], startIndex: number): number {
  let depth = 0; // Track parentheses for multi-line expressions

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i] ?? '';

    // Count parentheses
    for (const char of line) {
      if (char === '(' || char === '[' || char === '{') {
        depth++;
      } else if (char === ')' || char === ']' || char === '}') {
        depth--;
      }
    }

    // If we're at depth 0 and line ends with semicolon or has no continuation
    if (depth <= 0 && (line.trimEnd().endsWith(';') || line.trimEnd().endsWith(','))) {
      return i + 1; // 1-indexed
    }

    // Check if next line starts a new statement
    if (i < lines.length - 1) {
      const nextLine = (lines[i + 1] ?? '').trim();
      if (
        depth <= 0 &&
        (nextLine.startsWith('const ') ||
          nextLine.startsWith('let ') ||
          nextLine.startsWith('var ') ||
          nextLine.startsWith('function ') ||
          nextLine.startsWith('class ') ||
          nextLine.startsWith('export ') ||
          nextLine.startsWith('import ') ||
          nextLine === '' ||
          nextLine.startsWith('//') ||
          nextLine.startsWith('/*'))
      ) {
        return i + 1; // 1-indexed
      }
    }
  }

  return lines.length;
}

/**
 * Count opening and closing braces in a line, ignoring strings and comments.
 *
 * @param line - Source code line
 * @returns Object with opens and closes counts
 */
export function countBraces(line: string): { opens: number; closes: number } {
  let opens = 0;
  let closes = 0;
  let inString: string | null = null;
  let inLineComment = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i] ?? '';
    const nextChar = line[i + 1] ?? '';
    const prevChar = i > 0 ? line[i - 1] ?? '' : '';

    // Check for line comment start
    if (!inString && char === '/' && nextChar === '/') {
      inLineComment = true;
      break; // Rest of line is comment
    }

    // Handle string boundaries
    if (!inString && !inLineComment) {
      if (char === '"' || char === "'" || char === '`') {
        inString = char;
        i++;
        continue;
      }
    } else if (inString && char === inString && prevChar !== '\\') {
      inString = null;
      i++;
      continue;
    }

    // Count braces if not in string or comment
    if (!inString && !inLineComment) {
      if (char === '{') {
        opens++;
      } else if (char === '}') {
        closes++;
      }
    }

    i++;
  }

  return { opens, closes };
}

/**
 * Parse TypeScript/JavaScript function parameter string into array of parameter names.
 *
 * Handles:
 * - Simple params: "a, b, c"
 * - Typed params: "a: number, b: string"
 * - Default values: "a = 1, b = 'hello'"
 * - Destructured params: "{ x, y }: Point"
 * - Rest params: "...args: any[]"
 * - Optional params: "x?: number"
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
  let depth = 0; // Track nested brackets

  for (const char of paramsRaw) {
    if (char === '(' || char === '[' || char === '{' || char === '<') {
      depth++;
      current += char;
    } else if (char === ')' || char === ']' || char === '}' || char === '>') {
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
 * @param paramDef - Parameter definition string (e.g., "x: number = 0")
 * @returns Parameter name (e.g., "x")
 */
function extractParamName(paramDef: string): string | null {
  const trimmed = paramDef.trim();
  if (!trimmed) {
    return null;
  }

  // Handle rest parameters ...args
  if (trimmed.startsWith('...')) {
    const rest = trimmed.slice(3);
    // Get name before : or =
    const colonIdx = rest.indexOf(':');
    const eqIdx = rest.indexOf('=');
    if (colonIdx >= 0 && (eqIdx < 0 || colonIdx < eqIdx)) {
      return '...' + rest.slice(0, colonIdx).trim();
    } else if (eqIdx >= 0) {
      return '...' + rest.slice(0, eqIdx).trim();
    }
    return '...' + rest.trim();
  }

  // Handle destructured parameters { x, y } or [ a, b ]
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    // Find matching closing bracket
    let depth = 0;
    let i = 0;
    for (; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === '{' || ch === '[') {
        depth++;
      } else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          break;
        }
      }
    }
    // Return the destructured pattern
    return trimmed.slice(0, i + 1);
  }

  // Regular parameter - extract name before : or =
  // Handle optional marker ?
  let name = trimmed;

  // Remove optional marker for finding the split point
  const questionIdx = name.indexOf('?');
  if (questionIdx >= 0) {
    // Check if it's optional param like "x?"
    const beforeQuestion = name.slice(0, questionIdx);
    const afterQuestion = name.slice(questionIdx + 1);
    if (afterQuestion.trim().startsWith(':') || afterQuestion.trim() === '') {
      name = beforeQuestion + afterQuestion;
    }
  }

  const colonIdx = name.indexOf(':');
  const eqIdx = name.indexOf('=');

  if (colonIdx >= 0 && (eqIdx < 0 || colonIdx < eqIdx)) {
    return trimmed.slice(0, colonIdx).replace('?', '').trim();
  } else if (eqIdx >= 0) {
    return trimmed.slice(0, eqIdx).replace('?', '').trim();
  }

  return trimmed.replace('?', '').trim();
}

/**
 * Extract import statements from TypeScript/JavaScript source lines.
 *
 * Handles:
 * - import module from 'module'
 * - import { a, b } from 'module'
 * - import * as name from 'module'
 * - import 'module' (side effect)
 * - import type { T } from 'module'
 * - require('module')
 *
 * @param lines - Array of source code lines
 * @param options - Reader options for import classification
 * @returns Array of ImportStatement objects
 */
export function extractImportStatements(
  lines: string[],
  options: TypeScriptReaderOptions
): ImportStatement[] {
  const imports: ImportStatement[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const importInfo = parseImportLine(line);

    if (importInfo) {
      imports.push({
        raw: line.trim(),
        module: importInfo.module,
        isInternal: classifyImport(importInfo.module, options),
        line: i + 1, // 1-indexed
      });
    }
  }

  return imports;
}

/**
 * Result of parsing an import line
 */
interface ImportParseResult {
  module: string;
}

/**
 * Parse a single import line to extract module name.
 *
 * @param line - Source code line
 * @returns Import parse result or null if not an import
 */
export function parseImportLine(line: string): ImportParseResult | null {
  const trimmed = line.trim();

  // Skip comments and empty lines
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) {
    return null;
  }

  // ES6 import: import ... from 'module'
  // Match: import { stuff } from 'module'
  //        import * as name from 'module'
  //        import name from 'module'
  //        import 'module'
  //        import type { T } from 'module'
  const esImportRegex = /^import\s+(?:type\s+)?(?:[^'"]*from\s+)?['"]([^'"]+)['"]/;
  const esMatch = trimmed.match(esImportRegex);
  if (esMatch) {
    return { module: esMatch[1] ?? '' };
  }

  // Dynamic import: import('module') or await import('module')
  const dynamicImportRegex = /(?:await\s+)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/;
  const dynamicMatch = trimmed.match(dynamicImportRegex);
  if (dynamicMatch) {
    return { module: dynamicMatch[1] ?? '' };
  }

  // CommonJS require: require('module')
  // const x = require('module')
  // const { a, b } = require('module')
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/;
  const requireMatch = trimmed.match(requireRegex);
  if (requireMatch) {
    return { module: requireMatch[1] ?? '' };
  }

  // Re-export: export ... from 'module'
  const reExportRegex = /^export\s+(?:type\s+)?(?:\*|{[^}]*})\s+from\s+['"]([^'"]+)['"]/;
  const reExportMatch = trimmed.match(reExportRegex);
  if (reExportMatch) {
    return { module: reExportMatch[1] ?? '' };
  }

  return null;
}

/**
 * Classify an import as internal or external.
 *
 * An import is internal if:
 * - It starts with . or .. (relative import)
 * - It starts with @ and matches an internal scoped package
 * - It matches an internal package name
 *
 * An import is external if:
 * - It matches an external package name (explicit override)
 * - It's a node: built-in module
 * - It's a standard npm package
 *
 * @param module - Module specifier from import statement
 * @param options - Reader options with package lists
 * @returns True if import is internal, false if external
 */
export function classifyImport(module: string, options: TypeScriptReaderOptions): boolean {
  // Relative imports are always internal
  if (module.startsWith('.') || module.startsWith('/')) {
    return true;
  }

  // Node built-ins are always external
  if (module.startsWith('node:')) {
    return false;
  }

  // Extract the package name (first part, or @scope/name for scoped packages)
  let packageName: string;
  if (module.startsWith('@')) {
    // Scoped package: @scope/name
    const parts = module.split('/');
    packageName = parts.slice(0, 2).join('/');
  } else {
    // Regular package: name or name/subpath
    packageName = module.split('/')[0] ?? module;
  }

  // Check external packages first (explicit override)
  for (const pkg of options.externalPackages) {
    if (packageName === pkg || module.startsWith(pkg + '/')) {
      return false;
    }
  }

  // Check internal packages
  for (const pkg of options.internalPackages) {
    if (packageName === pkg || module.startsWith(pkg + '/')) {
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
 * @returns TypeScriptReaderOptions
 */
export function createTypeScriptReaderOptions(config: UnknitConfig): TypeScriptReaderOptions {
  return {
    internalPackages: config.internalPackages,
    externalPackages: config.externalPackages,
  };
}

/**
 * TypeScriptReader class for object-oriented access to TypeScript/JavaScript source reading.
 */
export class TypeScriptReader {
  private options: TypeScriptReaderOptions;

  constructor(options: TypeScriptReaderOptions) {
    this.options = options;
  }

  /**
   * Create a TypeScriptReader from UnknitConfig
   */
  static fromConfig(config: UnknitConfig): TypeScriptReader {
    return new TypeScriptReader(createTypeScriptReaderOptions(config));
  }

  /**
   * Read a TypeScript/JavaScript source file and extract metadata
   */
  async read(filePath: string): Promise<CodeMetadata> {
    return readTypeScriptSource(filePath, this.options);
  }

  /**
   * Parse TypeScript/JavaScript source content (for testing without file I/O)
   */
  parse(filePath: string, content: string): CodeMetadata {
    return parseTypeScriptSource(filePath, content, this.options);
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
