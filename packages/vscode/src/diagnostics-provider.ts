import * as vscode from 'vscode';
import { validateUnknitFile, getDiagnosticsCollection } from './validate-command';

/**
 * Registers event handlers for automatic validation of .unknit files.
 * Validation runs on:
 * - Document open (when a .unknit file is opened)
 * - Document save (when a .unknit file is saved)
 *
 * Diagnostics are displayed:
 * - Invalid source references as red underlines (errors)
 * - Coverage gaps as yellow underlines (warnings)
 * - All issues appear in the Problems panel
 */
export function registerDiagnosticsProvider(
  context: vscode.ExtensionContext
): void {
  const diagnosticsCollection = getDiagnosticsCollection(context);

  // Validate on document open
  const onOpenDisposable = vscode.workspace.onDidOpenTextDocument(
    async (document: vscode.TextDocument) => {
      if (isUnknitDocument(document)) {
        await validateUnknitFile(document, diagnosticsCollection);
      }
    }
  );
  context.subscriptions.push(onOpenDisposable);

  // Validate on document save
  const onSaveDisposable = vscode.workspace.onDidSaveTextDocument(
    async (document: vscode.TextDocument) => {
      if (isUnknitDocument(document)) {
        await validateUnknitFile(document, diagnosticsCollection);
      }
    }
  );
  context.subscriptions.push(onSaveDisposable);

  // Clear diagnostics when document is closed
  const onCloseDisposable = vscode.workspace.onDidCloseTextDocument(
    (document: vscode.TextDocument) => {
      if (isUnknitDocument(document)) {
        diagnosticsCollection.delete(document.uri);
      }
    }
  );
  context.subscriptions.push(onCloseDisposable);

  // Validate any already-open .unknit documents
  // This handles the case where the extension activates with .unknit files already open
  for (const document of vscode.workspace.textDocuments) {
    if (isUnknitDocument(document)) {
      void validateUnknitFile(document, diagnosticsCollection);
    }
  }
}

/**
 * Checks if a document is an unknit file.
 */
function isUnknitDocument(document: vscode.TextDocument): boolean {
  return (
    document.uri.scheme === 'file' && document.uri.fsPath.endsWith('.unknit')
  );
}
