const DEFAULT_LIMIT_PER_TYPE = 2;

export function selectRecommendedMaps(profile, database, language = "ja", limitPerType = DEFAULT_LIMIT_PER_TYPE) {
  if (!profile || !database) return [];

  const categories = database.categories ?? database;
  const weaknessTypes = profile.weaknessTypes?.length ? profile.weaknessTypes : [{ id: "general", reason_ja: "", reason_en: "" }];
  const seen = new Set();
  const recommendations = [];

  weaknessTypes.forEach((weakness) => {
    const maps = categories[weakness.id] ?? [];
    maps.slice(0, limitPerType).forEach((map) => {
      const key = `${weakness.id}:${map.url}:${map.title}`;
      if (seen.has(key)) return;
      seen.add(key);
      recommendations.push({
        ...map,
        category: weakness.id,
        categoryScore: weakness.score ?? 0,
        categoryReason: language === "en" ? weakness.reason_en : weakness.reason_ja,
        reason: language === "en" ? map.reason_en : map.reason_ja
      });
    });
  });

  if (recommendations.length) return recommendations;

  return (categories.general ?? []).slice(0, limitPerType).map((map) => ({
    ...map,
    category: "general",
    categoryScore: 0,
    categoryReason: language === "en" ? "No clear weakness has been detected yet." : "大きな偏りはまだ検出されていません。",
    reason: language === "en" ? map.reason_en : map.reason_ja
  }));
}
