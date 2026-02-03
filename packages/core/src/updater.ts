/**
 * Smart updater for automatic line number updates when source code changes.
 * Handles line insertions and deletions by adjusting sourceRef line numbers.
 */

import type { UnknitNode, SourceRef } from './types.js';

/**
 * Represents a line shift in the source code.
 * Positive delta means lines were inserted (shift down).
 * Negative delta means lines were deleted (shift up).
 */
export interface LineShift {
  /** The line number where the shift occurs (1-indexed) */
  atLine: number;
  /** Number of lines shifted (positive = insertion, negative = deletion) */
  delta: number;
}

/**
 * Result of an update operation.
 */
export interface UpdateResult {
  /** The updated nodes (mutated in place) */
  nodes: UnknitNode[];
  /** Number of source references that were updated */
  updatedCount: number;
  /** File paths that were affected */
  affectedFiles: string[];
}

/**
 * Detects line shifts by comparing original and modified line counts.
 * This is a simple diff detection based on line count changes at specific positions.
 *
 * @param originalLines - Array of original source lines
 * @param modifiedLines - Array of modified source lines
 * @returns Array of LineShift objects describing the changes
 */
export function detectLineShifts(
  originalLines: string[],
  modifiedLines: string[]
): LineShift[] {
  const shifts: LineShift[] = [];

  // Use a simple LCS-based approach to detect insertions and deletions
  // Find matching anchors and calculate shifts between them

  const originalLen = originalLines.length;
  const modifiedLen = modifiedLines.length;

  if (originalLen === modifiedLen) {
    // Same length - no line shifts, only content changes
    return shifts;
  }

  // Find the first point of divergence from the start
  let startMatch = 0;
  while (
    startMatch < originalLen &&
    startMatch < modifiedLen &&
    originalLines[startMatch] === modifiedLines[startMatch]
  ) {
    startMatch++;
  }

  // Find the first point of divergence from the end
  let endMatchOriginal = originalLen - 1;
  let endMatchModified = modifiedLen - 1;
  while (
    endMatchOriginal >= startMatch &&
    endMatchModified >= startMatch &&
    originalLines[endMatchOriginal] === modifiedLines[endMatchModified]
  ) {
    endMatchOriginal--;
    endMatchModified--;
  }

  // Calculate the delta at the divergence point
  // startMatch is the 0-indexed line where change begins
  // Convert to 1-indexed for the shift
  const changeLine = startMatch + 1;

  // Lines from startMatch to endMatchOriginal (inclusive) were in original
  const originalSpan = endMatchOriginal - startMatch + 1;
  // Lines from startMatch to endMatchModified (inclusive) are in modified
  const modifiedSpan = endMatchModified - startMatch + 1;

  const delta = modifiedSpan - originalSpan;

  if (delta !== 0) {
    shifts.push({
      atLine: changeLine,
      delta,
    });
  }

  return shifts;
}

/**
 * Applies line shifts to a single SourceRef.
 * Returns a new SourceRef with updated line numbers, or the original if unchanged.
 *
 * @param sourceRef - The source reference to update
 * @param file - The file path the shifts apply to
 * @param shifts - Array of line shifts to apply
 * @returns Updated SourceRef (may be same object if unchanged)
 */
export function applyShiftsToSourceRef(
  sourceRef: SourceRef,
  file: string,
  shifts: LineShift[]
): SourceRef {
  // Only apply shifts if the file matches
  if (sourceRef.file !== file) {
    return sourceRef;
  }

  let { startLine, endLine } = sourceRef;
  let changed = false;

  for (const shift of shifts) {
    // Shifts apply to lines at or after the shift point
    if (startLine >= shift.atLine) {
      startLine += shift.delta;
      changed = true;
    }
    if (endLine >= shift.atLine) {
      endLine += shift.delta;
      changed = true;
    }
  }

  if (!changed) {
    return sourceRef;
  }

  return {
    file: sourceRef.file,
    startLine,
    endLine,
  };
}

