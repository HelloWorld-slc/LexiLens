// Count each task once, not its duplicate result; worksheet attempts live separately.
export function usageParts(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(usageParts);
  if (
    ["prompt_tokens", "completion_tokens", "total_tokens"].some((k) =>
      Number.isFinite(value[k]),
    )
  )
    return [value];
  return Object.values(value).flatMap(usageParts);
}
export function projectUsage(library, project) {
  const rows = [
    ...library.tasks
      .filter((t) => t.projectId === project.id)
      .flatMap((t) => usageParts(t.usage)),
    ...(project.worksheetResults || []).flatMap((r) =>
      (r.attempts || []).flatMap((a) => usageParts(a.usage)),
    ),
  ];
  let input = 0,
    output = 0,
    total = 0,
    cached = 0,
    cacheInput = 0;
  for (const u of rows) {
    input += u.prompt_tokens || 0;
    output += u.completion_tokens || 0;
    total +=
      u.total_tokens ?? (u.prompt_tokens || 0) + (u.completion_tokens || 0);
    const hit =
      u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens;
    if (Number.isFinite(hit) && Number.isFinite(u.prompt_tokens)) {
      cached += hit;
      cacheInput += u.prompt_tokens;
    }
  }
  const last = project.aiLastUsage?.usage;
  return {
    input,
    output,
    total,
    reportedCalls: rows.length,
    cacheRate: cacheInput ? cached / cacheInput : null,
    last: last
      ? (last.total_tokens ??
        (last.prompt_tokens || 0) + (last.completion_tokens || 0))
      : null,
  };
}
