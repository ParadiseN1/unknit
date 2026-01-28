/**
 * Parser for the Unknit language.
 * Builds an AST from tokens produced by the tokenizer.
 */

import { Tokenizer, Token, TokenType } from './tokenizer.js';
import { UnknitNode, NodeType, SourceRef } from './types.js';

/**
 * Error during parsing.
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number
  ) {
    super(`${message} at line ${line}, column ${column}`);
    this.name = 'ParseError';
  }
}

/**
 * Parser for Unknit syntax.
 * Implements parsing of function definitions, blocks, and calls (US-005, US-006).
 */
export class Parser {
  private tokens: Token[] = [];
  private pos: number = 0;

  constructor(private input: string) {}

  /**
   * Parse the input and return an array of function definition nodes.
   */
  parse(): UnknitNode[] {
    const tokenizer = new Tokenizer(this.input);
    this.tokens = tokenizer.tokenize();
    this.pos = 0;

    const functions: UnknitNode[] = [];

    while (!this.isAtEnd()) {
      // Skip any leading newlines
      this.skipNewlines();

      if (this.isAtEnd()) break;

      // Parse function definition
      if (this.check(TokenType.FN)) {
        const fn = this.parseFunctionDefinition();
        functions.push(fn);
      } else {
        const token = this.peek();
        throw new ParseError(
          `Expected 'fn' keyword, found '${token.value}'`,
          token.line,
          token.column
        );
      }
    }

    return functions;
  }

  /**
   * Parse a function definition.
   * Syntax: fn name(params) -> return_type | error_type: {{src:file:line-line}}
   */
  private parseFunctionDefinition(): UnknitNode {
    // Consume 'fn' keyword
    this.consume(TokenType.FN, "Expected 'fn' keyword at start of function definition");

    // Parse function name
    const nameToken = this.consume(
      TokenType.IDENTIFIER,
      'Expected function name after fn keyword'
    );
    const name = nameToken.value;

    // Parse parameters
    this.consume(TokenType.LPAREN, "Expected '(' after function name");
    const params = this.parseParameters();
    this.consume(TokenType.RPAREN, "Expected ')' after parameters");

    // Parse return type
    this.consume(TokenType.ARROW, "Expected '->' for return type");
    const { returnType, errorType } = this.parseReturnType();

    // Consume the colon
    this.consume(TokenType.COLON, "Expected ':' after return type");

    // Try to capture source reference if present
    const sourceRef = this.tryConsumeSourceRef();

    // Create the function node
    const node: UnknitNode = {
      type: NodeType.fn,
      name,
      params: params.length > 0 ? params : undefined,
      returnType,
      errorType,
      sourceRef,
      children: [],
    };

    // Parse function body (skip any remaining content on this line)
    node.children = this.parseFunctionBody();

    return node;
  }

  /**
   * Parse function parameters.
   * Syntax: param1, param2, optional?
   */
  private parseParameters(): string[] {
    const params: string[] = [];

    // Handle empty parameter list
    if (this.check(TokenType.RPAREN)) {
      return params;
    }

    // Parse first parameter
    params.push(this.parseParameter());

    // Parse remaining parameters
    while (this.match(TokenType.COMMA)) {
      params.push(this.parseParameter());
    }

    return params;
  }

  /**
   * Parse a single parameter.
   * Syntax: name or name?
   */
  private parseParameter(): string {
    const nameToken = this.consume(
      TokenType.IDENTIFIER,
      'Expected parameter name'
    );
    let param = nameToken.value;

    // Check for optional marker
    if (this.match(TokenType.QUESTION)) {
      param += '?';
    }

    return param;
  }

  /**
   * Parse return type with optional error type.
   * Syntax: type or type | error
   */
  private parseReturnType(): { returnType: string; errorType?: string } {
    const returnTypeToken = this.consume(
      TokenType.IDENTIFIER,
      'Expected return type'
    );
    const returnType = returnTypeToken.value;

    let errorType: string | undefined;

    // Check for error type
    if (this.match(TokenType.PIPE)) {
      const errorTypeToken = this.consume(
        TokenType.IDENTIFIER,
        'Expected error type after |'
      );
      errorType = errorTypeToken.value;
    }

    return { returnType, errorType };
  }

  // Helper methods

  /**
   * Skip newline tokens.
   */
  private skipNewlines(): void {
    while (this.check(TokenType.NEWLINE)) {
      this.advance();
    }
  }

  /**
   * Parse the function body and build the AST with proper parent-child relationships.
   * The body is indentation-based: INDENT starts a block, DEDENT ends it.
   */
  private parseFunctionBody(): UnknitNode[] {
    const children: UnknitNode[] = [];

    // Skip any trailing tokens on the function definition line (like source refs)
    while (
      !this.isAtEnd() &&
      !this.check(TokenType.NEWLINE) &&
      !this.check(TokenType.EOF)
    ) {
      this.advance();
    }

    // Consume the newline if present
    if (this.check(TokenType.NEWLINE)) {
      this.advance();
    }

    // Check for indent to enter function body
    if (!this.check(TokenType.INDENT)) {
      // No body - empty function
      return children;
    }

    // Consume the indent
    this.advance();

    // Parse body elements until we hit DEDENT
    while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
      this.skipNewlines();

      if (this.check(TokenType.DEDENT) || this.isAtEnd()) {
        break;
      }

      const node = this.parseBodyElement();
      if (node) {
        children.push(node);
      }
    }

