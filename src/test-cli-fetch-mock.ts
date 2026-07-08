type Fixture = {
  status: number;
  body: unknown;
};

const rawFixtures = process.env.HABITAT_TEST_FETCH_FIXTURES;

if (rawFixtures) {
  const fixtures = JSON.parse(rawFixtures) as Record<string, Fixture>;

  const mockedFetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit | BunFetchRequestInit) => {
      const method = init?.method ?? "GET";
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const fixture = fixtures[`${method} ${url}`];

      if (!fixture) {
        return new Response(
          JSON.stringify({
            error: {
              code: "missing_fixture",
              message: `No fetch fixture for ${method} ${url}.`,
            },
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(JSON.stringify(fixture.body), {
        status: fixture.status,
        headers: { "content-type": "application/json" },
      });
    },
    {
      preconnect: fetch.preconnect.bind(fetch),
    },
  ) as typeof fetch;

  globalThis.fetch = mockedFetch;
}
