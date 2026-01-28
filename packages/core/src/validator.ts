/**
 * Validators for unknit AST nodes and source references.
 */

import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import type {
  UnknitNode,
  SourceRef,
  ValidationDiagnostic,
  DiagnosticRange,
} from './types.js';

/**
 * Options for the source file validator.
 */
export interface ValidatorOptions {
  /** Base directory for resolving relative source file paths */
  basePath: string;
}

/**
 * Result of validating source file references.
 */
export interface ValidationResult {
  /** Whether all validations passed */
  valid: boolean;
  /** List of validation diagnostics (errors and warnings) */
  diagnostics: ValidationDiagnostic[];
}

/**
 * Creates a diagnostic for a missing source file.
 */
function createMissingFileDiagnostic(
  sourceRef: SourceRef,
  range: DiagnosticRange
): ValidationDiagnostic {
  return {
    severity: 'error',
    message: `Source file not found: ${sourceRef.file}`,
    range,
    sourceRef,
  };
}

/**
 * Creates a diagnostic for line numbers exceeding file bounds.
 */
function createLineBoundsDiagnostic(
  sourceRef: SourceRef,
  totalLines: number,
  range: DiagnosticRange
): ValidationDiagnostic {
  return {
    severity: 'error',
    message: `Line numbers ${sourceRef.startLine}-${sourceRef.endLine} exceed file bounds (file has ${totalLines} lines)`,
    range,
    sourceRef,
  };
}

/**
 * Counts the number of lines in a file.
 */
async function countLines(content: string): Promise<number> {
  if (content.length === 0) {
    return 0;
  }
  // Count newlines + 1 (or just count if ends with newline)
  const lines = content.split('\n');
  // If the last element is empty (file ends with newline), don't count it as a line
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    return lines.length - 1;
  }
  return lines.length;
}

/**
 * Checks if a file exists.
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Collects all source references from an AST node and its children.
 * Returns pairs of [sourceRef, lineNumber] where lineNumber is the node's position in the unknit file.
 */
function collectSourceRefs(
  node: UnknitNode,
  lineNumber: number = 1
): Array<{ sourceRef: SourceRef; unknitLine: number }> {
  const refs: Array<{ sourceRef: SourceRef; unknitLine: number }> = [];

  if (node.sourceRef) {
    refs.push({ sourceRef: node.sourceRef, unknitLine: lineNumber });
  }

  if (node.children) {
    let childLine = lineNumber + 1;
    for (const child of node.children) {
      refs.push(...collectSourceRefs(child, childLine));
      // Estimate lines based on node type (simplified - in real usage we'd track actual positions)
      childLine += 1;
      if (child.children) {
        childLine += child.children.length;
      }
    }
  }

  return refs;
}

/**
 * Creates a diagnostic range for a given unknit line number.
 */
function createRangeForLine(line: number): DiagnosticRange {
  return {
    startLine: line,
    startColumn: 1,
    endLine: line,
    endColumn: 1,
  };
}

/**
 * Validates source file existence for a single source reference.
 */
export async function validateSourceRef(
  sourceRef: SourceRef,
  options: ValidatorOptions,
  unknitLine: number = 1
): Promise<ValidationDiagnostic[]> {
  const diagnostics: ValidationDiagnostic[] = [];
  const range = createRangeForLine(unknitLine);
  const absolutePath = resolvePath(options.basePath, sourceRef.file);

  // Check if file exists
  if (!(await fileExists(absolutePath))) {
    diagnostics.push(createMissingFileDiagnostic(sourceRef, range));
    return diagnostics;
  }

  // Check line bounds
  try {
    const content = await readFile(absolutePath, 'utf-8');
    const totalLines = await countLines(content);

    if (sourceRef.startLine < 1 || sourceRef.endLine > totalLines) {
      diagnostics.push(createLineBoundsDiagnostic(sourceRef, totalLines, range));
    }

    if (sourceRef.startLine > sourceRef.endLine) {
      diagnostics.push({
        severity: 'error',
        message: `Invalid line range: startLine (${sourceRef.startLine}) is greater than endLine (${sourceRef.endLine})`,
        range,
        sourceRef,
      });
    }
  } catch {
    diagnostics.push({
      severity: 'error',
      message: `Failed to read source file: ${sourceRef.file}`,
      range,
      sourceRef,
    });
  }

  return diagnostics;
}

/**
 * Validates all source references in a single UnknitNode and its children.
 */
export async function validateNode(
  node: UnknitNode,
  options: ValidatorOptions,
  startLine: number = 1
): Promise<ValidationResult> {
  const refs = collectSourceRefs(node, startLine);
  const allDiagnostics: ValidationDiagnostic[] = [];

  for (const { sourceRef, unknitLine } of refs) {
    const diagnostics = await validateSourceRef(sourceRef, options, unknitLine);
    allDiagnostics.push(...diagnostics);
  }

  return {
    valid: allDiagnostics.filter((d) => d.severity === 'error').length === 0,
    diagnostics: allDiagnostics,
  };
}

/**
 * Validates all source references in an array of UnknitNodes.
 */
export async function validateNodes(
  nodes: UnknitNode[],
  options: ValidatorOptions
): Promise<ValidationResult> {
  const allDiagnostics: ValidationDiagnostic[] = [];
  let currentLine = 1;

  for (const node of nodes) {
    const result = await validateNode(node, options, currentLine);
    allDiagnostics.push(...result.diagnostics);
    // Estimate lines used by this node (simplified)
    currentLine += 1;
    if (node.children) {
      currentLine += countNodeLines(node);
    }
    // Add blank line between top-level functions
    currentLine += 1;
  }

  return {
    valid: allDiagnostics.filter((d) => d.severity === 'error').length === 0,
    diagnostics: allDiagnostics,
  };
}

/**
 * Counts the approximate number of lines a node and its children occupy.
 */
function countNodeLines(node: UnknitNode): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodeLines(child);
    }
  }
  return count;
}

/**
 * Source file existence validator class.
 * Provides validation of source file references in unknit AST nodes.
 */
export class SourceFileValidator {
  private options: ValidatorOptions;

  constructor(options: ValidatorOptions) {
    this.options = options;
  }

  /**
   * Validates a single source reference.
   */
  async validateSourceRef(
    sourceRef: SourceRef,
    unknitLine: number = 1
  ): Promise<ValidationDiagnostic[]> {
    return validateSourceRef(sourceRef, this.options, unknitLine);
  }

  /**
   * Validates all source references in a node tree.
   */
  async validateNode(
    node: UnknitNode,
    startLine: number = 1
  ): Promise<ValidationResult> {
    return validateNode(node, this.options, startLine);
  }

  /**
   * Validates all source references in an array of nodes.
   */
  async validateNodes(nodes: UnknitNode[]): Promise<ValidationResult> {
    return validateNodes(nodes, this.options);
  }
}
