const state = {
  seasonStart: 2004,
  seasonEnd: 2025,
  team: "ALL",
  courtMetric: "attempts",
  rankMode: "teams",
  compareA: 2004,
  compareB: 2025,
};

const fmt = {
  int: d3.format(","),
  pct: d3.format(".1%"),
  one: d3.format(".1f"),
};

const colors = {
  teal: "#0f766e",
  blue: "#2563eb",
  amber: "#b45309",
  rust: "#b91c1c",
  ink: "#182026",
  muted: "#66717a",
};

const tooltip = d3.select("#tooltip");

Promise.all([
  d3.json("data/metadata.json"),
  d3.json("data/season_summary.json"),
  d3.json("data/team_summary.json"),
  d3.json("data/player_summary.json"),
  d3.json("data/zone_summary.json"),
  d3.json("data/hex/ALL.json"),
])
  .then(([metadata, seasons, teams, players, zones, leagueHexes]) => {
    const app = {
      metadata,
      seasons,
      teams,
      players,
      zones,
      hexCache: new Map([["ALL", leagueHexes]]),
      hexes: leagueHexes,
    };
    initialize(app);
    render(app);
  })
  .catch((error) => {
    d3.select("main").html(`<section class="panel"><h2>数据加载失败</h2><p>${error.message}</p></section>`);
  });

function initialize(app) {
  state.seasonStart = d3.min(app.seasons, (d) => d.season);
  state.seasonEnd = d3.max(app.seasons, (d) => d.season);
  state.compareA = state.seasonStart;
  state.compareB = state.seasonEnd;

  const seasonOptions = app.seasons.map((d) => [d.season, d.season_label]);
  fillSelect("#season-start", seasonOptions, state.seasonStart);
  fillSelect("#season-end", seasonOptions, state.seasonEnd);
  fillSelect("#compare-a", seasonOptions, state.compareA);
  fillSelect("#compare-b", seasonOptions, state.compareB);

  const teamNames = ["ALL", ...Array.from(new Set(app.teams.map((d) => d.team))).sort(d3.ascending)];
  fillSelect(
    "#team-select",
    teamNames.map((team) => [team, team === "ALL" ? "全联盟" : team]),
    state.team,
  );

  d3.select("#season-start").on("change", (event) => {
    state.seasonStart = +event.target.value;
    if (state.seasonStart > state.seasonEnd) {
      state.seasonEnd = state.seasonStart;
      d3.select("#season-end").property("value", state.seasonEnd);
    }
    render(app);
  });
  d3.select("#season-end").on("change", (event) => {
    state.seasonEnd = +event.target.value;
    if (state.seasonEnd < state.seasonStart) {
      state.seasonStart = state.seasonEnd;
      d3.select("#season-start").property("value", state.seasonStart);
    }
    render(app);
  });
  d3.select("#team-select").on("change", async (event) => {
    state.team = event.target.value;
    await render(app);
  });
  d3.select("#court-metric").on("change", (event) => {
    state.courtMetric = event.target.value;
    render(app);
  });
  d3.select("#rank-mode").on("change", (event) => {
    state.rankMode = event.target.value;
    render(app);
  });
  d3.select("#compare-a").on("change", (event) => {
    state.compareA = +event.target.value;
    renderCompare(app);
  });
  d3.select("#compare-b").on("change", (event) => {
    state.compareB = +event.target.value;
    renderCompare(app);
  });
  d3.select("#reset-btn").on("click", () => {
    state.seasonStart = d3.min(app.seasons, (d) => d.season);
    state.seasonEnd = d3.max(app.seasons, (d) => d.season);
    state.team = "ALL";
    state.courtMetric = "attempts";
    state.rankMode = "teams";
    d3.select("#season-start").property("value", state.seasonStart);
    d3.select("#season-end").property("value", state.seasonEnd);
    d3.select("#team-select").property("value", state.team);
    d3.select("#court-metric").property("value", state.courtMetric);
    d3.select("#rank-mode").property("value", state.rankMode);
    render(app);
  });

  d3.select("#header-stats")
    .selectAll("div")
    .data([
      ["投篮记录", fmt.int(app.metadata.total_attempts)],
      ["赛季", app.metadata.season_count],
      ["球员", fmt.int(app.metadata.player_count)],
    ])
    .join("div")
    .attr("class", "header-pill")
    .html((d) => `<strong>${d[1]}</strong><br><span>${d[0]}</span>`);
}

