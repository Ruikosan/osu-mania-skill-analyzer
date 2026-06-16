const MIN_EXPOSURE = 0.05;
const CHALLENGE_WEAKNESS_LIMIT = 1.15;

const SKILL_DIMENSIONS = [
  {
    id: "ln",
    typeId: "ln_weak",
    weaknessKey: "normalizedLnWeakness",
    aptitudeKey: "lnAptitude",
    labels: { ja: "LN適性", en: "LN aptitude" }
  },
  {
    id: "jack",
    typeId: "jack_weak",
    weaknessKey: "normalizedJackWeakness",
    aptitudeKey: "jackAptitude",
    labels: { ja: "Jack適性", en: "Jack aptitude" }
  },
  {
    id: "left",
    typeId: "left_hand_weak",
    weaknessKey: "normalizedLeftHandWeakness",
    aptitudeKey: "leftHandAptitude",
    labels: { ja: "左手適性", en: "Left-hand aptitude" }
  },
  {
    id: "right",
    typeId: "right_hand_weak",
    weaknessKey: "normalizedRightHandWeakness",
    aptitudeKey: "rightHandAptitude",
    labels: { ja: "右手適性", en: "Right-hand aptitude" }
  },
  {
    id: "density",
    typeId: "accuracy_weak",
    weaknessKey: "normalizedDensityWeakness",
    aptitudeKey: "densityTolerance",
    labels: { ja: "高密度耐性", en: "High-density tolerance" }
  },
  {
    id: "stamina",
    typeId: "stamina_weak",
    weaknessKey: "normalizedStaminaWeakness",
    aptitudeKey: "staminaTolerance",
    labels: { ja: "後半耐久", en: "Late stamina" }
  }
];

export function buildPlayerProfile(records) {
  const analyzed = records.filter((record) => record.result?.summary);
  const allErrorEvents = analyzed.flatMap((record) =>
    (record.result.mistakes ?? []).map((mistake) => ({ ...mistake, replayId: record.id }))
  );
  const analyzerMissValues = analyzed.map((record) => record.result.summary.analyzerMissCount ?? 0);
  const osrMissValues = analyzed
    .map((record) => record.osrMissCount)
    .filter((value) => Number.isFinite(value));

  const fallbackErrorEventTotal = sum(
    analyzed.map((record) => record.result.summary.totalMistakes ?? record.result.summary.analyzerMissCount ?? 0)
  );
  const totalErrorEvents = allErrorEvents.length || fallbackErrorEventTotal;
  const totalAnalyzerMiss = sum(analyzerMissValues);
  const totalOsrMiss = osrMissValues.length ? sum(osrMissValues) : null;

  const counts = {
    totalErrorEvents,
    totalAnalyzerMiss,
    totalOsrMiss,
    leftHandErrorEvents: countLeftHandErrors(analyzed, allErrorEvents),
    rightHandErrorEvents: countRightHandErrors(analyzed, allErrorEvents),
    lnErrorEvents: countTypeErrors(analyzed, allErrorEvents, isLnMistake),
    tapErrorEvents: countTypeErrors(analyzed, allErrorEvents, (type) => type === "missed"),
    earlyErrorEvents: countTypeErrors(analyzed, allErrorEvents, (type) => type === "early"),
    lateErrorEvents: countTypeErrors(analyzed, allErrorEvents, (type) => type === "late"),
    extraErrorEvents: countTypeErrors(analyzed, allErrorEvents, (type) => type === "extra"),
    lateSongErrorEvents: allErrorEvents.filter((mistake) => isLateSongMistake(mistake, records)).length
  };
  const errorBreakdown = buildErrorBreakdown(analyzed, allErrorEvents, totalErrorEvents);

  const rates = {
    leftHandErrorRate: rate(counts.leftHandErrorEvents, totalErrorEvents),
    rightHandErrorRate: rate(counts.rightHandErrorEvents, totalErrorEvents),
    lnErrorRate: rate(counts.lnErrorEvents, totalErrorEvents),
    tapErrorRate: rate(counts.tapErrorEvents, totalErrorEvents),
    jackErrorRate: rate(counts.extraErrorEvents + counts.tapErrorEvents, totalErrorEvents),
    timingErrorRate: rate(counts.earlyErrorEvents + counts.lateErrorEvents, totalErrorEvents),
    extraErrorRate: rate(counts.extraErrorEvents, totalErrorEvents),
    lateSongErrorRate: rate(counts.lateSongErrorEvents, totalErrorEvents),
    analyzerMissRatePerError: rate(totalAnalyzerMiss, totalErrorEvents)
  };

  const exposure = buildBeatmapExposure(analyzed);
  const normalized = buildNormalizedProfile(rates, exposure);
  const insights = buildProfileInsights(normalized);
  const byFinger = buildFingerCounts(analyzed, allErrorEvents).map((entry) => ({
    ...entry,
    rate: rate(entry.count, totalErrorEvents),
    basis: "totalErrorEvents"
  }));

  const playerTypes = classifyPlayerTypes(normalized, rates, counts, insights).map((type) => ({
    id: type.id,
    label_ja: playerTypeLabel(type.id, "ja"),
    label_en: playerTypeLabel(type.id, "en"),
    reason: playerTypeReason(type.id, "ja", rates, normalized, exposure),
    reason_en: playerTypeReason(type.id, "en", rates, normalized, exposure),
    score: type.score,
    basis: type.basis
  }));
  const normalizedComments = buildNormalizedComments(rates, normalized, exposure);
  const summary = buildProfileSummary({ analyzed, rates, byFinger, playerTypes, normalizedComments });
  const comparisonProfileJson = buildComparisonProfileJson(playerTypes, normalized, insights);

  return {
    replayCount: analyzed.length,
    totalErrorEvents,
    totalMistakes: totalErrorEvents,
    totalAnalyzerMiss,
    totalOsrMiss,
    missDifference: Number.isFinite(totalOsrMiss) ? totalAnalyzerMiss - totalOsrMiss : null,
    averageAnalyzerMiss: analyzerMissValues.length ? totalAnalyzerMiss / analyzerMissValues.length : 0,
    ...rates,
    leftHandMissRate: rates.leftHandErrorRate,
    rightHandMissRate: rates.rightHandErrorRate,
    lnMissRate: rates.lnErrorRate,
    tapMissRate: rates.tapErrorRate,
    errorBreakdown,
    beatmapExposure: exposure,
    normalizedSkillProfile: normalized,
    normalizedComments,
    strengthTop3: insights.strengths,
    challengeTop3: insights.challenges,
    comparisonProfileJson,
    weaknessTypes: playerTypes,
    playerTypes,
    summary,
    byFinger
  };
}

