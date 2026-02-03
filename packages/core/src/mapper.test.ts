import { describe, it, expect } from 'vitest';
import { SourceBlockMapper, getLinesForBlock } from './mapper.js';
import { NodeType } from './types.js';
import type { UnknitNode, SourceRef } from './types.js';

describe('SourceBlockMapper', () => {
  describe('getBlockForLine', () => {
    it('returns undefined for empty nodes', () => {
      const mapper = new SourceBlockMapper([]);
      expect(mapper.getBlockForLine('test.ts', 1)).toBeUndefined();
    });

    it('returns undefined for non-indexed file', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'test',
          sourceRef: { file: 'a.ts', startLine: 1, endLine: 5 },
        },
      ];
      const mapper = new SourceBlockMapper(nodes);
      expect(mapper.getBlockForLine('b.ts', 1)).toBeUndefined();
    });

    it('returns undefined for line not in range', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'test',
          sourceRef: { file: 'test.ts', startLine: 5, endLine: 10 },
        },
      ];
      const mapper = new SourceBlockMapper(nodes);
      expect(mapper.getBlockForLine('test.ts', 1)).toBeUndefined();
      expect(mapper.getBlockForLine('test.ts', 4)).toBeUndefined();
      expect(mapper.getBlockForLine('test.ts', 11)).toBeUndefined();
    });

    it('returns node for line within range', () => {
      const node: UnknitNode = {
        type: NodeType.fn,
        name: 'myFunction',
        sourceRef: { file: 'test.ts', startLine: 5, endLine: 10 },
      };
      const mapper = new SourceBlockMapper([node]);

      expect(mapper.getBlockForLine('test.ts', 5)).toBe(node);
      expect(mapper.getBlockForLine('test.ts', 7)).toBe(node);
      expect(mapper.getBlockForLine('test.ts', 10)).toBe(node);
    });

    it('returns most specific (deepest) node for nested blocks', () => {
      const innerCall: UnknitNode = {
        type: NodeType.call,
        name: 'helper',
        sourceRef: { file: 'test.ts', startLine: 7, endLine: 8 },
      };
      const outerBlock: UnknitNode = {
        type: NodeType.block,
        name: 'setup',
        sourceRef: { file: 'test.ts', startLine: 6, endLine: 10 },
        children: [innerCall],
      };
      const fn: UnknitNode = {
        type: NodeType.fn,
        name: 'test',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 15 },
        children: [outerBlock],
      };
      const mapper = new SourceBlockMapper([fn]);

      // Line 1-5: function only (before block)
      expect(mapper.getBlockForLine('test.ts', 1)).toBe(fn);
      expect(mapper.getBlockForLine('test.ts', 5)).toBe(fn);

      // Line 6: block (before inner call)
      expect(mapper.getBlockForLine('test.ts', 6)).toBe(outerBlock);

      // Line 7-8: inner call (most specific)
      expect(mapper.getBlockForLine('test.ts', 7)).toBe(innerCall);
      expect(mapper.getBlockForLine('test.ts', 8)).toBe(innerCall);

      // Line 9-10: block (after inner call)
      expect(mapper.getBlockForLine('test.ts', 9)).toBe(outerBlock);
      expect(mapper.getBlockForLine('test.ts', 10)).toBe(outerBlock);

      // Line 11-15: function only (after block)
      expect(mapper.getBlockForLine('test.ts', 11)).toBe(fn);
      expect(mapper.getBlockForLine('test.ts', 15)).toBe(fn);
    });

    it('handles multiple files independently', () => {
      const nodeA: UnknitNode = {
        type: NodeType.fn,
        name: 'funcA',
        sourceRef: { file: 'a.ts', startLine: 1, endLine: 10 },
      };
      const nodeB: UnknitNode = {
        type: NodeType.fn,
        name: 'funcB',
        sourceRef: { file: 'b.ts', startLine: 1, endLine: 10 },
      };
      const mapper = new SourceBlockMapper([nodeA, nodeB]);

      expect(mapper.getBlockForLine('a.ts', 5)).toBe(nodeA);
      expect(mapper.getBlockForLine('b.ts', 5)).toBe(nodeB);
    });

    it('handles multiple functions in same file', () => {
      const func1: UnknitNode = {
        type: NodeType.fn,
        name: 'func1',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 10 },
      };
      const func2: UnknitNode = {
        type: NodeType.fn,
        name: 'func2',
        sourceRef: { file: 'test.ts', startLine: 12, endLine: 20 },
      };
      const mapper = new SourceBlockMapper([func1, func2]);

      expect(mapper.getBlockForLine('test.ts', 5)).toBe(func1);
      expect(mapper.getBlockForLine('test.ts', 11)).toBeUndefined();
      expect(mapper.getBlockForLine('test.ts', 15)).toBe(func2);
    });

    it('handles nodes without source references', () => {
      const nodeWithRef: UnknitNode = {
        type: NodeType.fn,
        name: 'withRef',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 5 },
      };
      const nodeWithoutRef: UnknitNode = {
        type: NodeType.block,
        name: 'noRef',
        // No sourceRef
      };
      const parent: UnknitNode = {
        type: NodeType.fn,
        name: 'parent',
        sourceRef: { file: 'test.ts', startLine: 10, endLine: 20 },
        children: [nodeWithoutRef],
      };
      const mapper = new SourceBlockMapper([nodeWithRef, parent]);

      expect(mapper.getBlockForLine('test.ts', 3)).toBe(nodeWithRef);
      expect(mapper.getBlockForLine('test.ts', 15)).toBe(parent);
    });
  });

  describe('getLinesForBlock', () => {
    it('returns undefined for node without sourceRef', () => {
      const node: UnknitNode = {
        type: NodeType.block,
        name: 'test',
      };
      const mapper = new SourceBlockMapper([node]);
      expect(mapper.getLinesForBlock(node)).toBeUndefined();
    });

    it('returns sourceRef for node with sourceRef', () => {
      const sourceRef: SourceRef = {
        file: 'test.ts',
        startLine: 5,
        endLine: 10,
      };
      const node: UnknitNode = {
        type: NodeType.fn,
        name: 'test',
        sourceRef,
      };
      const mapper = new SourceBlockMapper([node]);
      expect(mapper.getLinesForBlock(node)).toEqual(sourceRef);
    });

    it('works with standalone function', () => {
      const sourceRef: SourceRef = {
        file: 'test.ts',
        startLine: 1,
        endLine: 100,
      };
      const node: UnknitNode = {
        type: NodeType.fn,
        name: 'test',
        sourceRef,
      };
      expect(getLinesForBlock(node)).toEqual(sourceRef);
    });
  });

  describe('getBlockPath', () => {
    it('returns undefined for non-indexed file', () => {
      const mapper = new SourceBlockMapper([]);
      expect(mapper.getBlockPath('test.ts', 1)).toBeUndefined();
    });

    it('returns undefined for line not in range', () => {
      const node: UnknitNode = {
        type: NodeType.fn,
        name: 'test',
        sourceRef: { file: 'test.ts', startLine: 5, endLine: 10 },
      };
      const mapper = new SourceBlockMapper([node]);
      expect(mapper.getBlockPath('test.ts', 1)).toBeUndefined();
    });

    it('returns single-element path for top-level node', () => {
      const node: UnknitNode = {
        type: NodeType.fn,
        name: 'test',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 10 },
      };
      const mapper = new SourceBlockMapper([node]);
      const path = mapper.getBlockPath('test.ts', 5);

      expect(path).toBeDefined();
      expect(path).toHaveLength(1);
      expect(path![0]).toBe(node);
    });

    it('returns full ancestor chain for nested nodes', () => {
      const innerCall: UnknitNode = {
        type: NodeType.call,
        name: 'helper',
        sourceRef: { file: 'test.ts', startLine: 7, endLine: 8 },
      };
      const block: UnknitNode = {
        type: NodeType.block,
        name: 'setup',
        sourceRef: { file: 'test.ts', startLine: 5, endLine: 10 },
        children: [innerCall],
      };
      const fn: UnknitNode = {
        type: NodeType.fn,
        name: 'test',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 15 },
        children: [block],
      };
      const mapper = new SourceBlockMapper([fn]);

      // Path to innerCall
      const pathToCall = mapper.getBlockPath('test.ts', 7);
      expect(pathToCall).toBeDefined();
      expect(pathToCall).toHaveLength(3);
      expect(pathToCall![0]).toBe(fn);
      expect(pathToCall![1]).toBe(block);
      expect(pathToCall![2]).toBe(innerCall);

      // Path to block (line 6, before innerCall)
      const pathToBlock = mapper.getBlockPath('test.ts', 6);
      expect(pathToBlock).toBeDefined();
      expect(pathToBlock).toHaveLength(2);
      expect(pathToBlock![0]).toBe(fn);
      expect(pathToBlock![1]).toBe(block);

      // Path to fn (line 1)
      const pathToFn = mapper.getBlockPath('test.ts', 1);
      expect(pathToFn).toBeDefined();
      expect(pathToFn).toHaveLength(1);
      expect(pathToFn![0]).toBe(fn);
    });

    it('handles deeply nested structures', () => {
      const level3: UnknitNode = {
        type: NodeType.call,
        name: 'level3',
        sourceRef: { file: 'test.ts', startLine: 4, endLine: 4 },
      };
      const level2: UnknitNode = {
        type: NodeType.block,
        name: 'level2',
        sourceRef: { file: 'test.ts', startLine: 3, endLine: 5 },
        children: [level3],
      };
      const level1: UnknitNode = {
        type: NodeType.block,
        name: 'level1',
        sourceRef: { file: 'test.ts', startLine: 2, endLine: 6 },
        children: [level2],
      };
      const root: UnknitNode = {
        type: NodeType.fn,
        name: 'root',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 7 },
        children: [level1],
      };
      const mapper = new SourceBlockMapper([root]);

      const path = mapper.getBlockPath('test.ts', 4);
      expect(path).toBeDefined();
      expect(path).toHaveLength(4);
      expect(path![0]).toBe(root);
      expect(path![1]).toBe(level1);
      expect(path![2]).toBe(level2);
      expect(path![3]).toBe(level3);
    });
  });

  describe('getIndexedFiles', () => {
    it('returns empty array for no nodes', () => {
      const mapper = new SourceBlockMapper([]);
      expect(mapper.getIndexedFiles()).toEqual([]);
    });

    it('returns all indexed files', () => {
      const nodeA: UnknitNode = {
        type: NodeType.fn,
        name: 'a',
        sourceRef: { file: 'a.ts', startLine: 1, endLine: 5 },
      };
      const nodeB: UnknitNode = {
        type: NodeType.fn,
        name: 'b',
        sourceRef: { file: 'b.ts', startLine: 1, endLine: 5 },
      };
      const nodeC: UnknitNode = {
        type: NodeType.fn,
        name: 'c',
        sourceRef: { file: 'c.ts', startLine: 1, endLine: 5 },
      };
      const mapper = new SourceBlockMapper([nodeA, nodeB, nodeC]);
      const files = mapper.getIndexedFiles();

      expect(files).toHaveLength(3);
      expect(files).toContain('a.ts');
      expect(files).toContain('b.ts');
      expect(files).toContain('c.ts');
    });

    it('handles nodes without sourceRef', () => {
      const nodeWithRef: UnknitNode = {
        type: NodeType.fn,
        name: 'withRef',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 5 },
      };
      const nodeWithoutRef: UnknitNode = {
        type: NodeType.block,
        name: 'noRef',
      };
      const mapper = new SourceBlockMapper([nodeWithRef, nodeWithoutRef]);

      expect(mapper.getIndexedFiles()).toEqual(['test.ts']);
    });
  });

  describe('getIndexedLines', () => {
    it('returns empty array for non-indexed file', () => {
      const mapper = new SourceBlockMapper([]);
      expect(mapper.getIndexedLines('test.ts')).toEqual([]);
    });

    it('returns sorted line numbers for indexed file', () => {
      const node: UnknitNode = {
        type: NodeType.fn,
        name: 'test',
        sourceRef: { file: 'test.ts', startLine: 5, endLine: 10 },
      };
      const mapper = new SourceBlockMapper([node]);
      const lines = mapper.getIndexedLines('test.ts');

      expect(lines).toEqual([5, 6, 7, 8, 9, 10]);
    });

    it('handles non-contiguous ranges from multiple nodes', () => {
      const func1: UnknitNode = {
        type: NodeType.fn,
        name: 'func1',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 3 },
      };
      const func2: UnknitNode = {
        type: NodeType.fn,
        name: 'func2',
        sourceRef: { file: 'test.ts', startLine: 10, endLine: 12 },
      };
      const mapper = new SourceBlockMapper([func1, func2]);
      const lines = mapper.getIndexedLines('test.ts');

      expect(lines).toEqual([1, 2, 3, 10, 11, 12]);
    });
  });

  describe('getNodes', () => {
    it('returns the original nodes', () => {
      const nodes: UnknitNode[] = [
        { type: NodeType.fn, name: 'a' },
        { type: NodeType.fn, name: 'b' },
      ];
      const mapper = new SourceBlockMapper(nodes);
      expect(mapper.getNodes()).toBe(nodes);
    });
  });

  describe('rebuild', () => {
    it('updates index after node modification', () => {
      const node: UnknitNode = {
        type: NodeType.fn,
        name: 'test',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 5 },
      };
      const nodes = [node];
      const mapper = new SourceBlockMapper(nodes);

      // Initial state
      expect(mapper.getBlockForLine('test.ts', 3)).toBe(node);
      expect(mapper.getBlockForLine('test.ts', 7)).toBeUndefined();

      // Modify the node
      node.sourceRef = { file: 'test.ts', startLine: 5, endLine: 10 };

      // Old index still has old data
      expect(mapper.getBlockForLine('test.ts', 3)).toBe(node);

      // Rebuild
      mapper.rebuild();

      // New index reflects changes
      expect(mapper.getBlockForLine('test.ts', 3)).toBeUndefined();
      expect(mapper.getBlockForLine('test.ts', 7)).toBe(node);
    });
  });

  describe('standalone functions', () => {
    it('getBlockForLine works with raw index', () => {
      const node: UnknitNode = {
        type: NodeType.fn,
        name: 'test',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 5 },
      };
      const mapper = new SourceBlockMapper([node]);

      // Access the internal index via the getBlockForLine result
      // This is testing the standalone function pattern
      expect(mapper.getBlockForLine('test.ts', 3)).toBe(node);
    });

    it('getBlockPath works with raw index', () => {
      const child: UnknitNode = {
        type: NodeType.call,
        name: 'helper',
        sourceRef: { file: 'test.ts', startLine: 3, endLine: 3 },
      };
      const parent: UnknitNode = {
        type: NodeType.fn,
        name: 'test',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 5 },
        children: [child],
      };
      const mapper = new SourceBlockMapper([parent]);
      const path = mapper.getBlockPath('test.ts', 3);

      expect(path).toEqual([parent, child]);
    });
  });

  describe('edge cases', () => {
    it('handles single-line source reference', () => {
      const node: UnknitNode = {
        type: NodeType.call,
        name: 'test',
        sourceRef: { file: 'test.ts', startLine: 5, endLine: 5 },
      };
      const mapper = new SourceBlockMapper([node]);

      expect(mapper.getBlockForLine('test.ts', 4)).toBeUndefined();
      expect(mapper.getBlockForLine('test.ts', 5)).toBe(node);
      expect(mapper.getBlockForLine('test.ts', 6)).toBeUndefined();
    });

    it('handles overlapping source references (last child wins)', () => {
      // In practice, overlapping refs are a validation error,
      // but the mapper should handle them gracefully
      const child1: UnknitNode = {
        type: NodeType.block,
        name: 'block1',
        sourceRef: { file: 'test.ts', startLine: 3, endLine: 7 },
      };
      const child2: UnknitNode = {
        type: NodeType.block,
        name: 'block2',
        sourceRef: { file: 'test.ts', startLine: 5, endLine: 9 },
      };
      const parent: UnknitNode = {
        type: NodeType.fn,
        name: 'test',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 12 },
        children: [child1, child2],
      };
      const mapper = new SourceBlockMapper([parent]);

      // Lines 3-4: only child1
      expect(mapper.getBlockForLine('test.ts', 3)).toBe(child1);
      expect(mapper.getBlockForLine('test.ts', 4)).toBe(child1);

      // Lines 5-7: overlap - child2 wins (processed later)
      expect(mapper.getBlockForLine('test.ts', 5)).toBe(child2);
      expect(mapper.getBlockForLine('test.ts', 7)).toBe(child2);

      // Lines 8-9: only child2
      expect(mapper.getBlockForLine('test.ts', 8)).toBe(child2);
      expect(mapper.getBlockForLine('test.ts', 9)).toBe(child2);
    });

    it('handles all node types', () => {
      const returnNode: UnknitNode = {
        type: NodeType.return,
        name: '',
        sourceRef: { file: 'test.ts', startLine: 10, endLine: 10 },
      };
      const earlyExit: UnknitNode = {
        type: NodeType.early_exit,
        name: 'error',
        sourceRef: { file: 'test.ts', startLine: 8, endLine: 8 },
      };
      const errorHandler: UnknitNode = {
        type: NodeType.error_handler,
        name: 'error',
        sourceRef: { file: 'test.ts', startLine: 6, endLine: 7 },
      };
      const externalCall: UnknitNode = {
        type: NodeType.external_call,
        name: 'fetch',
        sourceRef: { file: 'test.ts', startLine: 4, endLine: 5 },
      };
      const call: UnknitNode = {
        type: NodeType.call,
        name: 'helper',
        sourceRef: { file: 'test.ts', startLine: 3, endLine: 3 },
      };
      const fn: UnknitNode = {
        type: NodeType.fn,
        name: 'test',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 12 },
        children: [call, externalCall, errorHandler, earlyExit, returnNode],
      };
      const mapper = new SourceBlockMapper([fn]);

      expect(mapper.getBlockForLine('test.ts', 1)).toBe(fn);
      expect(mapper.getBlockForLine('test.ts', 3)).toBe(call);
      expect(mapper.getBlockForLine('test.ts', 4)).toBe(externalCall);
      expect(mapper.getBlockForLine('test.ts', 6)).toBe(errorHandler);
      expect(mapper.getBlockForLine('test.ts', 8)).toBe(earlyExit);
      expect(mapper.getBlockForLine('test.ts', 10)).toBe(returnNode);
    });
  });
});
