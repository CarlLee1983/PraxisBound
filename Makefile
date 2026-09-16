.PHONY: verify verify-protocol verify-bootstrap verify-doctor verify-story verify-handoff verify-execution verify-release verify-typescript verify-go verify-actions verify-tooling verify-portability verify-praxisbound release-check

verify: verify-protocol verify-bootstrap verify-doctor verify-story verify-handoff verify-release verify-typescript verify-go verify-actions verify-execution verify-tooling verify-praxisbound

release-check: verify
	./scripts/release-check

verify-protocol:
	sh -n tests/protocol.sh tests/code-quality.sh tests/human-review.sh tests/review-integrity.sh
	./tests/protocol.sh
	./tests/code-quality.sh
	./tests/human-review.sh
	./tests/review-integrity.sh

verify-bootstrap:
	sh -n scripts/bootstrap tests/bootstrap.sh
	./tests/bootstrap.sh
	sh -n scripts/codex-activate tests/codex-activation.sh
	sh -n specs/stories/FF-225-codex-project-activation/walkthrough-fixtures.sh
	./tests/codex-activation.sh

verify-doctor:
	sh -n scripts/doctor tests/doctor.sh
	./tests/doctor.sh

verify-story:
	sh -n scripts/story-check tests/story-check.sh
	./tests/story-check.sh
	./scripts/story-check
	./scripts/story-check examples/*/specs/stories/*

verify-handoff:
	sh -n scripts/handoff-check tests/handoff-check.sh
	./tests/handoff-check.sh
	./scripts/handoff-check

verify-execution:
	sh -n scripts/verification-check tests/execution-governance.sh
	./tests/execution-governance.sh
	./scripts/verification-check
	./scripts/verification-check examples/*/specs/stories/*
	./scripts/verification-check --result specs/stories/FF-224-execution-governance

verify-release:
	sh -n scripts/release-check tests/release-check-entrypoint.sh

verify-typescript:
	$(MAKE) -C examples/typescript verify

verify-tooling:
	test "pnpm@$$(pnpm --version)" = "$$(node -p 'require("./package.json").packageManager')"
	pnpm install --frozen-lockfile --lockfile-only --offline --ignore-scripts
	pnpm run format:check
	pnpm run lint
	pnpm run typecheck
	pnpm run clean
	pnpm run build
	pnpm test
	sh -n tests/typescript-tooling.sh
	./tests/typescript-tooling.sh
	sh -n tests/release-check-entrypoint.sh
	node --check scripts/release-check-compat.mjs
	pnpm exec prettier --check scripts/release-check-compat.mjs
	./tests/release-check-entrypoint.sh

verify-go:
	$(MAKE) -C examples/go verify

verify-actions:
	go -C examples/go tool actionlint \
		../../templates/ci/github-actions.yml ../../.github/workflows/verify.yml \
		../../.github/workflows/publish.yml

PORTABILITY_SHELL ?= /bin/sh

verify-portability:
	PORTABILITY_SHELL="$(PORTABILITY_SHELL)" sh ./tests/portability.sh

verify-praxisbound:
	sh -n tests/praxisbound-identity.sh tests/praxisbound-activation.sh
	./tests/praxisbound-identity.sh
	./tests/praxisbound-activation.sh
