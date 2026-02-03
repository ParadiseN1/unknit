// Tests for TypeScript/JavaScript source code reader
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  readTypeScriptSource,
  parseTypeScriptSource,
  extractFunctionBoundaries,
  extractImportStatements,
  matchFunctionStart,
  matchFunctionDeclaration,
  matchArrowFunction,
  matchClassMethod,
  findFunctionEnd,
  countBraces,
  parseParameters,
  parseImportLine,
  classifyImport,
  createTypeScriptReaderOptions,
  getLanguageFromPath,
  TypeScriptReader,
  type TypeScriptReaderOptions,
} from './typescript-reader.js';

// Default options for testing
const defaultOptions: TypeScriptReaderOptions = {
  internalPackages: ['@myapp/core', '@myapp/utils', 'mylib'],
  externalPackages: ['lodash', 'axios'],
};

describe('getLanguageFromPath', () => {
  it('returns typescript for .ts files', () => {
    expect(getLanguageFromPath('src/index.ts')).toBe('typescript');
  });

  it('returns typescript for .tsx files', () => {
    expect(getLanguageFromPath('src/App.tsx')).toBe('typescript');
  });

  it('returns javascript for .js files', () => {
    expect(getLanguageFromPath('src/index.js')).toBe('javascript');
  });

  it('returns javascript for .jsx files', () => {
    expect(getLanguageFromPath('src/App.jsx')).toBe('javascript');
  });

  it('returns javascript for unknown extensions', () => {
    expect(getLanguageFromPath('src/index')).toBe('javascript');
  });
});

describe('matchFunctionDeclaration', () => {
  it('matches simple function', () => {
    const result = matchFunctionDeclaration('function foo() {');
    expect(result).toEqual({
      name: 'foo',
      params: [],
      returnType: undefined,
      openBraceOffset: 0,
    });
  });

  it('matches function with parameters', () => {
    const result = matchFunctionDeclaration('function add(a, b) {');
    expect(result).toEqual({
      name: 'add',
      params: ['a', 'b'],
      returnType: undefined,
      openBraceOffset: 0,
    });
  });

  it('matches function with typed parameters', () => {
    const result = matchFunctionDeclaration('function process(x: number, y: string) {');
    expect(result).toEqual({
      name: 'process',
      params: ['x', 'y'],
      returnType: undefined,
      openBraceOffset: 0,
    });
  });

  it('matches function with return type', () => {
    const result = matchFunctionDeclaration('function getValue(): number {');
    expect(result).toEqual({
      name: 'getValue',
      params: [],
      returnType: 'number',
      openBraceOffset: 0,
    });
  });

  it('matches async function', () => {
    const result = matchFunctionDeclaration('async function fetchData() {');
    expect(result).toEqual({
      name: 'fetchData',
      params: [],
      returnType: undefined,
      openBraceOffset: 0,
    });
  });

  it('matches exported function', () => {
    const result = matchFunctionDeclaration('export function publicFn() {');
    expect(result).toEqual({
      name: 'publicFn',
      params: [],
      returnType: undefined,
      openBraceOffset: 0,
    });
  });

  it('matches export default function', () => {
    const result = matchFunctionDeclaration('export default function main() {');
    expect(result).toEqual({
      name: 'main',
      params: [],
      returnType: undefined,
      openBraceOffset: 0,
    });
  });

  it('matches generic function', () => {
    const result = matchFunctionDeclaration('function identity<T>(value: T): T {');
    expect(result).toEqual({
      name: 'identity',
      params: ['value'],
      returnType: 'T',
      openBraceOffset: 0,
    });
  });

  it('matches function without brace on same line', () => {
    const result = matchFunctionDeclaration('function foo()');
    expect(result).toEqual({
      name: 'foo',
      params: [],
      returnType: undefined,
      openBraceOffset: 1,
    });
  });

  it('returns null for non-function lines', () => {
    expect(matchFunctionDeclaration('const x = 1')).toBeNull();
    expect(matchFunctionDeclaration('class Foo {')).toBeNull();
    expect(matchFunctionDeclaration('// function commented()')).toBeNull();
    expect(matchFunctionDeclaration('')).toBeNull();
  });
});

