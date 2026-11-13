import { describe, it, expect } from 'vitest';
import { extractOrganizationId, formatOrganizationUrn } from './linkedin.util';

describe('linkedin.util', () => {
  it('extracts numeric organization id from various formats', () => {
    expect(extractOrganizationId('112589310')).toBe('112589310');
    expect(extractOrganizationId('urn:li:organization:112589310')).toBe('112589310');
    expect(
      extractOrganizationId('https://www.linkedin.com/company/112589310/admin/dashboard/'),
    ).toBe('112589310');
    expect(extractOrganizationId('invalid_slug')).toBeNull();
    expect(extractOrganizationId('')).toBeNull();
    expect(extractOrganizationId(null)).toBeNull();
  });

  it('formats organization urn correctly', () => {
    expect(formatOrganizationUrn('112589310')).toBe('urn:li:organization:112589310');
    expect(formatOrganizationUrn('urn:li:organization:112589310')).toBe(
      'urn:li:organization:112589310',
    );
    expect(
      formatOrganizationUrn('https://www.linkedin.com/company/112589310/'),
    ).toBe('urn:li:organization:112589310');
    expect(formatOrganizationUrn('invalid')).toBeNull();
  });
});