/**
 * Recursively updates all sourceRefs in a node tree.
 *
 * @param node - The node to update (mutated in place)
 * @param file - The file path the shifts apply to
 * @param shifts - Array of line shifts to apply
 * @returns Number of sourceRefs that were updated
 */
function updateNodeSourceRefs(
  node: UnknitNode,
  file: string,
  shifts: LineShift[]
): number {
  let count = 0;

  if (node.sourceRef) {
    const updated = applyShiftsToSourceRef(node.sourceRef, file, shifts);
    if (updated !== node.sourceRef) {
      node.sourceRef = updated;
      count++;
    }
  }

  if (node.children) {
    for (const child of node.children) {
      count += updateNodeSourceRefs(child, file, shifts);
    }
  }

  return count;
}

/**
 * Updates all sourceRefs in an array of nodes for a given file and shifts.
 *
 * @param nodes - Array of nodes to update (mutated in place)
 * @param file - The file path the shifts apply to
 * @param shifts - Array of line shifts to apply
 * @returns UpdateResult with counts and affected files
 */
export function applyShiftsToNodes(
  nodes: UnknitNode[],
  file: string,
  shifts: LineShift[]
): UpdateResult {
  if (shifts.length === 0) {
    return {
      nodes,
      updatedCount: 0,
      affectedFiles: [],
    };
  }

  let totalUpdated = 0;
  for (const node of nodes) {
    totalUpdated += updateNodeSourceRefs(node, file, shifts);
  }

  return {
    nodes,
    updatedCount: totalUpdated,
    affectedFiles: totalUpdated > 0 ? [file] : [],
  };
}

/**
 * Smart updater class for managing line number updates.
 */
export class SmartUpdater {
  private nodes: UnknitNode[];

  /**
   * Creates a new SmartUpdater for the given AST nodes.
   *
   * @param nodes - Array of top-level UnknitNode (typically function nodes)
   */
  constructor(nodes: UnknitNode[]) {
    this.nodes = nodes;
  }

  /**
   * Gets the underlying AST nodes.
   *
   * @returns The array of top-level UnknitNodes
   */
  getNodes(): UnknitNode[] {
    return this.nodes;
  }

  /**
   * Detects line shifts between original and modified source content.
   *
   * @param originalContent - Original source file content
   * @param modifiedContent - Modified source file content
   * @returns Array of LineShift objects
   */
  detectShifts(originalContent: string, modifiedContent: string): LineShift[] {
    const originalLines = originalContent.split('\n');
    const modifiedLines = modifiedContent.split('\n');
    return detectLineShifts(originalLines, modifiedLines);
  }

  /**
   * Updates all sourceRefs for a file based on detected line shifts.
   *
   * @param file - The file path that was modified
   * @param originalContent - Original source file content
   * @param modifiedContent - Modified source file content
   * @returns UpdateResult with counts and affected files
   */
  update(
    file: string,
    originalContent: string,
    modifiedContent: string
  ): UpdateResult {
    const shifts = this.detectShifts(originalContent, modifiedContent);
    return applyShiftsToNodes(this.nodes, file, shifts);
  }

  /**
   * Updates all sourceRefs for a file based on pre-computed line shifts.
   *
   * @param file - The file path that was modified
   * @param shifts - Array of line shifts to apply
   * @returns UpdateResult with counts and affected files
   */
  applyShifts(file: string, shifts: LineShift[]): UpdateResult {
    return applyShiftsToNodes(this.nodes, file, shifts);
  }

  /**
   * Collects all source files referenced by the nodes.
   *
   * @returns Array of unique file paths
   */
  getReferencedFiles(): string[] {
    const files = new Set<string>();

    const collectFiles = (node: UnknitNode): void => {
      if (node.sourceRef) {
        files.add(node.sourceRef.file);
      }
      if (node.children) {
        for (const child of node.children) {
          collectFiles(child);
        }
      }
    };

    for (const node of this.nodes) {
      collectFiles(node);
    }

    return Array.from(files);
  }
}
