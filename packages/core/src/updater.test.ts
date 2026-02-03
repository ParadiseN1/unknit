/**
 * Unit tests for the smart updater module.
 */

import { describe, it, expect } from 'vitest';
import {
  detectLineShifts,
  applyShiftsToSourceRef,
  applyShiftsToNodes,
  SmartUpdater,
  type LineShift,
} from './updater.js';
import { NodeType, type UnknitNode, type SourceRef } from './types.js';

describe('detectLineShifts', () => {
  describe('no changes', () => {
    it('returns empty array for identical content', () => {
      const original = ['line 1', 'line 2', 'line 3'];
      const modified = ['line 1', 'line 2', 'line 3'];

      const shifts = detectLineShifts(original, modified);

      expect(shifts).toEqual([]);
    });

    it('returns empty array for content-only changes', () => {
      const original = ['line 1', 'line 2', 'line 3'];
      const modified = ['line 1', 'modified line', 'line 3'];

      const shifts = detectLineShifts(original, modified);

      // Same number of lines, no shifts needed
      expect(shifts).toEqual([]);
    });
  });

  describe('line insertions', () => {
    it('detects single line insertion at beginning', () => {
      const original = ['line 1', 'line 2'];
      const modified = ['new line', 'line 1', 'line 2'];

      const shifts = detectLineShifts(original, modified);

      expect(shifts).toHaveLength(1);
      expect(shifts[0]).toEqual({ atLine: 1, delta: 1 });
    });

    it('detects single line insertion in middle', () => {
      const original = ['line 1', 'line 2', 'line 3'];
      const modified = ['line 1', 'new line', 'line 2', 'line 3'];

      const shifts = detectLineShifts(original, modified);

      expect(shifts).toHaveLength(1);
      expect(shifts[0]).toEqual({ atLine: 2, delta: 1 });
    });

    it('detects single line insertion at end', () => {
      const original = ['line 1', 'line 2'];
      const modified = ['line 1', 'line 2', 'new line'];

      const shifts = detectLineShifts(original, modified);

      expect(shifts).toHaveLength(1);
      expect(shifts[0]).toEqual({ atLine: 3, delta: 1 });
    });

    it('detects multiple line insertion', () => {
      const original = ['line 1', 'line 2'];
      const modified = ['line 1', 'new 1', 'new 2', 'new 3', 'line 2'];

      const shifts = detectLineShifts(original, modified);

      expect(shifts).toHaveLength(1);
      expect(shifts[0]).toEqual({ atLine: 2, delta: 3 });
    });
  });

  describe('line deletions', () => {
    it('detects single line deletion at beginning', () => {
      const original = ['line 1', 'line 2', 'line 3'];
      const modified = ['line 2', 'line 3'];

      const shifts = detectLineShifts(original, modified);

      expect(shifts).toHaveLength(1);
      expect(shifts[0]).toEqual({ atLine: 1, delta: -1 });
    });

    it('detects single line deletion in middle', () => {
      const original = ['line 1', 'line 2', 'line 3'];
      const modified = ['line 1', 'line 3'];

      const shifts = detectLineShifts(original, modified);

      expect(shifts).toHaveLength(1);
      expect(shifts[0]).toEqual({ atLine: 2, delta: -1 });
    });

    it('detects single line deletion at end', () => {
      const original = ['line 1', 'line 2', 'line 3'];
      const modified = ['line 1', 'line 2'];

      const shifts = detectLineShifts(original, modified);

      expect(shifts).toHaveLength(1);
      expect(shifts[0]).toEqual({ atLine: 3, delta: -1 });
    });

    it('detects multiple line deletion', () => {
      const original = ['line 1', 'del 1', 'del 2', 'del 3', 'line 2'];
      const modified = ['line 1', 'line 2'];

      const shifts = detectLineShifts(original, modified);

      expect(shifts).toHaveLength(1);
      expect(shifts[0]).toEqual({ atLine: 2, delta: -3 });
    });
  });

  describe('edge cases', () => {
    it('handles empty original', () => {
      const original: string[] = [];
      const modified = ['new line'];

      const shifts = detectLineShifts(original, modified);

      expect(shifts).toHaveLength(1);
      expect(shifts[0]).toEqual({ atLine: 1, delta: 1 });
    });

    it('handles empty modified', () => {
      const original = ['line 1'];
      const modified: string[] = [];

      const shifts = detectLineShifts(original, modified);

      expect(shifts).toHaveLength(1);
      expect(shifts[0]).toEqual({ atLine: 1, delta: -1 });
    });

    it('handles both empty', () => {
      const original: string[] = [];
      const modified: string[] = [];

      const shifts = detectLineShifts(original, modified);

      expect(shifts).toEqual([]);
    });
  });
});

