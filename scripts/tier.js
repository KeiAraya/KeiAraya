"use strict";

const fs = require("fs");
const path = require("path");

const username = process.env.USERNAME;
const token = process.env.GITHUB_TOKEN;

if (!username || !token) {
  console.error("Missing USERNAME or GITHUB_TOKEN.");
  process.exit(1);
}

const now = new Date();
const from = new Date(now);
from.setUTCDate(from.getUTCDate() - 365);

const weights = {
  commits: 1,
  stars: 5,
  prs: 3,
  issues: 2,
  followers: 2,
};

const tiers = [
  { name: "S Tier", min: 500, color: "E53935" },
  { name: "A Tier", min: 250, color: "FB8C00" },
  { name: "B Tier", min: 120, color: "2E7D32" },
  { name: "C Tier", min: 60, color: "1976D2" },
  { name: "D Tier", min: 0, color: "546E7A" },
];

const query = `
query($login: String!, $from: DateTime!, $to: DateTime!, $cursor: String) {
  user(login: $login) {
    followers { totalCount }
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      totalPullRequestContributions
      totalIssueContributions
    }
    repositories(
      first: 100,
      after: $cursor,
      ownerAffiliations: OWNER,
      isFork: false,
      privacy: PUBLIC
    ) {
      nodes { stargazerCount }
      pageInfo { hasNextPage endCursor }
    }
  }
}
`;

async function graphql(queryText, variables) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `bearer ${token}`,
      "User-Agent": "tier-badge",
    },
    body: JSON.stringify({ query: queryText, variables }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${body}`);
  }

  const json = await response.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data;
}

async function main() {
  let cursor = null;
  let stars = 0;
  let baseStats = null;

  do {
    const data = await graphql(query, {
      login: username,
      from: from.toISOString(),
      to: now.toISOString(),
      cursor,
    });

    const user = data.user;
    if (!baseStats) {
      const contribs = user.contributionsCollection;
      baseStats = {
        commits: contribs.totalCommitContributions,
        prs: contribs.totalPullRequestContributions,
        issues: contribs.totalIssueContributions,
        followers: user.followers.totalCount,
      };
    }

    for (const repo of user.repositories.nodes) {
      stars += repo.stargazerCount;
    }

    const pageInfo = user.repositories.pageInfo;
    cursor = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (cursor);

  const stats = {
    commits: baseStats.commits,
    stars,
    prs: baseStats.prs,
    issues: baseStats.issues,
    followers: baseStats.followers,
  };

  const score =
    stats.commits * weights.commits +
    stats.stars * weights.stars +
    stats.prs * weights.prs +
    stats.issues * weights.issues +
    stats.followers * weights.followers;

  const tier = tiers.find((entry) => score >= entry.min) || tiers[tiers.length - 1];

  const badge = {
    schemaVersion: 1,
    label: "Developer Tier",
    message: tier.name,
    color: tier.color,
  };

  const metrics = {
    updated: now.toISOString(),
    windowDays: 365,
    score,
    stats,
    weights,
    tiers,
  };

  fs.writeFileSync(path.join(process.cwd(), "tier.json"), JSON.stringify(badge));
  fs.writeFileSync(
    path.join(process.cwd(), "tier-metrics.json"),
    JSON.stringify(metrics, null, 2)
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