function fillSelect(selector, options, selected) {
  d3.select(selector)
    .selectAll("option")
    .data(options)
    .join("option")
    .attr("value", (d) => d[0])
    .property("selected", (d) => d[0] === selected)
    .text((d) => d[1]);
}

async function render(app) {
  await ensureHexData(app, state.team);
  renderKpis(app);
  renderCourt(app, "#court-chart", filteredHexes(app), {
    metric: state.courtMetric,
    titleTarget: "#court-caption",
    legendTarget: "#court-legend",
  });
  renderRanking(app);
  renderTrend(app);
  renderZoneMatrix(app);
  renderCompare(app);
}

async function ensureHexData(app, team) {
  if (app.hexCache.has(team)) {
    app.hexes = app.hexCache.get(team);
    return;
  }
  const file = app.metadata.hex_files[team];
  if (!file) {
    app.hexes = app.hexCache.get("ALL");
    return;
  }
  d3.select("#court-caption").text(`正在加载 ${team} 的投篮空间数据...`);
  const rows = await d3.json(`data/${file}`);
  app.hexCache.set(team, rows);
  app.hexes = rows;
}

function inSeasonRange(d) {
  return d.season >= state.seasonStart && d.season <= state.seasonEnd;
}

function mergeStats(rows, keyFn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = keyFn(row);
    if (!map.has(key)) {
      map.set(key, { key, attempts: 0, made: 0, three_attempts: 0, distance_sum: 0, clutch_attempts: 0 });
    }
    const item = map.get(key);
    item.attempts += row.attempts;
    item.made += row.made;
    item.three_attempts += Math.round(row.three_rate * row.attempts);
    item.distance_sum += row.avg_distance * row.attempts;
    item.clutch_attempts += row.clutch_attempts || 0;
  });
  return Array.from(map.values()).map(finalizeMerged);
}

function finalizeMerged(item) {
  item.fg_pct = item.attempts ? item.made / item.attempts : 0;
  item.three_rate = item.attempts ? item.three_attempts / item.attempts : 0;
  item.avg_distance = item.attempts ? item.distance_sum / item.attempts : 0;
  return item;
}

function currentSummary(app) {
  const rows =
    state.team === "ALL"
      ? app.seasons.filter(inSeasonRange)
      : app.teams.filter((d) => inSeasonRange(d) && d.team === state.team);
  const merged = mergeStats(rows, () => "summary")[0];
  return merged || { attempts: 0, made: 0, fg_pct: 0, three_rate: 0, avg_distance: 0, clutch_attempts: 0 };
}

function renderKpis(app) {
  const summary = currentSummary(app);
  const zoneRows = app.zones.filter(inSeasonRange);
  const zoneTotals = mergeStats(zoneRows, (d) => d.zone).sort((a, b) => d3.descending(a.attempts, b.attempts));
  const dominantZone = zoneTotals[0]?.key || "N/A";
  const rows = [
    ["总出手", fmt.int(summary.attempts)],
    ["命中率", fmt.pct(summary.fg_pct)],
    ["三分出手占比", fmt.pct(summary.three_rate)],
    ["平均距离", `${fmt.one(summary.avg_distance)} ft`],
    ["主导区域", dominantZone],
  ];
  d3.select("#kpis")
    .selectAll(".kpi")
    .data(rows)
    .join("div")
    .attr("class", "kpi")
    .html((d) => `<span>${d[0]}</span><strong>${d[1]}</strong>`);
}

function filteredHexes(app) {
  const rows = app.hexes.filter((d) => inSeasonRange(d) && d.team === state.team);
  const grouped = mergeStats(rows, (d) => `${d.x}|${d.y}`);
  const zoneLookup = d3.rollup(
    rows,
    (items) => d3.greatest(d3.rollups(items, (v) => d3.sum(v, (d) => d.attempts), (d) => d.zone), (d) => d[1])?.[0] || "",
    (d) => `${d.x}|${d.y}`,
  );
  grouped.forEach((d) => {
    const [x, y] = d.key.split("|").map(Number);
    d.x = x;
    d.y = y;
    d.zone = zoneLookup.get(d.key) || "Unknown";
  });
  return grouped;
}

function metricValue(d, metric) {
  if (metric === "fg_pct") return d.fg_pct;
  if (metric === "three_rate") return d.three_rate;
  return d.attempts;
}

