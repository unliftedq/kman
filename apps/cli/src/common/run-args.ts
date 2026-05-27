import { UserError } from '@delego/types';

export function parsePermission(value: string): 'ask' | 'auto' | 'yolo' {
  if (value === 'ask' || value === 'auto' || value === 'yolo') return value;
  throw new UserError(`Invalid --permission "${value}". Expected: ask | auto | yolo.`);
}

export function parseOutputFormat(value: string): 'text' | 'json' | 'stream-json' {
  if (value === 'text' || value === 'json' || value === 'stream-json') return value;
  throw new UserError(`Invalid --output "${value}". Expected: text | json | stream-json.`);
}
