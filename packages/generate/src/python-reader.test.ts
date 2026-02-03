// Tests for Python source code reader
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  readPythonSource,
  parsePythonSource,
  extractFunctionBoundaries,
  extractImportStatements,
  matchFunctionDefinition,
  parseParameters,
  getIndentation,
  isBlankOrComment,
  parseImportLine,
  classifyImport,
  createPythonReaderOptions,
  PythonReader,
  type PythonReaderOptions,
} from './python-reader.js';

// Default options for testing
const defaultOptions: PythonReaderOptions = {
  internalPackages: ['myapp', 'mylib'],
  externalPackages: ['requests', 'numpy'],
};

describe('matchFunctionDefinition', () => {
  it('matches simple function', () => {
    const result = matchFunctionDefinition('def foo():');
    expect(result).toEqual({ name: 'foo', params: [], returnType: undefined });
  });

  it('matches function with parameters', () => {
    const result = matchFunctionDefinition('def add(a, b):');
    expect(result).toEqual({ name: 'add', params: ['a', 'b'], returnType: undefined });
  });

  it('matches function with typed parameters', () => {
    const result = matchFunctionDefinition('def process(x: int, y: str):');
    expect(result).toEqual({ name: 'process', params: ['x', 'y'], returnType: undefined });
  });

  it('matches function with return type', () => {
    const result = matchFunctionDefinition('def get_value() -> int:');
    expect(result).toEqual({ name: 'get_value', params: [], returnType: 'int' });
  });

  it('matches function with complex return type', () => {
    const result = matchFunctionDefinition('def fetch() -> Optional[List[str]]:');
    expect(result).toEqual({ name: 'fetch', params: [], returnType: 'Optional[List[str]]' });
  });

  it('matches async function', () => {
    const result = matchFunctionDefinition('async def fetch_data():');
    expect(result).toEqual({ name: 'fetch_data', params: [], returnType: undefined });
  });

  it('matches indented function (method)', () => {
    const result = matchFunctionDefinition('    def method(self):');
    expect(result).toEqual({ name: 'method', params: ['self'], returnType: undefined });
  });

  it('matches function with default values', () => {
    const result = matchFunctionDefinition("def greet(name='World'):");
    expect(result).toEqual({ name: 'greet', params: ['name'], returnType: undefined });
  });

  it('matches function with *args and **kwargs', () => {
    const result = matchFunctionDefinition('def variadic(*args, **kwargs):');
    expect(result).toEqual({ name: 'variadic', params: ['*args', '**kwargs'], returnType: undefined });
  });

  it('returns null for non-function lines', () => {
    expect(matchFunctionDefinition('class Foo:')).toBeNull();
    expect(matchFunctionDefinition('x = 1')).toBeNull();
    expect(matchFunctionDefinition('# def commented():')).toBeNull();
    expect(matchFunctionDefinition('')).toBeNull();
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
    expect(parseParameters('x: int, y: str')).toEqual(['x', 'y']);
  });

  it('parses parameters with defaults', () => {
    expect(parseParameters("x=1, y='hello'")).toEqual(['x', 'y']);
  });

  it('parses parameters with type and default', () => {
    expect(parseParameters('x: int = 0, y: str = "hi"')).toEqual(['x', 'y']);
  });

  it('parses self parameter', () => {
    expect(parseParameters('self, x')).toEqual(['self', 'x']);
  });

  it('parses cls parameter', () => {
    expect(parseParameters('cls, x')).toEqual(['cls', 'x']);
  });

  it('parses *args', () => {
    expect(parseParameters('*args')).toEqual(['*args']);
  });

  it('parses **kwargs', () => {
    expect(parseParameters('**kwargs')).toEqual(['**kwargs']);
  });

  it('parses complex nested types', () => {
    expect(parseParameters('items: List[Dict[str, Any]], count: int')).toEqual(['items', 'count']);
  });

  it('handles keyword-only separator', () => {
    // * alone is used to separate positional from keyword-only args
    expect(parseParameters('a, *, b')).toEqual(['a', 'b']);
  });
});

describe('getIndentation', () => {
  it('returns 0 for no indentation', () => {
    expect(getIndentation('def foo():')).toBe(0);
  });

  it('counts spaces', () => {
    expect(getIndentation('    def foo():')).toBe(4);
    expect(getIndentation('        x = 1')).toBe(8);
  });

  it('treats tabs as 4 spaces', () => {
    expect(getIndentation('\tdef foo():')).toBe(4);
    expect(getIndentation('\t\tx = 1')).toBe(8);
  });

  it('handles mixed tabs and spaces', () => {
    expect(getIndentation('\t  x = 1')).toBe(6);
  });

  it('returns 0 for empty line', () => {
    expect(getIndentation('')).toBe(0);
  });
});

