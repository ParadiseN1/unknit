/**
 * Tokenizer for the Unknit language.
 * Breaks unknit syntax into tokens for the parser.
 */

/**
 * Types of tokens in the Unknit language.
 */
export enum TokenType {
  // Keywords
  FN = 'FN',
  ON = 'ON',

  // Operators
  ARROW = 'ARROW', // ->
  EARLY_EXIT = 'EARLY_EXIT', // *->
  AT = 'AT', // @
  LPAREN = 'LPAREN', // (
  RPAREN = 'RPAREN', // )
  COLON = 'COLON', // :
  PIPE = 'PIPE', // |
  COMMA = 'COMMA', // ,
  QUESTION = 'QUESTION', // ?

  // Values
  IDENTIFIER = 'IDENTIFIER',

  // Source reference
  SOURCE_REF = 'SOURCE_REF', // {{src:file:line-line}}

  // Structure
  INDENT = 'INDENT', // Increased indentation
  DEDENT = 'DEDENT', // Decreased indentation
  NEWLINE = 'NEWLINE', // End of line

  // End of file
  EOF = 'EOF',
}

/**
 * A token produced by the tokenizer.
 */
export interface Token {
  /** The type of the token */
  type: TokenType;
  /** The raw text value of the token */
  value: string;
  /** Line number (1-indexed) */
  line: number;
  /** Column number (1-indexed) */
  column: number;
}

/**
 * Error during tokenization.
 */
export class TokenizerError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number
  ) {
    super(`${message} at line ${line}, column ${column}`);
    this.name = 'TokenizerError';
  }
}

/**
 * Tokenizer for Unknit syntax.
 */
export class Tokenizer {
  private input: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 1;
  private indentStack: number[] = [0];
  private pendingTokens: Token[] = [];
  private atLineStart: boolean = true;

  constructor(input: string) {
    this.input = input;
  }

  /**
   * Tokenize the entire input and return all tokens.
   */
  tokenize(): Token[] {
    const tokens: Token[] = [];
    let token = this.nextToken();

    while (token.type !== TokenType.EOF) {
      tokens.push(token);
      token = this.nextToken();
    }
    tokens.push(token); // Push EOF token

    return tokens;
  }

  /**
   * Get the next token from the input.
   */
  nextToken(): Token {
    // Return any pending tokens first (from DEDENT processing)
    if (this.pendingTokens.length > 0) {
      return this.pendingTokens.shift()!;
    }

    // Skip whitespace within a line (not at line start)
    if (!this.atLineStart) {
      this.skipInlineWhitespace();
    }

    // Handle end of input
    if (this.isAtEnd()) {
      // Emit any remaining DEDENTs
      if (this.indentStack.length > 1) {
        this.indentStack.pop();
        const dedent: Token = {
          type: TokenType.DEDENT,
          value: '',
          line: this.line,
          column: this.column,
        };
        if (this.indentStack.length > 1) {
          // More DEDENTs needed
          this.pendingTokens.push({
            type: TokenType.EOF,
            value: '',
            line: this.line,
            column: this.column,
          });
        }
        return dedent;
      }
      return {
        type: TokenType.EOF,
        value: '',
        line: this.line,
        column: this.column,
      };
    }

    // Handle line start - process indentation
    if (this.atLineStart) {
      return this.handleLineStart();
    }

    // Handle newline
    if (this.peek() === '\n') {
      return this.consumeNewline();
    }

    // Handle carriage return (Windows line endings)
    if (this.peek() === '\r') {
      this.advance(); // skip CR
      if (this.peek() === '\n') {
        return this.consumeNewline();
      }
      // Standalone CR treated as newline
      this.line++;
      this.column = 1;
      this.atLineStart = true;
      return {
        type: TokenType.NEWLINE,
        value: '\r',
        line: this.line - 1,
        column: 1,
      };
    }

    // Handle source reference {{src:...}}
    if (this.peek() === '{' && this.peekAhead(1) === '{') {
      return this.consumeSourceRef();
    }

    // Handle operators and punctuation
    const opToken = this.tryConsumeOperator();
    if (opToken) {
      return opToken;
    }

    // Handle identifiers and keywords
    if (this.isIdentifierStart(this.peek())) {
      return this.consumeIdentifier();
    }

    // Unknown character
    throw new TokenizerError(
      `Unexpected character: '${this.peek()}'`,
      this.line,
      this.column
    );
  }