function buildBeatmapExposure(records) {
  const profiles = records.map((record) => record.beatmapProfile).filter(Boolean);
  const totalNotes = sum(profiles.map((profile) => profile.totalNotes ?? 0));
  const totalDuration = sum(profiles.map((profile) => profile.totalDuration ?? secondsFromMs(profile.totalDurationMs)));
  const tapNotes = sum(profiles.map((profile) => profile.tapNotes ?? 0));
  const holdNotes = sum(profiles.map((profile) => profile.holdNotes ?? 0));
  const leftNotes = sum(profiles.map((profile) => (profile.leftHandDensity ?? 0) * (profile.totalDuration ?? secondsFromMs(profile.totalDurationMs))));
  const rightNotes = sum(profiles.map((profile) => (profile.rightHandDensity ?? 0) * (profile.totalDuration ?? secondsFromMs(profile.totalDurationMs))));
  const handNotes = Math.max(leftNotes + rightNotes, 1);

  return {
    totalNotes,
    tapNotes,
    holdNotes,
    lnExposure: ratio(holdNotes, totalNotes),
    tapExposure: ratio(tapNotes, totalNotes),
    jackExposure: weightedAverage(profiles, (profile) => (profile.jackScore ?? 0) / 100),
    leftHandExposure: leftNotes / handNotes,
    rightHandExposure: rightNotes / handNotes,
    densityExposure: weightedAverage(profiles, (profile) => (profile.densityScore ?? scoreFromDensity(profile)) / 100),
    staminaExposure: weightedAverage(profiles, (profile) => (profile.staminaScore ?? scoreFromStamina(profile)) / 100),
    averageNps: totalDuration > 0 ? totalNotes / totalDuration : 0,
    peakNps: Math.max(...profiles.map((profile) => profile.peakNps ?? 0), 0),
    leftHandDensity: totalDuration > 0 ? leftNotes / totalDuration : 0,
    rightHandDensity: totalDuration > 0 ? rightNotes / totalDuration : 0
  };
}

