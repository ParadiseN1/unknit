/**
 * Structural change detection for unknit files.
 * Detects when source code changes require LLM regeneration.
 */

import type { UnknitNode, SourceRef } from './types.js';
import { NodeType } from './types.js';

/**
 * Represents a function signature extracted from source code.
 */
export interface FunctionSignature {
  /** Function name */
  name: string;
  /** Parameter names */
  params: string[];
  /** Source file path */
  file: string;
  /** Start line number (1-indexed) */
  startLine: number;
  /** End line number (1-indexed) */
  endLine: number;
}

/**
 * Types of structural changes that can be detected.
 */
export enum StructuralChangeType {
  /** A new function was added to source that is not in unknit */
  function_added = 'function_added',
  /** A function in unknit no longer exists in source */
  function_removed = 'function_removed',
  /** A function's signature has changed (parameters differ) */
  signature_changed = 'signature_changed',
}

/**
 * Represents a single structural change.
 */
export interface StructuralChange {
  /** Type of the change */
  type: StructuralChangeType;
  /** Name of the function involved */
  functionName: string;
  /** Source file path */
  file: string;
  /** Description of the change */
  message: string;
  /** The unknit node (for removed/changed functions) */
  unknitNode?: UnknitNode;
  /** The source function signature (for added/changed functions) */
  sourceSignature?: FunctionSignature;
}

/**
 * Result of structural change detection.
 */
export interface StructuralChangeResult {
  /** Whether regeneration is needed */
  regenerationNeeded: boolean;
  /** List of detected changes */
  changes: StructuralChange[];
}

/**
 * Extracts function nodes from an array of unknit nodes.
 * Groups them by source file.
 *
 * @param nodes - Array of top-level UnknitNodes
 * @returns Map from file path to array of function nodes
 */
function extractUnknitFunctions(
  nodes: UnknitNode[]
): Map<string, UnknitNode[]> {
  const result = new Map<string, UnknitNode[]>();

  for (const node of nodes) {
    if (node.type === NodeType.fn && node.sourceRef) {
      const file = node.sourceRef.file;
      const existing = result.get(file) ?? [];
      existing.push(node);
      result.set(file, existing);
    }
  }

  return result;
}

/**
 * Groups source function signatures by file.
 *
 * @param signatures - Array of function signatures
 * @returns Map from file path to array of signatures
 */
function groupSignaturesByFile(
  signatures: FunctionSignature[]
): Map<string, FunctionSignature[]> {
  const result = new Map<string, FunctionSignature[]>();

  for (const sig of signatures) {
    const existing = result.get(sig.file) ?? [];
    existing.push(sig);
    result.set(sig.file, existing);
  }

  return result;
}

/**
 * Compares parameters between unknit node and source signature.
 * Returns true if they match.
 *
 * @param unknitParams - Parameters from unknit node (may have ? suffix for optional)
 * @param sourceParams - Parameters from source code
 * @returns True if parameters match
 */