describe('applyShiftsToSourceRef', () => {
  const sourceRef: SourceRef = {
    file: 'test.ts',
    startLine: 10,
    endLine: 20,
  };

  it('returns original if file does not match', () => {
    const shift: LineShift = { atLine: 5, delta: 2 };

    const result = applyShiftsToSourceRef(sourceRef, 'other.ts', [shift]);

    expect(result).toBe(sourceRef);
  });

  it('returns original if shift is after source range', () => {
    const shift: LineShift = { atLine: 25, delta: 2 };

    const result = applyShiftsToSourceRef(sourceRef, 'test.ts', [shift]);

    expect(result).toBe(sourceRef);
  });

  it('applies positive shift (insertion) before source range', () => {
    const shift: LineShift = { atLine: 5, delta: 3 };

    const result = applyShiftsToSourceRef(sourceRef, 'test.ts', [shift]);

    expect(result).not.toBe(sourceRef);
    expect(result.file).toBe('test.ts');
    expect(result.startLine).toBe(13);
    expect(result.endLine).toBe(23);
  });

  it('applies positive shift (insertion) at start of source range', () => {
    const shift: LineShift = { atLine: 10, delta: 2 };

    const result = applyShiftsToSourceRef(sourceRef, 'test.ts', [shift]);

    expect(result.startLine).toBe(12);
    expect(result.endLine).toBe(22);
  });

  it('applies positive shift (insertion) within source range', () => {
    const shift: LineShift = { atLine: 15, delta: 5 };

    const result = applyShiftsToSourceRef(sourceRef, 'test.ts', [shift]);

    // startLine is before shift point, so stays at 10
    // endLine is at or after shift point, so increases
    expect(result.startLine).toBe(10);
    expect(result.endLine).toBe(25);
  });

  it('applies negative shift (deletion) before source range', () => {
    const shift: LineShift = { atLine: 5, delta: -2 };

    const result = applyShiftsToSourceRef(sourceRef, 'test.ts', [shift]);

    expect(result.startLine).toBe(8);
    expect(result.endLine).toBe(18);
  });

  it('applies multiple shifts', () => {
    const shifts: LineShift[] = [
      { atLine: 5, delta: 2 }, // Insertion before
      { atLine: 15, delta: -1 }, // Deletion within
    ];

    const result = applyShiftsToSourceRef(sourceRef, 'test.ts', shifts);

    // After first shift: 12-22
    // After second shift: startLine stays 12 (not at/after 15), endLine becomes 21
    expect(result.startLine).toBe(12);
    expect(result.endLine).toBe(21);
  });

  it('returns original for empty shifts array', () => {
    const result = applyShiftsToSourceRef(sourceRef, 'test.ts', []);

    expect(result).toBe(sourceRef);
  });
});

describe('applyShiftsToNodes', () => {
  it('returns unchanged result for empty shifts', () => {
    const nodes: UnknitNode[] = [
      {
        type: NodeType.fn,
        name: 'test',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 10 },
      },
    ];

    const result = applyShiftsToNodes(nodes, 'test.ts', []);

    expect(result.updatedCount).toBe(0);
    expect(result.affectedFiles).toEqual([]);
    expect(result.nodes).toBe(nodes);
  });

  it('updates single node sourceRef', () => {
    const nodes: UnknitNode[] = [
      {
        type: NodeType.fn,
        name: 'test',
        sourceRef: { file: 'test.ts', startLine: 10, endLine: 20 },
      },
    ];

    const result = applyShiftsToNodes(nodes, 'test.ts', [
      { atLine: 5, delta: 2 },
    ]);

    expect(result.updatedCount).toBe(1);
    expect(result.affectedFiles).toEqual(['test.ts']);
    expect(nodes[0]?.sourceRef?.startLine).toBe(12);
    expect(nodes[0]?.sourceRef?.endLine).toBe(22);
  });

  it('updates nested children sourceRefs', () => {
    const nodes: UnknitNode[] = [
      {
        type: NodeType.fn,
        name: 'test',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 30 },
        children: [
          {
            type: NodeType.call,
            name: 'child1',
            sourceRef: { file: 'test.ts', startLine: 5, endLine: 10 },
          },
          {
            type: NodeType.block,
            name: 'block1',
            sourceRef: { file: 'test.ts', startLine: 15, endLine: 25 },
            children: [
              {
                type: NodeType.call,
                name: 'nested',
                sourceRef: { file: 'test.ts', startLine: 18, endLine: 22 },
              },
            ],
          },
        ],
      },
    ];

    const result = applyShiftsToNodes(nodes, 'test.ts', [
      { atLine: 1, delta: 3 },
    ]);

    expect(result.updatedCount).toBe(4);
    expect(nodes[0]?.sourceRef?.startLine).toBe(4);
    expect(nodes[0]?.children?.[0]?.sourceRef?.startLine).toBe(8);
    expect(nodes[0]?.children?.[1]?.sourceRef?.startLine).toBe(18);
    expect(nodes[0]?.children?.[1]?.children?.[0]?.sourceRef?.startLine).toBe(
      21
    );
  });

  it('only updates matching file', () => {
    const nodes: UnknitNode[] = [
      {
        type: NodeType.fn,
        name: 'test1',
        sourceRef: { file: 'test.ts', startLine: 10, endLine: 20 },
      },
      {
        type: NodeType.fn,
        name: 'test2',
        sourceRef: { file: 'other.ts', startLine: 10, endLine: 20 },
      },
    ];

    const result = applyShiftsToNodes(nodes, 'test.ts', [
      { atLine: 5, delta: 2 },
    ]);

    expect(result.updatedCount).toBe(1);
    expect(nodes[0]?.sourceRef?.startLine).toBe(12);
    expect(nodes[1]?.sourceRef?.startLine).toBe(10); // Unchanged
  });

  it('handles nodes without sourceRef', () => {
    const nodes: UnknitNode[] = [
      {
        type: NodeType.fn,
        name: 'test',
        children: [
          {
            type: NodeType.call,
            name: 'noRef',
            // No sourceRef
          },
          {
            type: NodeType.call,
            name: 'withRef',
            sourceRef: { file: 'test.ts', startLine: 10, endLine: 15 },
          },
        ],
      },
    ];

    const result = applyShiftsToNodes(nodes, 'test.ts', [
      { atLine: 5, delta: 2 },
    ]);

    expect(result.updatedCount).toBe(1);
    expect(nodes[0]?.children?.[1]?.sourceRef?.startLine).toBe(12);
  });
});

