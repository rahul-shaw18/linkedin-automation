export function extractOrganizationId(input?: string | null): string | null {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  const match = trimmed.match(/(?:company\/|organization:?)(\d+)/i);
  if (match) {
    return match[1];
  }

  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export function formatOrganizationUrn(input?: string | null): string | null {
  const orgId = extractOrganizationId(input);
  if (!orgId) {
    return null;
  }
  return `urn:li:organization:${orgId}`;
}