function parametersMatch(
  unknitParams: string[] | undefined,
  sourceParams: string[]
): boolean {
  const unknitClean = (unknitParams ?? []).map((p) =>
    p.endsWith('?') ? p.slice(0, -1) : p
  );

  if (unknitClean.length !== sourceParams.length) {
    return false;
  }

  // Compare parameter names (order matters)
  for (let i = 0; i < unknitClean.length; i++) {
    if (unknitClean[i] !== sourceParams[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Finds a matching unknit node for a source function.
 * First tries to match by line overlap, then by name.
 *
 * @param signature - Source function signature
 * @param unknitFunctions - Array of unknit function nodes
 * @returns Matching node or undefined
 */
function findMatchingUnknitNode(
  signature: FunctionSignature,
  unknitFunctions: UnknitNode[]
): UnknitNode | undefined {
  // First, try to match by line overlap (most reliable)
  for (const node of unknitFunctions) {
    if (!node.sourceRef) continue;

    // Check if lines overlap
    const nodeStart = node.sourceRef.startLine;
    const nodeEnd = node.sourceRef.endLine;
    const sigStart = signature.startLine;
    const sigEnd = signature.endLine;

    if (nodeStart <= sigEnd && nodeEnd >= sigStart) {
      return node;
    }
  }

  // Fall back to name matching
  for (const node of unknitFunctions) {
    if (node.name === signature.name) {
      return node;
    }
  }

  return undefined;
}

/**
 * Detects structural changes between unknit AST and source function signatures.
 *
 * @param nodes - Array of top-level UnknitNodes (typically function definitions)
 * @param sourceSignatures - Array of function signatures extracted from source code
 * @returns StructuralChangeResult with detected changes and regeneration flag
 */
export function detectStructuralChanges(
  nodes: UnknitNode[],
  sourceSignatures: FunctionSignature[]
): StructuralChangeResult {
  const changes: StructuralChange[] = [];

  // Group by file for efficient lookup
  const unknitByFile = extractUnknitFunctions(nodes);
  const sourceByFile = groupSignaturesByFile(sourceSignatures);

  // Get all files mentioned in either source or unknit
  const allFiles = new Set([
    ...unknitByFile.keys(),
    ...sourceByFile.keys(),
  ]);

  for (const file of allFiles) {
    const unknitFunctions = unknitByFile.get(file) ?? [];
    const sourceFunctions = sourceByFile.get(file) ?? [];

    // Track which functions we've matched
    const matchedUnknitNodes = new Set<UnknitNode>();
    const matchedSourceSigs = new Set<FunctionSignature>();

    // Check each source function
    for (const sig of sourceFunctions) {
      const matchingNode = findMatchingUnknitNode(sig, unknitFunctions);

      if (!matchingNode) {
        // Function added - exists in source but not in unknit
        changes.push({
          type: StructuralChangeType.function_added,
          functionName: sig.name,
          file,
          message: `Function '${sig.name}' was added at lines ${sig.startLine}-${sig.endLine}`,
          sourceSignature: sig,
        });
      } else {
        matchedUnknitNodes.add(matchingNode);
        matchedSourceSigs.add(sig);

        // Check for signature changes
        if (!parametersMatch(matchingNode.params, sig.params)) {
          changes.push({
            type: StructuralChangeType.signature_changed,
            functionName: sig.name,
            file,
            message: `Function '${sig.name}' signature changed: unknit has (${(matchingNode.params ?? []).join(', ')}), source has (${sig.params.join(', ')})`,
            unknitNode: matchingNode,
            sourceSignature: sig,
          });
        } else if (matchingNode.name !== sig.name) {
          // Parameters match but name is different - likely a rename
          changes.push({
            type: StructuralChangeType.signature_changed,
            functionName: sig.name,
            file,
            message: `Function appears to be renamed from '${matchingNode.name}' to '${sig.name}'`,
            unknitNode: matchingNode,
            sourceSignature: sig,
          });
        }
      }
    }

    // Check each unknit function for removal
    for (const node of unknitFunctions) {
      if (!matchedUnknitNodes.has(node)) {
        // Function removed - exists in unknit but not in source
        const sourceRef = node.sourceRef as SourceRef;
        changes.push({
          type: StructuralChangeType.function_removed,
          functionName: node.name,
          file,
          message: `Function '${node.name}' was removed (was at lines ${sourceRef.startLine}-${sourceRef.endLine})`,
          unknitNode: node,
        });
      }
    }
  }

  return {
    regenerationNeeded: changes.length > 0,
    changes,
  };
}

/**
 * Class for detecting structural changes between unknit and source code.
 */
export class StructuralChangeDetector {
  private nodes: UnknitNode[];

  /**
   * Creates a new StructuralChangeDetector.
   *
   * @param nodes - Array of top-level UnknitNodes
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
   * Detects structural changes against source function signatures.
   *
   * @param sourceSignatures - Array of function signatures from source code
   * @returns StructuralChangeResult with detected changes
   */
  detect(sourceSignatures: FunctionSignature[]): StructuralChangeResult {
    return detectStructuralChanges(this.nodes, sourceSignatures);
  }

  /**
   * Checks if regeneration is needed given source function signatures.
   *
   * @param sourceSignatures - Array of function signatures from source code
   * @returns True if regeneration is needed
   */
  needsRegeneration(sourceSignatures: FunctionSignature[]): boolean {
    return this.detect(sourceSignatures).regenerationNeeded;
  }

  /**
   * Gets all files referenced by function nodes.
   *
   * @returns Array of unique file paths
   */
  getReferencedFiles(): string[] {
    const files = new Set<string>();

    for (const node of this.nodes) {
      if (node.type === NodeType.fn && node.sourceRef) {
        files.add(node.sourceRef.file);
      }
    }

    return Array.from(files);
  }
}
