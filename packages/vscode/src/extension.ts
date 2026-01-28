import * as vscode from 'vscode';
import { UnknitEditorProvider } from './unknit-editor-provider';
import { registerGoToBlockCommand } from './go-to-block-command';
import { registerGenerateCommand } from './generate-command';
import { registerValidateCommand } from './validate-command';
import { registerSyncCommand } from './sync-command';
import { registerDiagnosticsProvider } from './diagnostics-provider';

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

  // Register the "Unknit: Validate" command
  context.subscriptions.push(registerValidateCommand(context));

  // Register the "Unknit: Sync" command
  context.subscriptions.push(registerSyncCommand(context));

  // Register diagnostics provider for automatic validation on open/save
  registerDiagnosticsProvider(context);
}

/**
 * Called when the extension is deactivated.
 */
export function deactivate(): void {
  console.log('Unknit extension is now deactivated');
}
