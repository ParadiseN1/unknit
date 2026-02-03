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
 * The output channel for displaying file watcher results.
 */
let outputChannel: vscode.OutputChannel | undefined;

/**
 * Gets or creates the output channel for file watcher results.
 */
function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Unknit File Watcher');
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
 * Checks if a file path is a supported source file type (Python, TypeScript, JavaScript).
 */
function isSupportedSourceFile(filePath: string): boolean {
  return getLanguageFromPath(filePath) !== undefined;
}

/**
 * Gets the corresponding .unknit file path for a source file.
 */
function getUnknitFilePath(sourceFilePath: string): string {
  return sourceFilePath + '.unknit';
}

/**
 * Checks if a corresponding .unknit file exists for a source file.
 */
async function hasUnknitCounterpart(sourceFilePath: string): Promise<boolean> {
  const unknitPath = getUnknitFilePath(sourceFilePath);
  try {
    await fs.access(unknitPath);
    return true;
  } catch {
    return false;
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
 * Handles the sync operation for a source file and its corresponding .unknit file.
 */
async function syncUnknitFile(
  sourceFilePath: string,
  unknitFilePath: string
): Promise<void> {
  const channel = getOutputChannel();
  const basePath = path.dirname(unknitFilePath);

  try {
    // Read the .unknit file
    const unknitContent = await fs.readFile(unknitFilePath, 'utf-8');

    // Parse the unknit file
    const parseResult = parseFunctionsWithRecovery(unknitContent);

    if (parseResult.errors.length > 0) {
      channel.appendLine(`[${new Date().toLocaleTimeString()}] Skipping sync for ${path.basename(sourceFilePath)}: parse errors in .unknit file`);
      return;
    }

    if (parseResult.nodes.length === 0) {
      return;
    }

    // Check if this source file is referenced in the unknit file
    const referencedFiles = collectSourceFiles(parseResult.nodes);
    const sourceFileName = path.basename(sourceFilePath);
    const relativeSourcePath = path.relative(basePath, sourceFilePath);

    let isReferenced = false;
    for (const refFile of referencedFiles) {
      if (refFile === sourceFileName || refFile === relativeSourcePath || refFile === sourceFilePath) {
        isReferenced = true;
        break;
      }
    }

    if (!isReferenced) {
      return;
    }

    channel.appendLine(`[${new Date().toLocaleTimeString()}] Source file saved: ${sourceFileName}`);

    let structuralChangesDetected = false;
    const structuralChangeMessages: string[] = [];

    // Create a smart updater with the parsed nodes
    const updater = new SmartUpdater(parseResult.nodes);

    // Extract current function signatures from the saved source file
    const signatures = await extractFunctionSignatures(sourceFilePath, basePath);

    if (signatures.length > 0) {
      // Detect structural changes
      const changeResult = detectStructuralChanges(parseResult.nodes, signatures);

      if (changeResult.regenerationNeeded) {
        structuralChangesDetected = true;
        for (const change of changeResult.changes) {
          structuralChangeMessages.push(change.message);
          channel.appendLine(`  Structural change: ${change.message}`);
        }
      }
    }

    // Serialize the updated nodes back to unknit format
    const updatedContent = serialize(updater.getNodes());

    // Check if content changed
    if (updatedContent !== unknitContent) {
      // Write the updated content
      await fs.writeFile(unknitFilePath, updatedContent, 'utf-8');
      channel.appendLine(`  Updated: ${path.basename(unknitFilePath)}`);

      // Refresh the unknit file in VS Code if it's open
      const unknitDocument = vscode.workspace.textDocuments.find(
        (doc) => doc.uri.fsPath === unknitFilePath
      );
      if (unknitDocument) {
        // The document will be reloaded from disk automatically
        // We just need to trigger a refresh of the custom editor if it's open
        void vscode.commands.executeCommand('workbench.action.files.revert');
      }
    }

    // Show notification if structural changes detected
    if (structuralChangesDetected) {
      const action = await vscode.window.showWarningMessage(
        `Unknit: Structural changes detected in ${sourceFileName} - ${structuralChangeMessages.length} change(s) found`,
        'Regenerate',
        'View Details'
      );

      if (action === 'Regenerate') {
        // Open the source file and execute the generate command
        const sourceUri = vscode.Uri.file(sourceFilePath);
        await vscode.window.showTextDocument(sourceUri);
        await vscode.commands.executeCommand('unknit.generate');
      } else if (action === 'View Details') {
        channel.show(true);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    channel.appendLine(`[${new Date().toLocaleTimeString()}] Sync failed for ${path.basename(sourceFilePath)}: ${errorMessage}`);
  }
}

/**
 * Registers the file system watcher for source files.
 * Monitors source files (.py, .ts, .tsx, .js, .jsx) that have corresponding .unknit files.
 */
export function registerFileWatcher(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];

  // Create file system watcher for Python files
  const pythonWatcher = vscode.workspace.createFileSystemWatcher('**/*.py');

  // Create file system watcher for TypeScript files
  const tsWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,tsx}');

  // Create file system watcher for JavaScript files
  const jsWatcher = vscode.workspace.createFileSystemWatcher('**/*.{js,jsx}');

  // Handler for file save events
  const handleFileSave = async (uri: vscode.Uri): Promise<void> => {
    const sourceFilePath = uri.fsPath;

    // Check if it's a supported source file
    if (!isSupportedSourceFile(sourceFilePath)) {
      return;
    }

    // Check if there's a corresponding .unknit file
    const hasCounterpart = await hasUnknitCounterpart(sourceFilePath);
    if (!hasCounterpart) {
      return;
    }

    // Sync the unknit file
    const unknitFilePath = getUnknitFilePath(sourceFilePath);
    await syncUnknitFile(sourceFilePath, unknitFilePath);
  };

  // Register save handlers for all watchers
  disposables.push(pythonWatcher.onDidChange(handleFileSave));
  disposables.push(tsWatcher.onDidChange(handleFileSave));
  disposables.push(jsWatcher.onDidChange(handleFileSave));

  // Add the watchers themselves to disposables
  disposables.push(pythonWatcher);
  disposables.push(tsWatcher);
  disposables.push(jsWatcher);

  // Create a composite disposable
  const compositeDisposable = vscode.Disposable.from(...disposables);

  // Add to extension subscriptions
  context.subscriptions.push(compositeDisposable);

  // Log activation
  const channel = getOutputChannel();
  channel.appendLine(`[${new Date().toLocaleTimeString()}] File watcher activated - monitoring source files for changes`);

  return compositeDisposable;
}
