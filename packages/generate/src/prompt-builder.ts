// LLM prompt builder for unknit generation
// Constructs well-structured prompts for accurate unknit generation

import type { CodeMetadata, FunctionBoundary, ImportStatement } from './index.js';

/**
 * Options for building prompts
 */
export interface PromptBuilderOptions {
  // Include source references in the generated unknit
  includeSourceRefs?: boolean;
  // Additional context to include in the user prompt
  additionalContext?: string;
}

/**
 * Built prompts ready for LLM API call
 */
export interface BuiltPrompts {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Condensed unknit spec for the system prompt
 * Contains the essential syntax and rules without verbose explanations
 */
export const UNKNIT_SPEC_CONDENSED = `# Unknit Language Specification (Condensed)

Unknit is a literate programming language for high-level code review. It transforms implementation code into a scannable, hierarchical outline.

## Syntax

### Function Definition
\`\`\`
fn name(param1, param2, optional?) -> return_type | error_type:
\`\`\`
- \`fn\` = function declaration keyword
- \`param\` = required parameter
- \`param?\` = optional parameter
- \`-> type\` = return type
- \`type | error\` = success or failure return types

### Blocks and Calls
- \`name\` = conceptual block (logical grouping, no parens)
- \`name()\` = internal function call (defined in project)
- \`@name()\` = external call (library/dependency)

### Returns
- \`*->\` = early exit (error, failure, guard clause)
- \`->\` = final return (end of function)
- Early exits can combine with calls: \`validate() *-> errors\`

### Error Handling
\`\`\`
on error: *-> errors
\`\`\`

## Structure Rules
1. Indentation defines hierarchy (2 spaces per level)
2. Each line = one toggleable concept
3. NO implementation details - just conceptual outline
4. Group related logic under conceptual blocks
5. Use internal calls \`name()\` for project functions
6. Use external calls \`@name()\` for libraries/dependencies`;

/**
 * Generation rules for the LLM
 */
export const GENERATION_RULES = `## Generation Rules

1. **Function Signature**: Start with \`fn name(params) -> type:\` matching the source function
2. **Conceptual Grouping**: Create meaningful conceptual blocks to group related operations
3. **Internal vs External**:
   - Use \`name()\` for functions defined in the project
   - Use \`@name()\` for library/framework calls
4. **Early Exits**: Use \`*->\` for any early return (validation failures, errors, guards)
5. **Final Return**: Use \`->\` for the function's final return statement
6. **Error Handling**: Use \`on error: *-> errors\` for try/catch blocks
7. **Indentation**: Use 2 spaces per indentation level
8. **Brevity**: Keep block names short and descriptive (1-3 words)
9. **No Implementation**: Never include actual code, just conceptual descriptions`;

/**
 * Few-shot examples for consistent output
 */
export const FEW_SHOT_EXAMPLES = `## Examples

### Example 1: Python function with validation and API call

**Source (Python):**
\`\`\`python
def create_user(data: dict) -> dict:
    if not data.get("email"):
        return {"error": "Email required"}

    email = data["email"].lower().strip()
    if User.query.filter_by(email=email).first():
        return {"error": "Email already exists"}

    password_hash = bcrypt.hash(data["password"])
    user = User(email=email, password=password_hash)
    db.session.add(user)
    db.session.commit()

    send_welcome_email(email)
    return {"user": user.to_dict()}
\`\`\`

**Unknit Output:**
\`\`\`
fn create_user(data) -> user | error:
  validate_input
    *-> error
  check_duplicate
    @User.query() *-> error
  create_user_record
    @bcrypt.hash()
    @db.session.add()
    @db.session.commit()
  send_welcome_email()
  -> user
\`\`\`

### Example 2: TypeScript function with error handling

**Source (TypeScript):**
\`\`\`typescript
async function fetchUserData(userId: string): Promise<UserData | null> {
  try {
    const response = await fetch(\`/api/users/\${userId}\`);
    if (!response.ok) {
      logger.warn(\`Failed to fetch user \${userId}\`);
      return null;
    }
    const data = await response.json();
    return transformUserData(data);
  } catch (error) {
    logger.error("Network error", error);
    return null;
  }
}
\`\`\`

**Unknit Output:**
\`\`\`
fn fetchUserData(userId) -> UserData | null:
  @fetch()
  check_response
    @logger.warn() *-> null
  parse_response
    @response.json()
  transformUserData()
  -> UserData
  on error:
    @logger.error() *-> null
\`\`\``;

/**
 * Source reference format instructions
 */
export const SOURCE_REF_INSTRUCTIONS = `## Source References

Include source references to map unknit blocks to source code lines.
Format: \`{{src:file:startLine-endLine}}\` or \`{{src:file:line}}\` for single lines.

Place the source reference at the end of the line it corresponds to.

Example:
\`\`\`
fn create_user(data) -> user | error: {{src:users.py:1-20}}
  validate_input {{src:users.py:2-4}}
    *-> error {{src:users.py:3}}
\`\`\``;

/**
 * Build the complete system prompt
 */
export function buildSystemPrompt(options: PromptBuilderOptions = {}): string {
  const parts = [
    'You are an expert code analyst that transforms source code into unknit format.',
    'Your task is to analyze the provided source code and generate a high-level, scannable outline.',
    '',
    UNKNIT_SPEC_CONDENSED,
    '',
    GENERATION_RULES,
  ];

  if (options.includeSourceRefs) {
    parts.push('', SOURCE_REF_INSTRUCTIONS);
  }

  parts.push('', FEW_SHOT_EXAMPLES);

  parts.push(
    '',
    '## Output Format',
    '',
    'Respond with ONLY the unknit output. No explanations, no markdown code fences, just the raw unknit content.',
    'Do not include any preamble or commentary.'
  );

  return parts.join('\n');
}

/**
 * Format function boundaries for the user prompt
 */
export function formatFunctionBoundaries(functions: FunctionBoundary[]): string {
  if (functions.length === 0) {
    return 'No functions detected in source file.';
  }

  const lines = ['## Function Boundaries', ''];
  for (const fn of functions) {
    const params = fn.params.length > 0 ? fn.params.join(', ') : '';
    const returnType = fn.returnType ? ` -> ${fn.returnType}` : '';
    lines.push(`- \`${fn.name}(${params})${returnType}\` (lines ${fn.startLine}-${fn.endLine})`);
  }
  return lines.join('\n');
}

/**
 * Format import statements for the user prompt
 */
export function formatImportStatements(imports: ImportStatement[]): string {
  if (imports.length === 0) {
    return 'No imports detected.';
  }

  const internal = imports.filter((i) => i.isInternal);
  const external = imports.filter((i) => !i.isInternal);

  const lines = ['## Imports'];

  if (internal.length > 0) {
    lines.push('', '### Internal (use `name()` syntax):');
    for (const imp of internal) {
      lines.push(`- ${imp.module}`);
    }
  }

  if (external.length > 0) {
    lines.push('', '### External (use `@name()` syntax):');
    for (const imp of external) {
      lines.push(`- ${imp.module}`);
    }
  }

  return lines.join('\n');
}

/**
 * Build the user prompt with source code and metadata
 */
export function buildUserPrompt(
  sourceCode: string,
  metadata: CodeMetadata,
  options: PromptBuilderOptions = {}
): string {
  const parts = [
    `Generate unknit for the following ${metadata.language} source file: \`${metadata.filePath}\``,
    '',
  ];

  // Add function boundaries
  parts.push(formatFunctionBoundaries(metadata.functions));
  parts.push('');

  // Add import classification
  parts.push(formatImportStatements(metadata.imports));
  parts.push('');

  // Add source reference instructions if enabled
  if (options.includeSourceRefs) {
    parts.push(`Include source references using the file path: ${metadata.filePath}`);
    parts.push('');
  }

  // Add additional context if provided
  if (options.additionalContext) {
    parts.push('## Additional Context');
    parts.push(options.additionalContext);
    parts.push('');
  }

  // Add source code
  parts.push('## Source Code');
  parts.push('');
  parts.push('```' + metadata.language);
  parts.push(sourceCode);
  parts.push('```');

  return parts.join('\n');
}

/**
 * Build both system and user prompts
 */
export function buildPrompts(
  sourceCode: string,
  metadata: CodeMetadata,
  options: PromptBuilderOptions = {}
): BuiltPrompts {
  return {
    systemPrompt: buildSystemPrompt(options),
    userPrompt: buildUserPrompt(sourceCode, metadata, options),
  };
}

/**
 * PromptBuilder class for object-oriented usage
 */
export class PromptBuilder {
  private options: PromptBuilderOptions;

  constructor(options: PromptBuilderOptions = {}) {
    this.options = options;
  }

  /**
   * Build the system prompt
   */
  buildSystemPrompt(): string {
    return buildSystemPrompt(this.options);
  }

  /**
   * Build the user prompt with source code and metadata
   */
  buildUserPrompt(sourceCode: string, metadata: CodeMetadata): string {
    return buildUserPrompt(sourceCode, metadata, this.options);
  }

  /**
   * Build both prompts
   */
  build(sourceCode: string, metadata: CodeMetadata): BuiltPrompts {
    return buildPrompts(sourceCode, metadata, this.options);
  }

  /**
   * Get the condensed unknit spec
   */
  getSpec(): string {
    return UNKNIT_SPEC_CONDENSED;
  }

  /**
   * Get the generation rules
   */
  getRules(): string {
    return GENERATION_RULES;
  }

  /**
   * Get the few-shot examples
   */
  getExamples(): string {
    return FEW_SHOT_EXAMPLES;
  }
}