describe('SmartUpdater', () => {
  describe('detectShifts', () => {
    it('detects line insertion from content strings', () => {
      const updater = new SmartUpdater([]);

      const original = 'line 1\nline 2';
      const modified = 'line 1\nnew line\nline 2';

      const shifts = updater.detectShifts(original, modified);

      expect(shifts).toHaveLength(1);
      expect(shifts[0]).toEqual({ atLine: 2, delta: 1 });
    });

    it('detects line deletion from content strings', () => {
      const updater = new SmartUpdater([]);

      const original = 'line 1\nline 2\nline 3';
      const modified = 'line 1\nline 3';

      const shifts = updater.detectShifts(original, modified);

      expect(shifts).toHaveLength(1);
      expect(shifts[0]).toEqual({ atLine: 2, delta: -1 });
    });
  });

  describe('update', () => {
    it('updates nodes based on content diff', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'test',
          sourceRef: { file: 'test.ts', startLine: 5, endLine: 10 },
        },
      ];

      const updater = new SmartUpdater(nodes);

      const original = 'line 1\nline 2\nline 3\nline 4\nfunction test()';
      const modified =
        'line 1\nline 2\nnew line\nline 3\nline 4\nfunction test()';

      const result = updater.update('test.ts', original, modified);

      expect(result.updatedCount).toBe(1);
      expect(nodes[0]?.sourceRef?.startLine).toBe(6);
      expect(nodes[0]?.sourceRef?.endLine).toBe(11);
    });

    it('preserves user edits to block names', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.block,
          name: 'user-edited-name', // User-edited name should be preserved
          sourceRef: { file: 'test.ts', startLine: 10, endLine: 20 },
        },
      ];

      const updater = new SmartUpdater(nodes);

      const original = 'line 1\nline 2';
      const modified = 'line 1\nnew line\nline 2';

      updater.update('test.ts', original, modified);

      // Name should be preserved even after update
      expect(nodes[0]?.name).toBe('user-edited-name');
      // Only line numbers should change
      expect(nodes[0]?.sourceRef?.startLine).toBe(11);
    });
  });

  describe('applyShifts', () => {
    it('applies pre-computed shifts to nodes', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'test',
          sourceRef: { file: 'test.ts', startLine: 10, endLine: 20 },
        },
      ];

      const updater = new SmartUpdater(nodes);
      const shifts: LineShift[] = [{ atLine: 5, delta: 5 }];

      const result = updater.applyShifts('test.ts', shifts);

      expect(result.updatedCount).toBe(1);
      expect(nodes[0]?.sourceRef?.startLine).toBe(15);
      expect(nodes[0]?.sourceRef?.endLine).toBe(25);
    });
  });

  describe('getReferencedFiles', () => {
    it('returns empty array for nodes without sourceRefs', () => {
      const nodes: UnknitNode[] = [
        { type: NodeType.fn, name: 'test' },
        { type: NodeType.fn, name: 'test2' },
      ];

      const updater = new SmartUpdater(nodes);

      expect(updater.getReferencedFiles()).toEqual([]);
    });

    it('returns unique file paths from all nodes', () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'test1',
          sourceRef: { file: 'file1.ts', startLine: 1, endLine: 10 },
          children: [
            {
              type: NodeType.call,
              name: 'call1',
              sourceRef: { file: 'file2.ts', startLine: 5, endLine: 8 },
            },
          ],
        },
        {
          type: NodeType.fn,
          name: 'test2',
          sourceRef: { file: 'file1.ts', startLine: 15, endLine: 25 },
        },
      ];

      const updater = new SmartUpdater(nodes);

      const files = updater.getReferencedFiles();
      expect(files).toHaveLength(2);
      expect(files).toContain('file1.ts');
      expect(files).toContain('file2.ts');
    });
  });

  describe('getNodes', () => {
    it('returns the original nodes array', () => {
      const nodes: UnknitNode[] = [{ type: NodeType.fn, name: 'test' }];
      const updater = new SmartUpdater(nodes);

      expect(updater.getNodes()).toBe(nodes);
    });
  });
});