describe('isBlankOrComment', () => {
  it('identifies blank lines', () => {
    expect(isBlankOrComment('')).toBe(true);
    expect(isBlankOrComment('   ')).toBe(true);
    expect(isBlankOrComment('\t')).toBe(true);
  });

  it('identifies comment lines', () => {
    expect(isBlankOrComment('# comment')).toBe(true);
    expect(isBlankOrComment('    # indented comment')).toBe(true);
  });

  it('identifies non-blank/comment lines', () => {
    expect(isBlankOrComment('x = 1')).toBe(false);
    expect(isBlankOrComment('def foo():')).toBe(false);
    expect(isBlankOrComment("    return 'test'")).toBe(false);
  });
});

describe('extractFunctionBoundaries', () => {
  it('extracts single function', () => {
    const lines = [
      'def hello():',
      '    print("Hello")',
    ];
    const functions = extractFunctionBoundaries(lines);
    expect(functions).toHaveLength(1);
    expect(functions[0]).toEqual({
      name: 'hello',
      startLine: 1,
      endLine: 2,
      params: [],
      returnType: undefined,
    });
  });

  it('extracts multiple functions', () => {
    const lines = [
      'def foo():',
      '    pass',
      '',
      'def bar(x):',
      '    return x',
    ];
    const functions = extractFunctionBoundaries(lines);
    expect(functions).toHaveLength(2);
    expect(functions[0]?.name).toBe('foo');
    expect(functions[0]?.startLine).toBe(1);
    expect(functions[0]?.endLine).toBe(2);
    expect(functions[1]?.name).toBe('bar');
    expect(functions[1]?.startLine).toBe(4);
    expect(functions[1]?.endLine).toBe(5);
  });

  it('handles nested functions', () => {
    const lines = [
      'def outer():',
      '    def inner():',
      '        pass',
      '    return inner',
    ];
    const functions = extractFunctionBoundaries(lines);
    // Both outer and inner should be found
    expect(functions).toHaveLength(2);
    expect(functions[0]?.name).toBe('outer');
    expect(functions[0]?.startLine).toBe(1);
    expect(functions[0]?.endLine).toBe(4);
    expect(functions[1]?.name).toBe('inner');
    expect(functions[1]?.startLine).toBe(2);
    expect(functions[1]?.endLine).toBe(3);
  });

  it('handles class methods', () => {
    const lines = [
      'class MyClass:',
      '    def __init__(self):',
      '        self.value = 0',
      '',
      '    def get_value(self) -> int:',
      '        return self.value',
    ];
    const functions = extractFunctionBoundaries(lines);
    expect(functions).toHaveLength(2);
    expect(functions[0]?.name).toBe('__init__');
    expect(functions[0]?.params).toEqual(['self']);
    expect(functions[1]?.name).toBe('get_value');
    expect(functions[1]?.returnType).toBe('int');
  });

  it('handles async functions', () => {
    const lines = [
      'async def fetch():',
      '    await something()',
      '    return result',
    ];
    const functions = extractFunctionBoundaries(lines);
    expect(functions).toHaveLength(1);
    expect(functions[0]?.name).toBe('fetch');
    expect(functions[0]?.endLine).toBe(3);
  });

  it('handles empty function body', () => {
    const lines = [
      'def empty():',
      '    pass',
    ];
    const functions = extractFunctionBoundaries(lines);
    expect(functions).toHaveLength(1);
    expect(functions[0]?.endLine).toBe(2);
  });

  it('handles function with only docstring', () => {
    const lines = [
      'def documented():',
      '    """This is a docstring."""',
      '    pass',
    ];
    const functions = extractFunctionBoundaries(lines);
    expect(functions).toHaveLength(1);
    expect(functions[0]?.endLine).toBe(3);
  });

  it('handles decorators (function starts at def, not decorator)', () => {
    const lines = [
      '@decorator',
      'def decorated():',
      '    pass',
    ];
    const functions = extractFunctionBoundaries(lines);
    expect(functions).toHaveLength(1);
    expect(functions[0]?.startLine).toBe(2);
    expect(functions[0]?.endLine).toBe(3);
  });
});

