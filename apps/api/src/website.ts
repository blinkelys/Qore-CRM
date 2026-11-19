import { z } from 'zod';

export const websiteSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    if (value === '') return true;
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  });
