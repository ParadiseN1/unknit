import * as vscode from 'vscode';
import { UnknitEditorProvider } from './unknit-editor-provider';
import { registerGoToBlockCommand } from './go-to-block-command';
import { registerGenerateCommand } from './generate-command';

/**
 * Called when the extension is activated.
 * The extension is activated when a .unknit file is opened.
 */
export function activate(context: vscode.ExtensionContext): void {
  console.log('Unknit extension is now active');

  // Register the custom editor provider for .unknit files
  context.subscriptions.push(UnknitEditorProvider.register(context));

  // Register the "Unknit: Go to Block" command
  context.subscriptions.push(registerGoToBlockCommand(context));

  // Register the "Unknit: Generate" command
  context.subscriptions.push(registerGenerateCommand(context));
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  console.log('Unknit extension is now deactivated');
}
