import * as vscode from 'vscode';

/**
 * Called when the extension is activated.
 * The extension is activated when a .unknit file is opened.
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('Unknit extension is now active');

  // Register the custom editor provider for .unknit files
  // This will be implemented in US-024
  void context;
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  console.log('Unknit extension is now deactivated');
}
