import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  parseFunctionsWithRecovery,
  serialize,
  SmartUpdater,
  detectStructuralChanges,
  type FunctionSignature,
  type UnknitNode,
} from '@unknit/core';
import {
  readPythonSource,
  readTypeScriptSource,
} from '@unknit/generate';

/**
 * The output channel for displaying sync results.
 */
let outputChannel: vscode.OutputChannel | undefined;

/**
 * Gets or creates the output channel for sync results.
 */
function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Unknit Sync');
  }
  return outputChannel;
}

/**
 * Gets the language type from a file path.
 */
function getLanguageFromPath(filePath: string): 'python' | 'typescript' | 'javascript' | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'py') {
    return 'python';
  }
  if (ext === 'ts' || ext === 'tsx') {
    return 'typescript';
  }
  if (ext === 'js' || ext === 'jsx') {
    return 'javascript';
  }
  return undefined;
}

/**
 * Reads the original content of a source file from disk.
 */
async function readSourceFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Extracts function signatures from source code for structural change detection.
 */
async function extractFunctionSignatures(
  sourceFilePath: string,
  basePath: string
): Promise<FunctionSignature[]> {
  const language = getLanguageFromPath(sourceFilePath);
  const relativePath = path.relative(basePath, sourceFilePath);

  try {
    if (language === 'python') {
      const metadata = await readPythonSource(sourceFilePath, {
        internalPackages: [],
        externalPackages: [],
      });
      return metadata.functions.map((fn) => ({
        name: fn.name,
        params: fn.params,
        file: relativePath,
        startLine: fn.startLine,
        endLine: fn.endLine,
      }));
    } else if (language) {
      // TypeScript or JavaScript
      const metadata = await readTypeScriptSource(sourceFilePath, {
        internalPackages: [],
        externalPackages: [],
      });
      return metadata.functions.map((fn) => ({
        name: fn.name,
        params: fn.params,
        file: relativePath,
        startLine: fn.startLine,
        endLine: fn.endLine,
      }));
    }
  } catch (error) {
    console.error('Failed to extract function signatures:', error);
  }

  return [];
}

/**
 * Collects all unique source file paths referenced by unknit nodes.
 */
function collectSourceFiles(nodes: UnknitNode[]): Set<string> {
  const files = new Set<string>();

  function collectFromNode(node: UnknitNode): void {
    if (node.sourceRef) {
      files.add(node.sourceRef.file);
    }
    if (node.children) {
      for (const child of node.children) {
        collectFromNode(child);
      }
    }
  }

  for (const node of nodes) {
    collectFromNode(node);
  }

  return files;
}

/**
 * Handles the "Unknit: Sync" command.
 * Syncs the unknit file after source changes.
 */
export async function syncCommand(
  _context: vscode.ExtensionContext
): Promise<void> {
  // Get the active text editor
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }

  const document = editor.document;
  const unknitFilePath = document.uri.fsPath;

  // Check if this is an unknit file
  if (!unknitFilePath.endsWith('.unknit')) {
    vscode.window.showWarningMessage(
      'Unknit: Sync is only available for .unknit files'
    );
    return;
  }

  const channel = getOutputChannel();
  const basePath = path.dirname(unknitFilePath);

  // Clear previous output
  channel.clear();
  channel.appendLine(`Syncing: ${unknitFilePath}`);
  channel.appendLine('');

  try {
    // Parse the unknit file
    const content = document.getText();
    const parseResult = parseFunctionsWithRecovery(content);

    if (parseResult.errors.length > 0) {
      channel.appendLine('Parse errors found:');
      for (const error of parseResult.errors) {
        channel.appendLine(`  Line ${error.line}: ${error.message}`);
      }
      channel.appendLine('');
      channel.appendLine('Please fix parse errors before syncing.');
      channel.show(true);
      vscode.window.showErrorMessage('Unknit: Cannot sync - parse errors found');
      return;
    }

    if (parseResult.nodes.length === 0) {
      vscode.window.showWarningMessage('Unknit: No functions found to sync');
      return;
    }

    // Collect all referenced source files
    const sourceFiles = collectSourceFiles(parseResult.nodes);

    if (sourceFiles.size === 0) {
      vscode.window.showWarningMessage('Unknit: No source references found to sync');
      return;
    }

    let structuralChangesDetected = false;
    const structuralChangeMessages: string[] = [];

    // Create a smart updater with the parsed nodes
    const updater = new SmartUpdater(parseResult.nodes);

    // Process each referenced source file
    for (const relativeFile of sourceFiles) {
      const absoluteFile = path.isAbsolute(relativeFile)
        ? relativeFile
        : path.join(basePath, relativeFile);

      channel.appendLine(`Checking: ${relativeFile}`);

      // Read the current source file
      const currentContent = await readSourceFile(absoluteFile);
      if (!currentContent) {
        channel.appendLine(`  Warning: Source file not found: ${absoluteFile}`);
        continue;
      }

      // For line shift detection, we need the original content
      // Since we don't have a stored snapshot, we'll skip line shift updates
      // and focus on structural change detection

      // Extract current function signatures
      const signatures = await extractFunctionSignatures(absoluteFile, basePath);

      if (signatures.length > 0) {
        // Detect structural changes
        const changeResult = detectStructuralChanges(parseResult.nodes, signatures);

        if (changeResult.regenerationNeeded) {
          structuralChangesDetected = true;
          for (const change of changeResult.changes) {
            structuralChangeMessages.push(change.message);
            channel.appendLine(`  Structural change: ${change.message}`);
          }
        } else {
          channel.appendLine(`  No structural changes detected`);
        }
      }
    }

    // Serialize the updated nodes back to unknit format
    const updatedContent = serialize(updater.getNodes());

    // Check if content changed
    if (updatedContent !== content) {
      // Apply the edit to the document
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(content.length)
      );

      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, fullRange, updatedContent);
      await vscode.workspace.applyEdit(edit);

      // Save the document
      await document.save();

      channel.appendLine('');
      channel.appendLine(`Updated and saved: ${unknitFilePath}`);
    } else {
      channel.appendLine('');
      channel.appendLine('No line number updates needed.');
    }

    // Show summary
    channel.appendLine('');
    if (structuralChangesDetected) {
      channel.appendLine('--- Structural Changes Detected ---');
      for (const msg of structuralChangeMessages) {
        channel.appendLine(`  - ${msg}`);
      }
      channel.appendLine('');
      channel.appendLine('Consider regenerating the unknit file to reflect these changes.');

      // Show notification with regenerate option
      const action = await vscode.window.showWarningMessage(
        `Unknit: Structural changes detected - ${structuralChangeMessages.length} change(s) found`,
        'Regenerate',
        'View Details'
      );

      if (action === 'Regenerate') {
        // Execute the generate command
        await vscode.commands.executeCommand('unknit.generate');
      } else if (action === 'View Details') {
        channel.show(true);
      }
    } else {
      channel.appendLine('Sync completed successfully.');
      vscode.window.showInformationMessage('Unknit: Sync completed');
    }

    channel.show(true);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    channel.appendLine(`Sync failed: ${errorMessage}`);
    channel.show(true);
    vscode.window.showErrorMessage(`Unknit: Sync failed - ${errorMessage}`);
  }
}

/**
 * Registers the "Unknit: Sync" command.
 */
export function registerSyncCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand('unknit.sync', () =>
    syncCommand(context)
  );
}
