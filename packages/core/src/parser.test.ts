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

    it('parses function with body containing internal calls', () => {
      const input = `fn process(data) -> result:
  validate()
  transform()`;
      const nodes = parseFunctions(input);

      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.name).toBe('process');
      expect(nodes[0]?.children).toHaveLength(2);
      expect(nodes[0]?.children?.[0]).toMatchObject({
        type: NodeType.call,
        name: 'validate',
      });
      expect(nodes[0]?.children?.[1]).toMatchObject({
        type: NodeType.call,
        name: 'transform',
      });
    });
  });

  describe('blocks and calls (US-006)', () => {
    describe('internal calls', () => {
      it('parses internal call with parentheses', () => {
        const input = `fn process() -> result:
  validate()`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children).toHaveLength(1);
        expect(nodes[0]?.children?.[0]).toMatchObject({
          type: NodeType.call,
          name: 'validate',
        });
      });

      it('parses multiple internal calls', () => {
        const input = `fn process() -> result:
  first()
  second()
  third()`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children).toHaveLength(3);
        expect(nodes[0]?.children?.[0]?.name).toBe('first');
        expect(nodes[0]?.children?.[1]?.name).toBe('second');
        expect(nodes[0]?.children?.[2]?.name).toBe('third');
      });
    });

    describe('external calls', () => {
      it('parses external call with @ prefix', () => {
        const input = `fn process() -> result:
  @db_query()`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children).toHaveLength(1);
        expect(nodes[0]?.children?.[0]).toMatchObject({
          type: NodeType.external_call,
          name: 'db_query',
        });
      });

      it('parses multiple external calls', () => {
        const input = `fn process() -> result:
  @api_fetch()
  @cache_get()`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children).toHaveLength(2);
        expect(nodes[0]?.children?.[0]).toMatchObject({
          type: NodeType.external_call,
          name: 'api_fetch',
        });
        expect(nodes[0]?.children?.[1]).toMatchObject({
          type: NodeType.external_call,
          name: 'cache_get',
        });
      });

      it('parses mixed internal and external calls', () => {
        const input = `fn process() -> result:
  validate()
  @db_save()
  transform()`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children).toHaveLength(3);
        expect(nodes[0]?.children?.[0]?.type).toBe(NodeType.call);
        expect(nodes[0]?.children?.[1]?.type).toBe(NodeType.external_call);
        expect(nodes[0]?.children?.[2]?.type).toBe(NodeType.call);
      });
    });

    describe('return statements', () => {
      it('parses simple return', () => {
        const input = `fn process() -> result:
  -> value`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children).toHaveLength(1);
        expect(nodes[0]?.children?.[0]).toMatchObject({
          type: NodeType.return,
          name: 'value',
        });
      });

      it('parses return without value', () => {
        const input = `fn process() -> result:
  ->`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children).toHaveLength(1);
        expect(nodes[0]?.children?.[0]).toMatchObject({
          type: NodeType.return,
          name: '',
        });
      });
    });

    describe('early exits', () => {
      it('parses early exit with value', () => {
        const input = `fn process() -> result:
  *-> error`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children).toHaveLength(1);
        expect(nodes[0]?.children?.[0]).toMatchObject({
          type: NodeType.early_exit,
          name: 'error',
        });
      });

      it('parses early exit without value', () => {
        const input = `fn process() -> result:
  *->`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children).toHaveLength(1);
        expect(nodes[0]?.children?.[0]).toMatchObject({
          type: NodeType.early_exit,
          name: '',
        });
      });
    });

    describe('error handlers', () => {
      it('parses error handler', () => {
        const input = `fn process() -> result:
  on error:
    log()`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children).toHaveLength(1);
        expect(nodes[0]?.children?.[0]).toMatchObject({
          type: NodeType.error_handler,
          name: 'error',
        });
        expect(nodes[0]?.children?.[0]?.children).toHaveLength(1);
        expect(nodes[0]?.children?.[0]?.children?.[0]).toMatchObject({
          type: NodeType.call,
          name: 'log',
        });
      });

      it('parses error handler with custom error type', () => {
        const input = `fn process() -> result:
  on validation_error:
    handle()`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children?.[0]).toMatchObject({
          type: NodeType.error_handler,
          name: 'validation_error',
        });
      });
    });

    describe('block labels', () => {
      it('parses labeled block', () => {
        const input = `fn process() -> result:
  setup:
    init()`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children).toHaveLength(1);
        expect(nodes[0]?.children?.[0]).toMatchObject({
          type: NodeType.block,
          name: 'setup',
        });
        expect(nodes[0]?.children?.[0]?.children?.[0]).toMatchObject({
          type: NodeType.call,
          name: 'init',
        });
      });
    });

    describe('nested structures', () => {
      it('parses deeply nested structure', () => {
        const input = `fn process() -> result:
  validate()
  process_data:
    transform()
    save()
  -> result`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children).toHaveLength(3);
        expect(nodes[0]?.children?.[0]?.type).toBe(NodeType.call);
        expect(nodes[0]?.children?.[1]?.type).toBe(NodeType.block);
        expect(nodes[0]?.children?.[1]?.children).toHaveLength(2);
        expect(nodes[0]?.children?.[2]?.type).toBe(NodeType.return);
      });

      it('parses nested blocks with early exits', () => {
        const input = `fn process() -> result | error:
  validate()
    *-> error
  transform()
  -> result`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children).toHaveLength(3);
        expect(nodes[0]?.children?.[0]?.type).toBe(NodeType.call);
        expect(nodes[0]?.children?.[0]?.children?.[0]?.type).toBe(NodeType.early_exit);
      });

      it('parses complex nested structure from spec example', () => {
        const input = `fn process_order(data) -> order | errors:
  validate:
    check_format()
    @validate_with_api()
      *-> errors
  transform()
  on error:
    log()
    *-> errors
  -> order`;
        const nodes = parseFunctions(input);

        expect(nodes).toHaveLength(1);
        const fn = nodes[0];
        expect(fn?.name).toBe('process_order');
        expect(fn?.children).toHaveLength(4); // validate, transform, on error, return

        // Check validate block
        const validate = fn?.children?.[0];
        expect(validate?.type).toBe(NodeType.block);
        expect(validate?.name).toBe('validate');
        expect(validate?.children).toHaveLength(2);
        expect(validate?.children?.[0]?.type).toBe(NodeType.call);
        expect(validate?.children?.[1]?.type).toBe(NodeType.external_call);
        expect(validate?.children?.[1]?.children?.[0]?.type).toBe(NodeType.early_exit);

        // Check error handler
        const errorHandler = fn?.children?.[2];
        expect(errorHandler?.type).toBe(NodeType.error_handler);
        expect(errorHandler?.children).toHaveLength(2);
      });

      it('builds correct parent-child relationships for multiple indent levels', () => {
        const input = `fn process() -> result:
  level1:
    level2:
      level3()`;
        const nodes = parseFunctions(input);

        const level1 = nodes[0]?.children?.[0];
        expect(level1?.name).toBe('level1');
        expect(level1?.type).toBe(NodeType.block);

        const level2 = level1?.children?.[0];
        expect(level2?.name).toBe('level2');
        expect(level2?.type).toBe(NodeType.block);

        const level3 = level2?.children?.[0];
        expect(level3?.name).toBe('level3');
        expect(level3?.type).toBe(NodeType.call);
      });

      it('parses sibling blocks at same level', () => {
        const input = `fn process() -> result:
  block_a:
    call_a()
  block_b:
    call_b()`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children).toHaveLength(2);
        expect(nodes[0]?.children?.[0]?.name).toBe('block_a');
        expect(nodes[0]?.children?.[1]?.name).toBe('block_b');
      });

      it('parses multiple functions with bodies', () => {
        const input = `fn first() -> a:
  call_a()
  -> a

fn second() -> b:
  call_b()
  -> b`;
        const nodes = parseFunctions(input);

        expect(nodes).toHaveLength(2);
        expect(nodes[0]?.children).toHaveLength(2);
        expect(nodes[1]?.children).toHaveLength(2);
      });
    });

    describe('empty bodies', () => {
      it('handles function with no body', () => {
        const input = 'fn process() -> result:';
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children).toEqual([]);
      });

      it('handles block with no children', () => {
        const input = `fn process() -> result:
  empty_block:`;
        const nodes = parseFunctions(input);

        // An identifier followed by : is a block
        expect(nodes[0]?.children?.[0]?.type).toBe(NodeType.block);
        expect(nodes[0]?.children?.[0]?.children).toEqual([]);
      });
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
