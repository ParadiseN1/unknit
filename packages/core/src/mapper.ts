/**
 * Source-to-block mapper for bidirectional mapping between source lines and unknit blocks.
 */

import type { UnknitNode, SourceRef } from './types.js';

/**
 * Entry in the line-to-block index for O(1) lookup.
 */
interface LineIndexEntry {
  /** The node that covers this line */
  node: UnknitNode;
  /** Ancestor chain from root to this node (inclusive) */
  ancestors: UnknitNode[];
}

/**
 * Index structure for O(1) line-to-block lookup.
 * Maps file paths to line number to index entry.
 */
type LineIndex = Map<string, Map<number, LineIndexEntry>>;

/**
 * Builds an optimized line-to-block index for O(1) lookup.
 *
 * @param nodes - Array of top-level UnknitNode (typically function nodes)
 * @returns LineIndex for fast lookups
 */
function buildLineIndex(nodes: UnknitNode[]): LineIndex {
  const index: LineIndex = new Map();

  for (const node of nodes) {
    indexNode(node, [], index);
  }

  return index;
}

/**
 * Recursively indexes a node and its children.
 *
 * @param node - The node to index
 * @param ancestors - Array of ancestor nodes from root to parent
 * @param index - The line index to populate
 */
function indexNode(
  node: UnknitNode,
  ancestors: UnknitNode[],
  index: LineIndex
): void {
  const currentPath = [...ancestors, node];

  // If this node has a source reference, index all its lines
  if (node.sourceRef) {
    const { file, startLine, endLine } = node.sourceRef;

    // Get or create the file's line map
    let fileIndex = index.get(file);
    if (!fileIndex) {
      fileIndex = new Map();
      index.set(file, fileIndex);
    }

    // Index each line, but only if not already indexed by a more specific (deeper) node
    // Since we process top-down, children will overwrite parent entries
    for (let line = startLine; line <= endLine; line++) {
      fileIndex.set(line, {
        node,
        ancestors: currentPath,
      });
    }
  }

  // Index children with this node as ancestor
  if (node.children) {
    for (const child of node.children) {
      indexNode(child, currentPath, index);
    }
  }
}

/**
 * Gets the UnknitNode that owns a specific source line.
 *
 * @param index - The pre-built line index
 * @param file - Source file path
 * @param line - Line number (1-indexed)
 * @returns The owning UnknitNode, or undefined if line is not covered
 */
export function getBlockForLine(
  index: LineIndex,
  file: string,
  line: number
): UnknitNode | undefined {
  const fileIndex = index.get(file);
  if (!fileIndex) {
    return undefined;
  }

  const entry = fileIndex.get(line);
  return entry?.node;
}

/**
 * Gets the SourceRef for a given UnknitNode.
 *
 * @param node - The UnknitNode to get lines for
 * @returns The SourceRef, or undefined if node has no source reference
 */
export function getLinesForBlock(node: UnknitNode): SourceRef | undefined {
  return node.sourceRef;
}

/**
 * Gets the ancestor chain from root to the node that covers a specific line.
 *
 * @param index - The pre-built line index
 * @param file - Source file path
 * @param line - Line number (1-indexed)
 * @returns Array of UnknitNodes from root to leaf, or undefined if line is not covered
 */
export function getBlockPath(
  index: LineIndex,
  file: string,
  line: number
): UnknitNode[] | undefined {
  const fileIndex = index.get(file);
  if (!fileIndex) {
    return undefined;
  }

  const entry = fileIndex.get(line);
  return entry?.ancestors;
}

/**
 * Source-to-block mapper class for bidirectional mapping.
 * Provides O(1) lookup from source lines to unknit blocks.
 */
export class SourceBlockMapper {
  private index: LineIndex;
  private nodes: UnknitNode[];

  /**
   * Creates a new mapper for the given AST nodes.
   *
   * @param nodes - Array of top-level UnknitNode (typically function nodes)
   */
  constructor(nodes: UnknitNode[]) {
    this.nodes = nodes;
    this.index = buildLineIndex(nodes);
  }

  /**
   * Gets the UnknitNode that owns a specific source line.
   *
   * @param file - Source file path
   * @param line - Line number (1-indexed)
   * @returns The owning UnknitNode, or undefined if line is not covered
   */
  getBlockForLine(file: string, line: number): UnknitNode | undefined {
    return getBlockForLine(this.index, file, line);
  }

  /**
   * Gets the SourceRef for a given UnknitNode.
   *
   * @param node - The UnknitNode to get lines for
   * @returns The SourceRef, or undefined if node has no source reference
   */
  getLinesForBlock(node: UnknitNode): SourceRef | undefined {
    return getLinesForBlock(node);
  }

  /**
   * Gets the ancestor chain from root to the node that covers a specific line.
   *
   * @param file - Source file path
   * @param line - Line number (1-indexed)
   * @returns Array of UnknitNodes from root to leaf, or undefined if line is not covered
   */
  getBlockPath(file: string, line: number): UnknitNode[] | undefined {
    return getBlockPath(this.index, file, line);
  }

  /**
   * Gets all source files that are indexed.
   *
   * @returns Array of file paths
   */
  getIndexedFiles(): string[] {
    return Array.from(this.index.keys());
  }

  /**
   * Gets all line numbers indexed for a specific file.
   *
   * @param file - Source file path
   * @returns Array of line numbers, or empty array if file is not indexed
   */
  getIndexedLines(file: string): number[] {
    const fileIndex = this.index.get(file);
    if (!fileIndex) {
      return [];
    }
    return Array.from(fileIndex.keys()).sort((a, b) => a - b);
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
   * Rebuilds the index after nodes have been modified.
   * Call this if you modify the nodes after construction.
   */
  rebuild(): void {
    this.index = buildLineIndex(this.nodes);
  }
}
