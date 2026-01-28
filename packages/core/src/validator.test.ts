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
  SourceFileValidator,
  type ValidatorOptions,
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
