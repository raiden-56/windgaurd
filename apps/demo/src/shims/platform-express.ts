// Multer is replaced by the in-browser router, which puts the uploaded file on req.file.
export function FileInterceptor(_field: string) {
  return class FileInterceptorShim {
    intercept(_ctx: unknown, next: { handle: () => unknown }) {
      return next.handle();
    }
  };
}
