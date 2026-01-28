import * as vscode from 'vscode';
import * as path from 'path';
import {
  parseFunctionsWithRecovery,
  validateNodes,
  validateCoverage,
  type ValidationDiagnostic,
} from '@unknit/core';

/**
 * The output channel for displaying validation results.
 */
let outputChannel: vscode.OutputChannel | undefined;

/**
 * The diagnostics collection for unknit validation.
 */
let diagnosticsCollection: vscode.DiagnosticCollection | undefined;

/**
 * Gets or creates the output channel for validation results.
 */
function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Unknit Validation');
  }
  return outputChannel;
}

/**
 * Gets or creates the diagnostics collection for unknit.
 */
export function getDiagnosticsCollection(
  context: vscode.ExtensionContext
): vscode.DiagnosticCollection {
  if (!diagnosticsCollection) {
    diagnosticsCollection = vscode.languages.createDiagnosticCollection('unknit');
    context.subscriptions.push(diagnosticsCollection);
  }
  return diagnosticsCollection;
}

/**
 * Converts a ValidationDiagnostic severity to VS Code DiagnosticSeverity.
 */
function convertSeverity(severity: 'error' | 'warning' | 'info'): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'info':
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

/**
 * Converts a ValidationDiagnostic to a VS Code Diagnostic.
 */
function convertDiagnostic(diag: ValidationDiagnostic): vscode.Diagnostic {
  // Convert 1-indexed to 0-indexed for VS Code
  const range = new vscode.Range(
    diag.range.startLine - 1,
    diag.range.startColumn - 1,
    diag.range.endLine - 1,
    diag.range.endColumn
  );

  const diagnostic = new vscode.Diagnostic(
    range,
    diag.message,
    convertSeverity(diag.severity)
  );

  diagnostic.source = 'Unknit';

  return diagnostic;
}

/**
 * Runs validation on an unknit file and updates diagnostics.
 * Returns the validation diagnostics.
 */
export async function validateUnknitFile(
  document: vscode.TextDocument,
  diagnostics: vscode.DiagnosticCollection
): Promise<ValidationDiagnostic[]> {
  const allDiagnostics: ValidationDiagnostic[] = [];
  const vscodeDiagnostics: vscode.Diagnostic[] = [];

  const content = document.getText();
  const unknitFilePath = document.uri.fsPath;
  const basePath = path.dirname(unknitFilePath);

  // Parse the unknit file
  const parseResult = parseFunctionsWithRecovery(content);

  // Add parse errors as diagnostics
  if (parseResult.errors.length > 0) {
    for (const error of parseResult.errors) {
      const range = new vscode.Range(
        error.line - 1,
        error.column - 1,
        error.line - 1,
        error.column + 10
      );

      const diagnostic = new vscode.Diagnostic(
        range,
        error.message,
        vscode.DiagnosticSeverity.Error
      );
      diagnostic.source = 'Unknit Parser';
      vscodeDiagnostics.push(diagnostic);
    }
  }

  // If parsing succeeded (or partially succeeded), validate source references
  if (parseResult.nodes.length > 0) {
    // Validate source file existence and line bounds
    const sourceValidation = await validateNodes(parseResult.nodes, { basePath });
    for (const diag of sourceValidation.diagnostics) {
      allDiagnostics.push(diag);
      vscodeDiagnostics.push(convertDiagnostic(diag));
    }

    // Validate coverage (check for overlaps - gaps require expected range which we don't have)
    const coverageValidation = await validateCoverage(parseResult.nodes, { basePath });
    for (const diag of coverageValidation.diagnostics) {
      allDiagnostics.push(diag);
      vscodeDiagnostics.push(convertDiagnostic(diag));
    }
  }

  // Update the diagnostics collection
  diagnostics.set(document.uri, vscodeDiagnostics);

  return allDiagnostics;
}

/**
 * Handles the "Unknit: Validate" command.
 * Validates the current .unknit file and displays results.
 */
export async function validateCommand(
  context: vscode.ExtensionContext
): Promise<void> {
  // Get the active text editor
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }

  const document = editor.document;
  const filePath = document.uri.fsPath;

  // Check if this is an unknit file
  if (!filePath.endsWith('.unknit')) {
    vscode.window.showWarningMessage(
      'Unknit: Validate is only available for .unknit files'
    );
    return;
  }

  const channel = getOutputChannel();
  const diagnostics = getDiagnosticsCollection(context);

  // Clear previous output
  channel.clear();
  channel.appendLine(`Validating: ${filePath}`);
  channel.appendLine('');

  try {
    const validationDiagnostics = await validateUnknitFile(document, diagnostics);

    // Display results in output channel
    if (validationDiagnostics.length === 0) {
      channel.appendLine('✓ No validation issues found');
      vscode.window.showInformationMessage('Unknit: Validation passed - no issues found');
    } else {
      const errors = validationDiagnostics.filter((d) => d.severity === 'error');
      const warnings = validationDiagnostics.filter((d) => d.severity === 'warning');

      channel.appendLine(`Found ${errors.length} error(s) and ${warnings.length} warning(s):`);
      channel.appendLine('');

      for (const diag of validationDiagnostics) {
        const icon = diag.severity === 'error' ? '✗' : '⚠';
        const sourceInfo = diag.sourceRef
          ? ` [${diag.sourceRef.file}:${diag.sourceRef.startLine}-${diag.sourceRef.endLine}]`
          : '';
        channel.appendLine(`${icon} [${diag.severity.toUpperCase()}] ${diag.message}${sourceInfo}`);
      }

      // Show summary notification
      if (errors.length > 0) {
        vscode.window.showErrorMessage(
          `Unknit: Validation found ${errors.length} error(s) and ${warnings.length} warning(s)`
        );
      } else {
        vscode.window.showWarningMessage(
          `Unknit: Validation found ${warnings.length} warning(s)`
        );
      }
    }

    // Show the output channel
    channel.show(true);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    channel.appendLine(`✗ Validation failed: ${errorMessage}`);
    channel.show(true);
    vscode.window.showErrorMessage(`Unknit: Validation failed - ${errorMessage}`);
  }
}

/**
 * Registers the "Unknit: Validate" command.
 */
export function registerValidateCommand(
  context: vscode.ExtensionContext
): vscode.Disposable {
  return vscode.commands.registerCommand('unknit.validate', () =>
    validateCommand(context)
  );
}
