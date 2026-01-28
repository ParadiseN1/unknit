# Unknit for Visual Studio Code

Code review tool for rapidly reviewing AI-generated code through scannable hierarchical outlines.

## Features

### Custom Editor for .unknit Files
- Syntax-highlighted rendering of unknit files
- Expandable/collapsible blocks for hierarchical code navigation
- Inline source code display when expanding blocks
- Visual distinction between internal calls, external calls, early exits, and error handlers

### Navigation
- **Go to Source**: Double-click any block or use the context menu to jump to the corresponding source code location
- **Go to Block**: Navigate from any source file to its corresponding unknit block (Command: `Unknit: Go to Block`)

### Generation
- **Generate Unknit**: Generate a .unknit file from any Python or TypeScript/JavaScript source file using AI (Command: `Unknit: Generate`)
- Requires an Anthropic API key configured via settings or environment variable

### Validation
- **Validate**: Check that source references in .unknit files are valid (Command: `Unknit: Validate`)
- Automatic validation on file open and save
- Inline diagnostics for invalid source references and coverage gaps
- Results displayed in the Problems panel

### Synchronization
- **Sync**: Update line numbers when source code changes (Command: `Unknit: Sync`)
- Automatic sync when source files are saved
- Notification when structural changes (function added/removed/renamed) are detected

## Supported Languages

- Python (.py)
- TypeScript (.ts, .tsx)
- JavaScript (.js, .jsx)

## Configuration

| Setting | Description |
|---------|-------------|
| `unknit.anthropicApiKey` | Anthropic API key for generating unknit files. Can also be set via the `ANTHROPIC_API_KEY` environment variable. |

## Commands

| Command | Description |
|---------|-------------|
| `Unknit: Go to Block` | Navigate from source code to the corresponding unknit block |
| `Unknit: Generate` | Generate a .unknit file for the current source file |
| `Unknit: Validate` | Validate source references in the current .unknit file |
| `Unknit: Sync` | Sync line numbers after source code changes |

## Getting Started

1. Install the extension
2. Open a Python or TypeScript/JavaScript file
3. Right-click and select "Unknit: Generate" or run the command from the Command Palette
4. The generated .unknit file will open in the custom editor
5. Click blocks to expand and view source code
6. Double-click blocks to navigate to source

## Requirements

- VS Code 1.85.0 or higher
- Anthropic API key (for generation feature)

## License

MIT