describe('matchArrowFunction', () => {
  it('matches simple arrow function', () => {
    const lines = ['const foo = () => {'];
    const result = matchArrowFunction(lines[0] ?? '', 0, lines);
    expect(result).toEqual({
      name: 'foo',
      params: [],
      returnType: undefined,
      openBraceOffset: 0,
    });
  });

  it('matches arrow function with parameters', () => {
    const lines = ['const add = (a, b) => {'];
    const result = matchArrowFunction(lines[0] ?? '', 0, lines);
    expect(result).toEqual({
      name: 'add',
      params: ['a', 'b'],
      returnType: undefined,
      openBraceOffset: 0,
    });
  });

  it('matches async arrow function', () => {
    const lines = ['const fetch = async (url) => {'];
    const result = matchArrowFunction(lines[0] ?? '', 0, lines);
    expect(result).toEqual({
      name: 'fetch',
      params: ['url'],
      returnType: undefined,
      openBraceOffset: 0,
    });
  });

  it('matches exported arrow function', () => {
    const lines = ['export const handler = (event) => {'];
    const result = matchArrowFunction(lines[0] ?? '', 0, lines);
    expect(result).toEqual({
      name: 'handler',
      params: ['event'],
      returnType: undefined,
      openBraceOffset: 0,
    });
  });

  it('matches arrow function with single param (no parens)', () => {
    const lines = ['const double = x => {'];
    const result = matchArrowFunction(lines[0] ?? '', 0, lines);
    expect(result).toEqual({
      name: 'double',
      params: ['x'],
      returnType: undefined,
      openBraceOffset: 0,
    });
  });

  it('matches arrow function with return type', () => {
    const lines = ['const getValue = (): number => {'];
    const result = matchArrowFunction(lines[0] ?? '', 0, lines);
    expect(result).toEqual({
      name: 'getValue',
      params: [],
      returnType: 'number',
      openBraceOffset: 0,
    });
  });

  it('matches let/var arrow functions', () => {
    const lines = ['let fn = () => {'];
    const result = matchArrowFunction(lines[0] ?? '', 0, lines);
    expect(result?.name).toBe('fn');
  });

  it('matches expression body arrow function', () => {
    const lines = ['const double = (x) => x * 2;'];
    const result = matchArrowFunction(lines[0] ?? '', 0, lines);
    expect(result?.name).toBe('double');
    expect(result?.openBraceOffset).toBe(-1); // Expression body
  });

  it('returns null for non-arrow function lines', () => {
    const lines = ['const x = 1'];
    expect(matchArrowFunction(lines[0] ?? '', 0, lines)).toBeNull();
  });
});

describe('matchClassMethod', () => {
  it('matches simple method', () => {
    const lines = ['  getValue() {'];
    const result = matchClassMethod(lines[0] ?? '', 0, lines);
    expect(result?.name).toBe('getValue');
    expect(result?.params).toEqual([]);
  });

  it('matches method with parameters', () => {
    const lines = ['  setName(name: string) {'];
    const result = matchClassMethod(lines[0] ?? '', 0, lines);
    expect(result?.name).toBe('setName');
    expect(result?.params).toEqual(['name']);
  });

  it('matches async method', () => {
    const lines = ['  async fetchData() {'];
    const result = matchClassMethod(lines[0] ?? '', 0, lines);
    expect(result?.name).toBe('fetchData');
  });

  it('matches public method', () => {
    const lines = ['  public getData() {'];
    const result = matchClassMethod(lines[0] ?? '', 0, lines);
    expect(result?.name).toBe('getData');
  });

  it('matches private method', () => {
    const lines = ['  private _process() {'];
    const result = matchClassMethod(lines[0] ?? '', 0, lines);
    expect(result?.name).toBe('_process');
  });

  it('matches static method', () => {
    const lines = ['  static create() {'];
    const result = matchClassMethod(lines[0] ?? '', 0, lines);
    expect(result?.name).toBe('create');
  });

  it('matches constructor', () => {
    const lines = ['  constructor(name: string) {'];
    const result = matchClassMethod(lines[0] ?? '', 0, lines);
    expect(result?.name).toBe('constructor');
    expect(result?.params).toEqual(['name']);
  });

  it('matches getter', () => {
    const lines = ['  get name() {'];
    const result = matchClassMethod(lines[0] ?? '', 0, lines);
    expect(result?.name).toBe('name');
  });

  it('matches setter', () => {
    const lines = ['  set name(value: string) {'];
    const result = matchClassMethod(lines[0] ?? '', 0, lines);
    expect(result?.name).toBe('name');
    expect(result?.params).toEqual(['value']);
  });

  it('returns null for keywords', () => {
    const lines = ['if (condition) {'];
    expect(matchClassMethod(lines[0] ?? '', 0, lines)).toBeNull();
  });

  it('returns null for class declaration', () => {
    const lines = ['class Foo {'];
    expect(matchClassMethod(lines[0] ?? '', 0, lines)).toBeNull();
  });
});

