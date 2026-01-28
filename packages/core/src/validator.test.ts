/**
 * Tests for the source file existence validator.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateSourceRef,
  validateNode,
  validateNodes,
  validateCoverage,
  SourceFileValidator,
  SourceCoverageValidator,
  type ValidatorOptions,
  type CoverageExpectedRange,
} from './validator.js';
import { NodeType, type UnknitNode, type SourceRef } from './types.js';

// Test fixtures directory
let fixturesDir: string;

beforeAll(async () => {
  // Create a temporary fixtures directory
  fixturesDir = join(tmpdir(), `unknit-test-${Date.now()}`);
  await mkdir(fixturesDir, { recursive: true });

  // Create test fixture files
  await writeFile(
    join(fixturesDir, 'sample.ts'),
    `// Line 1
// Line 2
// Line 3
function hello() {
  console.log('hello');
}
// Line 7
// Line 8
// Line 9
// Line 10
`
  );

  await writeFile(
    join(fixturesDir, 'empty.ts'),
    ''
  );

  await writeFile(
    join(fixturesDir, 'single-line.ts'),
    'const x = 1;'
  );

  await mkdir(join(fixturesDir, 'subdir'), { recursive: true });
  await writeFile(
    join(fixturesDir, 'subdir', 'nested.ts'),
    `// Line 1
// Line 2
// Line 3
`
  );
});

afterAll(async () => {
  // Clean up fixtures directory
  await rm(fixturesDir, { recursive: true, force: true });
});

describe('validateSourceRef', () => {
  describe('file existence', () => {
    it('passes for existing file', async () => {
      const sourceRef: SourceRef = {
        file: 'sample.ts',
        startLine: 1,
        endLine: 5,
      };
      const options: ValidatorOptions = { basePath: fixturesDir };

      const diagnostics = await validateSourceRef(sourceRef, options);
      expect(diagnostics).toHaveLength(0);
    });

    it('returns error for missing file', async () => {
      const sourceRef: SourceRef = {
        file: 'nonexistent.ts',
        startLine: 1,
        endLine: 5,
      };
      const options: ValidatorOptions = { basePath: fixturesDir };

      const diagnostics = await validateSourceRef(sourceRef, options);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('Source file not found');
      expect(diagnostics[0]?.message).toContain('nonexistent.ts');
    });

    it('handles nested file paths', async () => {
      const sourceRef: SourceRef = {
        file: 'subdir/nested.ts',
        startLine: 1,
        endLine: 3,
      };
      const options: ValidatorOptions = { basePath: fixturesDir };

      const diagnostics = await validateSourceRef(sourceRef, options);
      expect(diagnostics).toHaveLength(0);
    });
  });

  describe('line bounds validation', () => {
    it('passes for valid line range', async () => {
      const sourceRef: SourceRef = {
        file: 'sample.ts',
        startLine: 1,
        endLine: 10,
      };
      const options: ValidatorOptions = { basePath: fixturesDir };

      const diagnostics = await validateSourceRef(sourceRef, options);
      expect(diagnostics).toHaveLength(0);
    });

    it('returns error when startLine is less than 1', async () => {
      const sourceRef: SourceRef = {
        file: 'sample.ts',
        startLine: 0,
        endLine: 5,
      };
      const options: ValidatorOptions = { basePath: fixturesDir };

      const diagnostics = await validateSourceRef(sourceRef, options);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('exceed file bounds');
    });

    it('returns error when endLine exceeds file length', async () => {
      const sourceRef: SourceRef = {
        file: 'sample.ts',
        startLine: 1,
        endLine: 100, // File only has 10 lines
      };
      const options: ValidatorOptions = { basePath: fixturesDir };

      const diagnostics = await validateSourceRef(sourceRef, options);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('exceed file bounds');
      expect(diagnostics[0]?.message).toContain('10 lines');
    });

    it('returns error when startLine > endLine', async () => {
      const sourceRef: SourceRef = {
        file: 'sample.ts',
        startLine: 5,
        endLine: 2,
      };
      const options: ValidatorOptions = { basePath: fixturesDir };

      const diagnostics = await validateSourceRef(sourceRef, options);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('startLine');
      expect(diagnostics[0]?.message).toContain('greater than endLine');
    });

    it('handles empty file correctly', async () => {
      const sourceRef: SourceRef = {
        file: 'empty.ts',
        startLine: 1,
        endLine: 1,
      };
      const options: ValidatorOptions = { basePath: fixturesDir };

      const diagnostics = await validateSourceRef(sourceRef, options);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.message).toContain('exceed file bounds');
      expect(diagnostics[0]?.message).toContain('0 lines');
    });

    it('handles single line file correctly', async () => {
      const sourceRef: SourceRef = {
        file: 'single-line.ts',
        startLine: 1,
        endLine: 1,
      };
      const options: ValidatorOptions = { basePath: fixturesDir };

      const diagnostics = await validateSourceRef(sourceRef, options);
      expect(diagnostics).toHaveLength(0);
    });

    it('returns error for line 2 in single line file', async () => {
      const sourceRef: SourceRef = {
        file: 'single-line.ts',
        startLine: 1,
        endLine: 2,
      };
      const options: ValidatorOptions = { basePath: fixturesDir };

      const diagnostics = await validateSourceRef(sourceRef, options);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain('exceed file bounds');
    });
  });

  describe('diagnostic range', () => {
    it('includes correct unknit line in range', async () => {
      const sourceRef: SourceRef = {
        file: 'nonexistent.ts',
        startLine: 1,
        endLine: 5,
      };
      const options: ValidatorOptions = { basePath: fixturesDir };

      const diagnostics = await validateSourceRef(sourceRef, options, 42);
      expect(diagnostics[0]?.range.startLine).toBe(42);
      expect(diagnostics[0]?.range.endLine).toBe(42);
    });

    it('includes sourceRef in diagnostic', async () => {
      const sourceRef: SourceRef = {
        file: 'nonexistent.ts',
        startLine: 10,
        endLine: 20,
      };
      const options: ValidatorOptions = { basePath: fixturesDir };

      const diagnostics = await validateSourceRef(sourceRef, options);
      expect(diagnostics[0]?.sourceRef).toEqual(sourceRef);
    });
  });
});

describe('validateNode', () => {
  it('validates node with valid sourceRef', async () => {
    const node: UnknitNode = {
      type: NodeType.fn,
      name: 'test',
      sourceRef: { file: 'sample.ts', startLine: 1, endLine: 5 },
    };
    const options: ValidatorOptions = { basePath: fixturesDir };

    const result = await validateNode(node, options);
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('validates node without sourceRef (passes)', async () => {
    const node: UnknitNode = {
      type: NodeType.fn,
      name: 'test',
    };
    const options: ValidatorOptions = { basePath: fixturesDir };

    const result = await validateNode(node, options);
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('validates node with invalid sourceRef', async () => {
    const node: UnknitNode = {
      type: NodeType.fn,
      name: 'test',
      sourceRef: { file: 'missing.ts', startLine: 1, endLine: 5 },
    };
    const options: ValidatorOptions = { basePath: fixturesDir };

    const result = await validateNode(node, options);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe('error');
  });

  it('validates children recursively', async () => {
    const node: UnknitNode = {
      type: NodeType.fn,
      name: 'test',
      sourceRef: { file: 'sample.ts', startLine: 1, endLine: 10 },
      children: [
        {
          type: NodeType.call,
          name: 'helper',
          sourceRef: { file: 'missing-child.ts', startLine: 1, endLine: 5 },
        },
      ],
    };
    const options: ValidatorOptions = { basePath: fixturesDir };

    const result = await validateNode(node, options);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('missing-child.ts');
  });

  it('collects multiple errors from nested structure', async () => {
    const node: UnknitNode = {
      type: NodeType.fn,
      name: 'test',
      sourceRef: { file: 'missing1.ts', startLine: 1, endLine: 5 },
      children: [
        {
          type: NodeType.call,
          name: 'helper',
          sourceRef: { file: 'missing2.ts', startLine: 1, endLine: 5 },
        },
        {
          type: NodeType.block,
          name: 'section',
          sourceRef: { file: 'missing3.ts', startLine: 1, endLine: 5 },
        },
      ],
    };
    const options: ValidatorOptions = { basePath: fixturesDir };

    const result = await validateNode(node, options);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toHaveLength(3);
  });
});

describe('validateNodes', () => {
  it('validates multiple nodes', async () => {
    const nodes: UnknitNode[] = [
      {
        type: NodeType.fn,
        name: 'func1',
        sourceRef: { file: 'sample.ts', startLine: 1, endLine: 5 },
      },
      {
        type: NodeType.fn,
        name: 'func2',
        sourceRef: { file: 'sample.ts', startLine: 6, endLine: 10 },
      },
    ];
    const options: ValidatorOptions = { basePath: fixturesDir };

    const result = await validateNodes(nodes, options);
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('collects errors from multiple nodes', async () => {
    const nodes: UnknitNode[] = [
      {
        type: NodeType.fn,
        name: 'func1',
        sourceRef: { file: 'missing1.ts', startLine: 1, endLine: 5 },
      },
      {
        type: NodeType.fn,
        name: 'func2',
        sourceRef: { file: 'missing2.ts', startLine: 1, endLine: 5 },
      },
    ];
    const options: ValidatorOptions = { basePath: fixturesDir };

    const result = await validateNodes(nodes, options);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toHaveLength(2);
  });

  it('handles empty nodes array', async () => {
    const options: ValidatorOptions = { basePath: fixturesDir };

    const result = await validateNodes([], options);
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe('SourceFileValidator class', () => {
  it('creates validator with options', () => {
    const validator = new SourceFileValidator({ basePath: fixturesDir });
    expect(validator).toBeDefined();
  });

  it('validates sourceRef using instance method', async () => {
    const validator = new SourceFileValidator({ basePath: fixturesDir });
    const sourceRef: SourceRef = {
      file: 'sample.ts',
      startLine: 1,
      endLine: 5,
    };

    const diagnostics = await validator.validateSourceRef(sourceRef);
    expect(diagnostics).toHaveLength(0);
  });

  it('validates node using instance method', async () => {
    const validator = new SourceFileValidator({ basePath: fixturesDir });
    const node: UnknitNode = {
      type: NodeType.fn,
      name: 'test',
      sourceRef: { file: 'sample.ts', startLine: 1, endLine: 5 },
    };

    const result = await validator.validateNode(node);
    expect(result.valid).toBe(true);
  });

  it('validates nodes using instance method', async () => {
    const validator = new SourceFileValidator({ basePath: fixturesDir });
    const nodes: UnknitNode[] = [
      {
        type: NodeType.fn,
        name: 'test',
        sourceRef: { file: 'sample.ts', startLine: 1, endLine: 5 },
      },
    ];

    const result = await validator.validateNodes(nodes);
    expect(result.valid).toBe(true);
  });

  it('returns errors for missing file using instance', async () => {
    const validator = new SourceFileValidator({ basePath: fixturesDir });
    const sourceRef: SourceRef = {
      file: 'does-not-exist.ts',
      startLine: 1,
      endLine: 5,
    };

    const diagnostics = await validator.validateSourceRef(sourceRef);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe('error');
  });

  it('returns errors for line bounds using instance', async () => {
    const validator = new SourceFileValidator({ basePath: fixturesDir });
    const sourceRef: SourceRef = {
      file: 'sample.ts',
      startLine: 1,
      endLine: 500,
    };

    const diagnostics = await validator.validateSourceRef(sourceRef);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('exceed file bounds');
  });
});

describe('validateCoverage', () => {
  describe('overlap detection', () => {
    it('passes when no overlaps exist', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'test.ts', startLine: 1, endLine: 5 },
          children: [
            {
              type: NodeType.call,
              name: 'helper',
              sourceRef: { file: 'test.ts', startLine: 6, endLine: 10 },
            },
          ],
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };

      const result = await validateCoverage(nodes, options);
      expect(result.valid).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('detects overlapping source references', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'test.ts', startLine: 1, endLine: 10 },
          children: [
            {
              type: NodeType.call,
              name: 'helper',
              sourceRef: { file: 'test.ts', startLine: 5, endLine: 15 },
            },
          ],
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };

      const result = await validateCoverage(nodes, options);
      expect(result.valid).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe('warning');
      expect(result.diagnostics[0]?.message).toContain('Overlapping');
      expect(result.diagnostics[0]?.message).toContain('lines 5-10');
    });

    it('detects multiple overlaps', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'test.ts', startLine: 1, endLine: 10 },
          children: [
            {
              type: NodeType.call,
              name: 'helper1',
              sourceRef: { file: 'test.ts', startLine: 5, endLine: 12 },
            },
            {
              type: NodeType.call,
              name: 'helper2',
              sourceRef: { file: 'test.ts', startLine: 8, endLine: 15 },
            },
          ],
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };

      const result = await validateCoverage(nodes, options);
      expect(result.valid).toBe(false);
      // Should detect: func1 overlaps helper1 (5-10), func1 overlaps helper2 (8-10), helper1 overlaps helper2 (8-12)
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);
      result.diagnostics.forEach((d) => {
        expect(d.severity).toBe('warning');
        expect(d.message).toContain('Overlapping');
      });
    });

    it('handles single-line overlaps', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'test.ts', startLine: 1, endLine: 5 },
          children: [
            {
              type: NodeType.call,
              name: 'helper',
              sourceRef: { file: 'test.ts', startLine: 5, endLine: 10 },
            },
          ],
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };

      const result = await validateCoverage(nodes, options);
      expect(result.valid).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain('lines 5-5');
    });

    it('handles overlaps across different functions', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'test.ts', startLine: 1, endLine: 10 },
        },
        {
          type: NodeType.fn,
          name: 'func2',
          sourceRef: { file: 'test.ts', startLine: 8, endLine: 20 },
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };

      const result = await validateCoverage(nodes, options);
      expect(result.valid).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain('lines 8-10');
    });

    it('does not flag non-overlapping references', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'test.ts', startLine: 1, endLine: 5 },
        },
        {
          type: NodeType.fn,
          name: 'func2',
          sourceRef: { file: 'test.ts', startLine: 10, endLine: 20 },
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };

      const result = await validateCoverage(nodes, options);
      expect(result.valid).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('treats different files independently', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'file1.ts', startLine: 1, endLine: 10 },
        },
        {
          type: NodeType.fn,
          name: 'func2',
          sourceRef: { file: 'file2.ts', startLine: 1, endLine: 10 },
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };

      const result = await validateCoverage(nodes, options);
      expect(result.valid).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });
  });

  describe('gap detection', () => {
    it('passes when full range is covered', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'test.ts', startLine: 1, endLine: 10 },
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };
      const expectedRange: CoverageExpectedRange = {
        file: 'test.ts',
        startLine: 1,
        endLine: 10,
      };

      const result = await validateCoverage(nodes, options, expectedRange);
      expect(result.valid).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('detects gap at start', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'test.ts', startLine: 5, endLine: 10 },
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };
      const expectedRange: CoverageExpectedRange = {
        file: 'test.ts',
        startLine: 1,
        endLine: 10,
      };

      const result = await validateCoverage(nodes, options, expectedRange);
      expect(result.valid).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.severity).toBe('warning');
      expect(result.diagnostics[0]?.message).toContain('Coverage gap');
      expect(result.diagnostics[0]?.message).toContain('lines 1-4');
    });

    it('detects gap at end', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'test.ts', startLine: 1, endLine: 5 },
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };
      const expectedRange: CoverageExpectedRange = {
        file: 'test.ts',
        startLine: 1,
        endLine: 10,
      };

      const result = await validateCoverage(nodes, options, expectedRange);
      expect(result.valid).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain('lines 6-10');
    });

    it('detects gap in middle', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'test.ts', startLine: 1, endLine: 3 },
          children: [
            {
              type: NodeType.call,
              name: 'helper',
              sourceRef: { file: 'test.ts', startLine: 7, endLine: 10 },
            },
          ],
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };
      const expectedRange: CoverageExpectedRange = {
        file: 'test.ts',
        startLine: 1,
        endLine: 10,
      };

      const result = await validateCoverage(nodes, options, expectedRange);
      expect(result.valid).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain('lines 4-6');
    });

    it('detects multiple gaps', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'test.ts', startLine: 3, endLine: 5 },
          children: [
            {
              type: NodeType.call,
              name: 'helper',
              sourceRef: { file: 'test.ts', startLine: 8, endLine: 9 },
            },
          ],
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };
      const expectedRange: CoverageExpectedRange = {
        file: 'test.ts',
        startLine: 1,
        endLine: 12,
      };

      const result = await validateCoverage(nodes, options, expectedRange);
      expect(result.valid).toBe(false);
      // Gaps: 1-2, 6-7, 10-12
      expect(result.diagnostics).toHaveLength(3);
      result.diagnostics.forEach((d) => {
        expect(d.severity).toBe('warning');
        expect(d.message).toContain('Coverage gap');
      });
    });

    it('detects single-line gap', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'test.ts', startLine: 1, endLine: 4 },
          children: [
            {
              type: NodeType.call,
              name: 'helper',
              sourceRef: { file: 'test.ts', startLine: 6, endLine: 10 },
            },
          ],
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };
      const expectedRange: CoverageExpectedRange = {
        file: 'test.ts',
        startLine: 1,
        endLine: 10,
      };

      const result = await validateCoverage(nodes, options, expectedRange);
      expect(result.valid).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain('line 5');
    });

    it('does not report gaps without expected range', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'test.ts', startLine: 5, endLine: 10 },
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };

      // No expected range, so no gap detection
      const result = await validateCoverage(nodes, options);
      expect(result.valid).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('includes sourceRef in gap diagnostics', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'test.ts', startLine: 5, endLine: 10 },
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };
      const expectedRange: CoverageExpectedRange = {
        file: 'test.ts',
        startLine: 1,
        endLine: 10,
      };

      const result = await validateCoverage(nodes, options, expectedRange);
      expect(result.diagnostics[0]?.sourceRef).toEqual({
        file: 'test.ts',
        startLine: 1,
        endLine: 4,
      });
    });
  });

  describe('combined overlap and gap detection', () => {
    it('detects both overlaps and gaps', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'test.ts', startLine: 3, endLine: 7 },
          children: [
            {
              type: NodeType.call,
              name: 'helper',
              sourceRef: { file: 'test.ts', startLine: 5, endLine: 10 },
            },
          ],
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };
      const expectedRange: CoverageExpectedRange = {
        file: 'test.ts',
        startLine: 1,
        endLine: 12,
      };

      const result = await validateCoverage(nodes, options, expectedRange);
      expect(result.valid).toBe(false);
      // Overlap: 5-7, Gaps: 1-2, 11-12
      expect(result.diagnostics.length).toBeGreaterThanOrEqual(3);

      const overlaps = result.diagnostics.filter((d) =>
        d.message.includes('Overlapping')
      );
      const gaps = result.diagnostics.filter((d) =>
        d.message.includes('Coverage gap')
      );

      expect(overlaps.length).toBeGreaterThanOrEqual(1);
      expect(gaps.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('edge cases', () => {
    it('handles empty nodes array', async () => {
      const options: ValidatorOptions = { basePath: fixturesDir };

      const result = await validateCoverage([], options);
      expect(result.valid).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('handles empty nodes with expected range (all gaps)', async () => {
      const options: ValidatorOptions = { basePath: fixturesDir };
      const expectedRange: CoverageExpectedRange = {
        file: 'test.ts',
        startLine: 1,
        endLine: 5,
      };

      const result = await validateCoverage([], options, expectedRange);
      expect(result.valid).toBe(false);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain('lines 1-5');
    });

    it('handles nodes without sourceRef', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          // No sourceRef
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };

      const result = await validateCoverage(nodes, options);
      expect(result.valid).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });

    it('handles deeply nested nodes', async () => {
      const nodes: UnknitNode[] = [
        {
          type: NodeType.fn,
          name: 'func1',
          sourceRef: { file: 'test.ts', startLine: 1, endLine: 3 },
          children: [
            {
              type: NodeType.block,
              name: 'block1',
              sourceRef: { file: 'test.ts', startLine: 4, endLine: 6 },
              children: [
                {
                  type: NodeType.call,
                  name: 'inner',
                  sourceRef: { file: 'test.ts', startLine: 7, endLine: 10 },
                },
              ],
            },
          ],
        },
      ];
      const options: ValidatorOptions = { basePath: fixturesDir };
      const expectedRange: CoverageExpectedRange = {
        file: 'test.ts',
        startLine: 1,
        endLine: 10,
      };

      const result = await validateCoverage(nodes, options, expectedRange);
      expect(result.valid).toBe(true);
      expect(result.diagnostics).toHaveLength(0);
    });
  });
});

describe('SourceCoverageValidator class', () => {
  it('creates validator with options', () => {
    const validator = new SourceCoverageValidator({ basePath: fixturesDir });
    expect(validator).toBeDefined();
  });

  it('validates coverage using instance method', async () => {
    const validator = new SourceCoverageValidator({ basePath: fixturesDir });
    const nodes: UnknitNode[] = [
      {
        type: NodeType.fn,
        name: 'func1',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 10 },
        children: [
          {
            type: NodeType.call,
            name: 'helper',
            sourceRef: { file: 'test.ts', startLine: 5, endLine: 15 },
          },
        ],
      },
    ];

    const result = await validator.validateCoverage(nodes);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.message).toContain('Overlapping');
  });

  it('validates coverage with expected range using instance method', async () => {
    const validator = new SourceCoverageValidator({ basePath: fixturesDir });
    const nodes: UnknitNode[] = [
      {
        type: NodeType.fn,
        name: 'func1',
        sourceRef: { file: 'test.ts', startLine: 5, endLine: 10 },
      },
    ];
    const expectedRange: CoverageExpectedRange = {
      file: 'test.ts',
      startLine: 1,
      endLine: 10,
    };

    const result = await validator.validateCoverage(nodes, expectedRange);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.message).toContain('Coverage gap');
  });
});

describe('SourceFileValidator coverage method', () => {
  it('validates coverage using instance method', async () => {
    const validator = new SourceFileValidator({ basePath: fixturesDir });
    const nodes: UnknitNode[] = [
      {
        type: NodeType.fn,
        name: 'func1',
        sourceRef: { file: 'test.ts', startLine: 1, endLine: 10 },
        children: [
          {
            type: NodeType.call,
            name: 'helper',
            sourceRef: { file: 'test.ts', startLine: 5, endLine: 15 },
          },
        ],
      },
    ];

    const result = await validator.validateCoverage(nodes);
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0]?.message).toContain('Overlapping');
  });
});
