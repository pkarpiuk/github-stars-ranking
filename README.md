# GitHub Stars Ranking

A ranking of the 10,000 most-starred GitHub repositories, refreshed every week. See how repositories climb and fall, which are new, and how many stars they gained since an earlier ranking.

**Live: <https://pkarpiuk.github.io/github-stars-ranking/>**

[![GitHub Stars Ranking: the main table, filter panels and repository details](screenshot.webp)](https://pkarpiuk.github.io/github-stars-ranking/)

## Features

- **Compare to an earlier ranking** (from a week to several years back) with a **Change** column (positions up or down) and a **Gain** column (stars gained, in numbers and percent).
- **Sort by** stars, stars gained, stars gained % or positions gained; **Show** all, new, climbing or falling repositories.
- **Filter panels** for users, topics and languages, with repository counts and star totals; search by name and description.
- **Repository details** (license, last push, issues and pull requests, size, homepage, language bar) and **history charts** of a repository's rank and stars.
- A static page: no server, no database. The data is refreshed by a weekly GitHub Actions workflow and published on GitHub Pages.

Click the **?** button in the page header for a short user manual.

## How it works

Once a week a GitHub Actions workflow runs `update.rb`, which fetches the ranking from the GitHub GraphQL API, builds `db.js` (the ranking, the comparison snapshots and repository metadata) and deploys it with the page (`site/`) to GitHub Pages. Every ranking is also appended to a history file kept on the `data` branch; snapshots older than a year are thinned out to one per quarter. The comparison snapshots shown in the page are picked from that history.

## Run your own

1. Fork the repository (it must be public for free Actions and Pages) and set Pages → Source to **GitHub Actions**.
2. Optionally add a fine-grained read-only token for public repositories as the `STARS_TOKEN` secret (otherwise the built-in `GITHUB_TOKEN` is used).
3. Create the `data` branch for the history, then run the workflow (Actions → Run workflow, with `force`).

To try it locally (Ruby 3, no gems):

```
GITHUB_TOKEN=... ruby update.rb [--force]
cp -r site/. _site/ && cd _site && python3 -m http.server 8000     # http://localhost:8000/
```

The detailed operating guide (first run step by step, workflow options, variables, limits) is in [README-tech.md](README-tech.md) (in Polish).

## License

Copyright (C) 2026 Piotr Karpiuk. Licensed under the **GNU General Public License v3.0**: see [LICENSE](LICENSE).

## Credits and data sources

- Repository data: the [GitHub GraphQL API](https://docs.github.com/en/graphql); repository details in the lower panel come live from the [GitHub REST API](https://docs.github.com/en/rest).
- Language colors: [GitHub Linguist](https://github.com/github-linguist/linguist) (`languages.yml`, MIT license).
- User interface: [Ext JS 4.2](https://www.sencha.com/) by Sencha, bundled in `site/` and used under the GPL v3.
- This project is not affiliated with or endorsed by GitHub.
