import { expect, test } from "bun:test";
import { createApiClient } from "./client";

function createFetchMock(responseFactory: () => Response): typeof fetch {
  return Object.assign(async () => responseFactory(), {
    preconnect: fetch.preconnect.bind(fetch),
  }) as typeof fetch;
}

test("requestJson returns parsed json", async () => {
  const client = createApiClient({
    baseUrl: "http://localhost:8787",
    fetchImpl: createFetchMock(() =>
      new Response(JSON.stringify({ registration: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  });

  await expect(client.requestJson("/registration", { method: "GET" })).resolves.toEqual({
    registration: null,
  });
});

test("requestJson turns backend error envelopes into friendly errors", async () => {
  const client = createApiClient({
    baseUrl: "http://localhost:8787",
    fetchImpl: createFetchMock(() =>
      new Response(JSON.stringify({ error: { message: "No registration found." } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    ),
  });

  await expect(client.requestJson("/registration", { method: "GET" })).rejects.toThrow(
    "No registration found.",
  );
});