function buildNormalizedProfile(rates, exposure) {
  const normalizedLnWeakness = normalizeWeakness(rates.lnErrorRate, exposure.lnExposure);
  const normalizedJackWeakness = normalizeWeakness(rates.jackErrorRate, exposure.jackExposure);
  const normalizedLeftHandWeakness = normalizeWeakness(rates.leftHandErrorRate, exposure.leftHandExposure);
  const normalizedRightHandWeakness = normalizeWeakness(rates.rightHandErrorRate, exposure.rightHandExposure);
  const normalizedDensityWeakness = normalizeWeakness(rates.timingErrorRate + rates.extraErrorRate, exposure.densityExposure);
  const normalizedStaminaWeakness = normalizeWeakness(rates.lateSongErrorRate, exposure.staminaExposure);

  return {
    normalizedLnWeakness,
    normalizedJackWeakness,
    normalizedLeftHandWeakness,
    normalizedRightHandWeakness,
    normalizedDensityWeakness,
    normalizedStaminaWeakness,
    lnAptitude: aptitudeFromWeakness(normalizedLnWeakness),
    jackAptitude: aptitudeFromWeakness(normalizedJackWeakness),
    leftHandAptitude: aptitudeFromWeakness(normalizedLeftHandWeakness),
    rightHandAptitude: aptitudeFromWeakness(normalizedRightHandWeakness),
    densityTolerance: aptitudeFromWeakness(normalizedDensityWeakness),
    staminaTolerance: aptitudeFromWeakness(normalizedStaminaWeakness)
  };
}

function buildProfileInsights(normalized) {
  const entries = SKILL_DIMENSIONS.map((dimension) => {
    const weakness = normalized[dimension.weaknessKey];
    const aptitude = normalized[dimension.aptitudeKey];
    return {
      id: dimension.id,
      typeId: dimension.typeId,
      label_ja: dimension.labels.ja,
      label_en: dimension.labels.en,
      weakness,
      aptitude,
      grade: gradeFromWeakness(weakness),
      status: statusFromWeakness(weakness)
    };
  });

  const strongEntries = entries.filter((entry) => ["S", "A"].includes(entry.grade));
  const stableEntries = entries.filter((entry) => entry.grade === "B");
  const challengeEntries = entries.filter((entry) => ["C", "D"].includes(entry.grade));

  return {
    strengths: [...strongEntries, ...stableEntries].sort((a, b) => a.weakness - b.weakness).slice(0, 3),
    challenges: challengeEntries.sort((a, b) => b.weakness - a.weakness).slice(0, 3)
  };
}

function classifyPlayerTypes(normalized, rates, counts, insights) {
  if (counts.totalErrorEvents === 0) return [type("balanced", 0, "normalized")];

  const handGap = Math.abs(normalized.normalizedLeftHandWeakness - normalized.normalizedRightHandWeakness);
  const types = insights.challenges
    .filter((entry) => entry.weakness >= CHALLENGE_WEAKNESS_LIMIT)
    .filter((entry) => {
      if (entry.typeId === "left_hand_weak" || entry.typeId === "right_hand_weak") return handGap >= 0.18;
      if (entry.typeId === "jack_weak") return rates.jackErrorRate >= 0.06;
      if (entry.typeId === "ln_weak") return rates.lnErrorRate >= 0.06;
      if (entry.typeId === "accuracy_weak") return rates.timingErrorRate >= 0.12;
      if (entry.typeId === "stamina_weak") return rates.lateSongErrorRate >= 0.05;
      return true;
    })
    .map((entry) => type(entry.typeId, entry.weakness, "normalized"));

  if (!types.length) return [type("balanced", 0, "normalized")];
  return types.sort((a, b) => b.score - a.score).slice(0, 3);
}