describe('parseImportLine', () => {
  it('parses simple import', () => {
    const result = parseImportLine('import os');
    expect(result).toEqual({ modules: ['os'] });
  });

  it('parses import with alias', () => {
    const result = parseImportLine('import numpy as np');
    expect(result).toEqual({ modules: ['numpy'] });
  });

  it('parses multiple imports', () => {
    const result = parseImportLine('import os, sys, re');
    expect(result).toEqual({ modules: ['os', 'sys', 're'] });
  });

  it('parses from import', () => {
    const result = parseImportLine('from pathlib import Path');
    expect(result).toEqual({ modules: ['pathlib'] });
  });

  it('parses relative from import', () => {
    const result = parseImportLine('from .utils import helper');
    expect(result).toEqual({ modules: ['.utils'] });
  });

  it('parses parent relative import', () => {
    const result = parseImportLine('from ..models import User');
    expect(result).toEqual({ modules: ['..models'] });
  });

  it('returns null for non-import lines', () => {
    expect(parseImportLine('')).toBeNull();
    expect(parseImportLine('x = 1')).toBeNull();
    expect(parseImportLine('# import os')).toBeNull();
    expect(parseImportLine('def foo():')).toBeNull();
  });
});

describe('classifyImport', () => {
  it('classifies relative imports as internal', () => {
    expect(classifyImport('.utils', defaultOptions)).toBe(true);
    expect(classifyImport('..models', defaultOptions)).toBe(true);
    expect(classifyImport('.', defaultOptions)).toBe(true);
  });

  it('classifies configured internal packages as internal', () => {
    expect(classifyImport('myapp', defaultOptions)).toBe(true);
    expect(classifyImport('myapp.utils', defaultOptions)).toBe(true);
    expect(classifyImport('mylib', defaultOptions)).toBe(true);
    expect(classifyImport('mylib.core.module', defaultOptions)).toBe(true);
  });

  it('classifies configured external packages as external', () => {
    expect(classifyImport('requests', defaultOptions)).toBe(false);
    expect(classifyImport('requests.auth', defaultOptions)).toBe(false);
    expect(classifyImport('numpy', defaultOptions)).toBe(false);
    expect(classifyImport('numpy.array', defaultOptions)).toBe(false);
  });

  it('classifies unknown packages as external', () => {
    expect(classifyImport('os', defaultOptions)).toBe(false);
    expect(classifyImport('json', defaultOptions)).toBe(false);
    expect(classifyImport('flask', defaultOptions)).toBe(false);
  });

  it('external packages override internal packages', () => {
    const options: PythonReaderOptions = {
      internalPackages: ['myapp'],
      externalPackages: ['myapp'], // Explicitly marked as external
    };
    expect(classifyImport('myapp', options)).toBe(false);
  });
});

