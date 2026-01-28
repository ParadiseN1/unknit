// Anthropic LLM client for unknit generation
// Transforms source code into unknit format using Claude API

import Anthropic from '@anthropic-ai/sdk';
import type { CodeMetadata } from './index.js';
import { buildPrompts, type PromptBuilderOptions } from './prompt-builder.js';

/**
 * Options for the LLM client
 */
export interface LLMClientOptions {
  // API key for Anthropic (defaults to ANTHROPIC_API_KEY env var)
  apiKey?: string;
  // Model to use (defaults to claude-sonnet-4-5-20250929)
  model?: string;
  // Maximum tokens for response (defaults to 4096)
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
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
// Default max tokens for response
const DEFAULT_MAX_TOKENS = 4096;
// Default max retries
const DEFAULT_MAX_RETRIES = 3;
// Default timeout in ms
const DEFAULT_TIMEOUT = 60000;

/**
 * Generate unknit from source code using Anthropic API
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
 * LLM Client class for Anthropic API interactions
 */
export class LLMClient {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private maxRetries: number;

  constructor(options: LLMClientOptions = {}) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      maxRetries: 0, // We handle retries ourselves for better error reporting
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
    });
    this.model = options.model ?? DEFAULT_MODEL;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
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
        const message = await this.client.messages.create({
          model: this.model,
          max_tokens: this.maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        });

        // Extract text content from response
        const textContent = message.content.find((block) => block.type === 'text');
        if (!textContent || textContent.type !== 'text') {
          return {
            success: false,
            error: {
              code: 'NO_TEXT_CONTENT',
              message: 'LLM response did not contain text content',
              retryable: false,
            },
          };
        }

        return {
          success: true,
          content: textContent.text.trim(),
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
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
    if (err instanceof Anthropic.APIError) {
      const status = err.status;
      const isRetryable = this.isRetryableStatus(status);

      // Map specific error types
      if (err instanceof Anthropic.RateLimitError) {
        return {
          code: 'RATE_LIMIT',
          message: 'Rate limit exceeded',
          status,
          retryable: true,
        };
      }

      if (err instanceof Anthropic.AuthenticationError) {
        return {
          code: 'AUTHENTICATION_ERROR',
          message: 'Invalid API key',
          status,
          retryable: false,
        };
      }

      if (err instanceof Anthropic.BadRequestError) {
        return {
          code: 'BAD_REQUEST',
          message: err.message || 'Invalid request parameters',
          status,
          retryable: false,
        };
      }

      if (err instanceof Anthropic.InternalServerError) {
        return {
          code: 'SERVER_ERROR',
          message: 'Anthropic API server error',
          status,
          retryable: true,
        };
      }

      // Generic API error
      return {
        code: 'API_ERROR',
        message: err.message || 'Unknown API error',
        status,
        retryable: isRetryable,
      };
    }

    // Connection errors are retryable
    if (err instanceof Anthropic.APIConnectionError) {
      return {
        code: 'CONNECTION_ERROR',
        message: 'Failed to connect to Anthropic API',
        retryable: true,
      };
    }

    // Unknown error
    const message = err instanceof Error ? err.message : 'Unknown error';
    return {
      code: 'UNKNOWN_ERROR',
      message,
      retryable: false,
    };
  }

  /**
   * Check if HTTP status code is retryable
   */
  private isRetryableStatus(status: number | undefined): boolean {
    if (!status) return false;
    // Retry on rate limit (429) and server errors (5xx)
    return status === 429 || status >= 500;
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