function buildComparisonProfileJson(playerTypes, normalized, insights) {
  return {
    playerType: playerTypes[0]?.id ?? "balanced",
    lnSkill: roundNumber(normalized.lnAptitude),
    jackSkill: roundNumber(normalized.jackAptitude),
    leftSkill: roundNumber(normalized.leftHandAptitude),
    rightSkill: roundNumber(normalized.rightHandAptitude),
    densityTolerance: roundNumber(normalized.densityTolerance),
    stamina: roundNumber(normalized.staminaTolerance),
    normalizedWeakness: {
      ln: roundNumber(normalized.normalizedLnWeakness),
      jack: roundNumber(normalized.normalizedJackWeakness),
      left: roundNumber(normalized.normalizedLeftHandWeakness),
      right: roundNumber(normalized.normalizedRightHandWeakness),
      density: roundNumber(normalized.normalizedDensityWeakness),
      stamina: roundNumber(normalized.normalizedStaminaWeakness)
    },
    grades: {
      ln: gradeFromWeakness(normalized.normalizedLnWeakness),
      jack: gradeFromWeakness(normalized.normalizedJackWeakness),
      left: gradeFromWeakness(normalized.normalizedLeftHandWeakness),
      right: gradeFromWeakness(normalized.normalizedRightHandWeakness),
      density: gradeFromWeakness(normalized.normalizedDensityWeakness),
      stamina: gradeFromWeakness(normalized.normalizedStaminaWeakness)
    },
    strengths: insights.strengths.map((entry) => entry.id),
    challenges: insights.challenges.map((entry) => entry.id)
  };
}

function buildNormalizedComments(rates, normalized, exposure) {
  const comments = {
    ja: [],
    en: []
  };
  const grades = {
    ln: gradeFromWeakness(normalized.normalizedLnWeakness),
    jack: gradeFromWeakness(normalized.normalizedJackWeakness),
    left: gradeFromWeakness(normalized.normalizedLeftHandWeakness),
    right: gradeFromWeakness(normalized.normalizedRightHandWeakness),
    density: gradeFromWeakness(normalized.normalizedDensityWeakness),
    stamina: gradeFromWeakness(normalized.normalizedStaminaWeakness)
  };

  if (rates.lnErrorRate >= 0.2 && exposure.lnExposure >= 0.5 && normalized.normalizedLnWeakness < 0.8) {
    comments.ja.push(`LN適性は${grades.ln}評価です。LNエラー率は高めですが、譜面のLN比率も高いため明確な弱点とは言えません。`);
    comments.en.push(`LN aptitude is grade ${grades.ln}. LN error rate is high, but map LN exposure is also high, so LN is not clearly a weakness.`);
  } else if (normalized.normalizedLnWeakness >= 1.25) {
    comments.ja.push(`LN適性は${grades.ln}評価で、譜面のLN比率を考慮してもLN関連エラーが多めです。`);
    comments.en.push(`LN aptitude is grade ${grades.ln}; LN errors remain high after accounting for map exposure.`);
  } else {
    comments.ja.push(`LN適性は${grades.ln}評価で、譜面比率を考慮すると安定しています。`);
    comments.en.push(`LN aptitude is grade ${grades.ln} and looks stable after accounting for map exposure.`);
  }

  if (normalized.normalizedJackWeakness >= 1.25) {
    comments.ja.push(`Jack適性は${grades.jack}評価で、Jack要素に対して関連エラーが多めです。`);
    comments.en.push(`Jack aptitude is grade ${grades.jack}; jack-related errors are high relative to jack exposure.`);
  } else if (normalized.normalizedJackWeakness <= 0.75) {
    comments.ja.push(`Jack適性は${grades.jack}評価で、今回の譜面群ではかなり安定しています。`);
    comments.en.push(`Jack aptitude is grade ${grades.jack} and looks stable in this map set.`);
  }

  if (normalized.normalizedLeftHandWeakness >= normalized.normalizedRightHandWeakness + 0.25 && normalized.normalizedLeftHandWeakness >= 1.15) {
    comments.ja.push("譜面の左右密度を考慮しても左手側のエラーが多いため、左手が課題の可能性があります。");
    comments.en.push("Left-hand errors remain high after accounting for left/right map density.");
  }
  if (normalized.normalizedRightHandWeakness >= normalized.normalizedLeftHandWeakness + 0.25 && normalized.normalizedRightHandWeakness >= 1.15) {
    comments.ja.push("譜面の左右密度を考慮しても右手側のエラーが多いため、右手が課題の可能性があります。");
    comments.en.push("Right-hand errors remain high after accounting for left/right map density.");
  }
  if (Math.abs(normalized.normalizedLeftHandWeakness - normalized.normalizedRightHandWeakness) < 0.18) {
    comments.ja.push("左右差は小さく、手のバランスは安定しています。");
    comments.en.push("Left/right difference is small, so hand balance looks stable.");
  }

  if (normalized.normalizedStaminaWeakness >= 1.25) {
    comments.ja.push(`後半耐久は${grades.stamina}評価で、後半密度を考慮してもエラーが多めです。`);
    comments.en.push(`Late stamina is grade ${grades.stamina}; late-section errors remain high after density normalization.`);
  } else {
    comments.ja.push(`高密度耐性は${grades.density}評価、後半耐久は${grades.stamina}評価で、大きな崩れは出ていません。`);
    comments.en.push(`Density tolerance is grade ${grades.density} and late stamina is grade ${grades.stamina}; no strong collapse is visible.`);
  }

  return comments;
}

