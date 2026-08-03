/** Permission helpers. */
export function has(permissions: string[], permission: string): boolean {
  return permissions.includes(permission);
}

export function hasAny(permissions: string[], required: string[]): boolean {
  return required.some((p) => permissions.includes(p));
}
