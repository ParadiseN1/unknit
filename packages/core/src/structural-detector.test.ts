import { describe, it, expect } from 'vitest';
import {
  StructuralChangeDetector,
  detectStructuralChanges,
  StructuralChangeType,
  type FunctionSignature,
  type StructuralChange,
} from './structural-detector.js';
import { NodeType, type UnknitNode } from './types.js';

// Helper to get a change at index, throws if undefined
function getChange(changes: StructuralChange[], index: number): StructuralChange {
  const change = changes[index];
  if (!change) {
    throw new Error(`No change at index ${index}`);
  }
  return change;
}

// Helper to create a function node for testing
function createFunctionNode(
  name: string,
  file: string,
  startLine: number,
  endLine: number,
  params?: string[]
): UnknitNode {
  return {
    type: NodeType.fn,
    name,
    params,
    sourceRef: { file, startLine, endLine },
  };
}

// Helper to create a function signature for testing
function createSignature(
  name: string,
  file: string,
  startLine: number,
  endLine: number,
  params: string[] = []
): FunctionSignature {
  return { name, file, startLine, endLine, params };
}

describe('detectStructuralChanges', () => {
  describe('function added detection', () => {
    it('detects a new function in source', () => {
      const nodes: UnknitNode[] = [
        createFunctionNode('existingFn', 'test.ts', 1, 10, ['a']),
      ];
      const signatures: FunctionSignature[] = [
        createSignature('existingFn', 'test.ts', 1, 10, ['a']),
        createSignature('newFn', 'test.ts', 15, 25, ['x', 'y']),
      ];

      const result = detectStructuralChanges(nodes, signatures);

      expect(result.regenerationNeeded).toBe(true);
      expect(result.changes).toHaveLength(1);
      const change = getChange(result.changes, 0);
      expect(change.type).toBe(StructuralChangeType.function_added);
      expect(change.functionName).toBe('newFn');
      expect(change.file).toBe('test.ts');
      expect(change.sourceSignature).toBeDefined();
    });

    it('detects multiple new functions', () => {
      const nodes: UnknitNode[] = [];
      const signatures: FunctionSignature[] = [
        createSignature('fn1', 'test.ts', 1, 10),
        createSignature('fn2', 'test.ts', 15, 25),
        createSignature('fn3', 'test.ts', 30, 40),
      ];

      const result = detectStructuralChanges(nodes, signatures);

      expect(result.regenerationNeeded).toBe(true);
      expect(result.changes).toHaveLength(3);
      expect(result.changes.every((c) => c.type === StructuralChangeType.function_added)).toBe(true);
    });

    it('detects new function in different file', () => {
      const nodes: UnknitNode[] = [
        createFunctionNode('fn1', 'file1.ts', 1, 10),
      ];
      const signatures: FunctionSignature[] = [
        createSignature('fn1', 'file1.ts', 1, 10),
        createSignature('fn2', 'file2.ts', 1, 10),
      ];

      const result = detectStructuralChanges(nodes, signatures);

      expect(result.regenerationNeeded).toBe(true);
      expect(result.changes).toHaveLength(1);
      const change = getChange(result.changes, 0);
      expect(change.functionName).toBe('fn2');
      expect(change.file).toBe('file2.ts');
    });
  });

  describe('function removed detection', () => {
    it('detects a removed function', () => {
      const nodes: UnknitNode[] = [
        createFunctionNode('existingFn', 'test.ts', 1, 10),
        createFunctionNode('removedFn', 'test.ts', 15, 25),
      ];
      const signatures: FunctionSignature[] = [
        createSignature('existingFn', 'test.ts', 1, 10),
      ];

      const result = detectStructuralChanges(nodes, signatures);

      expect(result.regenerationNeeded).toBe(true);
      expect(result.changes).toHaveLength(1);
      const change = getChange(result.changes, 0);
      expect(change.type).toBe(StructuralChangeType.function_removed);
      expect(change.functionName).toBe('removedFn');
      expect(change.unknitNode).toBeDefined();
    });

    it('detects all functions removed from a file', () => {
      const nodes: UnknitNode[] = [
        createFunctionNode('fn1', 'test.ts', 1, 10),
        createFunctionNode('fn2', 'test.ts', 15, 25),
      ];
      const signatures: FunctionSignature[] = [];

      const result = detectStructuralChanges(nodes, signatures);

      expect(result.regenerationNeeded).toBe(true);
      expect(result.changes).toHaveLength(2);
      expect(result.changes.every((c) => c.type === StructuralChangeType.function_removed)).toBe(true);
    });
  });

  describe('signature changed detection', () => {
    it('detects parameter count change', () => {
      const nodes: UnknitNode[] = [
        createFunctionNode('fn', 'test.ts', 1, 10, ['a', 'b']),
      ];
      const signatures: FunctionSignature[] = [
        createSignature('fn', 'test.ts', 1, 10, ['a', 'b', 'c']),
      ];

      const result = detectStructuralChanges(nodes, signatures);

      expect(result.regenerationNeeded).toBe(true);
      expect(result.changes).toHaveLength(1);
      const change = getChange(result.changes, 0);
      expect(change.type).toBe(StructuralChangeType.signature_changed);
      expect(change.message).toContain('(a, b)');
      expect(change.message).toContain('(a, b, c)');
    });

    it('detects parameter name change', () => {
      const nodes: UnknitNode[] = [
        createFunctionNode('fn', 'test.ts', 1, 10, ['oldParam']),
      ];
      const signatures: FunctionSignature[] = [
        createSignature('fn', 'test.ts', 1, 10, ['newParam']),
      ];

      const result = detectStructuralChanges(nodes, signatures);

      expect(result.regenerationNeeded).toBe(true);
      expect(result.changes).toHaveLength(1);
      const change = getChange(result.changes, 0);
      expect(change.type).toBe(StructuralChangeType.signature_changed);
    });

    it('handles optional parameters correctly', () => {
      const nodes: UnknitNode[] = [
        createFunctionNode('fn', 'test.ts', 1, 10, ['a', 'b?']),
      ];
      const signatures: FunctionSignature[] = [
        createSignature('fn', 'test.ts', 1, 10, ['a', 'b']),
      ];

      const result = detectStructuralChanges(nodes, signatures);

      // Optional marker difference should not trigger change
      expect(result.regenerationNeeded).toBe(false);
      expect(result.changes).toHaveLength(0);
    });

    it('detects function rename via line overlap', () => {
      const nodes: UnknitNode[] = [
        createFunctionNode('oldName', 'test.ts', 1, 10, ['a']),
      ];
      const signatures: FunctionSignature[] = [
        createSignature('newName', 'test.ts', 1, 10, ['a']),
      ];

      const result = detectStructuralChanges(nodes, signatures);

      expect(result.regenerationNeeded).toBe(true);
      expect(result.changes).toHaveLength(1);
      const change = getChange(result.changes, 0);
      expect(change.type).toBe(StructuralChangeType.signature_changed);
      expect(change.message).toContain('renamed');
      expect(change.message).toContain('oldName');
      expect(change.message).toContain('newName');
    });
  });

  describe('no changes', () => {
    it('returns no changes when source matches unknit', () => {
      const nodes: UnknitNode[] = [
        createFunctionNode('fn1', 'test.ts', 1, 10, ['a', 'b']),
        createFunctionNode('fn2', 'test.ts', 15, 25, ['x']),
      ];
      const signatures: FunctionSignature[] = [
        createSignature('fn1', 'test.ts', 1, 10, ['a', 'b']),
        createSignature('fn2', 'test.ts', 15, 25, ['x']),
      ];

      const result = detectStructuralChanges(nodes, signatures);

      expect(result.regenerationNeeded).toBe(false);
      expect(result.changes).toHaveLength(0);
    });

    it('handles empty inputs', () => {
      const result = detectStructuralChanges([], []);

      expect(result.regenerationNeeded).toBe(false);
      expect(result.changes).toHaveLength(0);
    });

    it('matches functions with no parameters', () => {
      const nodes: UnknitNode[] = [
        createFunctionNode('fn', 'test.ts', 1, 10),
      ];
      const signatures: FunctionSignature[] = [
        createSignature('fn', 'test.ts', 1, 10, []),
      ];

      const result = detectStructuralChanges(nodes, signatures);

      expect(result.regenerationNeeded).toBe(false);
      expect(result.changes).toHaveLength(0);
    });
  });

  describe('complex scenarios', () => {
    it('handles multiple files', () => {
      const nodes: UnknitNode[] = [
        createFunctionNode('fn1', 'file1.ts', 1, 10, ['a']),
        createFunctionNode('fn2', 'file2.ts', 1, 15, ['x']),
      ];
      const signatures: FunctionSignature[] = [
        createSignature('fn1', 'file1.ts', 1, 10, ['a']),
        createSignature('fn2', 'file2.ts', 1, 15, ['x']),
      ];

      const result = detectStructuralChanges(nodes, signatures);

      expect(result.regenerationNeeded).toBe(false);
      expect(result.changes).toHaveLength(0);
    });

    it('handles mixed changes across files', () => {
      const nodes: UnknitNode[] = [
        createFunctionNode('fn1', 'file1.ts', 1, 10, ['a']),
        createFunctionNode('removedFn', 'file2.ts', 1, 10),
      ];
      const signatures: FunctionSignature[] = [
        createSignature('fn1', 'file1.ts', 1, 10, ['a', 'newParam']), // signature changed
        createSignature('addedFn', 'file2.ts', 15, 25),              // function added
      ];

      const result = detectStructuralChanges(nodes, signatures);

      expect(result.regenerationNeeded).toBe(true);
      expect(result.changes).toHaveLength(3);

      const changeTypes = result.changes.map((c) => c.type);
      expect(changeTypes).toContain(StructuralChangeType.function_added);
      expect(changeTypes).toContain(StructuralChangeType.function_removed);
      expect(changeTypes).toContain(StructuralChangeType.signature_changed);
    });

    it('matches by line overlap when lines shift', () => {
      // Function moved from lines 1-10 to lines 5-15 (but same content)
      const nodes: UnknitNode[] = [
        createFunctionNode('fn', 'test.ts', 1, 10, ['a']),
      ];
      const signatures: FunctionSignature[] = [
        createSignature('fn', 'test.ts', 5, 15, ['a']),
      ];

      const result = detectStructuralChanges(nodes, signatures);

      // Lines 1-10 and 5-15 overlap, so should match
      expect(result.regenerationNeeded).toBe(false);
      expect(result.changes).toHaveLength(0);
    });

    it('falls back to name matching when no line overlap', () => {
      // Function moved significantly (no line overlap)
      const nodes: UnknitNode[] = [
        createFunctionNode('fn', 'test.ts', 1, 10, ['a']),
      ];
      const signatures: FunctionSignature[] = [
        createSignature('fn', 'test.ts', 50, 60, ['a']),
      ];

      const result = detectStructuralChanges(nodes, signatures);

      // Should match by name even without line overlap
      expect(result.regenerationNeeded).toBe(false);
      expect(result.changes).toHaveLength(0);
    });
  });

  describe('nodes without sourceRef', () => {
    it('skips function nodes without sourceRef in unknit', () => {
      const nodeWithoutRef: UnknitNode = {
        type: NodeType.fn,
        name: 'fn',
        params: ['a'],
      };
      const nodes: UnknitNode[] = [nodeWithoutRef];
      const signatures: FunctionSignature[] = [
        createSignature('fn', 'test.ts', 1, 10, ['a']),
      ];

      // Node without sourceRef won't be grouped by file
      const result = detectStructuralChanges(nodes, signatures);

      expect(result.regenerationNeeded).toBe(true);
      expect(result.changes).toHaveLength(1);
      const change = getChange(result.changes, 0);
      expect(change.type).toBe(StructuralChangeType.function_added);
    });
  });
});