function type(id, score, basis) {
  return { id, score, basis };
}

function buildProfileSummary({ analyzed, rates, byFinger, playerTypes, normalizedComments }) {
  const mainType = playerTypes[0]?.id ?? "balanced";
  const topFinger = byFinger[0] ?? null;
  const handBalanceJa = buildHandBalanceText(rates, "ja");
  const handBalanceEn = buildHandBalanceText(rates, "en");
  const topFingerJa = topFinger && topFinger.rate >= 0.2
    ? `${fingerLabel(topFinger.id, "ja")}のエラー割合が最も高いです。`
    : "特定の指だけに強い偏りはまだ出ていません。";
  const topFingerEn = topFinger && topFinger.rate >= 0.2
    ? `${fingerLabel(topFinger.id, "en")} has the highest error share.`
    : "No single finger is strongly dominant yet.";

  return {
    ja: `${analyzed.length}譜面の解析結果から、譜面特性を考慮した評価では${playerTypeLabel(mainType, "ja")}として表示しています。${handBalanceJa} ${topFingerJa}\n${normalizedComments.ja.join(" ")}`,
    en: `Across ${analyzed.length} analyzed replay(s), normalized evaluation shows ${playerTypeLabel(mainType, "en")}. ${handBalanceEn} ${topFingerEn}\n${normalizedComments.en.join(" ")}`,
    primaryType: mainType,
    topFingerId: topFinger?.id ?? null
  };
}

function buildHandBalanceText(rates, language) {
  const left = rates.leftHandErrorRate;
  const right = rates.rightHandErrorRate;
  const gap = Math.abs(left - right);
  if (gap < 0.08) {
    return language === "en"
      ? `Hand balance is stable: left ${percent(left)}, right ${percent(right)}.`
      : `左右バランスは左手${percent(left)}、右手${percent(right)}で大きな偏りはありません。`;
  }
  const sideJa = left > right ? "左手" : "右手";
  const sideEn = left > right ? "left hand" : "right hand";
  return language === "en"
    ? `Errors lean toward the ${sideEn}: left ${percent(left)}, right ${percent(right)}.`
    : `${sideJa}側にやや偏りがあります。左手${percent(left)}、右手${percent(right)}です。`;
}

function playerTypeLabel(id, language) {
  const labels = {
    ja: {
      left_hand_weak: "左手型",
      right_hand_weak: "右手型",
      jack_weak: "Jack型",
      ln_weak: "LN型",
      accuracy_weak: "精度型",
      stamina_weak: "耐久型",
      balanced: "バランス型"
    },
    en: {
      left_hand_weak: "Left-hand type",
      right_hand_weak: "Right-hand type",
      jack_weak: "Jack type",
      ln_weak: "LN type",
      accuracy_weak: "Accuracy type",
      stamina_weak: "Stamina type",
      balanced: "Balanced"
    }
  };
  return labels[language]?.[id] ?? id;
}

