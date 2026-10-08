export class ApiFailure extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409 | 422 | 500,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
