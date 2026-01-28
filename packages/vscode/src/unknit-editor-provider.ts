import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  parseFunctionsWithRecovery,
  NodeType,
  type UnknitNode,
  type ParseResult,
  type SourceRef,
} from '@unknit/core';

// Counter for generating unique node IDs
let nodeIdCounter = 0;

/**
 * Mapping from node ID to source reference for source code loading.
 */
interface NodeSourceMap {
  [nodeId: string]: SourceRef | undefined;
}

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

  /**
   * Mapping from node ID to source reference, rebuilt on each render.
   * Used to look up source code when expanding nodes.
   */
  private nodeSourceMap: NodeSourceMap = {};

  /**
   * The directory containing the current .unknit document.
   * Used to resolve relative source file paths.
   */
  private currentDocumentDir: string = '';

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
    // Store the document directory for resolving relative source paths
    this.currentDocumentDir = path.dirname(document.uri.fsPath);

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
      this.handleWebviewMessage(message, document, webviewPanel.webview);
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

          // Track which nodes have loaded source code
          const loadedSourceNodes = new Set();

          // Track which expanded nodes should have source loaded
          const expandedWithSourceNodes = new Set();

          // Save current state
          function saveState() {
            vscode.setState({
              collapsedNodes: Array.from(collapsedNodes),
              expandedWithSourceNodes: Array.from(expandedWithSourceNodes)
            });
          }

          // Initialize from saved state
          const savedState = vscode.getState();
          if (savedState) {
            if (savedState.collapsedNodes) {
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

            // Request source code for previously expanded nodes
            if (savedState.expandedWithSourceNodes) {
              savedState.expandedWithSourceNodes.forEach(nodeId => {
                expandedWithSourceNodes.add(nodeId);
                // Only request if not collapsed
                if (!collapsedNodes.has(nodeId)) {
                  vscode.postMessage({
                    type: 'toggleExpand',
                    nodeId: nodeId,
                    expanded: true
                  });
                }
              });
            }
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

            // Track expanded nodes that have source
            const sourceContainer = document.querySelector('[data-source-for="' + nodeId + '"]');
            if (sourceContainer && isCollapsed) {
              expandedWithSourceNodes.add(nodeId);
            }

            // Save state
            saveState();

            // Send message to extension host
            vscode.postMessage({
              type: 'toggleExpand',
              nodeId: nodeId,
              expanded: isCollapsed
            });
          });

          // Escape HTML for safe display
          function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
          }

          // Message passing between webview and extension
          window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
              case 'sourceCode':
                displaySourceCode(message);
                break;
              case 'sourceCodeError':
                displaySourceError(message);
                break;
              default:
                console.log('Received message:', message);
            }
          });

          // Display source code in the appropriate container
          function displaySourceCode(message) {
            const container = document.querySelector('[data-source-for="' + message.nodeId + '"]');
            if (!container) return;

            // Build the source code HTML with line numbers
            const lines = message.sourceCode.split('\\n');
            let html = '<div class="unknit-source-header">';
            html += '<span class="unknit-source-file">' + escapeHtml(message.file) + '</span>';
            html += '<span class="unknit-source-lines">lines ' + message.startLine + '-' + message.endLine + '</span>';
            html += '</div>';
            html += '<div class="unknit-source-code">';

            for (let i = 0; i < lines.length; i++) {
              const lineNum = message.startLine + i;
              html += '<div class="unknit-source-line">';
              html += '<span class="unknit-line-number">' + lineNum + '</span>';
              html += '<span class="unknit-line-content">' + escapeHtml(lines[i]) + '</span>';
              html += '</div>';
            }

            html += '</div>';

            container.innerHTML = html;
            container.classList.add('loaded');
            container.classList.remove('error');
            loadedSourceNodes.add(message.nodeId);
          }

          // Display error message in the source container
          function displaySourceError(message) {
            const container = document.querySelector('[data-source-for="' + message.nodeId + '"]');
            if (!container) return;

            container.innerHTML = '<span>' + escapeHtml(message.error) + '</span>';
            container.classList.add('loaded', 'error');
          }
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
      .unknit-source-container {
        display: none;
        margin: 8px 0;
        padding: 8px 12px;
        background-color: var(--vscode-textCodeBlock-background, rgba(0, 0, 0, 0.2));
        border-radius: 4px;
        border-left: 3px solid var(--vscode-textLink-activeForeground, #4ec9b0);
      }
      .unknit-source-container.loaded {
        display: block;
      }
      .unknit-source-container.error {
        display: block;
        color: var(--vscode-errorForeground, #f48771);
        border-left-color: var(--vscode-errorForeground, #f48771);
      }
      .unknit-source-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        padding-bottom: 4px;
        border-bottom: 1px solid var(--vscode-panel-border);
        font-size: 0.9em;
        color: var(--vscode-descriptionForeground);
      }
      .unknit-source-file {
        font-weight: 500;
      }
      .unknit-source-lines {
        opacity: 0.8;
      }
      .unknit-source-code {
        font-family: var(--vscode-editor-font-family);
        font-size: var(--vscode-editor-font-size);
        line-height: 1.4;
        white-space: pre;
        overflow-x: auto;
        tab-size: 4;
      }
      .unknit-source-line {
        display: flex;
      }
      .unknit-line-number {
        min-width: 40px;
        padding-right: 12px;
        text-align: right;
        color: var(--vscode-editorLineNumber-foreground, #858585);
        user-select: none;
      }
      .unknit-line-content {
        flex: 1;
      }
      .unknit-source-loading {
        color: var(--vscode-descriptionForeground);
        font-style: italic;
      }
    `;
  }

  /**
   * Renders the parse result (nodes and errors) to HTML.
   */
  private renderParseResult(parseResult: ParseResult): string {
    // Reset node ID counter and source map for each render
    nodeIdCounter = 0;
    this.nodeSourceMap = {};

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
   * Also stores the node's source reference in the node source map.
   */
  private generateNodeId(node: UnknitNode): string {
    const id = `node-${nodeIdCounter++}`;
    this.nodeSourceMap[id] = node.sourceRef;
    return id;
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
    nodeId: string,
    hasSourceRef: boolean
  ): string {
    // Always render the container if we have children OR source ref
    if ((!children || children.length === 0) && !hasSourceRef) {
      return '';
    }

    let html = `<div class="unknit-children expanded" data-children-for="${nodeId}">`;

    // Add source code container (hidden by default, shown when source is loaded)
    if (hasSourceRef) {
      html += `<div class="unknit-source-container" data-source-for="${nodeId}"></div>`;
    }

    // Render child nodes
    if (children) {
      for (const child of children) {
        html += this.renderNode(child, 1);
      }
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
    const nodeId = this.generateNodeId(node);
    const hasChildren = !!(node.children && node.children.length > 0);
    const hasSourceRef = !!node.sourceRef;
    const isExpandable = hasChildren || hasSourceRef;

    let html = '<div class="unknit-function">';
    html += '<div class="unknit-function-header unknit-expandable">';

    // Chevron for expand/collapse
    html += this.renderChevron(nodeId, isExpandable);

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
    html += this.renderChildren(node.children, nodeId, hasSourceRef);

    html += '</div>';
    return html;
  }

  /**
   * Renders an internal call node.
   */
  private renderCallNode(node: UnknitNode): string {
    const nodeId = this.generateNodeId(node);
    const hasChildren = !!(node.children && node.children.length > 0);
    const hasSourceRef = !!node.sourceRef;
    const isExpandable = hasChildren || hasSourceRef;

    let html = '<div class="unknit-node unknit-node-row unknit-expandable">';
    html += this.renderChevron(nodeId, isExpandable);
    html += `<span class="unknit-call">${escapeHtml(node.name)}</span>`;
    html += '<span class="unknit-paren">()</span>';
    html += '</div>';

    // Children with expand/collapse support
    html += this.renderChildren(node.children, nodeId, hasSourceRef);

    return html;
  }

  /**
   * Renders an external call node.
   */
  private renderExternalCallNode(node: UnknitNode): string {
    const nodeId = this.generateNodeId(node);
    const hasChildren = !!(node.children && node.children.length > 0);
    const hasSourceRef = !!node.sourceRef;
    const isExpandable = hasChildren || hasSourceRef;

    let html = '<div class="unknit-node unknit-node-row unknit-expandable">';
    html += this.renderChevron(nodeId, isExpandable);
    html += '<span class="unknit-external-at">@</span>';
    html += `<span class="unknit-external-call">${escapeHtml(node.name)}</span>`;
    html += '<span class="unknit-paren">()</span>';
    html += '</div>';

    // Children with expand/collapse support
    html += this.renderChildren(node.children, nodeId, hasSourceRef);

    return html;
  }

  /**
   * Renders a block node.
   */
  private renderBlockNode(node: UnknitNode): string {
    const nodeId = this.generateNodeId(node);
    const hasChildren = !!(node.children && node.children.length > 0);
    const hasSourceRef = !!node.sourceRef;
    const isExpandable = hasChildren || hasSourceRef;

    let html = '<div class="unknit-node unknit-node-row unknit-expandable">';
    html += this.renderChevron(nodeId, isExpandable);
    html += `<span class="unknit-block">${escapeHtml(node.name)}</span>`;
    html += '<span class="unknit-colon">:</span>';
    html += '</div>';

    // Children with expand/collapse support
    html += this.renderChildren(node.children, nodeId, hasSourceRef);

    return html;
  }

  /**
   * Renders a return node.
   */
  private renderReturnNode(node: UnknitNode): string {
    const nodeId = this.generateNodeId(node);
    const hasChildren = !!(node.children && node.children.length > 0);
    const hasSourceRef = !!node.sourceRef;
    const isExpandable = hasChildren || hasSourceRef;

    let html = '<div class="unknit-node unknit-node-row unknit-expandable">';
    html += this.renderChevron(nodeId, isExpandable);
    html += '<span class="unknit-return">-&gt;</span>';
    if (node.name) {
      html += ` <span class="unknit-return">${escapeHtml(node.name)}</span>`;
    }
    html += '</div>';

    // Children with expand/collapse support
    html += this.renderChildren(node.children, nodeId, hasSourceRef);

    return html;
  }

  /**
   * Renders an early exit node.
   */
  private renderEarlyExitNode(node: UnknitNode): string {
    const nodeId = this.generateNodeId(node);
    const hasChildren = !!(node.children && node.children.length > 0);
    const hasSourceRef = !!node.sourceRef;
    const isExpandable = hasChildren || hasSourceRef;

    let html = '<div class="unknit-node unknit-node-row unknit-expandable">';
    html += this.renderChevron(nodeId, isExpandable);
    html += '<span class="unknit-early-exit">*-&gt;</span>';
    if (node.name) {
      html += ` <span class="unknit-early-exit">${escapeHtml(node.name)}</span>`;
    }
    html += '</div>';

    // Children with expand/collapse support
    html += this.renderChildren(node.children, nodeId, hasSourceRef);

    return html;
  }

  /**
   * Renders an error handler node.
   */
  private renderErrorHandlerNode(node: UnknitNode): string {
    const nodeId = this.generateNodeId(node);
    const hasChildren = !!(node.children && node.children.length > 0);
    const hasSourceRef = !!node.sourceRef;
    const isExpandable = hasChildren || hasSourceRef;

    let html = '<div class="unknit-node unknit-node-row unknit-expandable">';
    html += this.renderChevron(nodeId, isExpandable);
    html += '<span class="unknit-error-handler">on </span>';
    html += `<span class="unknit-error-handler">${escapeHtml(node.name)}</span>`;
    html += '<span class="unknit-colon">:</span>';
    html += '</div>';

    // Children with expand/collapse support
    html += this.renderChildren(node.children, nodeId, hasSourceRef);

    return html;
  }

  /**
   * Handles messages received from the webview.
   */
  private handleWebviewMessage(
    message: WebviewMessage,
    _document: vscode.TextDocument,
    webview: vscode.Webview
  ): void {
    switch (message.type) {
      case 'ready':
        console.log('Webview is ready');
        break;
      case 'toggleExpand':
        this.handleToggleExpand(message, webview);
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  /**
   * Handles expand/collapse toggle events.
   * When a node is expanded, loads and sends source code to the webview.
   */
  private handleToggleExpand(
    message: WebviewMessage,
    webview: vscode.Webview
  ): void {
    const nodeId = message.nodeId as string;
    const expanded = message.expanded as boolean;

    if (!expanded) {
      // Node was collapsed, nothing to do
      return;
    }

    // Look up the source reference for this node
    const sourceRef = this.nodeSourceMap[nodeId];
    if (!sourceRef) {
      // No source reference, nothing to load
      return;
    }

    // Load and send source code asynchronously
    this.loadAndSendSourceCode(nodeId, sourceRef, webview);
  }

  /**
   * Loads source code from the file system and sends it to the webview.
   */
  private async loadAndSendSourceCode(
    nodeId: string,
    sourceRef: SourceRef,
    webview: vscode.Webview
  ): Promise<void> {
    try {
      // Resolve the source file path relative to the unknit document
      const sourceFilePath = path.isAbsolute(sourceRef.file)
        ? sourceRef.file
        : path.join(this.currentDocumentDir, sourceRef.file);

      // Read the source file
      const content = await fs.readFile(sourceFilePath, 'utf-8');
      const lines = content.split('\n');

      // Extract the relevant lines (1-indexed to 0-indexed)
      const startLine = sourceRef.startLine - 1;
      const endLine = sourceRef.endLine;
      const sourceLines = lines.slice(startLine, endLine);

      // Send the source code to the webview
      webview.postMessage({
        type: 'sourceCode',
        nodeId,
        sourceCode: sourceLines.join('\n'),
        file: sourceRef.file,
        startLine: sourceRef.startLine,
        endLine: sourceRef.endLine,
        language: this.getLanguageFromPath(sourceFilePath),
      });
    } catch (error) {
      // Send an error message to the webview
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      webview.postMessage({
        type: 'sourceCodeError',
        nodeId,
        error: `Failed to load source: ${errorMessage}`,
      });
    }
  }

  /**
   * Determines the programming language from a file path.
   */
  private getLanguageFromPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap: Record<string, string> = {
      '.py': 'python',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp',
      '.cs': 'csharp',
      '.rb': 'ruby',
      '.php': 'php',
      '.swift': 'swift',
      '.kt': 'kotlin',
      '.scala': 'scala',
      '.sh': 'shell',
      '.bash': 'shell',
      '.zsh': 'shell',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.xml': 'xml',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.less': 'less',
      '.sql': 'sql',
      '.md': 'markdown',
    };
    return languageMap[ext] ?? 'plaintext';
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
