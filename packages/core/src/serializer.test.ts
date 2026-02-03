/**
 * Tests for the Unknit serializer.
 */

import { describe, it, expect } from 'vitest';
import { serialize, serializeSourceRef, Serializer } from './serializer.js';
import { parseFunctions } from './parser.js';
import { UnknitNode, NodeType, SourceRef } from './types.js';

describe('Serializer', () => {
  describe('serializeSourceRef', () => {
    it('returns empty string for undefined sourceRef', () => {
      expect(serializeSourceRef(undefined)).toBe('');
    });

    it('serializes single line reference', () => {
      const ref: SourceRef = { file: 'src/main.ts', startLine: 10, endLine: 10 };
      expect(serializeSourceRef(ref)).toBe(' {{src:src/main.ts:10}}');
    });

    it('serializes line range reference', () => {
      const ref: SourceRef = { file: 'src/main.ts', startLine: 10, endLine: 20 };
      expect(serializeSourceRef(ref)).toBe(' {{src:src/main.ts:10-20}}');
    });

    it('handles Windows-style paths', () => {
      const ref: SourceRef = { file: 'C:\\Users\\dev\\project\\main.ts', startLine: 5, endLine: 15 };
      expect(serializeSourceRef(ref)).toBe(' {{src:C:\\Users\\dev\\project\\main.ts:5-15}}');
    });
  });

  describe('serialize function definitions', () => {
    it('serializes simple function without params', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'main',
          returnType: 'void',
        },
      ];
      expect(serialize(nodes)).toBe('fn main() -> void:\n');
    });

    it('serializes function with params', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'greet',
          params: ['name', 'age'],
          returnType: 'string',
        },
      ];
      expect(serialize(nodes)).toBe('fn greet(name, age) -> string:\n');
    });

    it('serializes function with optional params', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'fetch',
          params: ['url', 'timeout?'],
          returnType: 'Response',
        },
      ];
      expect(serialize(nodes)).toBe('fn fetch(url, timeout?) -> Response:\n');
    });

    it('serializes function with error type', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'parse',
          params: ['input'],
          returnType: 'AST',
          errorType: 'ParseError',
        },
      ];
      expect(serialize(nodes)).toBe('fn parse(input) -> AST | ParseError:\n');
    });

    it('serializes function with source reference', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'process',
          returnType: 'void',
          sourceRef: { file: 'src/index.ts', startLine: 1, endLine: 50 },
        },
      ];
      expect(serialize(nodes)).toBe('fn process() -> void: {{src:src/index.ts:1-50}}\n');
    });
  });

  describe('serialize calls', () => {
    it('serializes internal call', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'main',
          returnType: 'void',
          children: [
            {
              type: NodeType.call,
              name: 'helper',
            },
          ],
        },
      ];
      expect(serialize(nodes)).toBe('fn main() -> void:\n  helper()\n');
    });

    it('serializes external call', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'main',
          returnType: 'void',
          children: [
            {
              type: NodeType.external_call,
              name: 'fetch',
            },
          ],
        },
      ];
      expect(serialize(nodes)).toBe('fn main() -> void:\n  @fetch()\n');
    });

    it('serializes call with source reference', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'main',
          returnType: 'void',
          children: [
            {
              type: NodeType.call,
              name: 'helper',
              sourceRef: { file: 'src/main.ts', startLine: 5, endLine: 5 },
            },
          ],
        },
      ];
      expect(serialize(nodes)).toBe('fn main() -> void:\n  helper() {{src:src/main.ts:5}}\n');
    });
  });

  describe('serialize blocks', () => {
    it('serializes block label', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'main',
          returnType: 'void',
          children: [
            {
              type: NodeType.block,
              name: 'validation',
            },
          ],
        },
      ];
      expect(serialize(nodes)).toBe('fn main() -> void:\n  validation:\n');
    });

    it('serializes block with source reference', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'main',
          returnType: 'void',
          children: [
            {
              type: NodeType.block,
              name: 'validation',
              sourceRef: { file: 'src/main.ts', startLine: 10, endLine: 20 },
            },
          ],
        },
      ];
      expect(serialize(nodes)).toBe('fn main() -> void:\n  validation: {{src:src/main.ts:10-20}}\n');
    });
  });

  describe('serialize returns and early exits', () => {
    it('serializes return with value', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'getValue',
          returnType: 'number',
          children: [
            {
              type: NodeType.return,
              name: 'result',
            },
          ],
        },
      ];
      expect(serialize(nodes)).toBe('fn getValue() -> number:\n  -> result\n');
    });

    it('serializes return without value', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'doWork',
          returnType: 'void',
          children: [
            {
              type: NodeType.return,
              name: '',
            },
          ],
        },
      ];
      expect(serialize(nodes)).toBe('fn doWork() -> void:\n  ->\n');
    });

    it('serializes early exit with value', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'validate',
          returnType: 'boolean',
          children: [
            {
              type: NodeType.early_exit,
              name: 'false',
            },
          ],
        },
      ];
      expect(serialize(nodes)).toBe('fn validate() -> boolean:\n  *-> false\n');
    });

    it('serializes early exit without value', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'check',
          returnType: 'void',
          children: [
            {
              type: NodeType.early_exit,
              name: '',
            },
          ],
        },
      ];
      expect(serialize(nodes)).toBe('fn check() -> void:\n  *->\n');
    });
  });

  describe('serialize error handlers', () => {
    it('serializes error handler', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'process',
          returnType: 'Result',
          errorType: 'Error',
          children: [
            {
              type: NodeType.error_handler,
              name: 'error',
            },
          ],
        },
      ];
      expect(serialize(nodes)).toBe('fn process() -> Result | Error:\n  on error:\n');
    });

    it('serializes error handler with source reference', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'process',
          returnType: 'Result',
          children: [
            {
              type: NodeType.error_handler,
              name: 'error',
              sourceRef: { file: 'src/main.ts', startLine: 30, endLine: 35 },
            },
          ],
        },
      ];
      expect(serialize(nodes)).toBe('fn process() -> Result:\n  on error: {{src:src/main.ts:30-35}}\n');
    });
  });

  describe('serialize nested structures', () => {
    it('serializes nested blocks', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'main',
          returnType: 'void',
          children: [
            {
              type: NodeType.block,
              name: 'outer',
              children: [
                {
                  type: NodeType.block,
                  name: 'inner',
                },
              ],
            },
          ],
        },
      ];
      expect(serialize(nodes)).toBe('fn main() -> void:\n  outer:\n    inner:\n');
    });

    it('serializes deeply nested structure', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'process',
          returnType: 'Result',
          children: [
            {
              type: NodeType.block,
              name: 'validation',
              children: [
                {
                  type: NodeType.call,
                  name: 'validate',
                  children: [
                    {
                      type: NodeType.early_exit,
                      name: 'false',
                    },
                  ],
                },
              ],
            },
            {
              type: NodeType.block,
              name: 'processing',
              children: [
                {
                  type: NodeType.external_call,
                  name: 'process',
                },
                {
                  type: NodeType.return,
                  name: 'result',
                },
              ],
            },
          ],
        },
      ];
      const expected = `fn process() -> Result:
  validation:
    validate()
      *-> false
  processing:
    @process()
    -> result
`;
      expect(serialize(nodes)).toBe(expected);
    });

    it('serializes error handler with children', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'fetch',
          returnType: 'Data',
          errorType: 'Error',
          children: [
            {
              type: NodeType.external_call,
              name: 'fetchData',
              children: [
                {
                  type: NodeType.error_handler,
                  name: 'error',
                  children: [
                    {
                      type: NodeType.call,
                      name: 'logError',
                    },
                    {
                      type: NodeType.early_exit,
                      name: 'null',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ];
      const expected = `fn fetch() -> Data | Error:
  @fetchData()
    on error:
      logError()
      *-> null
`;
      expect(serialize(nodes)).toBe(expected);
    });
  });

  describe('serialize multiple functions', () => {
    it('serializes multiple functions with blank lines between', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'first',
          returnType: 'void',
        },
        {
          type: NodeType.fn,
          name: 'second',
          returnType: 'void',
        },
      ];
      expect(serialize(nodes)).toBe('fn first() -> void:\n\nfn second() -> void:\n');
    });

    it('serializes multiple functions with bodies', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'first',
          returnType: 'void',
          children: [
            {
              type: NodeType.call,
              name: 'helper',
            },
          ],
        },
        {
          type: NodeType.fn,
          name: 'second',
          returnType: 'void',
          children: [
            {
              type: NodeType.return,
              name: '',
            },
          ],
        },
      ];
      const expected = `fn first() -> void:
  helper()

fn second() -> void:
  ->
`;
      expect(serialize(nodes)).toBe(expected);
    });
  });

  describe('round-trip tests', () => {
    it('round-trips simple function', () => {
      const input = `fn main() -> void:
`;
      const ast = parseFunctions(input);
      const output = serialize(ast);
      const reparsed = parseFunctions(output);
      expect(reparsed).toEqual(ast);
    });

    it('round-trips function with params and error type', () => {
      const input = `fn process(input, options?) -> Result | Error:
`;
      const ast = parseFunctions(input);
      const output = serialize(ast);
      const reparsed = parseFunctions(output);
      expect(reparsed).toEqual(ast);
    });

    it('round-trips function with children', () => {
      const input = `fn main() -> void:
  validate()
  process()
  -> result
`;
      const ast = parseFunctions(input);
      const output = serialize(ast);
      const reparsed = parseFunctions(output);
      expect(reparsed).toEqual(ast);
    });

    it('round-trips nested structure', () => {
      const input = `fn main() -> void:
  validation:
    checkInput()
    *-> false
  processing:
    @externalCall()
    -> result
`;
      const ast = parseFunctions(input);
      const output = serialize(ast);
      const reparsed = parseFunctions(output);
      expect(reparsed).toEqual(ast);
    });

    it('round-trips with source references', () => {
      const input = `fn main() -> void: {{src:src/main.ts:1-50}}
  validate() {{src:src/main.ts:5-10}}
  process() {{src:src/main.ts:15-30}}
`;
      const ast = parseFunctions(input);
      const output = serialize(ast);
      const reparsed = parseFunctions(output);
      expect(reparsed).toEqual(ast);
    });

    it('round-trips error handler', () => {
      const input = `fn fetch() -> Data | Error:
  @fetchData()
    on error:
      logError()
      *-> null
`;
      const ast = parseFunctions(input);
      const output = serialize(ast);
      const reparsed = parseFunctions(output);
      expect(reparsed).toEqual(ast);
    });

    it('round-trips multiple functions', () => {
      const input = `fn first() -> void:
  helper()

fn second() -> Result:
  process()
  -> result
`;
      const ast = parseFunctions(input);
      const output = serialize(ast);
      const reparsed = parseFunctions(output);
      expect(reparsed).toEqual(ast);
    });

    it('round-trips external calls', () => {
      const input = `fn main() -> void:
  @externalLib()
  @anotherExternal() {{src:src/main.ts:20}}
`;
      const ast = parseFunctions(input);
      const output = serialize(ast);
      const reparsed = parseFunctions(output);
      expect(reparsed).toEqual(ast);
    });
  });

  describe('Serializer class', () => {
    it('serializes using instance method', () => {
      const serializer = new Serializer();
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'main',
          returnType: 'void',
        },
      ];
      expect(serializer.serialize(nodes)).toBe('fn main() -> void:\n');
    });

    it('serializes single node', () => {
      const serializer = new Serializer();
      const node: UnknitNode = {
        type: NodeType.call,
        name: 'helper',
      };
      expect(serializer.serializeNode(node)).toBe('helper()');
    });

    it('serializes single node with indent', () => {
      const serializer = new Serializer();
      const node: UnknitNode = {
        type: NodeType.call,
        name: 'helper',
        children: [
          {
            type: NodeType.return,
            name: 'result',
          },
        ],
      };
      expect(serializer.serializeNode(node, 1)).toBe('  helper()\n    -> result');
    });

    it('serializes source ref using instance method', () => {
      const serializer = new Serializer();
      const ref: SourceRef = { file: 'test.ts', startLine: 1, endLine: 10 };
      expect(serializer.serializeSourceRef(ref)).toBe(' {{src:test.ts:1-10}}');
    });
  });
});