function metricLabel(metric) {
  return {
    attempts: "出手量",
    fg_pct: "命中率",
    three_rate: "三分占比",
  }[metric];
}

function metricFormatter(metric) {
  return metric === "attempts" ? fmt.int : fmt.pct;
}

function colorScale(rows, metric) {
  if (metric === "fg_pct") {
    return d3.scaleDiverging([0.35, 0.5, 0.65], d3.interpolatePuOr);
  }
  const max = d3.max(rows, (d) => metricValue(d, metric)) || 1;
  return metric === "three_rate"
    ? d3.scaleSequential([0, max], d3.interpolateBlues)
    : d3.scaleSequentialSqrt([0, max], d3.interpolateYlGnBu);
}

function renderCourt(app, selector, rows, options = {}) {
  const svg = d3.select(selector);
  const node = svg.node();
  const width = Math.max(320, node.clientWidth || 720);
  const height = Math.max(320, node.clientHeight || 560);
  const margin = { top: 18, right: 24, bottom: 24, left: 24 };
  const x = d3.scaleLinear().domain([-25, 25]).range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, 47]).range([height - margin.bottom, margin.top]);
  const metric = options.metric || "attempts";
  const color = colorScale(rows, metric);
  const radius = Math.max(3.5, (x(2) - x(0)) * 0.58);

  svg.attr("viewBox", [0, 0, width, height]).selectAll("*").remove();
  drawCourt(svg, x, y);

  svg
    .append("g")
    .selectAll("path")
    .data(rows.filter((d) => d.attempts > 0))
    .join("path")
    .attr("class", "hex")
    .attr("d", (d) => hexPath(x(d.x), y(d.y), radius))
    .attr("fill", (d) => color(metricValue(d, metric)))
    .attr("fill-opacity", (d) => (metric === "attempts" ? 0.45 + Math.min(0.5, d.attempts / 8000) : 0.82))
    .attr("stroke", "rgba(24,32,38,0.16)")
    .on("mousemove", (event, d) => {
      showTooltip(event, `<strong>${d.zone}</strong>${metricLabel(metric)}：${metricFormatter(metric)(metricValue(d, metric))}<br>出手：${fmt.int(d.attempts)}<br>命中率：${fmt.pct(d.fg_pct)}<br>三分占比：${fmt.pct(d.three_rate)}`);
    })
    .on("mouseleave", hideTooltip);

  svg
    .append("text")
    .attr("x", x(-24))
    .attr("y", y(45.8))
    .attr("class", "note")
    .text(`${state.team === "ALL" ? "全联盟" : state.team} · ${state.seasonStart}-${state.seasonEnd}`);

  if (options.titleTarget) {
    d3.select(options.titleTarget).text(`${state.team === "ALL" ? "全联盟" : state.team}，${state.seasonStart}-${state.seasonEnd}，按${metricLabel(metric)}着色。`);
  }
  if (options.legendTarget) {
    renderLegend(options.legendTarget, rows, metric, color);
  }
}

function drawCourt(svg, x, y) {
  const line = d3.line().x((d) => x(d[0])).y((d) => y(d[1]));
  svg.append("rect").attr("x", x(-25)).attr("y", y(47)).attr("width", x(25) - x(-25)).attr("height", y(0) - y(47)).attr("class", "court-fill");
  const paths = [
    [[-25, 0], [-25, 47], [25, 47], [25, 0], [-25, 0]],
    [[-8, 0], [-8, 19], [8, 19], [8, 0]],
    [[-3, 4], [3, 4]],
    [[-22, 0], [-22, 14]],
    [[22, 0], [22, 14]],
  ];
  svg.append("g").selectAll("path").data(paths).join("path").attr("class", "court-line").attr("d", line);
  svg.append("circle").attr("cx", x(0)).attr("cy", y(5.25)).attr("r", Math.abs(y(5.25) - y(6))).attr("class", "court-line");
  svg.append("path").attr("class", "court-line").attr("d", arcPath(x, y, 0, 5.25, 4, 0, Math.PI));
  svg.append("path").attr("class", "court-line").attr("d", arcPath(x, y, 0, 19, 6, 0, Math.PI * 2));
  svg.append("path").attr("class", "court-line").attr("d", threePointPath(x, y));
}