describe('parseParameters', () => {
  it('parses empty parameters', () => {
    expect(parseParameters('')).toEqual([]);
    expect(parseParameters('   ')).toEqual([]);
  });

  it('parses single parameter', () => {
    expect(parseParameters('x')).toEqual(['x']);
  });

  it('parses multiple parameters', () => {
    expect(parseParameters('a, b, c')).toEqual(['a', 'b', 'c']);
  });

  it('parses typed parameters', () => {
    expect(parseParameters('x: number, y: string')).toEqual(['x', 'y']);
  });

  it('parses parameters with defaults', () => {
    expect(parseParameters("x = 1, y = 'hello'")).toEqual(['x', 'y']);
  });

  it('parses parameters with type and default', () => {
    expect(parseParameters('x: number = 0, y: string = "hi"')).toEqual(['x', 'y']);
  });

  it('parses optional parameters', () => {
    expect(parseParameters('x?: number')).toEqual(['x']);
    expect(parseParameters('x?: number, y: string')).toEqual(['x', 'y']);
  });

  it('parses rest parameters', () => {
    expect(parseParameters('...args')).toEqual(['...args']);
    expect(parseParameters('...args: any[]')).toEqual(['...args']);
    expect(parseParameters('a, ...rest')).toEqual(['a', '...rest']);
  });

  it('parses destructured object parameter', () => {
    expect(parseParameters('{ x, y }')).toEqual(['{ x, y }']);
    expect(parseParameters('{ x, y }: Point')).toEqual(['{ x, y }']);
  });

  it('parses destructured array parameter', () => {
    expect(parseParameters('[first, second]')).toEqual(['[first, second]']);
  });

  it('parses complex generic types', () => {
    expect(parseParameters('items: Array<Map<string, number>>, count: number')).toEqual([
      'items',
      'count',
    ]);
  });
});

describe('countBraces', () => {
  it('counts simple braces', () => {
    expect(countBraces('{ x }')).toEqual({ opens: 1, closes: 1 });
    expect(countBraces('{')).toEqual({ opens: 1, closes: 0 });
    expect(countBraces('}')).toEqual({ opens: 0, closes: 1 });
  });

  it('counts multiple braces', () => {
    expect(countBraces('{ { } }')).toEqual({ opens: 2, closes: 2 });
  });

  it('ignores braces in strings', () => {
    expect(countBraces('const s = "{"')).toEqual({ opens: 0, closes: 0 });
    expect(countBraces("const s = '}'")).toEqual({ opens: 0, closes: 0 });
    expect(countBraces('const s = `{}`')).toEqual({ opens: 0, closes: 0 });
  });

  it('ignores braces in comments', () => {
    expect(countBraces('x // { comment')).toEqual({ opens: 0, closes: 0 });
  });

  it('counts braces before comment', () => {
    expect(countBraces('{ // comment')).toEqual({ opens: 1, closes: 0 });
  });
});

describe('findFunctionEnd', () => {
  it('finds end of simple function', () => {
    const lines = ['function foo() {', '  return 1;', '}'];
    expect(findFunctionEnd(lines, 0, 0)).toBe(3);
  });

  it('finds end of nested braces', () => {
    const lines = ['function foo() {', '  if (x) {', '    return 1;', '  }', '}'];
    expect(findFunctionEnd(lines, 0, 0)).toBe(5);
  });

  it('handles brace on next line', () => {
    const lines = ['function foo()', '{', '  return 1;', '}'];
    expect(findFunctionEnd(lines, 0, 1)).toBe(4);
  });
});

