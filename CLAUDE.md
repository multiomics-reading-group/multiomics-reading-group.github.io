# Multiomics Reading Group Site — Claude Notes

## Scheduling talks

When adding a talk to `data/schedule.json`:
- Always fetch the paper link provided to get the exact title and DOI
- Use the DOI URL format for the `paper` field: `https://doi.org/10.xxxxx/...`
- Do not guess or paraphrase the title — look it up from the paper link
- Run `node .github/scripts/verify-schedule.mjs --base HEAD` before committing; it checks the file's shape and that each changed talk's title matches its DOI record. CI runs the same check on PRs and pushes to main.