function arcPath(x, y, cx, cy, r, start, end) {
  const points = d3.range(start, end + 0.02, 0.04).map((a) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  return d3.line().x((d) => x(d[0])).y((d) => y(d[1]))(points);
}

function threePointPath(x, y) {
  const points = [[-22, 14]];
  d3.range(Math.PI - 0.36, 0.36, -0.035).forEach((a) => {
    points.push([Math.cos(a) * 23.75, 5.25 + Math.sin(a) * 23.75]);
  });
  points.push([22, 14]);
  return d3.line().x((d) => x(d[0])).y((d) => y(d[1]))(points);
}

function hexPath(cx, cy, r) {
  const points = d3.range(6).map((i) => {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
  return `M${points.map((p) => p.join(",")).join("L")}Z`;
}

function renderLegend(selector, rows, metric, color) {
  const values = rows.map((d) => metricValue(d, metric));
  const min = metric === "fg_pct" ? 0.35 : d3.min(values) || 0;
  const max = metric === "fg_pct" ? 0.65 : d3.max(values) || 1;
  const formatter = metricFormatter(metric);
  const stops = d3.range(5).map((i) => min + ((max - min) * i) / 4);
  d3.select(selector)
    .html("")
    .selectAll("span")
    .data(stops)
    .join("span")
    .style("display", "inline-block")
    .style("width", "22px")
    .style("height", "10px")
    .style("margin-right", "2px")
    .style("background", (d) => color(d))
    .attr("title", (d) => formatter(d));
  d3.select(selector).append("div").text(`${formatter(min)} - ${formatter(max)}`);
}

function renderRanking(app) {
  const svg = d3.select("#ranking-chart");
  const node = svg.node();
  const width = Math.max(320, node.clientWidth || 420);
  const height = Math.max(260, node.clientHeight || 310);
  const margin = { top: 18, right: 28, bottom: 28, left: 142 };
  const source =
    state.rankMode === "teams"
      ? mergeStats(app.teams.filter(inSeasonRange), (d) => d.team)
      : mergeStats(app.players.filter(inSeasonRange), (d) => `${d.player}|${d.team}`).map((d) => {
          const [player, team] = d.key.split("|");
          d.player = player;
          d.team = team;
          return d;
        });
  const minAttempts = state.rankMode === "teams" ? 1500 : 500;
  const metric = state.courtMetric === "attempts" ? "three_rate" : state.courtMetric;
  const rows = source
    .filter((d) => d.attempts >= minAttempts)
    .sort((a, b) => d3.descending(metricValue(a, metric), metricValue(b, metric)))
    .slice(0, 10);

  const x = d3.scaleLinear().domain([0, d3.max(rows, (d) => metricValue(d, metric)) || 1]).nice().range([margin.left, width - margin.right]);
  const y = d3.scaleBand().domain(rows.map((d) => d.key)).range([margin.top, height - margin.bottom]).padding(0.22);
  svg.attr("viewBox", [0, 0, width, height]).selectAll("*").remove();
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).ticks(4).tickFormat(metricFormatter(metric)));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).tickFormat((d) => shortLabel(d.split("|")[0], 18)));
  svg
    .append("g")
    .selectAll("rect")
    .data(rows)
    .join("rect")
    .attr("class", "bar")
    .attr("x", margin.left)
    .attr("y", (d) => y(d.key))
    .attr("width", (d) => x(metricValue(d, metric)) - margin.left)
    .attr("height", y.bandwidth())
    .attr("fill", (d) => (state.rankMode === "teams" && d.key === state.team ? colors.amber : colors.teal))
    .on("click", (_, d) => {
      if (state.rankMode === "teams") {
        state.team = d.key;
        d3.select("#team-select").property("value", state.team);
        render(app);
      }
    })
    .on("mousemove", (event, d) => {
      showTooltip(event, `<strong>${d.key.replace("|", " · ")}</strong>${metricLabel(metric)}：${metricFormatter(metric)(metricValue(d, metric))}<br>出手：${fmt.int(d.attempts)}<br>命中率：${fmt.pct(d.fg_pct)}`);
    })
    .on("mouseleave", hideTooltip);
}

