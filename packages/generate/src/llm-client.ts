// Google Gen AI client for unknit generation
// Transforms source code into unknit format using Gemini API via Vertex AI

import { GoogleGenAI } from '@google/genai';
import type { CodeMetadata } from './index.js';
import { buildPrompts, type PromptBuilderOptions } from './prompt-builder.js';

/**
 * Options for the LLM client
 */
export interface LLMClientOptions {
  // Google Cloud Project ID (defaults to VERTEX_AI_PROJECT_ID env var)
  projectId?: string;
  // Google Cloud Location (defaults to VERTEX_AI_LOCATION env var or 'global')
  location?: string;
  // Model to use (defaults to gemini-3-flash-preview)
  model?: string;
  // Maximum tokens for response (defaults to 8192)
  maxTokens?: number;
  // Maximum retry attempts (defaults to 3)
  maxRetries?: number;
  // Timeout in milliseconds (defaults to 60000)
  timeout?: number;
}

/**
 * Result of LLM generation
 */
export interface LLMGenerationResult {
  success: boolean;
  // Generated unknit content (if successful)
  content?: string;
  // Error information (if failed)
  error?: LLMGenerationError;
  // Token usage information
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/**
 * Error during LLM generation
 */
export interface LLMGenerationError {
  code: string;
  message: string;
  // HTTP status code (if applicable)
  status?: number;
  // Whether the error is retryable
  retryable: boolean;
}

// Default model to use
const DEFAULT_MODEL = 'gemini-3-flash-preview';
// Default max tokens for response
const DEFAULT_MAX_TOKENS = 8192;
// Default max retries
const DEFAULT_MAX_RETRIES = 3;
// Default timeout in ms
const DEFAULT_TIMEOUT = 60000;
// Default location
const DEFAULT_LOCATION = 'global';

/**
 * Generate unknit from source code using Google Gen AI API
 */
export async function generateUnknit(
  sourceCode: string,
  metadata: CodeMetadata,
  options: LLMClientOptions & PromptBuilderOptions = {}
): Promise<LLMGenerationResult> {
  const client = new LLMClient(options);
  return client.generate(sourceCode, metadata, options);
}

/**
 * LLM Client class for Google Gen AI API interactions
 */
export class LLMClient {
  private client: GoogleGenAI;
  private model: string;
  private maxTokens: number;
  private maxRetries: number;
  private timeout: number;

  constructor(options: LLMClientOptions = {}) {
    const projectId = options.projectId ?? process.env['VERTEX_AI_PROJECT_ID'];
    const location = options.location ?? process.env['VERTEX_AI_LOCATION'] ?? DEFAULT_LOCATION;

    if (!projectId) {
      throw new Error('Vertex AI Project ID is required. Set VERTEX_AI_PROJECT_ID env var or pass projectId option.');
    }

    // Initialize the Google Gen AI SDK for Vertex AI
    this.client = new GoogleGenAI({
      vertexai: true,
      project: projectId,
      location,
    });

    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
  }

  /**
   * Generate unknit from source code
   */
  async generate(
    sourceCode: string,
    metadata: CodeMetadata,
    promptOptions: PromptBuilderOptions = {}
  ): Promise<LLMGenerationResult> {
    const { systemPrompt, userPrompt } = buildPrompts(sourceCode, metadata, promptOptions);

    let lastError: LLMGenerationError | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const result = await Promise.race([
          this.client.models.generateContent({
            model: this.model,
            contents: userPrompt,
            config: {
              systemInstruction: systemPrompt,
              maxOutputTokens: this.maxTokens,
            },
          }),
          new Promise<never>((_, reject) => {
            controller.signal.addEventListener('abort', () => {
              reject(new Error('Request timeout'));
            });
          }),
        ]);

        clearTimeout(timeoutId);

        const text = result.text;

        if (!text) {
          return {
            success: false,
            error: {
              code: 'NO_TEXT_CONTENT',
              message: 'Gemini response did not contain text content',
              retryable: false,
            },
          };
        }

        // Extract token usage if available
        const usageMetadata = result.usageMetadata;
        const inputTokens = usageMetadata?.promptTokenCount ?? 0;
        const outputTokens = usageMetadata?.candidatesTokenCount ?? 0;

        return {
          success: true,
          content: text.trim(),
          usage: {
            inputTokens,
            outputTokens,
          },
        };
      } catch (err) {
        lastError = this.handleError(err);

        // Don't retry if error is not retryable
        if (!lastError.retryable) {
          return {
            success: false,
            error: lastError,
          };
        }

        // Wait before retrying with exponential backoff
        if (attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted
    return {
      success: false,
      error: lastError ?? {
        code: 'UNKNOWN_ERROR',
        message: 'All retry attempts failed',
        retryable: false,
      },
    };
  }

  /**
   * Handle API errors and convert to LLMGenerationError
   */
  private handleError(err: unknown): LLMGenerationError {
    // Handle Google API errors
    if (err instanceof Error) {
      const message = err.message;

      // Check for specific error patterns
      if (message.includes('429') || message.includes('rate limit') || message.includes('RATE_LIMIT_EXCEEDED')) {
        return {
          code: 'RATE_LIMIT',
          message: 'Rate limit exceeded',
          retryable: true,
        };
      }

      if (message.includes('401') || message.includes('403') || message.includes('authentication') || message.includes('permission')) {
        return {
          code: 'AUTHENTICATION_ERROR',
          message: 'Invalid credentials or insufficient permissions',
          retryable: false,
        };
      }

      if (message.includes('400') || message.includes('invalid')) {
        return {
          code: 'BAD_REQUEST',
          message: message || 'Invalid request parameters',
          retryable: false,
        };
      }

      if (message.includes('500') || message.includes('502') || message.includes('503') || message.includes('504')) {
        return {
          code: 'SERVER_ERROR',
          message: 'Vertex AI server error',
          retryable: true,
        };
      }

      if (message.includes('timeout') || message.includes('ETIMEDOUT') || message.includes('ECONNREFUSED')) {
        return {
          code: 'CONNECTION_ERROR',
          message: 'Failed to connect to Vertex AI API or request timed out',
          retryable: true,
        };
      }

      // Generic error
      return {
        code: 'API_ERROR',
        message: message || 'Unknown API error',
        retryable: this.isRetryableError(err),
      };
    }

    // Unknown error
    return {
      code: 'UNKNOWN_ERROR',
      message: 'Unknown error occurred',
      retryable: false,
    };
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(err: unknown): boolean {
    if (err instanceof Error) {
      const message = err.message.toLowerCase();
      // Retry on network errors and server errors
      return (
        message.includes('timeout') ||
        message.includes('network') ||
        message.includes('econnrefused') ||
        message.includes('etimedout') ||
        message.includes('500') ||
        message.includes('502') ||
        message.includes('503') ||
        message.includes('504')
      );
    }
    return false;
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get the configured model
   */
  getModel(): string {
    return this.model;
  }

  /**
   * Get the configured max tokens
   */
  getMaxTokens(): number {
    return this.maxTokens;
  }

  /**
   * Get the configured max retries
   */
  getMaxRetries(): number {
    return this.maxRetries;
  }
}
