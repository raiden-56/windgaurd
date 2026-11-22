import { BadRequestException } from '@nestjs/common';
import { z, ZodType } from 'zod';

export function parse<T extends ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const first = issues[0];
    throw new BadRequestException({
      message: first ? `${first.path || 'input'}: ${first.message}` : 'Invalid input',
      issues,
    });
  }
  return result.data;
}

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const zId = z.string().min(1);
export { z };
