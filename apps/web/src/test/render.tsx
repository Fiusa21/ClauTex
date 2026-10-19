import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { vi } from "vitest";
import { routes } from "../router.tsx";

/** Renders the real route tree at `path` with a fresh query client. */
export function renderApp(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router };
}

type Handler = (init: RequestInit | undefined) => Response;

/** Stubs fetch with handlers keyed by "METHOD /path"; unknown requests fail the test. */
export function stubApi(handlers: Partial<Record<string, Handler>>) {
  const calls: { key: string; init: RequestInit | undefined }[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const key = `${init?.method ?? "GET"} ${url}`;
    calls.push({ key, init });
    const handler = handlers[key];
    if (!handler) return Promise.reject(new Error(`unexpected request ${key}`));
    return Promise.resolve(handler(init));
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

export const problem = (status: number, code: string, detail: string) =>
  Response.json({ status, code, detail }, { status });
