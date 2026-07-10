export type FetchLike = typeof fetch;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ApiClientConfig = {
  baseUrl: string;
  fetchImpl?: FetchLike;
  headers?: HeadersInit;
};

export type ApiClient = {
  requestJson<T>(endpoint: string, init: RequestInit): Promise<T>;
  requestWithoutJson(endpoint: string, init: RequestInit): Promise<void>;
};

export function createApiClient(config: ApiClientConfig): ApiClient {
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    async requestJson<T>(endpoint: string, init: RequestInit): Promise<T> {
      const response = await request(fetchImpl, config.baseUrl, endpoint, init, config.headers);
      return (await response.json()) as T;
    },

    async requestWithoutJson(endpoint: string, init: RequestInit): Promise<void> {
      await request(fetchImpl, config.baseUrl, endpoint, init, config.headers);
    },
  };
}

async function request(
  fetchImpl: FetchLike,
  baseUrl: string,
  endpoint: string,
  init: RequestInit,
  headers: HeadersInit | undefined,
): Promise<Response> {
  const response = await fetchImpl(`${baseUrl}${endpoint}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...headers,
      ...init.headers,
    },
  });

  if (response.ok) {
    return response;
  }

  throw await createApiError(response);
}

async function createApiError(response: Response): Promise<ApiError> {
  try {
    const parsed = (await response.json()) as {
      error?: {
        message?: string;
      };
    };

    if (parsed.error?.message) {
      return new ApiError(parsed.error.message, response.status);
    }
  } catch {
    // Fall back to the generic HTTP status message below.
  }

  return new ApiError(
    `Request failed with ${response.status} ${response.statusText}.`,
    response.status,
  );
}
