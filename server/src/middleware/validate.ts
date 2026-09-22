import { z } from 'zod';
import { AppError } from './error.js';

/** zod 解析请求数据，失败抛 400 VALIDATION_ERROR */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw AppError.validation(
      result.error.issues.map((i) => `${i.path.join('.') || '字段'}: ${i.message}`).join('；'),
    );
  }
  return result.data as z.infer<T>;
}

/** 整数路径参数 */
export function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw AppError.validation('无效的 id');
  return id;
}
