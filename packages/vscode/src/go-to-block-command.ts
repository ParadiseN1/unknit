import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  parseFunctionsWithRecovery,
  SourceBlockMapper,
  type UnknitNode,
} from '@unknit/core';

/**
 * Finds the .unknit file counterpart for a source file.
 *
 * @param sourceFilePath - Path to the source file
 * @returns Path to the .unknit file, or undefined if not found
 */
async function findUnknitFile(
  sourceFilePath: string
): Promise<string | undefined> {
  // The .unknit file is typically alongside the source file with .unknit extension
  const dir = path.dirname(sourceFilePath);
  const baseName = path.basename(sourceFilePath);
  const unknitPath = path.join(dir, `${baseName}.unknit`);

  try {
    await fs.access(unknitPath);
    return unknitPath;
  } catch {
    return undefined;
  }
}

/**
 * Finds the block index in a flat list of nodes that corresponds to a given source file and line.
 * Returns the index of the node for scrolling purposes.
 */
function findBlockIndex(
  nodes: UnknitNode[],
  sourceFile: string,
  line: number
): number | undefined {
  let index = 0;

  // Flatten the nodes with depth-first traversal to match render order
  function traverse(node: UnknitNode): boolean {
    const currentIndex = index;
    index++;

    // Check if this node covers the line
    if (node.sourceRef) {
      const refFile = node.sourceRef.file;
      // Compare file names (source file could be relative or absolute)
      const sourceBaseName = path.basename(sourceFile);
      const refBaseName = path.basename(refFile);

      if (
        (refFile === sourceFile || refBaseName === sourceBaseName) &&
        line >= node.sourceRef.startLine &&
        line <= node.sourceRef.endLine
      ) {
        // Found a matching node, but continue to find most specific (deepest) match
        let foundInChild = false;
        if (node.children) {
          for (const child of node.children) {
            if (traverse(child)) {
              foundInChild = true;
            }
          }
        }
        // If we found a match in children, that's more specific
        // Otherwise this is our match
        if (!foundInChild) {
          index = currentIndex; // Reset to mark this as the found index
          return true;
        }
        return foundInChild;
      }
    }

    // Traverse children
    if (node.children) {
      for (const child of node.children) {
        if (traverse(child)) {
          return true;
        }
      }
    }

    return false;
  }

  for (const node of nodes) {
    if (traverse(node)) {
      return index;
    }
  }

  return undefined;
}

/**
 * Gets the source file path as it appears in source references.
 * This normalizes the path for comparison with source refs in .unknit files.
 */
function getSourceFileForRefs(
  sourceFilePath: string,
  unknitFilePath: string
): string {
  // Source refs are typically relative to the .unknit file location
  const unknitDir = path.dirname(unknitFilePath);
  const relativePath = path.relative(unknitDir, sourceFilePath);
  return relativePath;
}

/**
 * Handles the "Unknit: Go to Block" command.
 * Navigates from the current source file position to the corresponding unknit block.
 */
