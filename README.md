# Mini-Mice

A literate programming tool for rapid code review of AI-generated code through scannable, hierarchical outlines.

## Vision

As AI coding assistants generate increasingly complex code, developers need efficient ways to review and understand it. Mini-Mice transforms source code into concise, visual outlines that highlight key logic and structure without exposing implementation details.

**The goal:** Review 1000 lines of AI-generated code in under 5 minutes by scanning a hierarchical outline instead of reading every line.

## How It Works

1. **Generate** - Right-click a Python/TypeScript/JavaScript file → "Unknit: Generate"
2. **Review** - Scan the hierarchical outline showing function flow, external calls, and control structures
3. **Navigate** - Click any block to jump to the corresponding source code

### Example

Python source:
```python
def fetch_user_data(user_id):
    user = db.query(User).filter_by(id=user_id).first()
    if not user:
        raise UserNotFoundError(user_id)
    permissions = auth_service.get_permissions(user)
    return {"user": user, "permissions": permissions}
```

Mini-Mice outline:
```unknit
fn fetch_user_data(user_id) -> user_data | UserNotFoundError:
  @db.query().filter_by().first()
  validate_user_exists
    *-> UserNotFoundError
  @auth_service.get_permissions()
  -> user_data
```

## Current State

**Working:**
- VS Code extension with custom editor for `.unknit` files
- LLM-powered generation using Google Vertex AI (Gemini 3 Flash)
- Parser supporting Python/TypeScript/JavaScript patterns
- Navigation between unknit blocks and source code
- Auto-sync when source files change
- Validation and diagnostics

**Architecture:**
```
packages/
├── core       # Parser, tokenizer, validator
├── generate   # LLM client, prompt builder
└── vscode     # VS Code extension
```

## Next Focus

**Full Python Support** - Improving the generation quality and parser coverage for Python codebases, including:
- Better handling of decorators, context managers, comprehensions
- Class method support
- Async/await patterns
- Exception handling chains

## Quick Start

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run in VS Code
# Press F5 to launch Extension Development Host
```

### Configuration

Set your Google Cloud project in VS Code settings:
- `unknit.vertexAiProjectId` - Your GCP project ID
- `unknit.vertexAiLocation` - Region (default: `global`)

Authenticate with:
```bash
gcloud auth application-default login
```

## Tech Stack

- TypeScript, Node.js 20+
- pnpm + Turbo (monorepo)
- Google Vertex AI (Gemini 3 Flash)
- VS Code Extension API

## License

MIT
