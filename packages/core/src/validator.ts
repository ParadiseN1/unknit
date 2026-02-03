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

  /**
   * Validates source coverage for all nodes, checking for overlaps and gaps.
   */
  async validateCoverage(
    nodes: UnknitNode[],
    expectedRange?: { file: string; startLine: number; endLine: number }
  ): Promise<ValidationResult> {
    return validateCoverage(nodes, this.options, expectedRange);
  }
}

/**
 * Represents a source reference with its position in the unknit file.
 */
interface SourceRefWithPosition {
  sourceRef: SourceRef;
  unknitLine: number;
}

/**
 * Collects all source references from nodes, including their unknit line positions.
 */
function collectAllSourceRefs(nodes: UnknitNode[]): SourceRefWithPosition[] {
  const refs: SourceRefWithPosition[] = [];
  let currentLine = 1;

  for (const node of nodes) {
    collectSourceRefsRecursive(node, currentLine, refs);
    currentLine += countNodeLines(node);
    // Add blank line between top-level functions
    currentLine += 1;
  }

  return refs;
}

/**
 * Recursively collects source references from a node and its children.
 */
function collectSourceRefsRecursive(
  node: UnknitNode,
  lineNumber: number,
  refs: SourceRefWithPosition[]
): void {
  if (node.sourceRef) {
    refs.push({ sourceRef: node.sourceRef, unknitLine: lineNumber });
  }

  if (node.children) {
    let childLine = lineNumber + 1;
    for (const child of node.children) {
      collectSourceRefsRecursive(child, childLine, refs);
      childLine += countNodeLines(child);
    }
  }
}

/**
 * Groups source references by file.
 */
function groupByFile(
  refs: SourceRefWithPosition[]
): Map<string, SourceRefWithPosition[]> {
  const groups = new Map<string, SourceRefWithPosition[]>();

  for (const ref of refs) {
    const file = ref.sourceRef.file;
    const existing = groups.get(file);
    if (existing) {
      existing.push(ref);
    } else {
      groups.set(file, [ref]);
    }
  }

  return groups;
}

/**
 * Detects overlapping source references within a single file.
 * Returns warnings for each overlap detected.
 */
function detectOverlaps(
  refs: SourceRefWithPosition[],
  file: string
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];

  // Sort by start line for easier comparison
  const sorted = [...refs].sort(
    (a, b) => a.sourceRef.startLine - b.sourceRef.startLine
  );

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    if (!current) continue;

    for (let j = i + 1; j < sorted.length; j++) {
      const next = sorted[j];
      if (!next) continue;

      // Check if ranges overlap
      // Overlap occurs when: current.end >= next.start
      if (current.sourceRef.endLine >= next.sourceRef.startLine) {
        const overlapStart = next.sourceRef.startLine;
        const overlapEnd = Math.min(
          current.sourceRef.endLine,
          next.sourceRef.endLine
        );

        diagnostics.push({
          severity: 'warning',
          message: `Overlapping source references in ${file}: lines ${overlapStart}-${overlapEnd} are covered by multiple blocks`,
          range: createRangeForLine(current.unknitLine),
          sourceRef: current.sourceRef,
        });
      } else {
        // Since sorted, if no overlap with next, won't overlap with later ones
        break;
      }
    }
  }

  return diagnostics;
}

/**
 * Detects gaps in source coverage within a file's expected range.
 * Returns warnings for each gap detected.
 */
function detectGaps(
  refs: SourceRefWithPosition[],
  file: string,
  expectedStartLine: number,
  expectedEndLine: number
): ValidationDiagnostic[] {
  const diagnostics: ValidationDiagnostic[] = [];

  // Build a set of all covered lines
  const coveredLines = new Set<number>();
  for (const ref of refs) {
    for (
      let line = ref.sourceRef.startLine;
      line <= ref.sourceRef.endLine;
      line++
    ) {
      coveredLines.add(line);
    }
  }

  // Find gaps in coverage
  const gaps: Array<{ start: number; end: number }> = [];
  let gapStart: number | null = null;

  for (let line = expectedStartLine; line <= expectedEndLine; line++) {
    if (!coveredLines.has(line)) {
      if (gapStart === null) {
        gapStart = line;
      }
    } else {
      if (gapStart !== null) {
        gaps.push({ start: gapStart, end: line - 1 });
        gapStart = null;
      }
    }
  }

  // Handle trailing gap
  if (gapStart !== null) {
    gaps.push({ start: gapStart, end: expectedEndLine });
  }

  // Create diagnostics for each gap
  for (const gap of gaps) {
    const rangeStr =
      gap.start === gap.end ? `line ${gap.start}` : `lines ${gap.start}-${gap.end}`;
    diagnostics.push({
      severity: 'warning',
      message: `Coverage gap in ${file}: ${rangeStr} not mapped to any unknit block`,
      range: {
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 1,
      },
      sourceRef: {
        file,
        startLine: gap.start,
        endLine: gap.end,
      },
    });
  }

  return diagnostics;
}

/**
 * Options for expected source range when validating coverage.
 */
export interface CoverageExpectedRange {
  /** Source file path */
  file: string;
  /** Expected start line (1-indexed) */
  startLine: number;
  /** Expected end line (1-indexed, inclusive) */
  endLine: number;
}

/**
 * Validates source coverage for all nodes, detecting overlaps and gaps.
 *
 * @param nodes - The AST nodes to validate coverage for
 * @param options - Validator options (used for base path resolution, not used for coverage)
 * @param expectedRange - Optional expected range to check for gaps
 * @returns Validation result with warnings for overlaps and gaps
 */
export async function validateCoverage(
  nodes: UnknitNode[],
  options: ValidatorOptions,
  expectedRange?: CoverageExpectedRange
): Promise<ValidationResult> {
  // Avoid unused parameter warning
  void options;

  const allDiagnostics: ValidationDiagnostic[] = [];

  // Collect all source references from the nodes
  const allRefs = collectAllSourceRefs(nodes);

  // Group by file
  const byFile = groupByFile(allRefs);

  // Check for overlaps in each file
  for (const [file, refs] of byFile) {
    const overlaps = detectOverlaps(refs, file);
    allDiagnostics.push(...overlaps);
  }

  // Check for gaps if expected range is provided
  if (expectedRange) {
    const refs = byFile.get(expectedRange.file) ?? [];
    const gaps = detectGaps(
      refs,
      expectedRange.file,
      expectedRange.startLine,
      expectedRange.endLine
    );
    allDiagnostics.push(...gaps);
  }

  return {
    valid: allDiagnostics.length === 0,
    diagnostics: allDiagnostics,
  };
}

/**
 * Source coverage validator class.
 * Provides validation of source coverage, detecting overlaps and gaps.
 */
export class SourceCoverageValidator {
  private options: ValidatorOptions;

  constructor(options: ValidatorOptions) {
    this.options = options;
  }

  /**
   * Validates source coverage for all nodes.
   */
  async validateCoverage(
    nodes: UnknitNode[],
    expectedRange?: CoverageExpectedRange
  ): Promise<ValidationResult> {
    return validateCoverage(nodes, this.options, expectedRange);
  }
}