describe('StructuralChangeDetector class', () => {
  it('creates detector with nodes', () => {
    const nodes: UnknitNode[] = [
      createFunctionNode('fn', 'test.ts', 1, 10),
    ];
    const detector = new StructuralChangeDetector(nodes);

    expect(detector.getNodes()).toBe(nodes);
  });

  it('detects changes via detect method', () => {
    const nodes: UnknitNode[] = [
      createFunctionNode('fn', 'test.ts', 1, 10, ['a']),
    ];
    const detector = new StructuralChangeDetector(nodes);
    const signatures: FunctionSignature[] = [
      createSignature('fn', 'test.ts', 1, 10, ['a', 'b']),
    ];

    const result = detector.detect(signatures);

    expect(result.regenerationNeeded).toBe(true);
    expect(result.changes).toHaveLength(1);
  });

  it('checks needsRegeneration correctly', () => {
    const nodes: UnknitNode[] = [
      createFunctionNode('fn', 'test.ts', 1, 10, ['a']),
    ];
    const detector = new StructuralChangeDetector(nodes);

    const matchingSignatures: FunctionSignature[] = [
      createSignature('fn', 'test.ts', 1, 10, ['a']),
    ];
    expect(detector.needsRegeneration(matchingSignatures)).toBe(false);

    const changedSignatures: FunctionSignature[] = [
      createSignature('fn', 'test.ts', 1, 10, ['a', 'b']),
    ];
    expect(detector.needsRegeneration(changedSignatures)).toBe(true);
  });

  it('gets referenced files', () => {
    const nodes: UnknitNode[] = [
      createFunctionNode('fn1', 'file1.ts', 1, 10),
      createFunctionNode('fn2', 'file2.ts', 1, 10),
      createFunctionNode('fn3', 'file1.ts', 15, 25),
    ];
    const detector = new StructuralChangeDetector(nodes);

    const files = detector.getReferencedFiles();

    expect(files).toHaveLength(2);
    expect(files).toContain('file1.ts');
    expect(files).toContain('file2.ts');
  });

  it('handles nodes without sourceRef in getReferencedFiles', () => {
    const nodeWithoutRef: UnknitNode = {
      type: NodeType.fn,
      name: 'fn',
    };
    const nodes: UnknitNode[] = [nodeWithoutRef];
    const detector = new StructuralChangeDetector(nodes);

    const files = detector.getReferencedFiles();

    expect(files).toHaveLength(0);
  });

  it('only considers fn nodes for referenced files', () => {
    const nodes: UnknitNode[] = [
      createFunctionNode('fn1', 'file1.ts', 1, 10),
      {
        type: NodeType.block,
        name: 'block',
        sourceRef: { file: 'file2.ts', startLine: 1, endLine: 5 },
      },
    ];
    const detector = new StructuralChangeDetector(nodes);

    const files = detector.getReferencedFiles();

    expect(files).toHaveLength(1);
    expect(files).toContain('file1.ts');
  });
});

