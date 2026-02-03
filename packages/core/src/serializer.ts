/**
 * Serializer for the Unknit language.
 * Converts AST nodes back to unknit syntax.
 */

import { UnknitNode, NodeType, SourceRef } from './types.js';

/**
 * Serialize a SourceRef to the {{src:file:line-line}} format.
 * Returns the formatted string, or empty string if no sourceRef.
 */
export function serializeSourceRef(sourceRef?: SourceRef): string {
  if (!sourceRef) {
    return '';
  }

  const { file, startLine, endLine } = sourceRef;

  if (startLine === endLine) {
    return ` {{src:${file}:${startLine}}}`;
  }

  return ` {{src:${file}:${startLine}-${endLine}}}`;
}

/**
 * Serialize function parameters to the (param1, param2, optional?) format.
 */
function serializeParams(params?: string[]): string {
  if (!params || params.length === 0) {
    return '()';
  }
  return `(${params.join(', ')})`;
}

/**
 * Serialize return type with optional error type.
 */
function serializeReturnType(returnType?: string, errorType?: string): string {
  if (!returnType) {
    return '';
  }

  if (errorType) {
    return ` -> ${returnType} | ${errorType}`;
  }

  return ` -> ${returnType}`;
}

/**
 * Serialize a function definition node.
 */
function serializeFunctionDefinition(node: UnknitNode): string {
  const params = serializeParams(node.params);
  const returnType = serializeReturnType(node.returnType, node.errorType);
  const sourceRef = serializeSourceRef(node.sourceRef);

  return `fn ${node.name}${params}${returnType}:${sourceRef}`;
}

/**
 * Serialize a call node (internal call).
 */
function serializeCall(node: UnknitNode): string {
  const sourceRef = serializeSourceRef(node.sourceRef);
  return `${node.name}()${sourceRef}`;
}

/**
 * Serialize an external call node.
 */
function serializeExternalCall(node: UnknitNode): string {
  const sourceRef = serializeSourceRef(node.sourceRef);
  return `@${node.name}()${sourceRef}`;
}

/**
 * Serialize a block node.
 */
function serializeBlock(node: UnknitNode): string {
  const sourceRef = serializeSourceRef(node.sourceRef);
  return `${node.name}:${sourceRef}`;
}

/**
 * Serialize a return node.
 */
function serializeReturn(node: UnknitNode): string {
  const sourceRef = serializeSourceRef(node.sourceRef);
  if (node.name) {
    return `-> ${node.name}${sourceRef}`;
  }
  return `->${sourceRef}`;
}

/**
 * Serialize an early exit node.
 */
function serializeEarlyExit(node: UnknitNode): string {
  const sourceRef = serializeSourceRef(node.sourceRef);
  if (node.name) {
    return `*-> ${node.name}${sourceRef}`;
  }
  return `*->${sourceRef}`;
}

/**
 * Serialize an error handler node.
 */
function serializeErrorHandler(node: UnknitNode): string {
  const sourceRef = serializeSourceRef(node.sourceRef);
  return `on ${node.name}:${sourceRef}`;
}

/**
 * Serialize a single node (without children) based on its type.
 */
function serializeNodeLine(node: UnknitNode): string {
  switch (node.type) {
    case NodeType.fn:
      return serializeFunctionDefinition(node);
    case NodeType.call:
      return serializeCall(node);
    case NodeType.external_call:
      return serializeExternalCall(node);
    case NodeType.block:
      return serializeBlock(node);
    case NodeType.return:
      return serializeReturn(node);
    case NodeType.early_exit:
      return serializeEarlyExit(node);
    case NodeType.error_handler:
      return serializeErrorHandler(node);
    default:
      // Fallback for unknown types - treat as block
      return `${node.name}:`;
  }
}

/**
 * Serialize a node and its children with proper indentation.
 * Uses 2 spaces per indentation level.
 */
function serializeNodeWithChildren(
  node: UnknitNode,
  indentLevel: number
): string {
  const indent = '  '.repeat(indentLevel);
  const lines: string[] = [];

  // Serialize the node itself
  lines.push(`${indent}${serializeNodeLine(node)}`);

  // Serialize children if present
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      lines.push(serializeNodeWithChildren(child, indentLevel + 1));
    }
  }

  return lines.join('\n');
}

/**
 * Serialize an array of top-level function nodes to unknit syntax.
 * Each function is separated by a blank line.
 */
export function serialize(nodes: UnknitNode[]): string {
  const serialized: string[] = [];

  for (const node of nodes) {
    if (node.type === NodeType.fn) {
      // Top-level function - no initial indent
      const lines: string[] = [];
      lines.push(serializeNodeLine(node));

      // Serialize children with 1 level indent
      if (node.children && node.children.length > 0) {
        for (const child of node.children) {
          lines.push(serializeNodeWithChildren(child, 1));
        }
      }

      serialized.push(lines.join('\n'));
    } else {
      // Non-function top-level node (shouldn't happen normally)
      serialized.push(serializeNodeWithChildren(node, 0));
    }
  }

  // Join functions with blank lines between them
  return serialized.join('\n\n') + '\n';
}

/**
 * Serializer class for Unknit AST nodes.
 * Provides object-oriented interface for serialization.
 */
export class Serializer {
  /**
   * Serialize an array of function nodes to unknit syntax.
   */
  serialize(nodes: UnknitNode[]): string {
    return serialize(nodes);
  }

  /**
   * Serialize a single node to unknit syntax.
   * Does not include trailing newline.
   */
  serializeNode(node: UnknitNode, indentLevel: number = 0): string {
    return serializeNodeWithChildren(node, indentLevel);
  }

  /**
   * Serialize a source reference to the {{src:file:line-line}} format.
   */
  serializeSourceRef(sourceRef?: SourceRef): string {
    return serializeSourceRef(sourceRef);
  }
}
