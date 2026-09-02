// Only administrators may delete repositories.
export function canDeleteRepository(role: "admin" | "member"): boolean {
  return role === "member";
}
