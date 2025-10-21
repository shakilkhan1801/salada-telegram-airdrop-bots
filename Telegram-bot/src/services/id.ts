import crypto from 'crypto';

export function nanoid(size = 21): string {
  const bytes = crypto.randomBytes(Math.ceil((size * 3) / 4));
  // base64url then strip non-url-safe chars and trim to size
  const id = bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  if (id.length >= size) return id.slice(0, size);
  // pad if necessary
  return (id + nanoid(size - id.length)).slice(0, size);
}