export async function goToBlockCommand(): Promise<void> {
  // Get the active text editor
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }

  const document = editor.document;
  const sourceFilePath = document.uri.fsPath;

  // Check if this is a supported file type
  const ext = path.extname(sourceFilePath).toLowerCase();
  const supportedExtensions = ['.py', '.ts', '.tsx', '.js', '.jsx'];
  if (!supportedExtensions.includes(ext)) {
    vscode.window.showWarningMessage(
      'Go to Block is only available for Python and TypeScript/JavaScript files'
    );
    return;
  }

  // Find the corresponding .unknit file
  const unknitPath = await findUnknitFile(sourceFilePath);
  if (!unknitPath) {
    vscode.window.showWarningMessage(
      `No .unknit file found for ${path.basename(sourceFilePath)}`
    );
    return;
  }

  // Read and parse the .unknit file
  let unknitContent: string;
  try {
    unknitContent = await fs.readFile(unknitPath, 'utf-8');
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    vscode.window.showErrorMessage(
      `Failed to read .unknit file: ${errorMessage}`
    );
    return;
  }

  const parseResult = parseFunctionsWithRecovery(unknitContent);
  if (parseResult.nodes.length === 0) {
    vscode.window.showWarningMessage('No blocks found in .unknit file');
    return;
  }

  // Get the current cursor position (1-indexed line number)
  const currentLine = editor.selection.active.line + 1;

  // Create a mapper and find the block for this line
  const mapper = new SourceBlockMapper(parseResult.nodes);

  // Get the source file path as it appears in source refs
  const sourceFileForRefs = getSourceFileForRefs(sourceFilePath, unknitPath);

  // Try to find block by relative path first, then by absolute path
  let block = mapper.getBlockForLine(sourceFileForRefs, currentLine);
  if (!block) {
    // Try with just the filename
    const fileName = path.basename(sourceFilePath);
    block = mapper.getBlockForLine(fileName, currentLine);
  }
  if (!block) {
    // Try with absolute path
    block = mapper.getBlockForLine(sourceFilePath, currentLine);
  }

  if (!block) {
    // Check if the line is in any indexed file
    const indexedFiles = mapper.getIndexedFiles();
    if (indexedFiles.length === 0) {
      vscode.window.showWarningMessage(
        'No source references found in .unknit file'
      );
    } else {
      vscode.window.showWarningMessage(
        `No block found for line ${currentLine}. The .unknit file may need to be regenerated.`
      );
    }
    return;
  }

  // Find the block index for scrolling
  const blockIndex = findBlockIndex(
    parseResult.nodes,
    sourceFileForRefs,
    currentLine
  );

  // Open the .unknit file - this will open it in the custom editor
  const unknitUri = vscode.Uri.file(unknitPath);

  try {
    // Open the document first to get the text document
    await vscode.workspace.openTextDocument(unknitUri);

    // Show the document using the custom editor
    await vscode.commands.executeCommand('vscode.openWith', unknitUri, 'unknit.editor');

    // Send a message to scroll to the block
    // Note: We'll need to use a different mechanism since we can't directly
    // access the webview from here. We'll store the target block in workspace state.
    if (blockIndex !== undefined) {
      // Store the block info for the webview to pick up
      const workspaceState = {
        targetBlock: block.name,
        targetLine: currentLine,
        sourceFile: sourceFileForRefs,
        nodeIndex: blockIndex,
      };

      // Use a global state to communicate with the editor
      // The editor provider will check this on next update
      setGoToBlockTarget(unknitPath, workspaceState);
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    vscode.window.showErrorMessage(
      `Failed to open .unknit file: ${errorMessage}`
    );
  }
}

/**
 * Storage for go-to-block targets.
 * Maps unknit file path to target block info.
 */
const goToBlockTargets: Map<
  string,
  {
    targetBlock: string;
    targetLine: number;
    sourceFile: string;
    nodeIndex: number;
  }
> = new Map();

/**
 * Sets a go-to-block target for an unknit file.
 */
export function setGoToBlockTarget(
  unknitPath: string,
  target: {
    targetBlock: string;
    targetLine: number;
    sourceFile: string;
    nodeIndex: number;
  }
): void {
  goToBlockTargets.set(unknitPath, target);
}

/**
 * Gets and clears the go-to-block target for an unknit file.
 */
export function getAndClearGoToBlockTarget(
  unknitPath: string
): { targetBlock: string; targetLine: number; sourceFile: string; nodeIndex: number } | undefined {
  const target = goToBlockTargets.get(unknitPath);
  if (target) {
    goToBlockTargets.delete(unknitPath);
  }
  return target;
}

/**
 * Registers the "Unknit: Go to Block" command.
 */
export function registerGoToBlockCommand(
  _context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand('unknit.goToBlock', goToBlockCommand);
}