describe('parseImportLine', () => {
  it('parses default import', () => {
    const result = parseImportLine("import React from 'react'");
    expect(result).toEqual({ module: 'react' });
  });

  it('parses named imports', () => {
    const result = parseImportLine("import { useState, useEffect } from 'react'");
    expect(result).toEqual({ module: 'react' });
  });

  it('parses namespace import', () => {
    const result = parseImportLine("import * as lodash from 'lodash'");
    expect(result).toEqual({ module: 'lodash' });
  });

  it('parses side-effect import', () => {
    const result = parseImportLine("import 'polyfill'");
    expect(result).toEqual({ module: 'polyfill' });
  });

  it('parses type import', () => {
    const result = parseImportLine("import type { User } from './types'");
    expect(result).toEqual({ module: './types' });
  });

  it('parses relative import', () => {
    const result = parseImportLine("import { helper } from './utils'");
    expect(result).toEqual({ module: './utils' });
  });

  it('parses parent relative import', () => {
    const result = parseImportLine("import { Model } from '../models'");
    expect(result).toEqual({ module: '../models' });
  });

  it('parses scoped package import', () => {
    const result = parseImportLine("import { something } from '@myapp/core'");
    expect(result).toEqual({ module: '@myapp/core' });
  });

  it('parses node: built-in import', () => {
    const result = parseImportLine("import { readFile } from 'node:fs/promises'");
    expect(result).toEqual({ module: 'node:fs/promises' });
  });

  it('parses require statement', () => {
    const result = parseImportLine("const fs = require('fs')");
    expect(result).toEqual({ module: 'fs' });
  });

  it('parses destructured require', () => {
    const result = parseImportLine("const { readFile } = require('fs')");
    expect(result).toEqual({ module: 'fs' });
  });

  it('parses re-export', () => {
    const result = parseImportLine("export { foo, bar } from './module'");
    expect(result).toEqual({ module: './module' });
  });

  it('parses re-export all', () => {
    const result = parseImportLine("export * from './module'");
    expect(result).toEqual({ module: './module' });
  });

  it('returns null for non-import lines', () => {
    expect(parseImportLine('')).toBeNull();
    expect(parseImportLine('const x = 1')).toBeNull();
    expect(parseImportLine("// import 'commented'")).toBeNull();
    expect(parseImportLine('function foo() {')).toBeNull();
  });
});

describe('classifyImport', () => {
  it('classifies relative imports as internal', () => {
    expect(classifyImport('./utils', defaultOptions)).toBe(true);
    expect(classifyImport('../models', defaultOptions)).toBe(true);
    expect(classifyImport('./components/Button', defaultOptions)).toBe(true);
  });

  it('classifies absolute path imports as internal', () => {
    expect(classifyImport('/src/utils', defaultOptions)).toBe(true);
  });

  it('classifies configured internal packages as internal', () => {
    expect(classifyImport('@myapp/core', defaultOptions)).toBe(true);
    expect(classifyImport('@myapp/core/utils', defaultOptions)).toBe(true);
    expect(classifyImport('@myapp/utils', defaultOptions)).toBe(true);
    expect(classifyImport('mylib', defaultOptions)).toBe(true);
    expect(classifyImport('mylib/helpers', defaultOptions)).toBe(true);
  });

  it('classifies configured external packages as external', () => {
    expect(classifyImport('lodash', defaultOptions)).toBe(false);
    expect(classifyImport('lodash/debounce', defaultOptions)).toBe(false);
    expect(classifyImport('axios', defaultOptions)).toBe(false);
  });

  it('classifies node: built-ins as external', () => {
    expect(classifyImport('node:fs', defaultOptions)).toBe(false);
    expect(classifyImport('node:path', defaultOptions)).toBe(false);
    expect(classifyImport('node:fs/promises', defaultOptions)).toBe(false);
  });

  it('classifies unknown packages as external', () => {
    expect(classifyImport('react', defaultOptions)).toBe(false);
    expect(classifyImport('express', defaultOptions)).toBe(false);
    expect(classifyImport('@types/node', defaultOptions)).toBe(false);
  });

  it('external packages override internal packages', () => {
    const options: TypeScriptReaderOptions = {
      internalPackages: ['mylib'],
      externalPackages: ['mylib'], // Explicitly marked as external
    };
    expect(classifyImport('mylib', options)).toBe(false);
  });
});