  private handleLineStart(): Token {
    this.atLineStart = false;
    const indentLine = this.line;
    const indentCol = this.column;

    // Count leading spaces
    let spaces = 0;
    while (this.peek() === ' ') {
      spaces++;
      this.advance();
    }

    // Handle tabs (convert to spaces, assuming 2 spaces per tab)
    while (this.peek() === '\t') {
      spaces += 2;
      this.advance();
    }

    // Skip empty lines and comment-only lines
    if (this.peek() === '\n' || this.isAtEnd()) {
      this.atLineStart = true;
      if (this.peek() === '\n') {
        return this.consumeNewline();
      }
      return this.nextToken(); // Get EOF
    }

    const currentIndent = this.indentStack[this.indentStack.length - 1] ?? 0;

    if (spaces > currentIndent) {
      // Increased indentation
      this.indentStack.push(spaces);
      return {
        type: TokenType.INDENT,
        value: ' '.repeat(spaces),
        line: indentLine,
        column: indentCol,
      };
    } else if (spaces < currentIndent) {
      // Decreased indentation - may need multiple DEDENTs
      const tokens: Token[] = [];
      while (
        this.indentStack.length > 1 &&
        spaces < (this.indentStack[this.indentStack.length - 1] ?? 0)
      ) {
        this.indentStack.pop();
        tokens.push({
          type: TokenType.DEDENT,
          value: '',
          line: indentLine,
          column: indentCol,
        });
      }

      // Validate indentation matches a previous level
      const expectedIndent = this.indentStack[this.indentStack.length - 1] ?? 0;
      if (spaces !== expectedIndent) {
        throw new TokenizerError(
          `Inconsistent indentation: expected ${expectedIndent} spaces, got ${spaces}`,
          indentLine,
          indentCol
        );
      }

      // Return first DEDENT, queue the rest
      if (tokens.length > 1) {
        this.pendingTokens.push(...tokens.slice(1));
      }
      // tokens is guaranteed to have at least one item here since we entered the if block
      return tokens[0]!;
    }

    // Same indentation - continue to next token
    return this.nextToken();
  }

  private consumeNewline(): Token {
    const token: Token = {
      type: TokenType.NEWLINE,
      value: '\n',
      line: this.line,
      column: this.column,
    };
    this.advance(); // consume '\n'
    this.line++;
    this.column = 1;
    this.atLineStart = true;
    return token;
  }

  private consumeSourceRef(): Token {
    const startLine = this.line;
    const startCol = this.column;
    let value = '';

    // Consume {{
    value += this.advance();
    value += this.advance();

    // Consume until }}
    while (!this.isAtEnd()) {
      if (this.peek() === '}' && this.peekAhead(1) === '}') {
        value += this.advance();
        value += this.advance();
        break;
      }
      if (this.peek() === '\n') {
        throw new TokenizerError(
          'Unterminated source reference',
          startLine,
          startCol
        );
      }
      value += this.advance();
    }

    if (!value.endsWith('}}')) {
      throw new TokenizerError(
        'Unterminated source reference',
        startLine,
        startCol
      );
    }

    return {
      type: TokenType.SOURCE_REF,
      value,
      line: startLine,
      column: startCol,
    };
  }

  private tryConsumeOperator(): Token | null {
    const startLine = this.line;
    const startCol = this.column;

    // Check for *-> (early exit) first
    if (
      this.peek() === '*' &&
      this.peekAhead(1) === '-' &&
      this.peekAhead(2) === '>'
    ) {
      this.advance();
      this.advance();
      this.advance();
      return {
        type: TokenType.EARLY_EXIT,
        value: '*->',
        line: startLine,
        column: startCol,
      };
    }

    // Check for -> (arrow)
    if (this.peek() === '-' && this.peekAhead(1) === '>') {
      this.advance();
      this.advance();
      return {
        type: TokenType.ARROW,
        value: '->',
        line: startLine,
        column: startCol,
      };
    }

    // Single character operators
    const char = this.peek();
    const singleOps: Record<string, TokenType> = {
      '@': TokenType.AT,
      '(': TokenType.LPAREN,
      ')': TokenType.RPAREN,
      ':': TokenType.COLON,
      '|': TokenType.PIPE,
      ',': TokenType.COMMA,
      '?': TokenType.QUESTION,
    };

    const tokenType = singleOps[char];
    if (tokenType !== undefined) {
      this.advance();
      return {
        type: tokenType,
        value: char,
        line: startLine,
        column: startCol,
      };
    }

    return null;
  }

  private consumeIdentifier(): Token {
    const startLine = this.line;
    const startCol = this.column;
    let value = '';

    while (!this.isAtEnd() && this.isIdentifierChar(this.peek())) {
      value += this.advance();
    }

    // Check for keywords
    const keywords: Record<string, TokenType> = {
      fn: TokenType.FN,
      on: TokenType.ON,
    };

    const type = keywords[value] ?? TokenType.IDENTIFIER;

    return {
      type,
      value,
      line: startLine,
      column: startCol,
    };
  }

  // Helper methods

  private peek(): string {
    return this.input[this.pos] ?? '';
  }

  private peekAhead(n: number): string {
    return this.input[this.pos + n] ?? '';
  }

  private advance(): string {
    const char = this.input[this.pos] ?? '';
    this.pos++;
    this.column++;
    return char;
  }

  private isAtEnd(): boolean {
    return this.pos >= this.input.length;
  }

  private skipInlineWhitespace(): void {
    while (this.peek() === ' ' || this.peek() === '\t') {
      this.advance();
    }
  }

  private isIdentifierStart(char: string): boolean {
    // Allow dots for method chain continuations like .labels().list()
    return /[a-zA-Z_.]/.test(char);
  }

  private isIdentifierChar(char: string): boolean {
    // Allow dots for qualified names like service_account.Credentials.method()
    // Allow slashes and hyphens for values like text/plain, mime-type
    // Allow quotes for string values
    return /[a-zA-Z0-9_.\/\-"']/.test(char);
  }
}

/**
 * Tokenize an unknit source string.
 */
export function tokenize(input: string): Token[] {
  const tokenizer = new Tokenizer(input);
  return tokenizer.tokenize();
}
