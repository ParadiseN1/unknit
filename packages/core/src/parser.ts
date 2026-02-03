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
    public readonly column: number,
    public readonly expected?: string,
    public readonly found?: string
  ) {
    super(`${message} at line ${line}, column ${column}`);
    this.name = 'ParseError';
  }
}

/**
 * Result of parsing, containing both the AST nodes and any errors encountered.
 * The parser attempts to recover from errors and continue parsing.
 */
export interface ParseResult {
  /** Successfully parsed function nodes */
  nodes: UnknitNode[];
  /** Errors encountered during parsing */
  errors: ParseError[];
  /** Whether parsing completed without fatal errors */
  success: boolean;
}

/**
 * Parser for Unknit syntax.
 * Implements parsing of function definitions, blocks, and calls (US-005, US-006).
 * Supports error recovery to collect multiple errors in a single parse.
 */
export class Parser {
  private tokens: Token[] = [];
  private pos: number = 0;
  private errors: ParseError[] = [];

  constructor(private input: string) {}

  /**
   * Parse the input and return an array of function definition nodes.
   * Throws ParseError on the first error encountered.
   * For error-tolerant parsing, use parseWithRecovery().
   */
  parse(): UnknitNode[] {
    const tokenizer = new Tokenizer(this.input);
    this.tokens = tokenizer.tokenize();
    this.pos = 0;
    this.errors = [];

    const functions: UnknitNode[] = [];

    while (!this.isAtEnd()) {
      // Skip any leading newlines
      this.skipNewlines();

      if (this.isAtEnd()) break;

      // Parse function definition
      if (this.check(TokenType.FN)) {
        const fn = this.parseFunctionDefinition();
        functions.push(fn);
      } else if (this.check(TokenType.IDENTIFIER)) {
        // Allow top-level blocks (like main_flow:)
        const block = this.parseCallOrBlock();
        functions.push(block);
      } else {
        const token = this.peek();
        throw new ParseError(
          `Expected 'fn' keyword or block, found '${token.value}'`,
          token.line,
          token.column,
          'fn',
          token.value
        );
      }
    }

    return functions;
  }

  /**
   * Parse the input with error recovery, collecting all errors.
   * Returns both successfully parsed nodes and errors encountered.
   */
  parseWithRecovery(): ParseResult {
    const tokenizer = new Tokenizer(this.input);
    this.tokens = tokenizer.tokenize();
    this.pos = 0;
    this.errors = [];

    const functions: UnknitNode[] = [];

    while (!this.isAtEnd()) {
      // Skip any leading newlines
      this.skipNewlines();

      if (this.isAtEnd()) break;

      // Parse function definition or top-level block
      if (this.check(TokenType.FN)) {
        try {
          const fn = this.parseFunctionDefinitionWithRecovery();
          if (fn) {
            functions.push(fn);
          }
        } catch (e) {
          if (e instanceof ParseError) {
            this.addError(e);
            this.synchronize();
          } else {
            throw e;
          }
        }
      } else if (this.check(TokenType.IDENTIFIER)) {
        // Allow top-level blocks (like main_flow:)
        try {
          const block = this.parseCallOrBlock();
          functions.push(block);
        } catch (e) {
          if (e instanceof ParseError) {
            this.addError(e);
            this.synchronize();
          } else {
            throw e;
          }
        }
      } else {
        const token = this.peek();
        this.addError(
          new ParseError(
            `Expected 'fn' keyword or block, found '${token.value}'`,
            token.line,
            token.column,
            'fn',
            token.value
          )
        );
        this.synchronize();
      }
    }

    return {
      nodes: functions,
      errors: this.errors,
      success: this.errors.length === 0,
    };
  }

  /**
   * Add an error to the collection.
   */
  private addError(error: ParseError): void {
    this.errors.push(error);
  }

  /**
   * Synchronize parser state after an error by advancing to the next
   * likely starting point for a new statement or function.
   */
  private synchronize(): void {
    while (!this.isAtEnd()) {
      // If we've just passed a newline and are at dedent or 'fn', we're likely at a new statement
      if (this.check(TokenType.FN)) {
        return;
      }

      // Skip until we find 'fn' keyword or EOF
      const token = this.peek();
      if (token.type === TokenType.NEWLINE) {
        this.advance();
        // After newline, check for 'fn' at the start of next line (dedent level 0)
        this.skipNewlines();
        if (this.check(TokenType.FN)) {
          return;
        }
        // Also look for DEDENT tokens to return to top level
        while (this.check(TokenType.DEDENT)) {
          this.advance();
          this.skipNewlines();
          if (this.check(TokenType.FN)) {
            return;
          }
        }
      } else {
        this.advance();
      }
    }
  }

