/**
 * The WordPress records behind a configured Strapi type.
 * Authors are only the users who wrote exported content — never every account.
 */
export function itemsOf(data, type) {
  const { kind, slug } = type.source;
  if (kind === 'users') {
    const authors = new Set(Object.values(data.entries).flatMap((list) => list.map((e) => e.author)));
    return data.users.filter((u) => authors.has(u.id));
  }
  if (kind === 'taxonomy') return data.terms[slug] ?? [];
  return data.entries[slug] ?? [];
}
