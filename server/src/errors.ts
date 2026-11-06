export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function notFound(message = '内容不存在') {
  return new AppError(404, 'NOT_FOUND', message)
}

export function validation(message: string) {
  return new AppError(400, 'VALIDATION', message)
}

export function conflict(message: string) {
  return new AppError(409, 'CONFLICT', message)
}