describe('extractImportStatements', () => {
  it('extracts multiple import statements', () => {
    const lines = [
      "import React from 'react';",
      "import { useState } from 'react';",
      "import { helper } from '@myapp/utils';",
      '',
      'function App() {',
      '  return null;',
      '}',
    ];
    const imports = extractImportStatements(lines, defaultOptions);
    expect(imports).toHaveLength(3);
    expect(imports[0]).toEqual({
      raw: "import React from 'react';",
      module: 'react',
      isInternal: false,
      line: 1,
    });
    expect(imports[1]).toEqual({
      raw: "import { useState } from 'react';",
      module: 'react',
      isInternal: false,
      line: 2,
    });
    expect(imports[2]).toEqual({
      raw: "import { helper } from '@myapp/utils';",
      module: '@myapp/utils',
      isInternal: true,
      line: 3,
    });
  });

  it('handles relative imports', () => {
    const lines = ["import { foo } from './foo';", "import { bar } from '../bar';"];
    const imports = extractImportStatements(lines, defaultOptions);
    expect(imports).toHaveLength(2);
    expect(imports[0]?.isInternal).toBe(true);
    expect(imports[1]?.isInternal).toBe(true);
  });

  it('handles empty content', () => {
    const imports = extractImportStatements([], defaultOptions);
    expect(imports).toEqual([]);
  });
});

describe('extractFunctionBoundaries', () => {
  it('extracts function declaration', () => {
    const lines = ['function hello() {', '  console.log("Hello");', '}'];
    const functions = extractFunctionBoundaries(lines);
    expect(functions).toHaveLength(1);
    expect(functions[0]).toEqual({
      name: 'hello',
      startLine: 1,
      endLine: 3,
      params: [],
      returnType: undefined,
    });
  });

  it('extracts multiple functions', () => {
    const lines = ['function foo() {', '  return 1;', '}', '', 'function bar(x) {', '  return x;', '}'];
    const functions = extractFunctionBoundaries(lines);
    expect(functions).toHaveLength(2);
    expect(functions[0]?.name).toBe('foo');
    expect(functions[0]?.startLine).toBe(1);
    expect(functions[0]?.endLine).toBe(3);
    expect(functions[1]?.name).toBe('bar');
    expect(functions[1]?.startLine).toBe(5);
    expect(functions[1]?.endLine).toBe(7);
  });

  it('extracts arrow functions', () => {
    const lines = ['const add = (a, b) => {', '  return a + b;', '};'];
    const functions = extractFunctionBoundaries(lines);
    expect(functions).toHaveLength(1);
    expect(functions[0]?.name).toBe('add');
    expect(functions[0]?.params).toEqual(['a', 'b']);
  });

  it('extracts async functions', () => {
    const lines = ['async function fetchData() {', '  const data = await fetch();', '  return data;', '}'];
    const functions = extractFunctionBoundaries(lines);
    expect(functions).toHaveLength(1);
    expect(functions[0]?.name).toBe('fetchData');
  });

  it('extracts class methods', () => {
    const lines = [
      'class MyClass {',
      '  constructor(name) {',
      '    this.name = name;',
      '  }',
      '',
      '  getName() {',
      '    return this.name;',
      '  }',
      '}',
    ];
    const functions = extractFunctionBoundaries(lines);
    expect(functions).toHaveLength(2);
    expect(functions[0]?.name).toBe('constructor');
    expect(functions[0]?.startLine).toBe(2);
    expect(functions[0]?.endLine).toBe(4);
    expect(functions[1]?.name).toBe('getName');
    expect(functions[1]?.startLine).toBe(6);
    expect(functions[1]?.endLine).toBe(8);
  });

  it('extracts exported functions', () => {
    const lines = ['export function publicFn() {', '  return true;', '}'];
    const functions = extractFunctionBoundaries(lines);
    expect(functions).toHaveLength(1);
    expect(functions[0]?.name).toBe('publicFn');
  });

  it('handles nested functions', () => {
    const lines = [
      'function outer() {',
      '  function inner() {',
      '    return 1;',
      '  }',
      '  return inner;',
      '}',
    ];
    const functions = extractFunctionBoundaries(lines);
    // Should find both outer and inner
    expect(functions.length).toBeGreaterThanOrEqual(1);
    expect(functions[0]?.name).toBe('outer');
  });

  it('handles function with complex body', () => {
    const lines = [
      'function complex() {',
      '  if (condition) {',
      '    return { foo: 1 };',
      '  }',
      '  const obj = {',
      '    bar: 2',
      '  };',
      '  return obj;',
      '}',
    ];
    const functions = extractFunctionBoundaries(lines);
    expect(functions).toHaveLength(1);
    expect(functions[0]?.endLine).toBe(9);
  });
});

