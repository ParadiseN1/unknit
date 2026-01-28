import * as vscode from 'vscode';
import {
  parseFunctionsWithRecovery,
  NodeType,
  type UnknitNode,
  type ParseResult,
} from '@unknit/core';

// Counter for generating unique node IDs
let nodeIdCounter = 0;

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
   * Parses the unknit content and renders it as styled HTML blocks.
   */
  private getHtmlForWebview(
    webview: vscode.Webview,
    document: vscode.TextDocument
  ): string {
    // Get the document content
    const content = document.getText();
    const fileName = document.fileName.split('/').pop() ?? 'unknit';

    // Parse the unknit content
    const parseResult = parseFunctionsWithRecovery(content);

    // Use a nonce for Content Security Policy
    const nonce = getNonce();

    // Generate HTML for the parsed AST nodes
    const renderedContent = this.renderParseResult(parseResult);

    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
        <title>${escapeHtml(fileName)}</title>
        <style nonce="${nonce}">
          ${this.getStyles()}
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${escapeHtml(fileName)}</h1>
        </div>
        ${renderedContent}
        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();

          // Track collapsed state - all nodes start expanded
          const collapsedNodes = new Set();

          // Initialize from localStorage if available
          const savedState = vscode.getState();
          if (savedState && savedState.collapsedNodes) {
            savedState.collapsedNodes.forEach(id => collapsedNodes.add(id));
            // Apply saved state to DOM
            collapsedNodes.forEach(nodeId => {
              const chevron = document.querySelector('[data-node-id="' + nodeId + '"]');
              if (chevron) {
                chevron.classList.remove('expanded');
                chevron.classList.add('collapsed');
                const children = document.querySelector('[data-children-for="' + nodeId + '"]');
                if (children) {
                  children.classList.remove('expanded');
                  children.classList.add('collapsed');
                }
              }
            });
          }

          // Handle chevron clicks for expand/collapse
          document.addEventListener('click', (event) => {
            const chevron = event.target.closest('.unknit-chevron');
            if (!chevron) return;

            const nodeId = chevron.dataset.nodeId;
            if (!nodeId) return;

            const isCollapsed = chevron.classList.contains('collapsed');

            if (isCollapsed) {
              // Expand
              chevron.classList.remove('collapsed');
              chevron.classList.add('expanded');
              collapsedNodes.delete(nodeId);
            } else {
              // Collapse
              chevron.classList.remove('expanded');
              chevron.classList.add('collapsed');
              collapsedNodes.add(nodeId);
            }

            // Update children visibility
            const children = document.querySelector('[data-children-for="' + nodeId + '"]');
            if (children) {
              if (isCollapsed) {
                children.classList.remove('collapsed');
                children.classList.add('expanded');
              } else {
                children.classList.remove('expanded');
                children.classList.add('collapsed');
              }
            }

            // Save state
            vscode.setState({ collapsedNodes: Array.from(collapsedNodes) });

            // Send message to extension host
            vscode.postMessage({
              type: 'toggleExpand',
              nodeId: nodeId,
              expanded: isCollapsed
            });
          });

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
   * Returns the CSS styles for the webview.
   */
  private getStyles(): string {
    return `
      body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-editor-foreground);
        background-color: var(--vscode-editor-background);
        padding: 20px;
        line-height: 1.6;
        margin: 0;
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
      .unknit-container {
        font-family: var(--vscode-editor-font-family);
        font-size: var(--vscode-editor-font-size);
      }
      .unknit-function {
        margin-bottom: 24px;
        border-left: 3px solid var(--vscode-textLink-foreground);
        padding-left: 12px;
      }
      .unknit-function-header {
        display: flex;
        align-items: baseline;
        gap: 4px;
        margin-bottom: 8px;
      }
      .unknit-keyword {
        color: var(--vscode-symbolIcon-keywordForeground, #c586c0);
        font-weight: 600;
      }
      .unknit-function-name {
        color: var(--vscode-symbolIcon-functionForeground, #dcdcaa);
        font-weight: 500;
      }
      .unknit-params {
        color: var(--vscode-symbolIcon-variableForeground, #9cdcfe);
      }
      .unknit-arrow {
        color: var(--vscode-symbolIcon-operatorForeground, #d4d4d4);
      }
      .unknit-return-type {
        color: var(--vscode-symbolIcon-typeForeground, #4ec9b0);
      }
      .unknit-error-type {
        color: var(--vscode-errorForeground, #f48771);
      }
      .unknit-children {
        margin-left: 20px;
        border-left: 1px solid var(--vscode-panel-border);
        padding-left: 12px;
      }
      .unknit-node {
        margin: 4px 0;
        display: flex;
        align-items: baseline;
        gap: 4px;
      }
      .unknit-call {
        color: var(--vscode-symbolIcon-functionForeground, #dcdcaa);
      }
      .unknit-external-call {
        color: var(--vscode-symbolIcon-referenceForeground, #569cd6);
      }
      .unknit-external-at {
        color: var(--vscode-symbolIcon-referenceForeground, #569cd6);
        font-weight: 600;
      }
      .unknit-block {
        color: var(--vscode-symbolIcon-classForeground, #4fc1ff);
      }
      .unknit-return {
        color: var(--vscode-symbolIcon-keywordForeground, #c586c0);
      }
      .unknit-early-exit {
        color: var(--vscode-warningForeground, #cca700);
      }
      .unknit-error-handler {
        color: var(--vscode-errorForeground, #f48771);
      }
      .unknit-colon {
        color: var(--vscode-editor-foreground);
      }
      .unknit-paren {
        color: var(--vscode-editor-foreground);
        opacity: 0.8;
      }
      .parse-errors {
        background-color: var(--vscode-inputValidation-errorBackground, rgba(255, 0, 0, 0.1));
        border: 1px solid var(--vscode-inputValidation-errorBorder, #f48771);
        border-radius: 4px;
        padding: 12px;
        margin-bottom: 16px;
      }
      .parse-error {
        color: var(--vscode-errorForeground, #f48771);
        margin: 4px 0;
        font-family: var(--vscode-editor-font-family);
        font-size: var(--vscode-editor-font-size);
      }
      .parse-error-location {
        color: var(--vscode-descriptionForeground);
        font-size: 0.9em;
      }
      .unknit-expandable {
        cursor: pointer;
        user-select: none;
      }
      .unknit-chevron {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        margin-right: 4px;
        font-size: 10px;
        color: var(--vscode-foreground);
        opacity: 0.7;
        transition: transform 0.15s ease;
      }
      .unknit-chevron:hover {
        opacity: 1;
      }
      .unknit-chevron.collapsed {
        transform: rotate(0deg);
      }
      .unknit-chevron.expanded {
        transform: rotate(90deg);
      }
      .unknit-children.collapsed {
        display: none;
      }
      .unknit-children.expanded {
        display: block;
      }
      .unknit-node-row {
        display: flex;
        align-items: baseline;
      }
    `;
  }

  /**
   * Renders the parse result (nodes and errors) to HTML.
   */
  private renderParseResult(parseResult: ParseResult): string {
    // Reset node ID counter for each render
    nodeIdCounter = 0;

    let html = '';

    // Show parse errors if any
    if (parseResult.errors.length > 0) {
      html += '<div class="parse-errors">';
      for (const error of parseResult.errors) {
        html += `<div class="parse-error">`;
        html += `<span class="parse-error-location">Line ${error.line}, Col ${error.column}:</span> `;
        html += escapeHtml(error.message);
        html += `</div>`;
      }
      html += '</div>';
    }

    // Render the parsed nodes
    html += '<div class="unknit-container">';
    for (const node of parseResult.nodes) {
      html += this.renderNode(node, 0);
    }
    html += '</div>';

    return html;
  }

  /**
   * Generates a unique node ID for expand/collapse tracking.
   */
  private generateNodeId(): string {
    return `node-${nodeIdCounter++}`;
  }

  /**
   * Renders a chevron icon for expandable nodes.
   */
  private renderChevron(nodeId: string, hasChildren: boolean): string {
    if (!hasChildren) {
      // Placeholder for alignment
      return '<span class="unknit-chevron" style="visibility: hidden;">▶</span>';
    }
    // Right-pointing triangle that rotates 90° when expanded
    return `<span class="unknit-chevron expanded" data-node-id="${nodeId}">▶</span>`;
  }

  /**
   * Renders children with expand/collapse support.
   */
  private renderChildren(
    children: UnknitNode[] | undefined,
    nodeId: string
  ): string {
    if (!children || children.length === 0) {
      return '';
    }
    let html = `<div class="unknit-children expanded" data-children-for="${nodeId}">`;
    for (const child of children) {
      html += this.renderNode(child, 1);
    }
    html += '</div>';
    return html;
  }

  /**
   * Renders a single AST node to HTML.
   */
  private renderNode(node: UnknitNode, _depth: number): string {
    let html = '';

    switch (node.type) {
      case NodeType.fn:
        html += this.renderFunctionNode(node);
        break;
      case NodeType.call:
        html += this.renderCallNode(node);
        break;
      case NodeType.external_call:
        html += this.renderExternalCallNode(node);
        break;
      case NodeType.block:
        html += this.renderBlockNode(node);
        break;
      case NodeType.return:
        html += this.renderReturnNode(node);
        break;
      case NodeType.early_exit:
        html += this.renderEarlyExitNode(node);
        break;
      case NodeType.error_handler:
        html += this.renderErrorHandlerNode(node);
        break;
    }

    return html;
  }

  /**
   * Renders a function definition node.
   */
  private renderFunctionNode(node: UnknitNode): string {
    const nodeId = this.generateNodeId();
    const hasChildren = !!(node.children && node.children.length > 0);

    let html = '<div class="unknit-function">';
    html += '<div class="unknit-function-header unknit-expandable">';

    // Chevron for expand/collapse
    html += this.renderChevron(nodeId, hasChildren);

    // fn keyword
    html += '<span class="unknit-keyword">fn</span>';

    // Function name
    html += `<span class="unknit-function-name">${escapeHtml(node.name)}</span>`;

    // Parameters
    html += '<span class="unknit-paren">(</span>';
    if (node.params && node.params.length > 0) {
      html += `<span class="unknit-params">${escapeHtml(node.params.join(', '))}</span>`;
    }
    html += '<span class="unknit-paren">)</span>';

    // Return type
    html += '<span class="unknit-arrow"> -&gt; </span>';
    html += `<span class="unknit-return-type">${escapeHtml(node.returnType ?? 'void')}</span>`;

    // Error type
    if (node.errorType) {
      html += '<span class="unknit-arrow"> | </span>';
      html += `<span class="unknit-error-type">${escapeHtml(node.errorType)}</span>`;
    }

    html += '<span class="unknit-colon">:</span>';
    html += '</div>';

    // Children with expand/collapse support
    html += this.renderChildren(node.children, nodeId);

    html += '</div>';
    return html;
  }

  /**
   * Renders an internal call node.
   */
  private renderCallNode(node: UnknitNode): string {
    const nodeId = this.generateNodeId();
    const hasChildren = !!(node.children && node.children.length > 0);

    let html = '<div class="unknit-node unknit-node-row unknit-expandable">';
    html += this.renderChevron(nodeId, hasChildren);
    html += `<span class="unknit-call">${escapeHtml(node.name)}</span>`;
    html += '<span class="unknit-paren">()</span>';
    html += '</div>';

    // Children with expand/collapse support
    html += this.renderChildren(node.children, nodeId);

    return html;
  }

  /**
   * Renders an external call node.
   */
  private renderExternalCallNode(node: UnknitNode): string {
    const nodeId = this.generateNodeId();
    const hasChildren = !!(node.children && node.children.length > 0);

    let html = '<div class="unknit-node unknit-node-row unknit-expandable">';
    html += this.renderChevron(nodeId, hasChildren);
    html += '<span class="unknit-external-at">@</span>';
    html += `<span class="unknit-external-call">${escapeHtml(node.name)}</span>`;
    html += '<span class="unknit-paren">()</span>';
    html += '</div>';

    // Children with expand/collapse support
    html += this.renderChildren(node.children, nodeId);

    return html;
  }

  /**
   * Renders a block node.
   */
  private renderBlockNode(node: UnknitNode): string {
    const nodeId = this.generateNodeId();
    const hasChildren = !!(node.children && node.children.length > 0);

    let html = '<div class="unknit-node unknit-node-row unknit-expandable">';
    html += this.renderChevron(nodeId, hasChildren);
    html += `<span class="unknit-block">${escapeHtml(node.name)}</span>`;
    html += '<span class="unknit-colon">:</span>';
    html += '</div>';

    // Children with expand/collapse support
    html += this.renderChildren(node.children, nodeId);

    return html;
  }

  /**
   * Renders a return node.
   */
  private renderReturnNode(node: UnknitNode): string {
    const nodeId = this.generateNodeId();
    const hasChildren = !!(node.children && node.children.length > 0);

    let html = '<div class="unknit-node unknit-node-row unknit-expandable">';
    html += this.renderChevron(nodeId, hasChildren);
    html += '<span class="unknit-return">-&gt;</span>';
    if (node.name) {
      html += ` <span class="unknit-return">${escapeHtml(node.name)}</span>`;
    }
    html += '</div>';

    // Children with expand/collapse support
    html += this.renderChildren(node.children, nodeId);

    return html;
  }

  /**
   * Renders an early exit node.
   */
  private renderEarlyExitNode(node: UnknitNode): string {
    const nodeId = this.generateNodeId();
    const hasChildren = !!(node.children && node.children.length > 0);

    let html = '<div class="unknit-node unknit-node-row unknit-expandable">';
    html += this.renderChevron(nodeId, hasChildren);
    html += '<span class="unknit-early-exit">*-&gt;</span>';
    if (node.name) {
      html += ` <span class="unknit-early-exit">${escapeHtml(node.name)}</span>`;
    }
    html += '</div>';

    // Children with expand/collapse support
    html += this.renderChildren(node.children, nodeId);

    return html;
  }

  /**
   * Renders an error handler node.
   */
  private renderErrorHandlerNode(node: UnknitNode): string {
    const nodeId = this.generateNodeId();
    const hasChildren = !!(node.children && node.children.length > 0);

    let html = '<div class="unknit-node unknit-node-row unknit-expandable">';
    html += this.renderChevron(nodeId, hasChildren);
    html += '<span class="unknit-error-handler">on </span>';
    html += `<span class="unknit-error-handler">${escapeHtml(node.name)}</span>`;
    html += '<span class="unknit-colon">:</span>';
    html += '</div>';

    // Children with expand/collapse support
    html += this.renderChildren(node.children, nodeId);

    return html;
  }

  /**
   * Handles messages received from the webview.
   */
  private handleWebviewMessage(
    message: WebviewMessage,
    _document: vscode.TextDocument
  ): void {
    switch (message.type) {
      case 'ready':
        console.log('Webview is ready');
        break;
      case 'toggleExpand':
        // Log expand/collapse events for debugging
        console.log(
          `Node ${message.nodeId as string} ${message.expanded ? 'expanded' : 'collapsed'}`
        );
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
