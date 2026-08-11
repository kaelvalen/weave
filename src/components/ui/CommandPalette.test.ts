import { describe, expect, it } from 'vitest';
import { exampleFromSchema, schemaNeedsParams } from './CommandPalette';

describe('schemaNeedsParams (JSON Schema contract from backend)', () => {
  it('requires params when the schema has properties', () => {
    expect(
      schemaNeedsParams({
        type: 'object',
        properties: { path: { type: 'string' } },
      })
    ).toBe(true);
  });

  it('requires params when the schema has required keys', () => {
    expect(
      schemaNeedsParams({
        type: 'object',
        properties: {},
        required: ['path'],
      })
    ).toBe(true);
  });

  it('does not require params for an open object schema', () => {
    expect(schemaNeedsParams({ type: 'object', properties: {} })).toBe(false);
    expect(schemaNeedsParams(undefined)).toBe(false);
    expect(schemaNeedsParams(null)).toBe(false);
  });

  it('treats non-object schemas as needing input (defensive)', () => {
    expect(schemaNeedsParams('garbage')).toBe(true);
  });
});

describe('exampleFromSchema', () => {
  it('builds a typed example from schema properties', () => {
    const schema = {
      type: 'object',
      properties: {
        path: { type: 'string' },
        timeout: { type: 'integer' },
        staged: { type: 'boolean' },
      },
    };
    expect(exampleFromSchema(schema)).toEqual({
      path: '',
      timeout: 0,
      staged: false,
    });
  });

  it('returns empty object for schemas without properties', () => {
    expect(exampleFromSchema({ type: 'object' })).toEqual({});
    expect(exampleFromSchema(undefined)).toEqual({});
  });
});
