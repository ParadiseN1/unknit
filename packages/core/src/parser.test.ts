import { describe, it, expect } from 'vitest';
import { Parser, ParseError, parseFunctions } from './parser.js';
import { NodeType } from './types.js';

describe('Parser', () => {
  describe('function definitions', () => {
    it('parses simple function with no parameters', () => {
      const input = 'fn process() -> result:';
      const nodes = parseFunctions(input);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({
        type: NodeType.fn,
        name: 'process',
        params: undefined,
        returnType: 'result',
        errorType: undefined,
      });
    });

    it('parses function with single parameter', () => {
      const input = 'fn process(data) -> result:';
      const nodes = parseFunctions(input);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({
        type: NodeType.fn,
        name: 'process',
        params: ['data'],
        returnType: 'result',
      });
    });

    it('parses function with multiple parameters', () => {
      const input = 'fn process(data, options, config) -> result:';
      const nodes = parseFunctions(input);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({
        type: NodeType.fn,
        name: 'process',
        params: ['data', 'options', 'config'],
        returnType: 'result',
      });
    });

    it('parses function with optional parameter', () => {
      const input = 'fn process(data, opts?) -> result:';
      const nodes = parseFunctions(input);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({
        type: NodeType.fn,
        name: 'process',
        params: ['data', 'opts?'],
        returnType: 'result',
      });
    });

    it('parses function with multiple optional parameters', () => {
      const input = 'fn process(data?, opts?) -> result:';
      const nodes = parseFunctions(input);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({
        type: NodeType.fn,
        name: 'process',
        params: ['data?', 'opts?'],
        returnType: 'result',
      });
    });

    it('parses function with error type', () => {
      const input = 'fn process(data) -> result | error:';
      const nodes = parseFunctions(input);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({
        type: NodeType.fn,
        name: 'process',
        params: ['data'],
        returnType: 'result',
        errorType: 'error',
      });
    });

    it('parses function with custom error type name', () => {
      const input = 'fn process_order(data) -> order | errors:';
      const nodes = parseFunctions(input);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({
        type: NodeType.fn,
        name: 'process_order',
        params: ['data'],
        returnType: 'order',
        errorType: 'errors',
      });
    });

    it('parses function with underscores in name', () => {
      const input = 'fn process_order_data(input_data) -> output_result:';
      const nodes = parseFunctions(input);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({
        type: NodeType.fn,
        name: 'process_order_data',
        params: ['input_data'],
        returnType: 'output_result',
      });
    });

    it('parses multiple functions', () => {
      const input = `fn first() -> a:
fn second() -> b:`;
      const nodes = parseFunctions(input);

      expect(nodes).toHaveLength(2);
      expect(nodes[0]?.name).toBe('first');
      expect(nodes[1]?.name).toBe('second');
    });

    it('parses multiple functions with blank lines between', () => {
      const input = `fn first() -> a:

fn second() -> b:`;
      const nodes = parseFunctions(input);

      expect(nodes).toHaveLength(2);
      expect(nodes[0]?.name).toBe('first');
      expect(nodes[1]?.name).toBe('second');
    });

    it('parses function from spec example', () => {
      const input = 'fn process_order(data) -> order | errors:';
      const nodes = parseFunctions(input);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({
        type: NodeType.fn,
        name: 'process_order',
        params: ['data'],
        returnType: 'order',
        errorType: 'errors',
      });
    });

    it('parses function with body lines (ignores body for now)', () => {
      const input = `fn process(data) -> result:
  validate()
  transform()`;
      const nodes = parseFunctions(input);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.name).toBe('process');
      // Body parsing is for US-006, so we just verify the function is parsed
    });
  });

  describe('error cases', () => {
    it('throws on missing function name', () => {
      expect(() => parseFunctions('fn () -> result:')).toThrow(ParseError);
    });

    it('throws on missing opening parenthesis', () => {
      expect(() => parseFunctions('fn process -> result:')).toThrow(ParseError);
    });

    it('throws on missing closing parenthesis', () => {
      expect(() => parseFunctions('fn process(data -> result:')).toThrow(
        ParseError
      );
    });

    it('throws on missing arrow', () => {
      expect(() => parseFunctions('fn process() result:')).toThrow(ParseError);
    });

    it('throws on missing return type', () => {
      expect(() => parseFunctions('fn process() ->:')).toThrow(ParseError);
    });

    it('throws on missing colon', () => {
      expect(() => parseFunctions('fn process() -> result')).toThrow(
        ParseError
      );
    });

    it('throws on missing error type after pipe', () => {
      expect(() => parseFunctions('fn process() -> result |:')).toThrow(
        ParseError
      );
    });

    it('throws on unexpected token at start', () => {
      expect(() => parseFunctions('process() -> result:')).toThrow(ParseError);
    });

    it('provides line and column in error', () => {
      try {
        parseFunctions('fn process(data) result:');
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError);
        const error = e as ParseError;
        expect(error.line).toBe(1);
        expect(error.column).toBeGreaterThan(0);
      }
    });
  });

  describe('edge cases', () => {
    it('handles empty input', () => {
      const nodes = parseFunctions('');
      expect(nodes).toEqual([]);
    });

    it('handles input with only whitespace', () => {
      const nodes = parseFunctions('   \n\n   ');
      expect(nodes).toEqual([]);
    });

    it('handles function with whitespace around tokens', () => {
      const input = 'fn   process  (  data  ,  opts  )   ->   result  :';
      const nodes = parseFunctions(input);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]).toMatchObject({
        type: NodeType.fn,
        name: 'process',
        params: ['data', 'opts'],
        returnType: 'result',
      });
    });
  });

  describe('Parser class', () => {
    it('can be instantiated directly', () => {
      const parser = new Parser('fn test() -> result:');
      const nodes = parser.parse();

      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.name).toBe('test');
    });
  });
});
