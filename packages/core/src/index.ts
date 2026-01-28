// @unknit/core - Core types and utilities for unknit

export const VERSION = '0.0.1';

// Export all core types
export {
  type SourceRef,
  type UnknitNode,
  type UnknitFile,
  type DiagnosticSeverity,
  type DiagnosticRange,
  type ValidationDiagnostic,
  NodeType,
} from './types.js';

// Export tokenizer
export {
  type Token,
  TokenType,
  Tokenizer,
  TokenizerError,
  tokenize,
} from './tokenizer.js';

// Export parser
export {
  Parser,
  ParseError,
  type ParseResult,
  parseFunctions,
  parseFunctionsWithRecovery,
  parseSourceRef,
} from './parser.js';
