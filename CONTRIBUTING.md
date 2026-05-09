# Contributing

Thanks for considering a contribution.

## Workflow

1. **Open an issue first** for anything non-trivial so we can align on the approach before code is written.
2. **Fork** the repo (or create a branch if you have write access).
3. Create a topic branch: `git checkout -b feat/short-description` (or `fix/...`, `docs/...`).
4. Make focused commits. Keep PRs small — one concern per PR.
5. Push and open a **Pull Request** against `main`.
6. CI must pass and at least one approving review is required before merge.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat: ...` new feature
- `fix: ...` bug fix
- `chore: ...` tooling, deps, non-code
- `docs: ...` documentation only
- `refactor: ...` no behavior change

## Code style

- Rust: `cargo fmt` + `cargo clippy --all-targets -- -D warnings` before pushing.
- Frontend: project linter must pass.

## Reporting bugs / requesting features

Use the issue templates under [Issues → New issue](https://github.com/as1fansar1/NSHackathon/issues/new/choose).

## Security issues

Do **not** open a public issue. Report privately via GitHub's "Report a vulnerability" button on the Security tab, or email the maintainer directly.