describe('edge cases', () => {
  it('handles functions with same name in different files', () => {
    const nodes: UnknitNode[] = [
      createFunctionNode('fn', 'file1.ts', 1, 10, ['a']),
      createFunctionNode('fn', 'file2.ts', 1, 10, ['b']),
    ];
    const signatures: FunctionSignature[] = [
      createSignature('fn', 'file1.ts', 1, 10, ['a']),
      createSignature('fn', 'file2.ts', 1, 10, ['b']),
    ];

    const result = detectStructuralChanges(nodes, signatures);

    expect(result.regenerationNeeded).toBe(false);
    expect(result.changes).toHaveLength(0);
  });

  it('handles adjacent line ranges correctly', () => {
    const nodes: UnknitNode[] = [
      createFunctionNode('fn1', 'test.ts', 1, 10, ['a']),
      createFunctionNode('fn2', 'test.ts', 11, 20, ['b']),
    ];
    const signatures: FunctionSignature[] = [
      createSignature('fn1', 'test.ts', 1, 10, ['a']),
      createSignature('fn2', 'test.ts', 11, 20, ['b']),
    ];

    const result = detectStructuralChanges(nodes, signatures);

    expect(result.regenerationNeeded).toBe(false);
    expect(result.changes).toHaveLength(0);
  });

  it('handles single-line functions', () => {
    const nodes: UnknitNode[] = [
      createFunctionNode('fn', 'test.ts', 5, 5, ['a']),
    ];
    const signatures: FunctionSignature[] = [
      createSignature('fn', 'test.ts', 5, 5, ['a']),
    ];

    const result = detectStructuralChanges(nodes, signatures);

    expect(result.regenerationNeeded).toBe(false);
    expect(result.changes).toHaveLength(0);
  });
});
