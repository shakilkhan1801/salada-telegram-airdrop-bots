import crypto from 'crypto';
export function uuidv4(): string { return crypto.randomUUID(); }