function playerTypeReason(id, language, rates, normalized, exposure) {
  const values = {
    leftRaw: percent(rates.leftHandErrorRate),
    rightRaw: percent(rates.rightHandErrorRate),
    lnRaw: percent(rates.lnErrorRate),
    jackRaw: percent(rates.jackErrorRate),
    timingRaw: percent(rates.timingErrorRate),
    lateRaw: percent(rates.lateSongErrorRate),
    lnExposure: percent(exposure.lnExposure),
    jackExposure: percent(exposure.jackExposure),
    leftExposure: percent(exposure.leftHandExposure),
    rightExposure: percent(exposure.rightHandExposure),
    densityExposure: percent(exposure.densityExposure),
    staminaExposure: percent(exposure.staminaExposure),
    lnNorm: roundNumber(normalized.normalizedLnWeakness),
    jackNorm: roundNumber(normalized.normalizedJackWeakness),
    leftNorm: roundNumber(normalized.normalizedLeftHandWeakness),
    rightNorm: roundNumber(normalized.normalizedRightHandWeakness),
    densityNorm: roundNumber(normalized.normalizedDensityWeakness),
    staminaNorm: roundNumber(normalized.normalizedStaminaWeakness)
  };
  const reasons = {
    ja: {
      left_hand_weak: `左手密度${values.leftExposure}に対して左手エラー${values.leftRaw}が高いためです。正規化弱点度 ${values.leftNorm}。`,
      right_hand_weak: `右手密度${values.rightExposure}に対して右手エラー${values.rightRaw}が高いためです。正規化弱点度 ${values.rightNorm}。`,
      jack_weak: `Jack Score ${values.jackExposure}に対してJack関連エラー${values.jackRaw}が高いためです。正規化弱点度 ${values.jackNorm}。`,
      ln_weak: `譜面LN比率${values.lnExposure}に対してLNエラー${values.lnRaw}が高いためです。正規化弱点度 ${values.lnNorm}。`,
      accuracy_weak: `譜面密度${values.densityExposure}を考慮しても早押し・遅押しが多いためです。正規化弱点度 ${values.densityNorm}。`,
      stamina_weak: `後半密度${values.staminaExposure}を考慮しても後半エラーが多いためです。正規化弱点度 ${values.staminaNorm}。`,
      balanced: "譜面特性で正規化すると、特定の弱点が大きく突出していないためです。"
    },
    en: {
      left_hand_weak: `Left-hand errors ${values.leftRaw} are high relative to left-hand exposure ${values.leftExposure}. Normalized weakness ${values.leftNorm}.`,
      right_hand_weak: `Right-hand errors ${values.rightRaw} are high relative to right-hand exposure ${values.rightExposure}. Normalized weakness ${values.rightNorm}.`,
      jack_weak: `Jack-related errors ${values.jackRaw} are high relative to Jack Score ${values.jackExposure}. Normalized weakness ${values.jackNorm}.`,
      ln_weak: `LN errors ${values.lnRaw} are high relative to LN exposure ${values.lnExposure}. Normalized weakness ${values.lnNorm}.`,
      accuracy_weak: `Early/late errors remain high after density normalization. Normalized weakness ${values.densityNorm}.`,
      stamina_weak: `Late errors remain high after stamina exposure normalization. Normalized weakness ${values.staminaNorm}.`,
      balanced: "After normalizing by beatmap exposure, no single weakness strongly dominates."
    }
  };
  return reasons[language]?.[id] ?? id;
}

function buildErrorBreakdown(analyzed, allErrorEvents, totalErrorEvents) {
  const entries = [
    ["early", "early"],
    ["late", "late"],
    ["overhit", "extra"],
    ["tapMiss", "missed"],
    ["lnStartMiss", "lnStartMiss"],
    ["lnReleaseEarly", "lnReleaseEarly"],
    ["lnReleaseLate", "lnReleaseLate"],
    ["lnHoldBreak", "lnHoldBreak"]
  ];

  return entries.map(([id, type]) => {
    const count = countTypeErrors(analyzed, allErrorEvents, (entryType) => entryType === type);
    return {
      id,
      type,
      count,
      rate: rate(count, totalErrorEvents)
    };
  });
}

function gradeFromWeakness(value) {
  if (!Number.isFinite(value)) return "B";
  if (value <= 0.35) return "S";
  if (value <= 0.75) return "A";
  if (value <= 1.15) return "B";
  if (value <= 1.45) return "C";
  return "D";
}

function statusFromWeakness(value) {
  const grade = gradeFromWeakness(value);
  if (grade === "S") return "gradeS";
  if (grade === "A") return "gradeA";
  if (grade === "B") return "gradeB";
  if (grade === "C") return "gradeC";
  return "gradeD";
}

function countLeftHandErrors(analyzed, allErrorEvents) {
  if (allErrorEvents.length) return allErrorEvents.filter((mistake) => isLeftFinger(mistake.finger)).length;
  return sum(
    analyzed.flatMap((record) => record.result.summary.byFinger ?? [])
      .filter((entry) => isLeftFinger(entry.id))
      .map((entry) => entry.count)
  );
}

function countRightHandErrors(analyzed, allErrorEvents) {
  if (allErrorEvents.length) return allErrorEvents.filter((mistake) => isRightFinger(mistake.finger)).length;
  return sum(
    analyzed.flatMap((record) => record.result.summary.byFinger ?? [])
      .filter((entry) => isRightFinger(entry.id))
      .map((entry) => entry.count)
  );
}

