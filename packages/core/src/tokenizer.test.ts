import { describe, it, expect } from 'vitest';
import {
  Tokenizer,
  TokenizerError,
  TokenType,
  tokenize,
} from './tokenizer.js';

describe('Tokenizer', () => {
  describe('keywords', () => {
    it('tokenizes fn keyword', () => {
      const tokens = tokenize('fn');
      expect(tokens).toEqual([
        { type: TokenType.FN, value: 'fn', line: 1, column: 1 },
        { type: TokenType.EOF, value: '', line: 1, column: 3 },
      ]);
    });

    it('tokenizes on keyword', () => {
      const tokens = tokenize('on');
      expect(tokens).toEqual([
        { type: TokenType.ON, value: 'on', line: 1, column: 1 },
        { type: TokenType.EOF, value: '', line: 1, column: 3 },
      ]);
    });
  });

  describe('operators', () => {
    it('tokenizes arrow operator ->', () => {
      const tokens = tokenize('->');
      expect(tokens).toEqual([
        { type: TokenType.ARROW, value: '->', line: 1, column: 1 },
        { type: TokenType.EOF, value: '', line: 1, column: 3 },
      ]);
    });

    it('tokenizes early exit operator *->', () => {
      const tokens = tokenize('*->');
      expect(tokens).toEqual([
        { type: TokenType.EARLY_EXIT, value: '*->', line: 1, column: 1 },
        { type: TokenType.EOF, value: '', line: 1, column: 4 },
      ]);
    });

    it('tokenizes at operator @', () => {
      const tokens = tokenize('@');
      expect(tokens).toEqual([
        { type: TokenType.AT, value: '@', line: 1, column: 1 },
        { type: TokenType.EOF, value: '', line: 1, column: 2 },
      ]);
    });

    it('tokenizes parentheses', () => {
      const tokens = tokenize('()');
      expect(tokens).toEqual([
        { type: TokenType.LPAREN, value: '(', line: 1, column: 1 },
        { type: TokenType.RPAREN, value: ')', line: 1, column: 2 },
        { type: TokenType.EOF, value: '', line: 1, column: 3 },
      ]);
    });

    it('tokenizes colon', () => {
      const tokens = tokenize(':');
      expect(tokens).toEqual([
        { type: TokenType.COLON, value: ':', line: 1, column: 1 },
        { type: TokenType.EOF, value: '', line: 1, column: 2 },
      ]);
    });

    it('tokenizes pipe', () => {
      const tokens = tokenize('|');
      expect(tokens).toEqual([
        { type: TokenType.PIPE, value: '|', line: 1, column: 1 },
        { type: TokenType.EOF, value: '', line: 1, column: 2 },
      ]);
    });

    it('tokenizes comma', () => {
      const tokens = tokenize(',');
      expect(tokens).toEqual([
        { type: TokenType.COMMA, value: ',', line: 1, column: 1 },
        { type: TokenType.EOF, value: '', line: 1, column: 2 },
      ]);
    });

    it('tokenizes question mark (optional marker)', () => {
      const tokens = tokenize('param?');
      expect(tokens).toEqual([
        { type: TokenType.IDENTIFIER, value: 'param', line: 1, column: 1 },
        { type: TokenType.QUESTION, value: '?', line: 1, column: 6 },
        { type: TokenType.EOF, value: '', line: 1, column: 7 },
      ]);
    });
  });

  describe('identifiers', () => {
    it('tokenizes simple identifier', () => {
      const tokens = tokenize('foo');
      expect(tokens).toEqual([
        { type: TokenType.IDENTIFIER, value: 'foo', line: 1, column: 1 },
        { type: TokenType.EOF, value: '', line: 1, column: 4 },
      ]);
    });

    it('tokenizes identifier with underscores', () => {
      const tokens = tokenize('foo_bar');
      expect(tokens).toEqual([
        { type: TokenType.IDENTIFIER, value: 'foo_bar', line: 1, column: 1 },
        { type: TokenType.EOF, value: '', line: 1, column: 8 },
      ]);
    });

    it('tokenizes identifier with numbers', () => {
      const tokens = tokenize('foo123');
      expect(tokens).toEqual([
        { type: TokenType.IDENTIFIER, value: 'foo123', line: 1, column: 1 },
        { type: TokenType.EOF, value: '', line: 1, column: 7 },
      ]);
    });

    it('tokenizes identifier starting with underscore', () => {
      const tokens = tokenize('_private');
      expect(tokens).toEqual([
        { type: TokenType.IDENTIFIER, value: '_private', line: 1, column: 1 },
        { type: TokenType.EOF, value: '', line: 1, column: 9 },
      ]);
    });

    it('tokenizes multiple identifiers separated by whitespace', () => {
      const tokens = tokenize('foo bar baz');
      expect(tokens.filter((t) => t.type !== TokenType.EOF)).toEqual([
        { type: TokenType.IDENTIFIER, value: 'foo', line: 1, column: 1 },
        { type: TokenType.IDENTIFIER, value: 'bar', line: 1, column: 5 },
        { type: TokenType.IDENTIFIER, value: 'baz', line: 1, column: 9 },
      ]);
    });
  });

  describe('indentation', () => {
    it('tokenizes single level indent', () => {
      const tokens = tokenize('foo\n  bar');
      const types = tokens.map((t) => t.type);
      expect(types).toContain(TokenType.INDENT);
    });

    it('tokenizes dedent on returning to base level', () => {
      const tokens = tokenize('foo\n  bar\nbaz');
      const types = tokens.map((t) => t.type);
      expect(types).toContain(TokenType.INDENT);
      expect(types).toContain(TokenType.DEDENT);
    });

    it('tokenizes multiple indent levels', () => {
      const tokens = tokenize('foo\n  bar\n    baz');
      const indents = tokens.filter((t) => t.type === TokenType.INDENT);
      expect(indents.length).toBe(2);
    });

    it('tokenizes multiple dedent levels at once', () => {
      const tokens = tokenize('foo\n  bar\n    baz\nqux');
      const dedents = tokens.filter((t) => t.type === TokenType.DEDENT);
      expect(dedents.length).toBe(2);
    });

    it('handles empty lines correctly', () => {
      const tokens = tokenize('foo\n\nbar');
      const identifiers = tokens.filter((t) => t.type === TokenType.IDENTIFIER);
      expect(identifiers.length).toBe(2);
      expect(identifiers[0]?.value).toBe('foo');
      expect(identifiers[1]?.value).toBe('bar');
    });

    it('throws on inconsistent indentation', () => {
      expect(() => tokenize('foo\n  bar\n baz')).toThrow(TokenizerError);
    });
  });

  describe('source references', () => {
    it('tokenizes source reference', () => {
      const tokens = tokenize('{{src:file.py:10-20}}');
      expect(tokens).toEqual([
        {
          type: TokenType.SOURCE_REF,
          value: '{{src:file.py:10-20}}',
          line: 1,
          column: 1,
        },
        { type: TokenType.EOF, value: '', line: 1, column: 22 },
      ]);
    });

    it('tokenizes source reference with path', () => {
      const tokens = tokenize('{{src:src/utils/helper.ts:5-15}}');
      expect(tokens).toEqual([
        {
          type: TokenType.SOURCE_REF,
          value: '{{src:src/utils/helper.ts:5-15}}',
          line: 1,
          column: 1,
        },
        { type: TokenType.EOF, value: '', line: 1, column: 33 },
      ]);
    });

    it('tokenizes source reference inline with other tokens', () => {
      const tokens = tokenize('foo() {{src:file.py:1-5}}');
      const types = tokens.map((t) => t.type);
      expect(types).toContain(TokenType.IDENTIFIER);
      expect(types).toContain(TokenType.LPAREN);
      expect(types).toContain(TokenType.RPAREN);
      expect(types).toContain(TokenType.SOURCE_REF);
    });

    it('throws on unterminated source reference', () => {
      expect(() => tokenize('{{src:file.py:10-20')).toThrow(TokenizerError);
    });

    it('throws on source reference spanning newline', () => {
      expect(() => tokenize('{{src:file.py\n:10-20}}')).toThrow(TokenizerError);
    });
  });

  describe('complex expressions', () => {
    it('tokenizes function definition', () => {
      const tokens = tokenize('fn process_order(data) -> result:');
      const types = tokens.map((t) => t.type);
      expect(types).toEqual([
        TokenType.FN,
        TokenType.IDENTIFIER,
        TokenType.LPAREN,
        TokenType.IDENTIFIER,
        TokenType.RPAREN,
        TokenType.ARROW,
        TokenType.IDENTIFIER,
        TokenType.COLON,
        TokenType.EOF,
      ]);
    });

    it('tokenizes function with error type', () => {
      const tokens = tokenize('fn process(data) -> result | error:');
      const types = tokens.map((t) => t.type);
      expect(types).toContain(TokenType.PIPE);
    });

    it('tokenizes function with optional params', () => {
      const tokens = tokenize('fn process(data, opts?) -> result:');
      const values = tokens.map((t) => t.value);
      expect(values).toContain('opts');
      expect(tokens.some((t) => t.type === TokenType.QUESTION)).toBe(true);
    });

    it('tokenizes external call', () => {
      const tokens = tokenize('@save_order()');
      const types = tokens.map((t) => t.type);
      expect(types).toEqual([
        TokenType.AT,
        TokenType.IDENTIFIER,
        TokenType.LPAREN,
        TokenType.RPAREN,
        TokenType.EOF,
      ]);
    });

    it('tokenizes early exit with name', () => {
      const tokens = tokenize('validate() *-> errors');
      const types = tokens.map((t) => t.type);
      expect(types).toContain(TokenType.EARLY_EXIT);
      expect(types).toContain(TokenType.IDENTIFIER);
    });

    it('tokenizes error handler', () => {
      const tokens = tokenize('on error: *-> errors');
      const types = tokens.map((t) => t.type);
      expect(types).toEqual([
        TokenType.ON,
        TokenType.IDENTIFIER,
        TokenType.COLON,
        TokenType.EARLY_EXIT,
        TokenType.IDENTIFIER,
        TokenType.EOF,
      ]);
    });

    it('tokenizes full function example', () => {
      const input = `fn process_order(data) -> order | errors:
  validate_order() *-> errors
  check_duplicate_order() *-> errors
  calculate_order_total()
  inventory_check
    @check_availability() *-> errors
    @reserve_items()
  -> order

  on error: *-> errors`;

      const tokens = tokenize(input);

      // Check we have the expected structure
      const types = tokens.map((t) => t.type);
      expect(types.filter((t) => t === TokenType.INDENT).length).toBe(2);
      expect(types.filter((t) => t === TokenType.DEDENT).length).toBe(2);
      expect(types.filter((t) => t === TokenType.EARLY_EXIT).length).toBe(4);
      expect(types.filter((t) => t === TokenType.AT).length).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('handles empty input', () => {
      const tokens = tokenize('');
      expect(tokens).toEqual([
        { type: TokenType.EOF, value: '', line: 1, column: 1 },
      ]);
    });

    it('handles input with only whitespace', () => {
      const tokens = tokenize('   ');
      const lastToken = tokens[tokens.length - 1];
      expect(lastToken?.type).toBe(TokenType.EOF);
    });

    it('handles input with only newlines', () => {
      const tokens = tokenize('\n\n\n');
      const lastToken = tokens[tokens.length - 1];
      expect(lastToken?.type).toBe(TokenType.EOF);
    });

    it('throws on unexpected character', () => {
      expect(() => tokenize('foo # comment')).toThrow(TokenizerError);
    });

    it('tracks line and column numbers correctly', () => {
      const tokens = tokenize('foo\nbar\nbaz');
      const identifiers = tokens.filter((t) => t.type === TokenType.IDENTIFIER);
      expect(identifiers[0]?.line).toBe(1);
      expect(identifiers[1]?.line).toBe(2);
      expect(identifiers[2]?.line).toBe(3);
    });
  });

  describe('Tokenizer class', () => {
    it('can be used incrementally with nextToken()', () => {
      const tokenizer = new Tokenizer('foo bar');
      const first = tokenizer.nextToken();
      const second = tokenizer.nextToken();
      const third = tokenizer.nextToken();

      expect(first.type).toBe(TokenType.IDENTIFIER);
      expect(first.value).toBe('foo');
      expect(second.type).toBe(TokenType.IDENTIFIER);
      expect(second.value).toBe('bar');
      expect(third.type).toBe(TokenType.EOF);
    });
  });
});
