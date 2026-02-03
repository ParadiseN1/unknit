/**
 * Core type definitions for the Unknit AST and validation system.
 */

/**
 * Reference to a location in source code.
 */
export interface SourceRef {
  /** Path to the source file (relative to project root) */
  file: string;
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Ending line number (1-indexed, inclusive) */
  endLine: number;
}

/**
 * Types of nodes in the Unknit AST.
 */
export enum NodeType {
  /** Function definition: fn name(params) -> return: */
  fn = 'fn',
  /** Conceptual block (logical grouping) */
  block = 'block',
  /** Internal function call: name() */
  call = 'call',
  /** External function call: @name() */
  external_call = 'external_call',
  /** Early exit: *-> */
  early_exit = 'early_exit',
  /** Final return: -> */
  return = 'return',
  /** Error handler: on error: */
  error_handler = 'error_handler',
}

/**
 * A node in the Unknit AST representing a parsed element.
 */
export interface UnknitNode {
  /** The type of this node */
  type: NodeType;
  /** Name of the function, block, or call */
  name: string;
  /** Function parameters (only for fn nodes) */
  params?: string[];
  /** Return type (only for fn nodes) */
  returnType?: string;
  /** Error type if function can fail (only for fn nodes) */
  errorType?: string;
  /** Reference to source code location */
  sourceRef?: SourceRef;
  /** Child nodes (nested blocks, calls, etc.) */
  children?: UnknitNode[];
}

/**
 * Represents a parsed unknit file with all its function definitions.
 */
export interface UnknitFile {
  /** Path to the unknit file */
  source: string;
  /** Top-level function definitions */
  functions: UnknitNode[];
}

/**
 * Severity levels for validation diagnostics.
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info';

/**
 * Range within a file for diagnostic reporting.
 */
export interface DiagnosticRange {
  /** Starting line (1-indexed) */
  startLine: number;
  /** Starting column (1-indexed) */
  startColumn: number;
  /** Ending line (1-indexed) */
  endLine: number;
  /** Ending column (1-indexed) */
  endColumn: number;
}

/**
 * A validation diagnostic reporting an issue in an unknit file.
 */
export interface ValidationDiagnostic {
  /** Severity of the diagnostic */
  severity: DiagnosticSeverity;
  /** Human-readable description of the issue */
  message: string;
  /** Location of the issue within the unknit file */
  range: DiagnosticRange;
  /** Optional source file reference if issue relates to source code */
  sourceRef?: SourceRef;
}