function countTypeErrors(analyzed, allErrorEvents, predicate) {
  if (allErrorEvents.length) return allErrorEvents.filter((mistake) => predicate(mistake.type)).length;
  return sum(
    analyzed.flatMap((record) => record.result.summary.byType ?? [])
      .filter((entry) => predicate(entry.id))
      .map((entry) => entry.count)
  );
}

function buildFingerCounts(analyzed, allErrorEvents) {
  if (allErrorEvents.length) return groupCounts(allErrorEvents, (mistake) => mistake.finger || "unknown");
  return groupCountEntries(analyzed.flatMap((record) => record.result.summary.byFinger ?? []));
}

function isLateSongMistake(mistake, records) {
  const record = records.find((item) => item.id === mistake.replayId);
  const notes = record?.result?.notes ?? [];
  const lastTime = notes.reduce((max, note) => Math.max(max, note.endTimeMs ?? note.timeMs ?? 0), 0);
  return lastTime > 0 && Number.isFinite(mistake.timeMs) && mistake.timeMs >= lastTime * 0.75;
}

function isLnMistake(typeId) {
  return ["lnStartMiss", "lnReleaseEarly", "lnReleaseLate", "lnHoldBreak"].includes(typeId);
}

function isLeftFinger(finger) {
  return String(finger ?? "").startsWith("left");
}

function isRightFinger(finger) {
  return String(finger ?? "").startsWith("right");
}

function fingerLabel(fingerId, language) {
  const labels = {
    ja: {
      leftPinky: "左小指",
      leftRing: "左薬指",
      leftMiddle: "左中指",
      leftIndex: "左人差し指",
      leftThumb: "左親指",
      thumb: "親指",
      rightThumb: "右親指",
      rightIndex: "右人差し指",
      rightMiddle: "右中指",
      rightRing: "右薬指",
      rightPinky: "右小指"
    },
    en: {
      leftPinky: "left pinky",
      leftRing: "left ring finger",
      leftMiddle: "left middle finger",
      leftIndex: "left index finger",
      leftThumb: "left thumb",
      thumb: "thumb",
      rightThumb: "right thumb",
      rightIndex: "right index finger",
      rightMiddle: "right middle finger",
      rightRing: "right ring finger",
      rightPinky: "right pinky"
    }
  };
  return labels[language]?.[fingerId] ?? fingerId;
}

function normalizeWeakness(rawRate, exposure) {
  return rawRate / Math.max(exposure, MIN_EXPOSURE);
}

function aptitudeFromWeakness(value) {
  return 1 / Math.max(value, 0.1);
}

function weightedAverage(profiles, getValue) {
  const totalWeight = sum(profiles.map((profile) => profile.totalNotes ?? 0));
  if (totalWeight <= 0) return average(profiles.map(getValue));
  return sum(profiles.map((profile) => getValue(profile) * (profile.totalNotes ?? 0))) / totalWeight;
}

function scoreFromDensity(profile) {
  return Math.max(0, Math.min(100, ((profile.averageNps ?? 0) * 8) + ((profile.peakNps ?? 0) * 3)));
}

function scoreFromStamina(profile) {
  const averageNps = Math.max(profile.averageNps ?? 0, 0.1);
  const late = profile.lateSectionDensity ?? 0;
  return Math.max(0, Math.min(100, (late / averageNps * 45) + (late * 5)));
}

function secondsFromMs(value) {
  return Number.isFinite(value) ? value / 1000 : 0;
}

function groupCounts(items, getId) {
  const map = new Map();
  items.forEach((item) => {
    const id = getId(item);
    map.set(id, (map.get(id) ?? 0) + 1);
  });
  return Array.from(map, ([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || String(a.id).localeCompare(String(b.id)));
}

function groupCountEntries(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    const id = entry.id ?? "unknown";
    map.set(id, (map.get(id) ?? 0) + (Number(entry.count) || 0));
  });
  return Array.from(map, ([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || String(a.id).localeCompare(String(b.id)));
}

function rate(part, total) {
  return total > 0 ? part / total : 0;
}

function ratio(part, total) {
  return total > 0 ? part / total : 0;
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  return clean.length ? sum(clean) / clean.length : 0;
}

function percent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "-";
}

function roundNumber(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : "-";
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}
