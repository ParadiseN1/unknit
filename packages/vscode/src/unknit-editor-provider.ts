import * as vscode from 'vscode';

/**
 * Custom editor provider for .unknit files.
 * Implements CustomTextEditorProvider to display unknit files
 * as formatted HTML in a webview panel.
 */
export class UnknitEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'unknit.editor';

  /**
   * Register the custom editor provider with VS Code.
   */
  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new UnknitEditorProvider(context);
    const registration = vscode.window.registerCustomEditorProvider(
      UnknitEditorProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    );
    return registration;
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Called when a custom editor is opened.
   * Sets up the webview content and event handlers.
   */
  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // Configure the webview
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    // Initial render
    this.updateWebview(webviewPanel.webview, document);

    // Update the webview when the document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          this.updateWebview(webviewPanel.webview, document);
        }
      }
    );

    // Clean up when the panel is closed
    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
    });

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage((message: WebviewMessage) => {
      this.handleWebviewMessage(message, document);
    });
  }

  /**
   * Updates the webview content with the current document state.
   * This is a placeholder that will be fully implemented in US-025.
   */
  private updateWebview(
    webview: vscode.Webview,
    document: vscode.TextDocument
  ): void {
    webview.html = this.getHtmlForWebview(webview, document);
  }

  /**
   * Generates the HTML content for the webview.
   * This is a placeholder that will be fully implemented in US-025.
   */
  private getHtmlForWebview(
    webview: vscode.Webview,
    document: vscode.TextDocument
  ): string {
    // Get the document content
    const content = document.getText();
    const fileName = document.fileName.split('/').pop() ?? 'unknit';

    // Use a nonce for Content Security Policy
    const nonce = getNonce();

    // Placeholder HTML - will be replaced with proper rendering in US-025
    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
        <title>${escapeHtml(fileName)}</title>
        <style nonce="${nonce}">
          body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-editor-foreground);
            background-color: var(--vscode-editor-background);
            padding: 20px;
            line-height: 1.6;
          }
          .header {
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
          }
          .header h1 {
            margin: 0;
            font-size: 1.4em;
            font-weight: 500;
          }
          .content {
            white-space: pre-wrap;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
          }
          .placeholder-message {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            margin-bottom: 20px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${escapeHtml(fileName)}</h1>
        </div>
        <div class="placeholder-message">
          Unknit Editor - Custom rendering will be implemented in US-025
        </div>
        <div class="content">${escapeHtml(content)}</div>
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();

          // Message passing between webview and extension
          window.addEventListener('message', event => {
            const message = event.data;
            // Handle messages from extension - will be implemented in future stories
            console.log('Received message:', message);
          });
        </script>
      </body>
      </html>
    `;
  }

  /**
   * Handles messages received from the webview.
   * Will be implemented further in US-026 (expand/collapse) and US-028 (navigation).
   */
  private handleWebviewMessage(
    message: WebviewMessage,
    _document: vscode.TextDocument
  ): void {
    switch (message.type) {
      case 'ready':
        console.log('Webview is ready');
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }
}

/**
 * Message type for webview communication.
 */
interface WebviewMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * Generate a nonce for Content Security Policy.
 */
function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Escape HTML special characters to prevent XSS.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
