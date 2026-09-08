import { ArgumentsHost, NotFoundException } from "@nestjs/common";
import { DomainErrorFilter } from "./http-exception.filter";

/** Minimal fake Express response capturing what the filter sent, without
 * pulling in a real HTTP server for what is otherwise pure logic. */
function makeFakeResponse() {
  const res: { statusCode?: number; body?: unknown; status: (code: number) => typeof res; json: (body: unknown) => typeof res } = {
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

function makeHost(response: unknown): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({}), getNext: () => undefined }),
  } as unknown as ArgumentsHost;
}

class FakeDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRatingError"; // a name this filter's map actually knows
  }
}

test("maps a known domain error name to its configured status", () => {
  const filter = new DomainErrorFilter();
  const res = makeFakeResponse();
  filter.catch(new FakeDomainError("bad stars"), makeHost(res));
  expect(res.statusCode).toBe(400);
  expect(res.body).toEqual({ statusCode: 400, error: "InvalidRatingError", message: "bad stars" });
});

test("an unmapped plain Error falls through to 500", () => {
  const filter = new DomainErrorFilter();
  const res = makeFakeResponse();
  filter.catch(new Error("something unexpected"), makeHost(res));
  expect(res.statusCode).toBe(500);
});

/**
 * Regression test for a real bug caught while manually exercising the
 * running app: visiting an unmapped route returned a 500 with
 * `{"error":"NotFoundException"}` instead of an actual 404, because this
 * filter's `@Catch(Error)` also intercepts Nest's own HttpException
 * instances and was forcing every one of them through the domain-error path
 * (which defaults anything unmapped to 500). Nest's own exceptions must pass
 * through with their real status, not get reinterpreted as a domain error.
 */
test("a Nest HttpException (e.g. the built-in 404 for an unmatched route) passes through with its own status, not forced to 500", () => {
  const filter = new DomainErrorFilter();
  const res = makeFakeResponse();
  filter.catch(new NotFoundException("Cannot GET /nope"), makeHost(res));
  expect(res.statusCode).toBe(404);
  expect((res.body as { message: string }).message).toBe("Cannot GET /nope");
});

/**
 * Regression test for a real bug caught while live-verifying the new
 * CustomerModule against the running app: POST /customers with no
 * identifying field threw a real InvalidCustomerError, but this filter's map
 * never listed it — so it fell through to the unmapped-error 500 default
 * instead of the 400 a validation error should be. Every new domain error
 * class must be added to STATUS_BY_ERROR_NAME, or it silently becomes a 500.
 */
class FakeInvalidCustomerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCustomerError";
  }
}

test("InvalidCustomerError maps to 400, not the unmapped-error 500 default", () => {
  const filter = new DomainErrorFilter();
  const res = makeFakeResponse();
  filter.catch(new FakeInvalidCustomerError("A customer needs at least one of displayName, phone, or email"), makeHost(res));
  expect(res.statusCode).toBe(400);
});

class FakeCustomerNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerNotFoundError";
  }
}

test("CustomerNotFoundError maps to 404, not the unmapped-error 500 default", () => {
  const filter = new DomainErrorFilter();
  const res = makeFakeResponse();
  filter.catch(new FakeCustomerNotFoundError('No customer found with id "x"'), makeHost(res));
  expect(res.statusCode).toBe(404);
});
