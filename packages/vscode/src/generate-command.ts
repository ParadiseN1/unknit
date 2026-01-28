import * as vscode from 'vscode';
import * as path from 'path';
import { generate } from '@unknit/generate';

/**
 * Supported file extensions for generation.
 */
const SUPPORTED_EXTENSIONS = ['.py', '.ts', '.tsx', '.js', '.jsx'];

/**
 * Check if a file path has a supported extension for generation.
 */
function isSupportedFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/**
 * Gets the Anthropic API key from VS Code settings or environment.
 * Returns undefined if not found.
 */
function getApiKey(): string | undefined {
  // First check VS Code settings
  const config = vscode.workspace.getConfiguration('unknit');
  const settingsKey = config.get<string>('anthropicApiKey');
  if (settingsKey) {
    return settingsKey;
  }

  // Fall back to environment variable
  return process.env['ANTHROPIC_API_KEY'];
}

/**
 * Handles the "Unknit: Generate" command.
 * Generates an unknit file for the current source file.
 */
export async function generateCommand(): Promise<void> {
  // Get the active text editor
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }

  const document = editor.document;
  const sourceFilePath = document.uri.fsPath;

  // Check if this is a supported file type
  if (!isSupportedFile(sourceFilePath)) {
    vscode.window.showWarningMessage(
      `Unknit: Generate is only available for Python and TypeScript/JavaScript files. ` +
        `Supported extensions: ${SUPPORTED_EXTENSIONS.join(', ')}`
    );
    return;
  }

  // Get the API key
  const apiKey = getApiKey();
  if (!apiKey) {
    const result = await vscode.window.showErrorMessage(
      'Anthropic API key not found. Set it in VS Code settings (unknit.anthropicApiKey) ' +
        'or as the ANTHROPIC_API_KEY environment variable.',
      'Open Settings'
    );

    if (result === 'Open Settings') {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'unknit.anthropicApiKey'
      );
    }
    return;
  }

  // Get project root (workspace folder or file directory)
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
  const projectRoot = workspaceFolder?.uri.fsPath ?? path.dirname(sourceFilePath);

  // Show progress notification during generation
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Unknit: Generating',
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: `Processing ${path.basename(sourceFilePath)}...` });

      try {
        const result = await generate(sourceFilePath, {
          apiKey,
          projectRoot,
          writeOutput: true,
          validate: true,
        });

        if (result.success && result.outputPath) {
          // Show success notification
          vscode.window.showInformationMessage(
            `Unknit file generated: ${path.basename(result.outputPath)}`
          );

          // Open the generated .unknit file
          const unknitUri = vscode.Uri.file(result.outputPath);
          await vscode.workspace.openTextDocument(unknitUri);
          await vscode.commands.executeCommand(
            'vscode.openWith',
            unknitUri,
            'unknit.editor'
          );
        } else {
          // Show error notification with details
          const errorMessages = result.errors?.map((e) => e.message) ?? ['Unknown error'];
          const primaryError = errorMessages[0] ?? 'Generation failed';

          const moreErrors = errorMessages.length > 1 ? ` (+${errorMessages.length - 1} more)` : '';

          vscode.window.showErrorMessage(`Unknit: ${primaryError}${moreErrors}`);

          // Log all errors to the output channel
          const outputChannel = vscode.window.createOutputChannel('Unknit');
          outputChannel.appendLine('Generation failed with errors:');
          for (const error of result.errors ?? []) {
            outputChannel.appendLine(`  - [${error.code}] ${error.message}`);
          }
          outputChannel.show(true);
        }
      } catch (error) {
        // Handle unexpected errors
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        vscode.window.showErrorMessage(`Unknit: Generation failed - ${errorMessage}`);
      }
    }
  );
}

/**
 * Registers the "Unknit: Generate" command.
 */
export function registerGenerateCommand(
  _context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand('unknit.generate', generateCommand);
}
