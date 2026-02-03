// Tests for Anthropic LLM client
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CodeMetadata } from './index.js';

// Define mock classes and mock function inside vi.hoisted to ensure proper hoisting
const mocks = vi.hoisted(() => {
  const mockCreate = vi.fn();

  class MockAPIError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'APIError';
      this.status = status;
    }
  }

  class MockRateLimitError extends MockAPIError {
    constructor(message = 'Rate limit exceeded') {
      super(message, 429);
      this.name = 'RateLimitError';
    }
  }

  class MockAuthenticationError extends MockAPIError {
    constructor(message = 'Invalid API key') {
      super(message, 401);
      this.name = 'AuthenticationError';
    }
  }

  class MockBadRequestError extends MockAPIError {
    constructor(message = 'Bad request') {
      super(message, 400);
      this.name = 'BadRequestError';
    }
  }

  class MockInternalServerError extends MockAPIError {
    constructor(message = 'Internal server error') {
      super(message, 500);
      this.name = 'InternalServerError';
    }
  }

  class MockAPIConnectionError extends Error {
    constructor(message = 'Connection failed') {
      super(message);
      this.name = 'APIConnectionError';
    }
  }

  return {
    mockCreate,
    MockAPIError,
    MockRateLimitError,
    MockAuthenticationError,
    MockBadRequestError,
    MockInternalServerError,
    MockAPIConnectionError,
  };
});

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = {
      create: mocks.mockCreate,
    };
    constructor() {}
    static APIError = mocks.MockAPIError;
    static RateLimitError = mocks.MockRateLimitError;
    static AuthenticationError = mocks.MockAuthenticationError;
    static BadRequestError = mocks.MockBadRequestError;
    static InternalServerError = mocks.MockInternalServerError;
    static APIConnectionError = mocks.MockAPIConnectionError;
  }

  return { default: MockAnthropic };
});

// Import after mocking
import {
  LLMClient,
  generateUnknit,
  type LLMGenerationResult,
} from './llm-client.js';

// Destructure mocks for convenience
const {
  mockCreate,
  MockRateLimitError,
  MockAuthenticationError,
  MockBadRequestError,
  MockInternalServerError,
  MockAPIConnectionError,
} = mocks;

// Sample metadata for tests
const sampleMetadata: CodeMetadata = {
  filePath: 'test.py',
  language: 'python',
  functions: [
    {
      name: 'hello',
      startLine: 1,
      endLine: 3,
      params: ['name'],
      returnType: 'str',
    },
  ],
  imports: [],
};

const sampleSourceCode = `def hello(name: str) -> str:
    return f"Hello, {name}!"
`;

const sampleUnknitOutput = `fn hello(name) -> str:
  -> greeting`;

