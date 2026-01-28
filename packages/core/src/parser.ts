/**
 * Parser for the Unknit language.
 * Builds an AST from tokens produced by the tokenizer.
 */

import { Tokenizer, Token, TokenType } from './tokenizer.js';
import { UnknitNode, NodeType } from './types.js';

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
 * Currently implements parsing of function definitions (US-005).
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
   * Syntax: fn name(params) -> return_type | error_type:
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

    // Create the function node
    const node: UnknitNode = {
      type: NodeType.fn,
      name,
      params: params.length > 0 ? params : undefined,
      returnType,
      errorType,
      children: [],
    };

    // Skip function body (body parsing will be in US-006)
    this.skipFunctionBody();

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
   * Skip the function body (all indented content after the function definition).
   * This tracks indent level and skips until we return to the base level.
   */
  private skipFunctionBody(): void {
    let indentLevel = 0;

    // First, skip to end of the current line (the function signature line)
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

    // Now skip all indented content (the function body)
    while (!this.isAtEnd()) {
      const tokenType = this.peek().type;

      if (tokenType === TokenType.INDENT) {
        indentLevel++;
        this.advance();
      } else if (tokenType === TokenType.DEDENT) {
        indentLevel--;
        this.advance();
        // If we've dedented back to base level, we're done with this function
        if (indentLevel <= 0) {
          break;
        }
      } else if (tokenType === TokenType.NEWLINE) {
        this.advance();
      } else if (indentLevel === 0) {
        // We're at base level and not at INDENT - we've found the next top-level element
        break;
      } else {
        // We're inside the function body, skip this token
        this.advance();
      }
    }
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