describe('integration: line shift scenarios', () => {
  it('handles function insertion at top of file', () => {
    const nodes: UnknitNode[] = [
      {
        type: NodeType.fn,
        name: 'existingFn',
        sourceRef: { file: 'app.ts', startLine: 1, endLine: 10 },
        children: [
          {
            type: NodeType.call,
            name: 'helper',
            sourceRef: { file: 'app.ts', startLine: 3, endLine: 5 },
          },
        ],
      },
    ];

    const updater = new SmartUpdater(nodes);

    // New function added at top (5 lines)
    const original = 'function existingFn() {\n  // body\n}';
    const modified =
      'function newFn() {\n  // new\n  // function\n}\n\nfunction existingFn() {\n  // body\n}';

    const result = updater.update('app.ts', original, modified);

    expect(result.updatedCount).toBe(2);
    // Both sourceRefs should shift down by 5 lines
    expect(nodes[0]?.sourceRef?.startLine).toBe(6);
    expect(nodes[0]?.sourceRef?.endLine).toBe(15);
    expect(nodes[0]?.children?.[0]?.sourceRef?.startLine).toBe(8);
    expect(nodes[0]?.children?.[0]?.sourceRef?.endLine).toBe(10);
  });

  it('handles function deletion in middle of file', () => {
    const nodes: UnknitNode[] = [
      {
        type: NodeType.fn,
        name: 'firstFn',
        sourceRef: { file: 'app.ts', startLine: 1, endLine: 5 },
      },
      {
        type: NodeType.fn,
        name: 'thirdFn',
        sourceRef: { file: 'app.ts', startLine: 15, endLine: 25 },
      },
    ];

    const updater = new SmartUpdater(nodes);

    // Middle function deleted (lines 6-14, 9 lines)
    const original = [
      'function first() {}', // 1
      '', // 2
      '', // 3
      '', // 4
      '}', // 5
      'function middle() {', // 6
      '  // deleted', // 7
      '  // function', // 8
      '  // body', // 9
      '  // here', // 10
      '  // more', // 11
      '  // lines', // 12
      '  // etc', // 13
      '}', // 14
      'function third() {', // 15
    ].join('\n');

    const modified = [
      'function first() {}', // 1
      '', // 2
      '', // 3
      '', // 4
      '}', // 5
      'function third() {', // 6
    ].join('\n');

    const result = updater.update('app.ts', original, modified);

    expect(result.updatedCount).toBe(1); // Only thirdFn should be affected
    // firstFn stays at 1-5
    expect(nodes[0]?.sourceRef?.startLine).toBe(1);
    expect(nodes[0]?.sourceRef?.endLine).toBe(5);
    // thirdFn shifts up by 9 lines
    expect(nodes[1]?.sourceRef?.startLine).toBe(6);
    expect(nodes[1]?.sourceRef?.endLine).toBe(16);
  });

  it('handles multiple files independently', () => {
    const nodes: UnknitNode[] = [
      {
        type: NodeType.fn,
        name: 'fn1',
        sourceRef: { file: 'a.ts', startLine: 10, endLine: 20 },
      },
      {
        type: NodeType.fn,
        name: 'fn2',
        sourceRef: { file: 'b.ts', startLine: 10, endLine: 20 },
      },
    ];

    const updater = new SmartUpdater(nodes);

    // Only update a.ts
    const result = updater.applyShifts('a.ts', [{ atLine: 5, delta: 5 }]);

    expect(result.updatedCount).toBe(1);
    expect(nodes[0]?.sourceRef?.startLine).toBe(15); // Updated
    expect(nodes[1]?.sourceRef?.startLine).toBe(10); // Unchanged
  });
});