    // Consume the dedent
    if (this.check(TokenType.DEDENT)) {
      this.advance();
    }

    return children;
  }

  /**
   * Parse a single body element (call, return, early exit, error handler, or block).
   */
  private parseBodyElement(): UnknitNode | null {
    this.skipNewlines();

    if (this.isAtEnd() || this.check(TokenType.DEDENT)) {
      return null;
    }

    // Check for error handler: on error:
    if (this.check(TokenType.ON)) {
      return this.parseErrorHandler();
    }

    // Check for external call: @name()
    if (this.check(TokenType.AT)) {
      return this.parseExternalCall();
    }

    // Check for early exit: *->
    if (this.check(TokenType.EARLY_EXIT)) {
      return this.parseEarlyExit();
    }

    // Check for return: ->
    if (this.check(TokenType.ARROW)) {
      return this.parseReturn();
    }

    // Check for identifier (internal call or block label)
    if (this.check(TokenType.IDENTIFIER)) {
      return this.parseCallOrBlock();
    }

    // Unknown token - skip it
    this.advance();
    return null;
  }

  /**
   * Parse an internal call or a block label.
   * Internal call: name() {{src:file:line-line}}
   * Block label: name: {{src:file:line-line}} (followed by indented children)
   */
  private parseCallOrBlock(): UnknitNode {
    const nameToken = this.advance();
    const name = nameToken.value;

    // Check if this is a call: name()
    if (this.check(TokenType.LPAREN)) {
      this.advance(); // consume (
      this.consume(TokenType.RPAREN, "Expected ')' after call");

      // Try to capture source reference
      const sourceRef = this.tryConsumeSourceRef();

      const node: UnknitNode = {
        type: NodeType.call,
        name,
        sourceRef,
        children: [],
      };

      // Check for nested children (indented block after call)
      node.children = this.parseNestedChildren();

      return node;
    }

    // Check if this is a block label: name:
    if (this.check(TokenType.COLON)) {
      this.advance(); // consume :

      // Try to capture source reference
      const sourceRef = this.tryConsumeSourceRef();

      const node: UnknitNode = {
        type: NodeType.block,
        name,
        sourceRef,
        children: [],
      };

      // Parse nested children
      node.children = this.parseNestedChildren();

      return node;
    }

    // Just an identifier without () or : - treat as a block
    // Try to capture source reference
    const sourceRef = this.tryConsumeSourceRef();

    const node: UnknitNode = {
      type: NodeType.block,
      name,
      sourceRef,
      children: [],
    };

    node.children = this.parseNestedChildren();

    return node;
  }

  /**
   * Parse an external call: @name() {{src:file:line-line}}
   */
  private parseExternalCall(): UnknitNode {
    this.advance(); // consume @

    const nameToken = this.consume(
      TokenType.IDENTIFIER,
      'Expected function name after @'
    );
    const name = nameToken.value;

    this.consume(TokenType.LPAREN, "Expected '(' after external function name");
    this.consume(TokenType.RPAREN, "Expected ')' after external call");

    // Try to capture source reference
    const sourceRef = this.tryConsumeSourceRef();

    const node: UnknitNode = {
      type: NodeType.external_call,
      name,
      sourceRef,
      children: [],
    };

    // Check for nested children
    node.children = this.parseNestedChildren();

    return node;
  }

  /**
   * Parse an early exit: *-> value {{src:file:line-line}}
   */
  private parseEarlyExit(): UnknitNode {
    this.advance(); // consume *->

    // Parse the exit value if present
    let name = '';
    if (this.check(TokenType.IDENTIFIER)) {
      name = this.advance().value;
    }

    // Try to capture source reference
    const sourceRef = this.tryConsumeSourceRef();

    const node: UnknitNode = {
      type: NodeType.early_exit,
      name,
      sourceRef,
      children: [],
    };

    // Check for nested children
    node.children = this.parseNestedChildren();

    return node;
  }

  /**
   * Parse a return: -> value {{src:file:line-line}}
   */
  private parseReturn(): UnknitNode {
    this.advance(); // consume ->

    // Parse the return value if present
    let name = '';
    if (this.check(TokenType.IDENTIFIER)) {
      name = this.advance().value;
    }

    // Try to capture source reference
    const sourceRef = this.tryConsumeSourceRef();

    const node: UnknitNode = {
      type: NodeType.return,
      name,
      sourceRef,
      children: [],
    };

    // Check for nested children
    node.children = this.parseNestedChildren();

    return node;
  }

  /**
   * Parse an error handler: on error: {{src:file:line-line}}
   */
  private parseErrorHandler(): UnknitNode {
    this.advance(); // consume 'on'

    // Expect an identifier (typically 'error')
    const typeToken = this.consume(
      TokenType.IDENTIFIER,
      "Expected error type after 'on'"
    );
    const name = typeToken.value;

    this.consume(TokenType.COLON, "Expected ':' after error type");

    // Try to capture source reference
    const sourceRef = this.tryConsumeSourceRef();

    const node: UnknitNode = {
      type: NodeType.error_handler,
      name,
      sourceRef,
      children: [],
    };

    // Parse nested children
    node.children = this.parseNestedChildren();

    return node;
  }

  /**
   * Parse nested children after a body element.
   * Handles INDENT/DEDENT for nested blocks.
   */
  private parseNestedChildren(): UnknitNode[] {
    const children: UnknitNode[] = [];

    // Skip any trailing content on this line (like source refs)
    while (
      !this.isAtEnd() &&
      !this.check(TokenType.NEWLINE) &&
      !this.check(TokenType.EOF) &&
      !this.check(TokenType.INDENT) &&
      !this.check(TokenType.DEDENT)
    ) {
      this.advance();
    }

    // Skip newline
    if (this.check(TokenType.NEWLINE)) {
      this.advance();
    }

    // Check for indent (nested content)
    if (!this.check(TokenType.INDENT)) {
      return children;
    }

    // Consume indent
    this.advance();

    // Parse children until dedent
    while (!this.isAtEnd() && !this.check(TokenType.DEDENT)) {
      this.skipNewlines();

      if (this.check(TokenType.DEDENT) || this.isAtEnd()) {
        break;
      }

      const node = this.parseBodyElement();
      if (node) {
        children.push(node);
      }
    }

    // Consume dedent
    if (this.check(TokenType.DEDENT)) {
      this.advance();
    }

    return children;
  }

  /**
   * Try to consume a source reference token and parse it.
   * Returns the SourceRef if present, undefined otherwise.
   */
  private tryConsumeSourceRef(): SourceRef | undefined {
    if (this.check(TokenType.SOURCE_REF)) {
      const token = this.advance();
      return parseSourceRef(token.value);
    }
    return undefined;
  }

  /**
   * Check if we've reached the end of input.
   */
  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }

  /**
   * Get the current token without advancing.
   */
  private peek(): Token {
    return this.tokens[this.pos] ?? {
      type: TokenType.EOF,
      value: '',
      line: 1,
      column: 1,
    };
  }

  /**
   * Get the previous token.
   */
  private previous(): Token {
    return this.tokens[this.pos - 1] ?? {
      type: TokenType.EOF,
      value: '',
      line: 1,
      column: 1,
    };
  }

  /**
   * Check if current token matches the given type.
   */
  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  /**
   * Advance and return the current token.
   */
  private advance(): Token {
    if (!this.isAtEnd()) {
      this.pos++;
    }
    return this.previous();
  }

  /**
   * If current token matches, advance and return true.
   */
  private match(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  /**
   * Consume a token of the expected type or throw an error.
   */
  private consume(type: TokenType, message: string): Token {
    if (this.check(type)) {
      return this.advance();
    }

    const token = this.peek();
    throw new ParseError(
      `${message}, found '${token.value}' (${token.type})`,
      token.line,
      token.column
    );
  }
}