  /**
   * Parse a function definition with error recovery support.
   */
  private parseFunctionDefinitionWithRecovery(): UnknitNode | null {
    try {
      return this.parseFunctionDefinition();
    } catch (e) {
      if (e instanceof ParseError) {
        this.addError(e);
        // Skip to end of this function definition
        this.skipToNextFunction();
        return null;
      }
      throw e;
    }
  }

  /**
   * Skip tokens until we reach the next function definition or EOF.
   */
  private skipToNextFunction(): void {
    while (!this.isAtEnd()) {
      if (this.check(TokenType.FN)) {
        return;
      }
      this.advance();
    }
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

    // Parse optional return type
    let returnType: string | undefined;
    let errorType: string | undefined;

    if (this.match(TokenType.ARROW)) {
      const result = this.parseReturnType();
      returnType = result.returnType;
      errorType = result.errorType;
    }

    // Consume the colon
    this.consume(TokenType.COLON, "Expected ':' after function signature");

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
   * Syntax: type or type1, type2 or (type1, type2) or type | error
   */
  private parseReturnType(): { returnType: string; errorType?: string } {
    let returnType = '';

    // Handle tuple return types with parentheses: (type1, type2)
    if (this.match(TokenType.LPAREN)) {
      const types: string[] = [];
      if (!this.check(TokenType.RPAREN)) {
        types.push(this.consume(TokenType.IDENTIFIER, 'Expected type').value);
        while (this.match(TokenType.COMMA)) {
          types.push(this.consume(TokenType.IDENTIFIER, 'Expected type after comma').value);
        }
      }
      this.consume(TokenType.RPAREN, "Expected ')' after tuple types");
      returnType = '(' + types.join(', ') + ')';
    } else {
      const returnTypeToken = this.consume(
        TokenType.IDENTIFIER,
        'Expected return type'
      );
      returnType = returnTypeToken.value;

      // Handle tuple return types without parentheses: type1, type2, ...
      while (this.match(TokenType.COMMA)) {
        const nextType = this.consume(
          TokenType.IDENTIFIER,
          'Expected type after comma'
        );
        returnType += ', ' + nextType.value;
      }
    }

    let errorType: string | undefined;

    // Check for error/alternative types (can be multiple: type1 | type2 | (tuple))
    if (this.match(TokenType.PIPE)) {
      const altTypes: string[] = [];
      altTypes.push(this.parseTypeValue());
      while (this.match(TokenType.PIPE)) {
        altTypes.push(this.parseTypeValue());
      }
      errorType = altTypes.join(' | ');
    }

    return { returnType, errorType };
  }

  /**
   * Parse a single type value (identifier or tuple)
   */
  private parseTypeValue(): string {
    if (this.match(TokenType.LPAREN)) {
      const types: string[] = [];
      if (!this.check(TokenType.RPAREN)) {
        types.push(this.consume(TokenType.IDENTIFIER, 'Expected type').value);
        while (this.match(TokenType.COMMA)) {
          types.push(this.consume(TokenType.IDENTIFIER, 'Expected type after comma').value);
        }
      }
      this.consume(TokenType.RPAREN, "Expected ')' after tuple types");
      return '(' + types.join(', ') + ')';
    }
    return this.consume(TokenType.IDENTIFIER, 'Expected type').value;
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
   * Skip tokens until we reach a right parenthesis.
   * Used to skip arguments inside function calls.
   */
  private skipUntilRightParen(): void {
    let depth = 1; // We've already consumed the opening paren
    while (!this.isAtEnd() && depth > 0) {
      if (this.check(TokenType.LPAREN)) {
        depth++;
        this.advance();
      } else if (this.check(TokenType.RPAREN)) {
        depth--;
        if (depth > 0) {
          this.advance();
        }
        // Don't consume the final RPAREN - let the caller do that
      } else if (this.check(TokenType.NEWLINE) || this.check(TokenType.EOF)) {
        // Don't go past the end of the line
        break;
      } else {
        this.advance();
      }
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
   * Parse a single body element (call, return, early exit, error handler, nested fn, or block).
   */
  private parseBodyElement(): UnknitNode | null {
    this.skipNewlines();

    if (this.isAtEnd() || this.check(TokenType.DEDENT)) {
      return null;
    }

    // Check for nested function definition: fn name()
    if (this.check(TokenType.FN)) {
      return this.parseFunctionDefinition();
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
   * Internal call with args: name(arg1, arg2) {{src:file:line-line}}
   * Block label: name: {{src:file:line-line}} (followed by indented children)
   */
  private parseCallOrBlock(): UnknitNode {
    const nameToken = this.advance();
    const name = nameToken.value;

    // Check if this is a call: name() or name(args)
    if (this.check(TokenType.LPAREN)) {
      this.advance(); // consume (
      // Skip any content inside parentheses (arguments)
      this.skipUntilRightParen();
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
   * Also handles method chaining: @service.users().labels().list().execute()
   */
  private parseExternalCall(): UnknitNode {
    this.advance(); // consume @

    const nameToken = this.consume(
      TokenType.IDENTIFIER,
      'Expected function name after @'
    );
    let name = nameToken.value;

    this.consume(TokenType.LPAREN, "Expected '(' after external function name");
    // Skip any content inside parentheses (arguments)
    this.skipUntilRightParen();
    this.consume(TokenType.RPAREN, "Expected ')' after external call");

    // Handle method chaining: .method().method()...
    // The tokenizer will see the dot as an unexpected character,
    // so we need to consume any continuation of the chain
    while (this.checkMethodChain()) {
      name += this.consumeMethodChain();
    }

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
   * Check if the next tokens represent a method chain continuation: .identifier()
   */
  private checkMethodChain(): boolean {
    // Check if the current token is an identifier starting with a dot
    if (this.check(TokenType.IDENTIFIER)) {
      const token = this.peek();
      return token.value.startsWith('.');
    }
    return false;
  }

  /**
   * Consume a method chain continuation: .identifier()
   * Returns the consumed chain portion including the dot
   */
  private consumeMethodChain(): string {
    let chain = '';

    // Consume the .identifier part
    if (this.check(TokenType.IDENTIFIER)) {
      const token = this.advance();
      chain += token.value;
    }

    // Consume () if present
    if (this.check(TokenType.LPAREN)) {
      this.advance(); // consume (
      if (this.check(TokenType.RPAREN)) {
        this.advance(); // consume )
        chain += '()';
      }
    }

    return chain;
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
    const expectedName = this.tokenTypeName(type);
    const foundValue = token.value || token.type;
    throw new ParseError(
      `${message}, found '${foundValue}' (${token.type})`,
      token.line,
      token.column,
      expectedName,
      foundValue
    );
  }

  /**
   * Get a human-readable name for a token type.
   */
  private tokenTypeName(type: TokenType): string {
    switch (type) {
      case TokenType.FN:
        return 'fn';
      case TokenType.ON:
        return 'on';
      case TokenType.ARROW:
        return '->';
      case TokenType.EARLY_EXIT:
        return '*->';
      case TokenType.AT:
        return '@';
      case TokenType.LPAREN:
        return '(';
      case TokenType.RPAREN:
        return ')';
      case TokenType.COLON:
        return ':';
      case TokenType.PIPE:
        return '|';
      case TokenType.COMMA:
        return ',';
      case TokenType.QUESTION:
        return '?';
      case TokenType.IDENTIFIER:
        return 'identifier';
      case TokenType.SOURCE_REF:
        return 'source reference';
      case TokenType.NEWLINE:
        return 'newline';
      case TokenType.INDENT:
        return 'indent';
      case TokenType.DEDENT:
        return 'dedent';
      case TokenType.EOF:
        return 'end of file';
      default:
        return type;
    }
  }
}

/**
 * Parse function definitions from unknit source.
 * This is a convenience function that creates a parser and parses the input.
 * Throws ParseError on the first error encountered.
 */
export function parseFunctions(input: string): UnknitNode[] {
  const parser = new Parser(input);
  return parser.parse();
}

/**
 * Parse function definitions with error recovery.
 * Returns a ParseResult containing successfully parsed nodes and any errors encountered.
 * The parser attempts to recover from errors and continue parsing to collect multiple errors.
 */
export function parseFunctionsWithRecovery(input: string): ParseResult {
  const parser = new Parser(input);
  return parser.parseWithRecovery();
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
