import { describe, it, expect } from 'vitest';
import {
  Parser,
  ParseError,
  parseFunctions,
  parseFunctionsWithRecovery,
  parseSourceRef,
} from './parser.js';
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

    it('includes expected and found info in error', () => {
      try {
        parseFunctions('fn process() result:');
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError);
        const error = e as ParseError;
        expect(error.expected).toBe('->');
        expect(error.found).toBe('result');
      }
    });
  });

  describe('error recovery (US-008)', () => {
    describe('parseFunctionsWithRecovery', () => {
      it('returns empty result for valid empty input', () => {
        const result = parseFunctionsWithRecovery('');
        expect(result.nodes).toEqual([]);
        expect(result.errors).toEqual([]);
        expect(result.success).toBe(true);
      });

      it('returns success for valid input', () => {
        const input = 'fn process(data) -> result:';
        const result = parseFunctionsWithRecovery(input);

        expect(result.nodes).toHaveLength(1);
        expect(result.errors).toEqual([]);
        expect(result.success).toBe(true);
      });

      it('collects error and continues parsing', () => {
        const input = `fn invalid(
fn second() -> result:`;
        const result = parseFunctionsWithRecovery(input);

        // Should have collected an error for the first function
        expect(result.errors.length).toBeGreaterThanOrEqual(1);
        expect(result.success).toBe(false);
        // Should have recovered and parsed the second function
        expect(result.nodes.length).toBeGreaterThanOrEqual(1);
      });

      it('collects multiple errors from multiple malformed functions', () => {
        const input = `fn bad1(
fn bad2(
fn good() -> result:`;
        const result = parseFunctionsWithRecovery(input);

        // Should have multiple errors
        expect(result.errors.length).toBeGreaterThanOrEqual(2);
        expect(result.success).toBe(false);
        // Should have parsed the good function
        expect(result.nodes.length).toBeGreaterThanOrEqual(1);
        const goodFn = result.nodes.find((n) => n.name === 'good');
        expect(goodFn).toBeDefined();
      });

      it('collects error when missing return type', () => {
        const input = `fn process() ->:
fn second() -> result:`;
        const result = parseFunctionsWithRecovery(input);

        expect(result.errors.length).toBeGreaterThanOrEqual(1);
        expect(result.errors[0]?.line).toBe(1);
      });

      it('collects error when unexpected token at start', () => {
        const input = `process() -> result:
fn second() -> result:`;
        const result = parseFunctionsWithRecovery(input);

        expect(result.errors.length).toBeGreaterThanOrEqual(1);
        expect(result.errors[0]?.expected).toBe('fn');
      });

      it('provides descriptive error messages', () => {
        const input = 'fn process() result:';
        const result = parseFunctionsWithRecovery(input);

        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]?.message).toContain("Expected '->'");
        expect(result.errors[0]?.message).toContain('result');
      });

      it('preserves correctly parsed functions between errors', () => {
        const input = `fn first() -> a:
fn invalid(
fn second() -> b:
fn broken() ->
fn third() -> c:`;
        const result = parseFunctionsWithRecovery(input);

        // Should have parsed first, second, and third
        const names = result.nodes.map((n) => n.name);
        expect(names).toContain('first');
        expect(names).toContain('second');
        expect(names).toContain('third');
        // Should have errors for invalid and broken
        expect(result.errors.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe('ParseError properties', () => {
      it('has expected and found properties', () => {
        const error = new ParseError(
          'test error',
          1,
          5,
          'identifier',
          '('
        );

        expect(error.expected).toBe('identifier');
        expect(error.found).toBe('(');
        expect(error.line).toBe(1);
        expect(error.column).toBe(5);
      });

      it('works without expected/found', () => {
        const error = new ParseError('test error', 1, 5);

        expect(error.expected).toBeUndefined();
        expect(error.found).toBeUndefined();
        expect(error.message).toBe('test error at line 1, column 5');
      });
    });

    describe('Parser.parseWithRecovery method', () => {
      it('can be called directly on Parser instance', () => {
        const parser = new Parser('fn test() -> result:');
        const result = parser.parseWithRecovery();

        expect(result.success).toBe(true);
        expect(result.nodes).toHaveLength(1);
        expect(result.errors).toEqual([]);
      });

      it('recovers from error in function body', () => {
        const input = `fn process() -> result:
  @incomplete
fn second() -> result:
  -> done`;
        const result = parseFunctionsWithRecovery(input);

        // Should have at least one error for incomplete external call
        expect(result.errors.length).toBeGreaterThanOrEqual(1);
        // Should have parsed both functions (with recovery)
        expect(result.nodes.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('multi-line error locations', () => {
      it('reports correct line number for error on second line', () => {
        const input = `fn first() -> result:
fn second) -> result:`;
        const result = parseFunctionsWithRecovery(input);

        const secondLineError = result.errors.find((e) => e.line === 2);
        expect(secondLineError).toBeDefined();
      });

      it('reports correct line number for error in function body', () => {
        const input = `fn process() -> result:
  validate()
  @incomplete
fn second() -> result:`;
        const result = parseFunctionsWithRecovery(input);

        // Error should be on line 3
        const bodyError = result.errors.find((e) => e.line === 3);
        expect(bodyError).toBeDefined();
      });
    });

    describe('error recovery edge cases', () => {
      it('handles input with only errors', () => {
        const input = `bad1(
bad2(
bad3(`;
        const result = parseFunctionsWithRecovery(input);

        expect(result.nodes).toEqual([]);
        expect(result.errors.length).toBeGreaterThanOrEqual(1);
        expect(result.success).toBe(false);
      });

      it('handles deeply nested error and recovers', () => {
        const input = `fn first() -> result:
  level1:
    level2:
      @broken
fn second() -> result:
  -> done`;
        const result = parseFunctionsWithRecovery(input);

        // Should have error for broken call
        expect(result.errors.length).toBeGreaterThanOrEqual(1);
        // Should have parsed both functions
        expect(result.nodes.length).toBeGreaterThanOrEqual(1);
      });
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

  describe('source reference extraction (US-007)', () => {
    describe('parseSourceRef function', () => {
      it('parses source reference with line range', () => {
        const result = parseSourceRef('{{src:path/to/file.ts:10-20}}');

        expect(result).toEqual({
          file: 'path/to/file.ts',
          startLine: 10,
          endLine: 20,
        });
      });

      it('parses source reference with single line', () => {
        const result = parseSourceRef('{{src:file.ts:42}}');

        expect(result).toEqual({
          file: 'file.ts',
          startLine: 42,
          endLine: 42,
        });
      });

      it('parses source reference with deep path', () => {
        const result = parseSourceRef('{{src:src/components/Button.tsx:1-50}}');

        expect(result).toEqual({
          file: 'src/components/Button.tsx',
          startLine: 1,
          endLine: 50,
        });
      });

      it('handles Windows-style paths with colon in drive letter', () => {
        const result = parseSourceRef('{{src:C:\\Users\\project\\file.ts:10-20}}');

        expect(result).toEqual({
          file: 'C:\\Users\\project\\file.ts',
          startLine: 10,
          endLine: 20,
        });
      });

      it('returns undefined for invalid format', () => {
        expect(parseSourceRef('not a source ref')).toBeUndefined();
        expect(parseSourceRef('{{src:}}')).toBeUndefined();
        expect(parseSourceRef('{{src:file}}')).toBeUndefined();
        expect(parseSourceRef('{{src:file:}}')).toBeUndefined();
        expect(parseSourceRef('{{src:file:abc}}')).toBeUndefined();
        expect(parseSourceRef('{{wrong:file:10}}')).toBeUndefined();
        expect(parseSourceRef('{src:file:10}')).toBeUndefined();
      });

      it('returns undefined for empty input', () => {
        expect(parseSourceRef('')).toBeUndefined();
      });
    });

    describe('function definition with source reference', () => {
      it('parses function with source reference', () => {
        const input = 'fn process(data) -> result: {{src:src/main.ts:10-25}}';
        const nodes = parseFunctions(input);

        expect(nodes).toHaveLength(1);
        expect(nodes[0]?.sourceRef).toEqual({
          file: 'src/main.ts',
          startLine: 10,
          endLine: 25,
        });
      });

      it('parses function without source reference', () => {
        const input = 'fn process(data) -> result:';
        const nodes = parseFunctions(input);

        expect(nodes).toHaveLength(1);
        expect(nodes[0]?.sourceRef).toBeUndefined();
      });
    });

    describe('internal calls with source reference', () => {
      it('parses call with source reference', () => {
        const input = `fn process() -> result:
  validate() {{src:src/validate.ts:5-10}}`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children?.[0]?.sourceRef).toEqual({
          file: 'src/validate.ts',
          startLine: 5,
          endLine: 10,
        });
      });

      it('parses multiple calls with source references', () => {
        const input = `fn process() -> result:
  validate() {{src:src/validate.ts:5-10}}
  transform() {{src:src/transform.ts:15-25}}`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children?.[0]?.sourceRef).toEqual({
          file: 'src/validate.ts',
          startLine: 5,
          endLine: 10,
        });
        expect(nodes[0]?.children?.[1]?.sourceRef).toEqual({
          file: 'src/transform.ts',
          startLine: 15,
          endLine: 25,
        });
      });
    });

    describe('external calls with source reference', () => {
      it('parses external call with source reference', () => {
        const input = `fn process() -> result:
  @db_query() {{src:src/db.ts:100-120}}`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children?.[0]?.sourceRef).toEqual({
          file: 'src/db.ts',
          startLine: 100,
          endLine: 120,
        });
      });
    });

    describe('blocks with source reference', () => {
      it('parses block label with source reference', () => {
        const input = `fn process() -> result:
  validation: {{src:src/main.ts:10-30}}
    check()`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children?.[0]?.type).toBe(NodeType.block);
        expect(nodes[0]?.children?.[0]?.sourceRef).toEqual({
          file: 'src/main.ts',
          startLine: 10,
          endLine: 30,
        });
      });
    });

    describe('return statements with source reference', () => {
      it('parses return with source reference', () => {
        const input = `fn process() -> result:
  -> value {{src:src/main.ts:50-50}}`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children?.[0]?.sourceRef).toEqual({
          file: 'src/main.ts',
          startLine: 50,
          endLine: 50,
        });
      });

      it('parses return without value but with source reference', () => {
        const input = `fn process() -> result:
  -> {{src:src/main.ts:50}}`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children?.[0]?.sourceRef).toEqual({
          file: 'src/main.ts',
          startLine: 50,
          endLine: 50,
        });
      });
    });

    describe('early exits with source reference', () => {
      it('parses early exit with source reference', () => {
        const input = `fn process() -> result:
  *-> error {{src:src/main.ts:25-26}}`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children?.[0]?.sourceRef).toEqual({
          file: 'src/main.ts',
          startLine: 25,
          endLine: 26,
        });
      });
    });

    describe('error handlers with source reference', () => {
      it('parses error handler with source reference', () => {
        const input = `fn process() -> result:
  on error: {{src:src/main.ts:40-50}}
    log()`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children?.[0]?.sourceRef).toEqual({
          file: 'src/main.ts',
          startLine: 40,
          endLine: 50,
        });
      });
    });

    describe('mixed source references', () => {
      it('parses complex structure with multiple source references', () => {
        const input = `fn process_order(data) -> order | errors: {{src:src/order.ts:1-100}}
  validate: {{src:src/order.ts:5-25}}
    check_format() {{src:src/order.ts:6-10}}
    @validate_with_api() {{src:src/order.ts:11-20}}
      *-> errors {{src:src/order.ts:15-16}}
  transform() {{src:src/order.ts:30-40}}
  on error: {{src:src/order.ts:45-55}}
    log() {{src:src/order.ts:46-48}}
    *-> errors {{src:src/order.ts:50-52}}
  -> order {{src:src/order.ts:60-60}}`;
        const nodes = parseFunctions(input);

        expect(nodes).toHaveLength(1);
        const fn = nodes[0];

        // Function source ref
        expect(fn?.sourceRef).toEqual({
          file: 'src/order.ts',
          startLine: 1,
          endLine: 100,
        });

        // Validate block
        const validate = fn?.children?.[0];
        expect(validate?.sourceRef).toEqual({
          file: 'src/order.ts',
          startLine: 5,
          endLine: 25,
        });

        // check_format call
        expect(validate?.children?.[0]?.sourceRef).toEqual({
          file: 'src/order.ts',
          startLine: 6,
          endLine: 10,
        });

        // validate_with_api external call
        expect(validate?.children?.[1]?.sourceRef).toEqual({
          file: 'src/order.ts',
          startLine: 11,
          endLine: 20,
        });

        // Early exit in external call
        expect(validate?.children?.[1]?.children?.[0]?.sourceRef).toEqual({
          file: 'src/order.ts',
          startLine: 15,
          endLine: 16,
        });

        // transform call
        expect(fn?.children?.[1]?.sourceRef).toEqual({
          file: 'src/order.ts',
          startLine: 30,
          endLine: 40,
        });

        // error handler
        const errorHandler = fn?.children?.[2];
        expect(errorHandler?.sourceRef).toEqual({
          file: 'src/order.ts',
          startLine: 45,
          endLine: 55,
        });

        // Return
        expect(fn?.children?.[3]?.sourceRef).toEqual({
          file: 'src/order.ts',
          startLine: 60,
          endLine: 60,
        });
      });

      it('handles missing source references gracefully in mixed content', () => {
        const input = `fn process() -> result:
  validate() {{src:src/validate.ts:5-10}}
  transform()
  -> result {{src:src/main.ts:50}}`;
        const nodes = parseFunctions(input);

        expect(nodes[0]?.children?.[0]?.sourceRef).toBeDefined();
        expect(nodes[0]?.children?.[1]?.sourceRef).toBeUndefined();
        expect(nodes[0]?.children?.[2]?.sourceRef).toBeDefined();
      });
    });
  });
});