describe('extractImportStatements', () => {
  it('extracts multiple import statements', () => {
    const lines = [
      'import os',
      'from pathlib import Path',
      'from myapp.utils import helper',
      '',
      'def foo():',
      '    pass',
    ];
    const imports = extractImportStatements(lines, defaultOptions);
    expect(imports).toHaveLength(3);
    expect(imports[0]).toEqual({
      raw: 'import os',
      module: 'os',
      isInternal: false,
      line: 1,
    });
    expect(imports[1]).toEqual({
      raw: 'from pathlib import Path',
      module: 'pathlib',
      isInternal: false,
      line: 2,
    });
    expect(imports[2]).toEqual({
      raw: 'from myapp.utils import helper',
      module: 'myapp.utils',
      isInternal: true,
      line: 3,
    });
  });

  it('handles relative imports', () => {
    const lines = [
      'from . import sibling',
      'from ..parent import Parent',
    ];
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

describe('parsePythonSource', () => {
  it('parses complete Python source', () => {
    const content = `
import os
from myapp.models import User

def get_user(user_id: int) -> User:
    """Fetch a user by ID."""
    return User.get(user_id)

def delete_user(user_id: int) -> bool:
    User.delete(user_id)
    return True
`.trim();

    const result = parsePythonSource('test.py', content, defaultOptions);

    expect(result.filePath).toBe('test.py');
    expect(result.language).toBe('python');
    expect(result.imports).toHaveLength(2);
    expect(result.functions).toHaveLength(2);

    expect(result.functions[0]?.name).toBe('get_user');
    expect(result.functions[0]?.params).toEqual(['user_id']);
    expect(result.functions[0]?.returnType).toBe('User');

    expect(result.functions[1]?.name).toBe('delete_user');
  });
});

describe('createPythonReaderOptions', () => {
  it('creates options from config', () => {
    const config = {
      internalPackages: ['pkg1', 'pkg2'],
      externalPackages: ['ext1'],
      sourceRoot: '.',
      outputRoot: '.',
      includeSourceRefs: true,
    };
    const options = createPythonReaderOptions(config);
    expect(options).toEqual({
      internalPackages: ['pkg1', 'pkg2'],
      externalPackages: ['ext1'],
    });
  });
});

describe('PythonReader class', () => {
  it('creates reader from options', () => {
    const reader = new PythonReader(defaultOptions);
    expect(reader).toBeInstanceOf(PythonReader);
  });

  it('creates reader from config', () => {
    const config = {
      internalPackages: ['myapp'],
      externalPackages: [],
      sourceRoot: '.',
      outputRoot: '.',
      includeSourceRefs: true,
    };
    const reader = PythonReader.fromConfig(config);
    expect(reader).toBeInstanceOf(PythonReader);
  });

  it('parses content correctly', () => {
    const reader = new PythonReader(defaultOptions);
    const result = reader.parse('test.py', 'def foo():\n    pass');
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0]?.name).toBe('foo');
  });

  it('extracts functions from content', () => {
    const reader = new PythonReader(defaultOptions);
    const functions = reader.extractFunctions('def bar(x):\n    return x');
    expect(functions).toHaveLength(1);
    expect(functions[0]?.name).toBe('bar');
  });

  it('extracts imports from content', () => {
    const reader = new PythonReader(defaultOptions);
    const imports = reader.extractImports('import os\nfrom myapp import utils');
    expect(imports).toHaveLength(2);
    expect(imports[0]?.isInternal).toBe(false);
    expect(imports[1]?.isInternal).toBe(true);
  });
});

describe('readPythonSource (file I/O)', () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = join(tmpdir(), `unknit-python-reader-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('reads and parses a Python file', async () => {
    const filePath = join(tempDir, 'sample.py');
    const content = `
import json
from myapp.core import process

def main():
    data = json.loads('{}')
    process(data)
`.trim();
    await writeFile(filePath, content);

    const result = await readPythonSource(filePath, defaultOptions);

    expect(result.filePath).toBe(filePath);
    expect(result.language).toBe('python');
    expect(result.imports).toHaveLength(2);
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0]?.name).toBe('main');
  });

  it('handles file with no functions', async () => {
    const filePath = join(tempDir, 'constants.py');
    const content = `
# Constants module
VALUE = 42
NAME = "test"
`;
    await writeFile(filePath, content);

    const result = await readPythonSource(filePath, defaultOptions);

    expect(result.functions).toHaveLength(0);
    expect(result.imports).toHaveLength(0);
  });

  it('handles file with only imports', async () => {
    const filePath = join(tempDir, 'imports_only.py');
    const content = `
import os
import sys
from pathlib import Path
`;
    await writeFile(filePath, content);

    const result = await readPythonSource(filePath, defaultOptions);

    expect(result.functions).toHaveLength(0);
    expect(result.imports).toHaveLength(3);
  });

  it('handles complex Python file', async () => {
    const filePath = join(tempDir, 'complex.py');
    const content = `
#!/usr/bin/env python3
"""Module docstring."""

from typing import Optional, List
import asyncio

from myapp.models import User, Post
from .utils import helper

class Service:
    """Service class."""

    def __init__(self, config: dict):
        self.config = config

    async def fetch_users(self, ids: List[int]) -> List[User]:
        """Fetch multiple users."""
        users = []
        for id in ids:
            user = await self._fetch_one(id)
            if user:
                users.append(user)
        return users

    async def _fetch_one(self, id: int) -> Optional[User]:
        # Implementation
        return None

def main():
    service = Service({})
    asyncio.run(service.fetch_users([1, 2, 3]))

if __name__ == "__main__":
    main()
`;
    await writeFile(filePath, content);

    const result = await readPythonSource(filePath, defaultOptions);

    expect(result.imports).toHaveLength(4);
    // Check internal vs external
    const internalImports = result.imports.filter((i) => i.isInternal);
    const externalImports = result.imports.filter((i) => !i.isInternal);
    expect(internalImports).toHaveLength(2); // myapp.models and .utils
    expect(externalImports).toHaveLength(2); // typing and asyncio

    // Functions: __init__, fetch_users, _fetch_one, main
    expect(result.functions).toHaveLength(4);
    expect(result.functions.map((f) => f.name)).toEqual([
      '__init__',
      'fetch_users',
      '_fetch_one',
      'main',
    ]);
  });
});