describe('matchFunctionStart', () => {
  it('skips import lines', () => {
    const lines = ["import { foo } from 'bar';"];
    expect(matchFunctionStart(lines[0] ?? '', 0, lines)).toBeNull();
  });

  it('skips type/interface exports', () => {
    const lines = ['export type Foo = string;', 'export interface Bar {}'];
    expect(matchFunctionStart(lines[0] ?? '', 0, lines)).toBeNull();
    expect(matchFunctionStart(lines[1] ?? '', 1, lines)).toBeNull();
  });

  it('skips comments', () => {
    const lines = ['// function foo() {}', '/* function bar() {} */'];
    expect(matchFunctionStart(lines[0] ?? '', 0, lines)).toBeNull();
    expect(matchFunctionStart(lines[1] ?? '', 1, lines)).toBeNull();
  });
});

describe('parseTypeScriptSource', () => {
  it('parses complete TypeScript source', () => {
    const content = `
import React from 'react';
import { helper } from '@myapp/utils';

export function getUser(userId: number): User {
  return fetchUser(userId);
}

export const deleteUser = async (userId: number): Promise<boolean> => {
  await remove(userId);
  return true;
};
`.trim();

    const result = parseTypeScriptSource('test.ts', content, defaultOptions);

    expect(result.filePath).toBe('test.ts');
    expect(result.language).toBe('typescript');
    expect(result.imports).toHaveLength(2);
    expect(result.functions).toHaveLength(2);

    expect(result.functions[0]?.name).toBe('getUser');
    expect(result.functions[0]?.params).toEqual(['userId']);
    expect(result.functions[0]?.returnType).toBe('User');

    expect(result.functions[1]?.name).toBe('deleteUser');
  });

  it('parses JavaScript source', () => {
    const content = `
const add = (a, b) => {
  return a + b;
};
`.trim();

    const result = parseTypeScriptSource('utils.js', content, defaultOptions);
    expect(result.language).toBe('javascript');
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0]?.name).toBe('add');
  });
});

describe('createTypeScriptReaderOptions', () => {
  it('creates options from config', () => {
    const config = {
      internalPackages: ['@app/core', '@app/utils'],
      externalPackages: ['lodash'],
      sourceRoot: '.',
      outputRoot: '.',
      includeSourceRefs: true,
    };
    const options = createTypeScriptReaderOptions(config);
    expect(options).toEqual({
      internalPackages: ['@app/core', '@app/utils'],
      externalPackages: ['lodash'],
    });
  });
});

describe('TypeScriptReader class', () => {
  it('creates reader from options', () => {
    const reader = new TypeScriptReader(defaultOptions);
    expect(reader).toBeInstanceOf(TypeScriptReader);
  });

  it('creates reader from config', () => {
    const config = {
      internalPackages: ['@myapp/core'],
      externalPackages: [],
      sourceRoot: '.',
      outputRoot: '.',
      includeSourceRefs: true,
    };
    const reader = TypeScriptReader.fromConfig(config);
    expect(reader).toBeInstanceOf(TypeScriptReader);
  });

  it('parses content correctly', () => {
    const reader = new TypeScriptReader(defaultOptions);
    const result = reader.parse('test.ts', 'function foo() {\n  return 1;\n}');
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0]?.name).toBe('foo');
  });

  it('extracts functions from content', () => {
    const reader = new TypeScriptReader(defaultOptions);
    const functions = reader.extractFunctions('const bar = (x) => {\n  return x;\n};');
    expect(functions).toHaveLength(1);
    expect(functions[0]?.name).toBe('bar');
  });

  it('extracts imports from content', () => {
    const reader = new TypeScriptReader(defaultOptions);
    const imports = reader.extractImports("import React from 'react';\nimport { foo } from '@myapp/core';");
    expect(imports).toHaveLength(2);
    expect(imports[0]?.isInternal).toBe(false);
    expect(imports[1]?.isInternal).toBe(true);
  });
});