function renderTrend(app) {
  const svg = d3.select("#trend-chart");
  const node = svg.node();
  const width = Math.max(320, node.clientWidth || 520);
  const height = Math.max(260, node.clientHeight || 310);
  const margin = { top: 18, right: 78, bottom: 34, left: 48 };
  const rows = app.seasons;
  const x = d3.scaleLinear().domain(d3.extent(rows, (d) => d.season)).range([margin.left, width - margin.right]);
  const yPct = d3.scaleLinear().domain([0, 0.5]).nice().range([height - margin.bottom, margin.top]);
  const yDist = d3.scaleLinear().domain([0, d3.max(rows, (d) => d.avg_distance)]).nice().range([height - margin.bottom, margin.top]);
  const series = [
    { key: "three_rate", label: "三分占比", color: colors.blue, y: yPct, fmt: fmt.pct },
    { key: "fg_pct", label: "命中率", color: colors.teal, y: yPct, fmt: fmt.pct },
    { key: "avg_distance", label: "平均距离", color: colors.amber, y: yDist, fmt: (d) => `${fmt.one(d)} ft` },
  ];

  svg.attr("viewBox", [0, 0, width, height]).selectAll("*").remove();
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).tickFormat(d3.format("d")).ticks(8));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(yPct).tickFormat(fmt.pct).ticks(5));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${width - margin.right},0)`).call(d3.axisRight(yDist).ticks(5));

  series.forEach((s, i) => {
    svg
      .append("path")
      .datum(rows)
      .attr("class", "trend-line")
      .attr("stroke", s.color)
      .attr("d", d3.line().x((d) => x(d.season)).y((d) => s.y(d[s.key])));
    svg
      .append("text")
      .attr("x", width - margin.right + 10)
      .attr("y", margin.top + 16 + i * 18)
      .attr("fill", s.color)
      .attr("font-size", 12)
      .text(s.label);
  });

  svg
    .append("rect")
    .attr("x", x(state.seasonStart))
    .attr("y", margin.top)
    .attr("width", Math.max(2, x(state.seasonEnd) - x(state.seasonStart)))
    .attr("height", height - margin.top - margin.bottom)
    .attr("fill", "rgba(15,118,110,0.08)")
    .attr("stroke", "rgba(15,118,110,0.3)");
}

function renderZoneMatrix(app) {
  const svg = d3.select("#zone-chart");
  const node = svg.node();
  const width = Math.max(320, node.clientWidth || 520);
  const height = Math.max(260, node.clientHeight || 310);
  const margin = { top: 18, right: 20, bottom: 44, left: 132 };
  const seasons = app.seasons.map((d) => d.season);
  const zones = app.metadata.zones;
  const seasonAttempts = new Map(app.seasons.map((d) => [d.season, d.attempts]));
  const rows = app.zones.map((d) => ({ ...d, share: d.attempts / (seasonAttempts.get(d.season) || 1) }));
  const x = d3.scaleBand().domain(seasons).range([margin.left, width - margin.right]).padding(0.04);
  const y = d3.scaleBand().domain(zones).range([margin.top, height - margin.bottom]).padding(0.08);
  const color = d3.scaleSequential([0, d3.max(rows, (d) => d.share) || 0.35], d3.interpolateOrRd);

  svg.attr("viewBox", [0, 0, width, height]).selectAll("*").remove();
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x).tickValues(seasons.filter((d, i) => i % 3 === 0)));
  svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y).tickFormat((d) => shortLabel(d, 20)));
  svg
    .append("g")
    .selectAll("rect")
    .data(rows)
    .join("rect")
    .attr("x", (d) => x(d.season))
    .attr("y", (d) => y(d.zone))
    .attr("width", x.bandwidth())
    .attr("height", y.bandwidth())
    .attr("fill", (d) => color(d.share))
    .on("mousemove", (event, d) => showTooltip(event, `<strong>${d.season} · ${d.zone}</strong>区域占比：${fmt.pct(d.share)}<br>出手：${fmt.int(d.attempts)}<br>命中率：${fmt.pct(d.fg_pct)}`))
    .on("mouseleave", hideTooltip);
}

function renderCompare(app) {
  d3.select("#compare-a-title").text(`${state.compareA} 赛季`);
  d3.select("#compare-b-title").text(`${state.compareB} 赛季`);
  const rowsA = app.hexes.filter((d) => d.season === state.compareA && d.team === state.team);
  const rowsB = app.hexes.filter((d) => d.season === state.compareB && d.team === state.team);
  renderCourt(app, "#compare-a-chart", rowsA, { metric: "attempts" });
  renderCourt(app, "#compare-b-chart", rowsB, { metric: "attempts" });
}

function shortLabel(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function showTooltip(event, html) {
  tooltip.style("opacity", 1).style("left", `${event.clientX}px`).style("top", `${event.clientY}px`).html(html);
}

function hideTooltip() {
  tooltip.style("opacity", 0);
}