describe('LLMClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create client with default options', () => {
      const client = new LLMClient();
      expect(client.getModel()).toBe('claude-sonnet-4-5-20250929');
      expect(client.getMaxTokens()).toBe(4096);
      expect(client.getMaxRetries()).toBe(3);
    });

    it('should accept custom model', () => {
      const client = new LLMClient({ model: 'claude-3-opus-20240229' });
      expect(client.getModel()).toBe('claude-3-opus-20240229');
    });

    it('should accept custom max tokens', () => {
      const client = new LLMClient({ maxTokens: 8192 });
      expect(client.getMaxTokens()).toBe(8192);
    });

    it('should accept custom max retries', () => {
      const client = new LLMClient({ maxRetries: 5 });
      expect(client.getMaxRetries()).toBe(5);
    });
  });

  describe('generate', () => {
    it('should return success with content on successful API call', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: sampleUnknitOutput }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = new LLMClient();
      const result = await client.generate(sampleSourceCode, sampleMetadata);

      expect(result.success).toBe(true);
      expect(result.content).toBe(sampleUnknitOutput);
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
      expect(result.error).toBeUndefined();
    });

    it('should trim whitespace from generated content', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: `\n${sampleUnknitOutput}\n\n` }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = new LLMClient();
      const result = await client.generate(sampleSourceCode, sampleMetadata);

      expect(result.content).toBe(sampleUnknitOutput);
    });

    it('should call Anthropic API with correct parameters', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: sampleUnknitOutput }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = new LLMClient({ model: 'claude-3-haiku-20240307', maxTokens: 2048 });
      await client.generate(sampleSourceCode, sampleMetadata);

      expect(mockCreate).toHaveBeenCalledWith({
        model: 'claude-3-haiku-20240307',
        max_tokens: 2048,
        system: expect.any(String),
        messages: [{ role: 'user', content: expect.any(String) }],
      });
    });

    it('should include source refs in prompt when option is set', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: sampleUnknitOutput }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = new LLMClient();
      await client.generate(sampleSourceCode, sampleMetadata, { includeSourceRefs: true });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining('Source References'),
        })
      );
    });

    it('should return error when response has no text content', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 'test', name: 'test', input: {} }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const client = new LLMClient();
      const result = await client.generate(sampleSourceCode, sampleMetadata);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NO_TEXT_CONTENT');
      expect(result.error?.retryable).toBe(false);
    });

    it('should return error when response has empty content array', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [],
        usage: { input_tokens: 100, output_tokens: 0 },
      });

      const client = new LLMClient();
      const result = await client.generate(sampleSourceCode, sampleMetadata);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('NO_TEXT_CONTENT');
    });
  });

  describe('error handling', () => {
    it('should handle rate limit error with retry', async () => {
      // First call fails with rate limit, second succeeds
      mockCreate
        .mockRejectedValueOnce(new MockRateLimitError())
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: sampleUnknitOutput }],
          usage: { input_tokens: 100, output_tokens: 50 },
        });

      const client = new LLMClient({ maxRetries: 2 });
      const result = await client.generate(sampleSourceCode, sampleMetadata);

      expect(result.success).toBe(true);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('should return error after exhausting retries', async () => {
      mockCreate.mockRejectedValue(new MockRateLimitError());

      const client = new LLMClient({ maxRetries: 2 });
      const result = await client.generate(sampleSourceCode, sampleMetadata);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RATE_LIMIT');
      expect(result.error?.retryable).toBe(true);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('should not retry authentication errors', async () => {
      mockCreate.mockRejectedValueOnce(new MockAuthenticationError());

      const client = new LLMClient({ maxRetries: 3 });
      const result = await client.generate(sampleSourceCode, sampleMetadata);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('AUTHENTICATION_ERROR');
      expect(result.error?.retryable).toBe(false);
      expect(result.error?.status).toBe(401);
      expect(mockCreate).toHaveBeenCalledTimes(1); // No retry
    });

    it('should not retry bad request errors', async () => {
      mockCreate.mockRejectedValueOnce(new MockBadRequestError('Invalid model'));

      const client = new LLMClient({ maxRetries: 3 });
      const result = await client.generate(sampleSourceCode, sampleMetadata);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('BAD_REQUEST');
      expect(result.error?.message).toBe('Invalid model');
      expect(result.error?.retryable).toBe(false);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should retry server errors', async () => {
      mockCreate
        .mockRejectedValueOnce(new MockInternalServerError())
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: sampleUnknitOutput }],
          usage: { input_tokens: 100, output_tokens: 50 },
        });

      const client = new LLMClient({ maxRetries: 2 });
      const result = await client.generate(sampleSourceCode, sampleMetadata);

      expect(result.success).toBe(true);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('should retry connection errors', async () => {
      mockCreate
        .mockRejectedValueOnce(new MockAPIConnectionError())
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: sampleUnknitOutput }],
          usage: { input_tokens: 100, output_tokens: 50 },
        });

      const client = new LLMClient({ maxRetries: 2 });
      const result = await client.generate(sampleSourceCode, sampleMetadata);

      expect(result.success).toBe(true);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('should handle connection error after all retries', async () => {
      mockCreate.mockRejectedValue(new MockAPIConnectionError('Network error'));

      const client = new LLMClient({ maxRetries: 2 });
      const result = await client.generate(sampleSourceCode, sampleMetadata);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CONNECTION_ERROR');
      expect(result.error?.message).toBe('Failed to connect to Anthropic API');
      expect(result.error?.retryable).toBe(true);
    });

    it('should handle unknown errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Something unexpected'));

      const client = new LLMClient({ maxRetries: 1 });
      const result = await client.generate(sampleSourceCode, sampleMetadata);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_ERROR');
      expect(result.error?.message).toBe('Something unexpected');
      expect(result.error?.retryable).toBe(false);
    });

    it('should handle non-Error thrown values', async () => {
      mockCreate.mockRejectedValueOnce('string error');

      const client = new LLMClient({ maxRetries: 1 });
      const result = await client.generate(sampleSourceCode, sampleMetadata);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_ERROR');
    });
  });

  describe('retry behavior', () => {
    it('should use exponential backoff between retries', async () => {
      // Mock setTimeout to track delays
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;
      vi.spyOn(global, 'setTimeout').mockImplementation((fn, delay) => {
        delays.push(delay as number);
        return originalSetTimeout(fn, 0); // Execute immediately for test speed
      });

      mockCreate
        .mockRejectedValueOnce(new MockRateLimitError())
        .mockRejectedValueOnce(new MockRateLimitError())
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: sampleUnknitOutput }],
          usage: { input_tokens: 100, output_tokens: 50 },
        });

      const client = new LLMClient({ maxRetries: 3 });
      await client.generate(sampleSourceCode, sampleMetadata);

      // First retry after 1s (2^0 * 1000), second after 2s (2^1 * 1000)
      expect(delays).toEqual([1000, 2000]);
    });

    it('should respect maxRetries setting', async () => {
      // Mock setTimeout to run immediately
      const originalSetTimeout = global.setTimeout;
      vi.spyOn(global, 'setTimeout').mockImplementation((fn) => {
        return originalSetTimeout(fn, 0);
      });

      mockCreate.mockRejectedValue(new MockRateLimitError());

      const client = new LLMClient({ maxRetries: 5 });
      await client.generate(sampleSourceCode, sampleMetadata);

      expect(mockCreate).toHaveBeenCalledTimes(5);
    });

    it('should work with maxRetries = 1 (no retries)', async () => {
      mockCreate.mockRejectedValueOnce(new MockRateLimitError());

      const client = new LLMClient({ maxRetries: 1 });
      const result = await client.generate(sampleSourceCode, sampleMetadata);

      expect(result.success).toBe(false);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });
});

describe('generateUnknit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should be a convenience function that uses LLMClient', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: sampleUnknitOutput }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await generateUnknit(sampleSourceCode, sampleMetadata);

    expect(result.success).toBe(true);
    expect(result.content).toBe(sampleUnknitOutput);
  });

  it('should pass options to LLMClient', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: sampleUnknitOutput }],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    await generateUnknit(sampleSourceCode, sampleMetadata, {
      model: 'claude-3-opus-20240229',
      includeSourceRefs: true,
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-3-opus-20240229',
        system: expect.stringContaining('Source References'),
      })
    );
  });
});

describe('LLMGenerationResult type', () => {
  it('should have correct shape for success', () => {
    const result: LLMGenerationResult = {
      success: true,
      content: 'fn test():',
      usage: { inputTokens: 100, outputTokens: 50 },
    };

    expect(result.success).toBe(true);
    expect(result.content).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('should have correct shape for failure', () => {
    const result: LLMGenerationResult = {
      success: false,
      error: {
        code: 'API_ERROR',
        message: 'Something went wrong',
        status: 500,
        retryable: true,
      },
    };

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.content).toBeUndefined();
  });
});