describe('readTypeScriptSource (file I/O)', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = join(tmpdir(), `unknit-ts-reader-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('reads and parses a TypeScript file', async () => {
    const filePath = join(tempDir, 'sample.ts');
    const content = `
import { readFile } from 'node:fs/promises';
import { helper } from '@myapp/core';

export async function main(): Promise<void> {
  const data = await readFile('file.txt', 'utf-8');
  helper(data);
}
`.trim();
    await writeFile(filePath, content);

    const result = await readTypeScriptSource(filePath, defaultOptions);

    expect(result.filePath).toBe(filePath);
    expect(result.language).toBe('typescript');
    expect(result.imports).toHaveLength(2);
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0]?.name).toBe('main');
  });

  it('reads and parses a JavaScript file', async () => {
    const filePath = join(tempDir, 'utils.js');
    const content = `
const lodash = require('lodash');

function processData(items) {
  return lodash.map(items, x => x * 2);
}

module.exports = { processData };
`.trim();
    await writeFile(filePath, content);

    const result = await readTypeScriptSource(filePath, defaultOptions);

    expect(result.language).toBe('javascript');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0]?.module).toBe('lodash');
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0]?.name).toBe('processData');
  });

  it('handles TSX file', async () => {
    const filePath = join(tempDir, 'Component.tsx');
    const content = `
import React from 'react';
import { Button } from '@myapp/utils';

interface Props {
  name: string;
}

export function Greeting({ name }: Props) {
  return <div>Hello, {name}!</div>;
}

export const Welcome = (props: Props) => {
  return <Button>{props.name}</Button>;
};
`.trim();
    await writeFile(filePath, content);

    const result = await readTypeScriptSource(filePath, defaultOptions);

    expect(result.language).toBe('typescript');
    expect(result.imports).toHaveLength(2);
    const internalImports = result.imports.filter((i) => i.isInternal);
    expect(internalImports).toHaveLength(1); // @myapp/utils

    expect(result.functions).toHaveLength(2);
    expect(result.functions[0]?.name).toBe('Greeting');
    expect(result.functions[1]?.name).toBe('Welcome');
  });

  it('handles file with no functions', async () => {
    const filePath = join(tempDir, 'constants.ts');
    const content = `
// Constants module
export const VALUE = 42;
export const NAME = "test";
`;
    await writeFile(filePath, content);

    const result = await readTypeScriptSource(filePath, defaultOptions);

    expect(result.functions).toHaveLength(0);
    expect(result.imports).toHaveLength(0);
  });

  it('handles file with only imports', async () => {
    const filePath = join(tempDir, 'imports.ts');
    const content = `
import 'reflect-metadata';
import type { User } from './types';
export { User };
`;
    await writeFile(filePath, content);

    const result = await readTypeScriptSource(filePath, defaultOptions);

    expect(result.functions).toHaveLength(0);
    expect(result.imports.length).toBeGreaterThanOrEqual(2);
  });

  it('handles complex TypeScript file', async () => {
    const filePath = join(tempDir, 'service.ts');
    const content = `
import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { UserRepository } from '@myapp/core';
import type { User } from './types';

@Injectable()
export class UserService {
  constructor(private readonly repo: UserRepository) {}

  async findAll(): Promise<User[]> {
    return this.repo.findAll();
  }

  async findById(id: number): Promise<User | null> {
    if (!id) {
      return null;
    }
    return this.repo.findById(id);
  }

  private async loadFromFile(path: string): Promise<string> {
    return readFile(path, 'utf-8');
  }
}

export async function createService(): Promise<UserService> {
  const repo = new UserRepository();
  return new UserService(repo);
}
`.trim();
    await writeFile(filePath, content);

    const result = await readTypeScriptSource(filePath, defaultOptions);

    expect(result.imports.length).toBe(4);
    const internalImports = result.imports.filter((i) => i.isInternal);
    const externalImports = result.imports.filter((i) => !i.isInternal);
    expect(internalImports.length).toBe(2); // @myapp/core, ./types
    expect(externalImports.length).toBe(2); // @nestjs/common, node:fs/promises

    // Functions: constructor, findAll, findById, loadFromFile, createService
    expect(result.functions.length).toBeGreaterThanOrEqual(4);
    expect(result.functions.map((f) => f.name)).toContain('constructor');
    expect(result.functions.map((f) => f.name)).toContain('findAll');
    expect(result.functions.map((f) => f.name)).toContain('findById');
    expect(result.functions.map((f) => f.name)).toContain('createService');
  });
});
