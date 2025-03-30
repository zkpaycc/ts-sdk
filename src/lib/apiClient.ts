import { BASE_API_URL } from "./constants";

/**
 * Represents an error response from the backend API
 */
type BackendErrorResponse = {
  message: string;
  error: string;
  statusCode: number;
};

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly errorType?: string,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = "ApiError";
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/**
 * Configuration options for the API client
 */
interface ApiClientConfig {
  baseUrl?: string;
  timeout?: number;
  headers?: HeadersInit;
}

/**
 * Options for individual API requests
 */
export interface RequestOptions extends RequestInit {
  headers?: HeadersInit;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: HeadersInit;
  private readonly timeout: number;

  constructor(config: ApiClientConfig = {}) {
    if (!config.baseUrl && !BASE_API_URL) {
      throw new Error("No base URL provided for API client");
    }

    this.baseUrl = config.baseUrl || BASE_API_URL;
    this.timeout = config.timeout ?? 5000;
    this.defaultHeaders = {
      "Content-Type": "application/json",
      ...(config.headers || {}),
    };
  }

  /**
   * Makes a generic API request
   * @param endpoint The API endpoint to call
   * @param options Fetch options
   * @returns Promise with the response data
   * @throws ApiError when the request fails
   */
  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const requestId = this.generateRequestId();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      this.logRequest(options.method || "GET", endpoint, requestId);

      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: this.prepareHeaders(options.headers),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await this.parseErrorResponse(response);
        throw new ApiError(
          errorData.message || "API request failed",
          errorData.statusCode,
          errorData.error,
          requestId
        );
      }

      return this.parseResponse(response);
    } catch (error) {
      clearTimeout(timeoutId);
      this.handleRequestError(error, requestId);
    }
  }

  // HTTP Method Shortcuts

  async get<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "GET",
    });
  }

  async post<T>(
    endpoint: string,
    body: unknown,
    options: RequestOptions = {}
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async put<T>(
    endpoint: string,
    body: unknown,
    options: RequestOptions = {}
  ): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  async delete<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>(endpoint, {
      ...options,
      method: "DELETE",
    });
  }

  // Private Helpers

  private prepareHeaders(customHeaders?: HeadersInit): HeadersInit {
    return {
      ...this.defaultHeaders,
      ...customHeaders,
    };
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return response.json();
    }
    return response.text() as unknown as T;
  }

  private async parseErrorResponse(
    response: Response
  ): Promise<BackendErrorResponse> {
    try {
      const data = await response.json();
      return {
        message: data.message || response.statusText,
        error: data.error || "Unknown Error",
        statusCode: data.statusCode || response.status,
      };
    } catch {
      return {
        message: response.statusText,
        error: "Request Failed",
        statusCode: response.status,
      };
    }
  }

  private handleRequestError(error: unknown, requestId: string): never {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof Error) {
      if (error.name === "AbortError") {
        throw new ApiError(
          `Request timed out after ${this.timeout}ms`,
          408,
          "TimeoutError",
          requestId
        );
      }

      throw new ApiError(
        error.message || "Network request failed",
        undefined,
        "NetworkError",
        requestId
      );
    }

    throw new ApiError(
      "An unknown error occurred",
      undefined,
      "UnknownError",
      requestId
    );
  }

  private generateRequestId(): string {
    return Math.random().toString(36).substring(2, 9);
  }

  private logRequest(
    method: string,
    endpoint: string,
    requestId: string
  ): void {
    console.debug(
      `[API] ${method.toUpperCase()} ${endpoint} [Request ID: ${requestId}]`
    );
  }
}