/**
 * Parse function definitions from unknit source.
 * This is a convenience function that creates a parser and parses the input.
 */
export function parseFunctions(input: string): UnknitNode[] {
  const parser = new Parser(input);
  return parser.parse();
}

/**
 * Parse a source reference token value into a SourceRef object.
 * Format: {{src:file:line-line}} or {{src:file:line}}
 * Returns undefined if the format is invalid.
 */
export function parseSourceRef(tokenValue: string): SourceRef | undefined {
  // Extract content between {{ and }}
  const match = tokenValue.match(/^\{\{src:(.+)\}\}$/);
  if (!match) {
    return undefined;
  }

  const content = match[1];
  if (!content) {
    return undefined;
  }

  // Find the last colon to separate file from line range
  // This handles file paths with colons (e.g., C:\path\file.ts)
  const lastColonIndex = content.lastIndexOf(':');
  if (lastColonIndex === -1) {
    return undefined;
  }

  const file = content.substring(0, lastColonIndex);
  const lineRange = content.substring(lastColonIndex + 1);

  if (!file || !lineRange) {
    return undefined;
  }

  // Parse line range: either "line" or "line-line"
  const lineMatch = lineRange.match(/^(\d+)(?:-(\d+))?$/);
  if (!lineMatch) {
    return undefined;
  }

  const startLine = parseInt(lineMatch[1]!, 10);
  const endLine = lineMatch[2] ? parseInt(lineMatch[2], 10) : startLine;

  if (isNaN(startLine) || isNaN(endLine)) {
    return undefined;
  }

  return {
    file,
    startLine,
    endLine,
  };
}
