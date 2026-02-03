import { describe, it, expect } from 'vitest';
import {
  PromptBuilder,
  buildSystemPrompt,
  buildUserPrompt,
  buildPrompts,
  formatFunctionBoundaries,
  formatImportStatements,
  UNKNIT_SPEC_CONDENSED,
  GENERATION_RULES,
  FEW_SHOT_EXAMPLES,
  SOURCE_REF_INSTRUCTIONS,
  type BuiltPrompts,
  type PromptBuilderOptions,
} from './prompt-builder.js';
import type { CodeMetadata, FunctionBoundary, ImportStatement } from './index.js';

describe('prompt-builder', () => {
  // Sample metadata for tests
  const sampleFunctions: FunctionBoundary[] = [
    {
      name: 'processOrder',
      startLine: 1,
      endLine: 30,
      params: ['data', 'options?'],
      returnType: 'Order | Error',
    },
    {
      name: 'validateOrder',
      startLine: 32,
      endLine: 45,
      params: ['data'],
      returnType: 'ValidationResult',
    },
  ];

  const sampleImports: ImportStatement[] = [
    { raw: 'import { db } from "./database"', module: './database', isInternal: true, line: 1 },
    { raw: 'import { Order } from "./models"', module: './models', isInternal: true, line: 2 },
    { raw: 'import axios from "axios"', module: 'axios', isInternal: false, line: 3 },
    { raw: 'import { z } from "zod"', module: 'zod', isInternal: false, line: 4 },
  ];

  const sampleMetadata: CodeMetadata = {
    filePath: 'src/orders/processor.ts',
    language: 'typescript',
    functions: sampleFunctions,
    imports: sampleImports,
  };

  const sampleSourceCode = `async function processOrder(data: OrderData, options?: Options): Promise<Order | Error> {
  const validated = validateOrder(data);
  if (!validated.success) {
    return new Error(validated.errors.join(', '));
  }

  const order = await db.orders.create(validated.data);
  await axios.post('/webhook', { order });
  return order;
}`;

  describe('UNKNIT_SPEC_CONDENSED', () => {
    it('contains function definition syntax', () => {
      expect(UNKNIT_SPEC_CONDENSED).toContain('fn name(param1, param2, optional?) -> return_type');
    });

    it('contains block and call syntax', () => {
      expect(UNKNIT_SPEC_CONDENSED).toContain('name()');
      expect(UNKNIT_SPEC_CONDENSED).toContain('@name()');
    });

    it('contains return syntax', () => {
      expect(UNKNIT_SPEC_CONDENSED).toContain('*->');
      expect(UNKNIT_SPEC_CONDENSED).toContain('->');
    });

    it('contains error handling syntax', () => {
      expect(UNKNIT_SPEC_CONDENSED).toContain('on error:');
    });

    it('contains structure rules', () => {
      expect(UNKNIT_SPEC_CONDENSED).toContain('Indentation');
      expect(UNKNIT_SPEC_CONDENSED).toContain('hierarchy');
    });
  });

  describe('GENERATION_RULES', () => {
    it('contains function signature rule', () => {
      expect(GENERATION_RULES).toContain('Function Signature');
    });

    it('contains internal vs external rule', () => {
      expect(GENERATION_RULES).toContain('Internal vs External');
    });

    it('contains early exits rule', () => {
      expect(GENERATION_RULES).toContain('Early Exits');
    });

    it('contains indentation rule', () => {
      expect(GENERATION_RULES).toContain('Indentation');
      expect(GENERATION_RULES).toContain('2 spaces');
    });

    it('contains no implementation rule', () => {
      expect(GENERATION_RULES).toContain('No Implementation');
    });
  });

  describe('FEW_SHOT_EXAMPLES', () => {
    it('contains Python example', () => {
      expect(FEW_SHOT_EXAMPLES).toContain('Python');
      expect(FEW_SHOT_EXAMPLES).toContain('def create_user');
    });

    it('contains TypeScript example', () => {
      expect(FEW_SHOT_EXAMPLES).toContain('TypeScript');
      expect(FEW_SHOT_EXAMPLES).toContain('async function fetchUserData');
    });

    it('contains unknit output examples', () => {
      expect(FEW_SHOT_EXAMPLES).toContain('fn create_user');
      expect(FEW_SHOT_EXAMPLES).toContain('fn fetchUserData');
    });

    it('demonstrates internal calls', () => {
      expect(FEW_SHOT_EXAMPLES).toContain('send_welcome_email()');
      expect(FEW_SHOT_EXAMPLES).toContain('transformUserData()');
    });

    it('demonstrates external calls', () => {
      expect(FEW_SHOT_EXAMPLES).toContain('@bcrypt.hash()');
      expect(FEW_SHOT_EXAMPLES).toContain('@fetch()');
    });

    it('demonstrates early exits', () => {
      expect(FEW_SHOT_EXAMPLES).toContain('*-> error');
      expect(FEW_SHOT_EXAMPLES).toContain('*-> null');
    });

    it('demonstrates error handling', () => {
      expect(FEW_SHOT_EXAMPLES).toContain('on error:');
    });
  });

  describe('SOURCE_REF_INSTRUCTIONS', () => {
    it('explains source reference format', () => {
      expect(SOURCE_REF_INSTRUCTIONS).toContain('{{src:');
      expect(SOURCE_REF_INSTRUCTIONS).toContain('startLine-endLine');
    });

    it('provides example with source refs', () => {
      expect(SOURCE_REF_INSTRUCTIONS).toContain('{{src:users.py:1-20}}');
    });
  });

  describe('formatFunctionBoundaries', () => {
    it('formats functions with params and return types', () => {
      const result = formatFunctionBoundaries(sampleFunctions);
      expect(result).toContain('## Function Boundaries');
      expect(result).toContain('`processOrder(data, options?) -> Order | Error`');
      expect(result).toContain('(lines 1-30)');
      expect(result).toContain('`validateOrder(data) -> ValidationResult`');
      expect(result).toContain('(lines 32-45)');
    });

    it('handles functions without params', () => {
      const functions: FunctionBoundary[] = [
        { name: 'init', startLine: 1, endLine: 10, params: [] },
      ];
      const result = formatFunctionBoundaries(functions);
      expect(result).toContain('`init()`');
    });

    it('handles functions without return type', () => {
      const functions: FunctionBoundary[] = [
        { name: 'setup', startLine: 1, endLine: 5, params: ['config'] },
      ];
      const result = formatFunctionBoundaries(functions);
      expect(result).toContain('`setup(config)`');
      expect(result).not.toContain('->');
    });

    it('handles empty functions array', () => {
      const result = formatFunctionBoundaries([]);
      expect(result).toContain('No functions detected');
    });
  });

  describe('formatImportStatements', () => {
    it('separates internal and external imports', () => {
      const result = formatImportStatements(sampleImports);
      expect(result).toContain('## Imports');
      expect(result).toContain('### Internal (use `name()` syntax):');
      expect(result).toContain('### External (use `@name()` syntax):');
    });

    it('lists internal imports', () => {
      const result = formatImportStatements(sampleImports);
      expect(result).toContain('./database');
      expect(result).toContain('./models');
    });

    it('lists external imports', () => {
      const result = formatImportStatements(sampleImports);
      expect(result).toContain('axios');
      expect(result).toContain('zod');
    });

    it('handles only internal imports', () => {
      const imports: ImportStatement[] = [
        { raw: 'import x from "./x"', module: './x', isInternal: true, line: 1 },
      ];
      const result = formatImportStatements(imports);
      expect(result).toContain('### Internal');
      expect(result).not.toContain('### External');
    });

    it('handles only external imports', () => {
      const imports: ImportStatement[] = [
        { raw: 'import x from "lodash"', module: 'lodash', isInternal: false, line: 1 },
      ];
      const result = formatImportStatements(imports);
      expect(result).toContain('### External');
      expect(result).not.toContain('### Internal');
    });

    it('handles empty imports array', () => {
      const result = formatImportStatements([]);
      expect(result).toContain('No imports detected');
    });
  });

  describe('buildSystemPrompt', () => {
    it('includes role description', () => {
      const result = buildSystemPrompt();
      expect(result).toContain('expert code analyst');
      expect(result).toContain('unknit format');
    });

    it('includes condensed spec', () => {
      const result = buildSystemPrompt();
      expect(result).toContain(UNKNIT_SPEC_CONDENSED);
    });

    it('includes generation rules', () => {
      const result = buildSystemPrompt();
      expect(result).toContain(GENERATION_RULES);
    });

    it('includes few-shot examples', () => {
      const result = buildSystemPrompt();
      expect(result).toContain(FEW_SHOT_EXAMPLES);
    });

    it('includes output format instructions', () => {
      const result = buildSystemPrompt();
      expect(result).toContain('Output Format');
      expect(result).toContain('ONLY the unknit output');
    });

    it('excludes source ref instructions by default', () => {
      const result = buildSystemPrompt();
      expect(result).not.toContain(SOURCE_REF_INSTRUCTIONS);
    });

    it('includes source ref instructions when enabled', () => {
      const result = buildSystemPrompt({ includeSourceRefs: true });
      expect(result).toContain(SOURCE_REF_INSTRUCTIONS);
    });
  });

  describe('buildUserPrompt', () => {
    it('includes file path and language', () => {
      const result = buildUserPrompt(sampleSourceCode, sampleMetadata);
      expect(result).toContain('typescript');
      expect(result).toContain('src/orders/processor.ts');
    });

    it('includes function boundaries', () => {
      const result = buildUserPrompt(sampleSourceCode, sampleMetadata);
      expect(result).toContain('## Function Boundaries');
      expect(result).toContain('processOrder');
      expect(result).toContain('validateOrder');
    });

    it('includes import statements', () => {
      const result = buildUserPrompt(sampleSourceCode, sampleMetadata);
      expect(result).toContain('## Imports');
      expect(result).toContain('./database');
      expect(result).toContain('axios');
    });

    it('includes source code with language tag', () => {
      const result = buildUserPrompt(sampleSourceCode, sampleMetadata);
      expect(result).toContain('## Source Code');
      expect(result).toContain('```typescript');
      expect(result).toContain(sampleSourceCode);
      expect(result).toContain('```');
    });

    it('excludes source ref instruction by default', () => {
      const result = buildUserPrompt(sampleSourceCode, sampleMetadata);
      expect(result).not.toContain('Include source references');
    });

    it('includes source ref instruction when enabled', () => {
      const result = buildUserPrompt(sampleSourceCode, sampleMetadata, {
        includeSourceRefs: true,
      });
      expect(result).toContain('Include source references');
      expect(result).toContain('src/orders/processor.ts');
    });

    it('includes additional context when provided', () => {
      const result = buildUserPrompt(sampleSourceCode, sampleMetadata, {
        additionalContext: 'This is an e-commerce order processing module.',
      });
      expect(result).toContain('## Additional Context');
      expect(result).toContain('e-commerce order processing');
    });

    it('works with Python metadata', () => {
      const pythonMetadata: CodeMetadata = {
        filePath: 'src/utils.py',
        language: 'python',
        functions: [{ name: 'helper', startLine: 1, endLine: 10, params: ['x'] }],
        imports: [],
      };
      const result = buildUserPrompt('def helper(x): pass', pythonMetadata);
      expect(result).toContain('python');
      expect(result).toContain('src/utils.py');
      expect(result).toContain('```python');
    });

    it('works with JavaScript metadata', () => {
      const jsMetadata: CodeMetadata = {
        filePath: 'src/utils.js',
        language: 'javascript',
        functions: [{ name: 'helper', startLine: 1, endLine: 10, params: ['x'] }],
        imports: [],
      };
      const result = buildUserPrompt('function helper(x) {}', jsMetadata);
      expect(result).toContain('javascript');
      expect(result).toContain('src/utils.js');
      expect(result).toContain('```javascript');
    });
  });

  describe('buildPrompts', () => {
    it('returns both system and user prompts', () => {
      const result: BuiltPrompts = buildPrompts(sampleSourceCode, sampleMetadata);
      expect(result.systemPrompt).toBeDefined();
      expect(result.userPrompt).toBeDefined();
    });

    it('system prompt contains spec and rules', () => {
      const result = buildPrompts(sampleSourceCode, sampleMetadata);
      expect(result.systemPrompt).toContain(UNKNIT_SPEC_CONDENSED);
      expect(result.systemPrompt).toContain(GENERATION_RULES);
    });

    it('user prompt contains source code', () => {
      const result = buildPrompts(sampleSourceCode, sampleMetadata);
      expect(result.userPrompt).toContain(sampleSourceCode);
    });

    it('passes options to both prompts', () => {
      const options: PromptBuilderOptions = {
        includeSourceRefs: true,
        additionalContext: 'Test context',
      };
      const result = buildPrompts(sampleSourceCode, sampleMetadata, options);
      expect(result.systemPrompt).toContain(SOURCE_REF_INSTRUCTIONS);
      expect(result.userPrompt).toContain('Test context');
    });
  });

  describe('PromptBuilder class', () => {
    it('can be instantiated with default options', () => {
      const builder = new PromptBuilder();
      expect(builder).toBeDefined();
    });

    it('can be instantiated with options', () => {
      const builder = new PromptBuilder({ includeSourceRefs: true });
      expect(builder).toBeDefined();
    });

    describe('buildSystemPrompt', () => {
      it('returns system prompt', () => {
        const builder = new PromptBuilder();
        const result = builder.buildSystemPrompt();
        expect(result).toContain(UNKNIT_SPEC_CONDENSED);
      });

      it('respects includeSourceRefs option', () => {
        const builder = new PromptBuilder({ includeSourceRefs: true });
        const result = builder.buildSystemPrompt();
        expect(result).toContain(SOURCE_REF_INSTRUCTIONS);
      });
    });

    describe('buildUserPrompt', () => {
      it('returns user prompt with source code', () => {
        const builder = new PromptBuilder();
        const result = builder.buildUserPrompt(sampleSourceCode, sampleMetadata);
        expect(result).toContain(sampleSourceCode);
      });

      it('respects options', () => {
        const builder = new PromptBuilder({
          includeSourceRefs: true,
          additionalContext: 'Class context',
        });
        const result = builder.buildUserPrompt(sampleSourceCode, sampleMetadata);
        expect(result).toContain('Include source references');
        expect(result).toContain('Class context');
      });
    });

    describe('build', () => {
      it('returns both prompts', () => {
        const builder = new PromptBuilder();
        const result = builder.build(sampleSourceCode, sampleMetadata);
        expect(result.systemPrompt).toBeDefined();
        expect(result.userPrompt).toBeDefined();
      });
    });

    describe('getSpec', () => {
      it('returns condensed spec', () => {
        const builder = new PromptBuilder();
        expect(builder.getSpec()).toBe(UNKNIT_SPEC_CONDENSED);
      });
    });

    describe('getRules', () => {
      it('returns generation rules', () => {
        const builder = new PromptBuilder();
        expect(builder.getRules()).toBe(GENERATION_RULES);
      });
    });

    describe('getExamples', () => {
      it('returns few-shot examples', () => {
        const builder = new PromptBuilder();
        expect(builder.getExamples()).toBe(FEW_SHOT_EXAMPLES);
      });
    });
  });

  describe('prompt structure verification', () => {
    it('system prompt has correct section order', () => {
      const prompt = buildSystemPrompt({ includeSourceRefs: true });
      const rolePos = prompt.indexOf('expert code analyst');
      const specPos = prompt.indexOf('# Unknit Language Specification');
      const rulesPos = prompt.indexOf('## Generation Rules');
      const srcRefPos = prompt.indexOf('## Source References');
      const examplesPos = prompt.indexOf('## Examples');
      const outputPos = prompt.indexOf('## Output Format');

      // Verify order
      expect(rolePos).toBeLessThan(specPos);
      expect(specPos).toBeLessThan(rulesPos);
      expect(rulesPos).toBeLessThan(srcRefPos);
      expect(srcRefPos).toBeLessThan(examplesPos);
      expect(examplesPos).toBeLessThan(outputPos);
    });

    it('user prompt has correct section order', () => {
      const prompt = buildUserPrompt(sampleSourceCode, sampleMetadata, {
        additionalContext: 'Context here',
      });
      const introPos = prompt.indexOf('Generate unknit');
      const funcPos = prompt.indexOf('## Function Boundaries');
      const importsPos = prompt.indexOf('## Imports');
      const contextPos = prompt.indexOf('## Additional Context');
      const sourcePos = prompt.indexOf('## Source Code');

      // Verify order
      expect(introPos).toBeLessThan(funcPos);
      expect(funcPos).toBeLessThan(importsPos);
      expect(importsPos).toBeLessThan(contextPos);
      expect(contextPos).toBeLessThan(sourcePos);
    });

    it('prompts do not contain explanatory preamble instructions', () => {
      const systemPrompt = buildSystemPrompt();
      expect(systemPrompt).toContain('No explanations');
      expect(systemPrompt).toContain('no markdown code fences');
    });
  });
});
